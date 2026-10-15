import {execFile} from 'node:child_process';
import fs from 'node:fs';

// Run a command and return {ok, stdout} (never throws). Used for version / login checks.
export function run(cmd, args, {timeout = 15000} = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {timeout, encoding: 'utf8'}, (err, stdout, stderr) =>
      resolve({ok: !err, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: err?.code}),
    );
  });
}

// Full path of a command on PATH (or null), following symlinks.
export async function which(bin) {
  if (bin.includes('/')) return fs.existsSync(bin) ? fs.realpathSync(bin) : null;
  const {ok, stdout} = await run('/usr/bin/which', [bin]);
  const found = stdout.trim();
  return ok && found ? fs.realpathSync(found) : null;
}

// Reads a CLI's line-delimited JSON output and calls onLine for each parsed object.
export function readJsonLines(stream, onLine) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        onLine(JSON.parse(line));
      } catch {
        // not JSON (log noise): ignore
      }
    }
  });
}

// Short status line for a docs tool call, shown in the chat while the CLI works.
export function describeTool(name, input = {}) {
  if (/search_docs$/.test(name)) return `Searching the docs for “${input.query ?? ''}”`;
  if (/read_doc$/.test(name)) {
    const page = String(input.page ?? '').replace(/^https?:\/\/[^/]+/, '') || 'a page';
    return `Reading ${page}${input.section ? ` › ${input.section}` : ''}`;
  }
  if (/list_docs$/.test(name)) return `Listing pages${input.path_prefix ? ` in ${input.path_prefix}` : ''}`;
  if (/project_board$/.test(name)) {
    const f = [input.status, input.repo, input.assignee && `@${input.assignee}`, input.label].filter(Boolean).join(', ');
    return `Checking the project board${f ? ` (${f})` : ''}`;
  }
  if (/list_issues$/.test(name)) return `Listing open issues${input.repo ? ` in ${input.repo}` : ''}`;
  if (/get_issue$/.test(name)) return `Reading ${input.repo}#${input.number}`;
  if (/search_issues$/.test(name)) return `Searching GitHub issues for “${input.query ?? ''}”`;
  if (/list_releases$/.test(name)) return `Checking releases${input.repo ? ` of ${input.repo}` : ''}`;
  if (/list_files$/.test(name)) return `Listing files in ${input.repo}${input.folder ? `/${input.folder}` : ''}`;
  if (/get_file$/.test(name)) return `Reading ${input.repo}/${input.path ?? ''}`;
  if (/search_code$/.test(name)) return `Searching code for “${input.query ?? ''}”`;
  if (/ci_status$/.test(name)) return `Checking CI${input.repo ? ` for ${input.repo}` : ''}`;
  if (/recent_changes$/.test(name)) return `Looking at merged pull requests${input.repo ? ` in ${input.repo}` : ''}`;
  if (/integration_tests$/.test(name)) return 'Checking the integration tests';
  if (/api_endpoints$/.test(name)) return `Listing API endpoints${input.tag ? ` (${input.tag})` : ''}`;
  if (/api_endpoint$/.test(name)) return `Reading the API spec for ${input.method ? `${input.method} ` : ''}${input.endpoint ?? ''}`;
  if (/api_schema$/.test(name)) return `Reading API schema ${input.name ?? ''}`;
  if (/docs_health$/.test(name)) return 'Checking docs health';
  if (/search_notes$/.test(name)) return `Searching your notes for “${input.query ?? ''}”`;
  if (/list_notes$/.test(name)) return `Listing your notes${input.tag ? ` tagged #${input.tag}` : ''}${input.folder ? ` in ${input.folder}` : ''}`;
  if (/read_note$/.test(name) && input.include_images) return `Looking at your note ${input.note ?? ''} and its images`;
  if (/read_note$/.test(name)) return `Reading your note ${input.note ?? ''}`;
  if (/list_note_tags$/.test(name)) return 'Checking your note tags';
  if (/create_note$/.test(name)) return `Saving a note: “${input.title ?? ''}”`;
  if (/update_note$/.test(name)) return `Updating your note ${input.note ?? ''}`;
  if (/related_notes$/.test(name)) return `Following links from ${input.note ?? 'a note'}`;
  if (/list_tasks$/.test(name)) return `Checking your ${input.status === 'done' ? 'finished' : 'open'} tasks${input.tag ? ` tagged #${input.tag}` : ''}`;
  if (/complete_task$/.test(name)) return `Ticking “${input.text ?? 'a task'}”`;
  if (/rename_note$/.test(name)) return `Renaming ${input.note ?? 'a note'} to “${input.title ?? ''}”`;
  if (/pin_note$/.test(name)) return `${input.pinned === false ? 'Unpinning' : 'Pinning'} ${input.note ?? 'a note'}`;
  if (/list_templates$/.test(name)) return 'Checking your note templates';
  if (/save_template$/.test(name)) return `Saving the template “${input.name ?? input.from_note ?? ''}”`;
  if (/duplicate_note$/.test(name)) return `Copying ${input.note ?? 'a note'}`;
  if (/list_attachments$/.test(name)) return 'Listing images in your notes';
  if (/get_note_image$/.test(name)) return `Looking at ${input.image ?? 'an image'}`;
  if (/attach_image$/.test(name)) return `Adding an image${input.note ? ` to ${input.note}` : ''}`;
  if (/notes_for_doc$/.test(name)) return 'Checking your notes about that page';
  if (/notes_health$/.test(name)) return 'Checking your notes for things to tidy';
  if (/fork_changes$/.test(name)) return `Comparing ${input.repo} with its upstream project`;
  return 'Working…';
}
