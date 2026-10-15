// MCP tools for the notes vault (notes.mjs).
//   Reading: list_notes, search_notes, read_note (a section, and the images it embeds), related_notes,
//            list_note_tags, list_tasks, list_templates, list_attachments, get_note_image,
//            notes_for_doc, notes_health
//   Writing: create_note (optionally from a template), update_note, duplicate_note, complete_task,
//            rename_note, pin_note, attach_image, save_template
// The write tools add or change notes; none deletes. Deleting is left to the person on the Notes page
// (which moves notes to the vault's .trash), never to an agent.
import {z} from 'zod';
import {
  allTags,
  createNote,
  duplicateNote,
  embeddedAttachments,
  findAttachment,
  imageForAgent,
  listAttachments,
  listNotes,
  listTasks,
  listTemplates,
  moveNote,
  noteHeadings,
  noteSection,
  notesHealth,
  notesLinkingTo,
  NoteError,
  readNote,
  relatedNotes,
  renameNote,
  saveAttachment,
  saveTemplate,
  searchNotes,
  setTask,
  templateFor,
  updateNote,
  VAULT_NAME,
} from './notes.mjs';

const MAX_IMAGES = 6;

const text = (t) => ({content: [{type: 'text', text: t}]});
const failed = (err) => {
  if (err instanceof NoteError) return {...text(err.message), isError: true};
  throw err;
};
const siteUrl = (rel) => `${(process.env.DOCS_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '')}/notes?note=${encodeURIComponent(rel)}`;

const line = (n) =>
  [
    `- ${n.title}`,
    `  path: ${n.path}`,
    n.tags.length ? `  tags: ${n.tags.map((t) => `#${t}`).join(' ')}` : null,
    `  created: ${n.created.slice(0, 10)} · updated: ${n.updated.slice(0, 16).replace('T', ' ')}`,
    n.snippet ?? n.excerpt ? `  ${n.snippet ?? n.excerpt}` : null,
  ]
    .filter(Boolean)
    .join('\n');

const describe = (note, verb) =>
  `${verb} "${note.title}"\npath: ${note.path}\nurl: ${siteUrl(note.path)}${note.tags.length ? `\ntags: ${note.tags.map((t) => `#${t}`).join(' ')}` : ''}`;

export function registerNotesTools(server) {
  server.registerTool(
    'list_notes',
    {
      title: 'List notes',
      description:
        `Lists notes in the "${VAULT_NAME}" notes vault (the user's own Markdown notes, also an Obsidian vault), newest first. ` +
        'Filter by tag, folder or date to answer "what did I note about X last week". Use read_note for a note\'s text.',
      inputSchema: {
        tag: z.string().optional().describe('Only notes with this tag (without #); nested tags match too, e.g. "project" matches "project/api"'),
        folder: z.string().optional().describe('Only notes in this folder (and its sub-folders)'),
        since: z.string().optional().describe('Only notes changed (or with sort "created", created) on or after this date, YYYY-MM-DD'),
        until: z.string().optional().describe('… and before the end of this date, YYYY-MM-DD'),
        sort: z.enum(['updated', 'created', 'title']).optional().describe('Default "updated" (newest first)'),
        limit: z.number().int().min(1).max(200).optional().describe('Default 50'),
      },
      annotations: {readOnlyHint: true},
    },
    async ({tag, folder, since, until, sort = 'updated', limit = 50}) => {
      const field = sort === 'created' ? 'created' : 'updated';
      const want = tag?.replace(/^#/, '').toLowerCase();
      let notes = listNotes().filter(
        (n) =>
          (!want || n.tags.some((t) => t.toLowerCase() === want || t.toLowerCase().startsWith(`${want}/`))) &&
          (!folder || n.folder === folder.replace(/\/$/, '') || n.folder.startsWith(`${folder.replace(/\/$/, '')}/`)) &&
          (!since || n[field].slice(0, 10) >= since) &&
          (!until || n[field].slice(0, 10) <= until),
      );
      notes = sort === 'title' ? notes.sort((a, b) => a.title.localeCompare(b.title)) : notes.sort((a, b) => b[field].localeCompare(a[field]));
      if (!notes.length) return text('No notes match. list_note_tags shows the tags in use.');
      return text(`${notes.length} note(s)${notes.length > limit ? `, showing ${limit}` : ''}\n\n${notes.slice(0, limit).map(line).join('\n')}`);
    },
  );

  server.registerTool(
    'search_notes',
    {
      title: 'Search notes',
      description: "Keyword search over the user's notes (titles, tags and text). Every word must match. Returns the best matches with a snippet and path.",
      inputSchema: {
        query: z.string().min(1).describe('Keywords; "#tag" matches tags'),
        limit: z.number().int().min(1).max(50).optional().describe('Default 10'),
      },
      annotations: {readOnlyHint: true},
    },
    async ({query, limit = 10}) => {
      const hits = searchNotes(query, {limit});
      return text(hits.length ? hits.map(line).join('\n') : `No notes match "${query}".`);
    },
  );

  server.registerTool(
    'read_note',
    {
      title: 'Read a note',
      description:
        'Returns a note as Markdown with its tags, dates and the notes linking to it. Pass a path from list_notes/search_notes, or a title as in a [[link]]. ' +
        'Pass section to get one heading of a long note. Pass include_images to also see the images it embeds (screenshots, diagrams, photos).',
      inputSchema: {
        note: z.string().min(1).describe('Path (e.g. "Meetings/2026-10-15 standup.md") or title'),
        section: z.string().optional().describe('A heading (or part of one): returns just that part, with its sub-sections'),
        include_images: z.boolean().optional().describe(`Also return the PNG/JPEG/GIF/WebP images the note (or section) embeds, up to ${MAX_IMAGES}`),
      },
      annotations: {readOnlyHint: true},
    },
    async ({note: ref, section, include_images}) => {
      try {
        const n = readNote(ref);
        let body = n.body.trim();
        if (section) {
          const part = noteSection(n.body, section);
          if (part == null) {
            const hs = noteHeadings(n.body);
            return {...text(`No heading "${section}" in ${n.path}. Headings:\n${hs.map((h) => `${'  '.repeat(h.level - 1)}- ${h.text}`).join('\n') || '(none)'}`), isError: true};
          }
          body = part;
        }
        const header = [
          `# ${n.title}`,
          `path: ${n.path}`,
          `url: ${siteUrl(n.path)}`,
          n.tags.length ? `tags: ${n.tags.map((t) => `#${t}`).join(' ')}` : null,
          `created: ${n.created} · updated: ${n.updated}`,
          n.author ? `author: ${n.author}` : null,
          n.backlinks.length ? `linked from: ${n.backlinks.map((b) => b.path).join(', ')}` : null,
        ].filter(Boolean);
        if (!include_images) return text(`${header.join('\n')}\n\n${body}`);
        // The images it embeds (only those in the section, when one was asked for)
        const inBody = embeddedAttachments({...n, body});
        const images = [];
        const skipped = [];
        for (const rel of inBody) {
          if (images.length >= MAX_IMAGES) {
            skipped.push(`${rel} (over ${MAX_IMAGES} images)`);
            continue;
          }
          try {
            images.push({rel, ...imageForAgent(rel)});
          } catch (err) {
            skipped.push(`${rel} (${err.message})`);
          }
        }
        const notes = [`images: ${images.length ? images.map((i) => i.rel).join(', ') : 'none'}`, skipped.length ? `not included: ${skipped.join('; ')}` : null].filter(Boolean);
        return {
          content: [
            {type: 'text', text: `${[...header, ...notes].join('\n')}\n\n${body}`},
            ...images.flatMap((i) => [
              {type: 'text', text: `Image: ${i.rel}`},
              {type: 'image', data: i.data, mimeType: i.mimeType},
            ]),
          ],
        };
      } catch (err) {
        return failed(err);
      }
    },
  );

  server.registerTool(
    'list_note_tags',
    {
      title: 'List note tags',
      description: 'Every tag used in the notes, with how many notes have it. Check it before tagging a new note, to reuse existing tags.',
      inputSchema: {},
      annotations: {readOnlyHint: true},
    },
    async () => {
      const tags = allTags();
      return text(tags.length ? tags.map((t) => `#${t.tag} (${t.count})`).join('\n') : 'No tags yet.');
    },
  );

  server.registerTool(
    'create_note',
    {
      title: 'Create a note',
      description:
        "Adds a new Markdown note to the user's notes vault. Only when the user asks you to save, write down or note something. " +
        'Reuse existing tags (list_note_tags). Use [[Note title]] to link other notes. Never overwrites: a taken title gets a number added.',
      inputSchema: {
        title: z.string().min(1).max(120).describe('Becomes the file name, as in Obsidian'),
        body: z.string().optional().describe('The note, in Markdown (no front matter; tags go in `tags`). With a template, this goes below it'),
        template: z.string().optional().describe('Start from this template (see list_templates), e.g. "Meeting notes"; {{title}} and {{date}} are filled in'),
        tags: z.array(z.string()).optional().describe('Tags without #, e.g. ["meeting", "bluecore_api"]'),
        folder: z.string().optional().describe('Folder inside the vault, e.g. "Meetings" (created if needed). Default: the top level'),
        author: z.string().optional().describe('Who is writing, e.g. "Claude Code"; default "AI agent"'),
      },
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false},
    },
    async ({title, body = '', tags = [], folder, author, template}) => {
      try {
        let text_ = body;
        let allTags_ = tags;
        if (template) {
          const t = templateFor(template, title);
          text_ = body.trim() ? `${t.body.replace(/\s*$/, '')}\n\n${body}` : t.body;
          allTags_ = [...t.tags, ...tags];
        }
        return text(describe(createNote({title, body: text_, tags: allTags_, folder, author: author || 'AI agent'}), template ? `Created from "${template}"` : 'Created'));
      } catch (err) {
        return failed(err);
      }
    },
  );

  server.registerTool(
    'update_note',
    {
      title: 'Update a note',
      description:
        'Changes an existing note: append text (preferred, keeps what is there), replace the whole text, add/remove tags, or move it to another folder. ' +
        'Only when the user asks. Read the note first when replacing its text.',
      inputSchema: {
        note: z.string().min(1).describe('Path or title of the note'),
        append: z.string().optional().describe('Markdown to add at the end'),
        body: z.string().optional().describe('New full text (replaces the current text; front matter is kept)'),
        add_tags: z.array(z.string()).optional(),
        remove_tags: z.array(z.string()).optional(),
        move_to: z.string().optional().describe('Folder to move the note to ("" = the top level); the file name stays, so [[links]] keep working'),
      },
      annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false},
    },
    async ({note: ref, append, body, add_tags, remove_tags, move_to}) => {
      if (append == null && body == null && !add_tags && !remove_tags && move_to == null) {
        return {...text('Nothing to change: pass append, body, add_tags, remove_tags or move_to.'), isError: true};
      }
      try {
        let note = append == null && body == null && !add_tags && !remove_tags ? readNote(ref) : updateNote(ref, {append, body, addTags: add_tags, removeTags: remove_tags});
        if (move_to != null) note = moveNote(note.path, move_to);
        return text(describe(note, move_to != null ? 'Updated and moved' : 'Updated'));
      } catch (err) {
        return failed(err);
      }
    },
  );

  server.registerTool(
    'related_notes',
    {
      title: 'Related notes',
      description: 'What a note is connected to: the notes it links to (and [[links]] to notes that don\'t exist yet), the notes linking to it, and notes sharing its tags. Use it to follow a topic across notes.',
      inputSchema: {note: z.string().min(1).describe('Path or title')},
      annotations: {readOnlyHint: true},
    },
    async ({note: ref}) => {
      try {
        const r = relatedNotes(ref);
        const list = (items) => (items.length ? items.map((x) => `- ${x.title} (${x.path})`).join('\n') : '(none)');
        return text(
          [
            `# ${r.note.title}`,
            `path: ${r.note.path}`,
            r.note.tags.length ? `tags: ${r.note.tags.map((t) => `#${t}`).join(' ')}` : null,
            `\n## Links to\n${list(r.outgoing)}`,
            r.missing.length ? `\n## Links to notes that don't exist yet\n${r.missing.map((m) => `- [[${m}]]`).join('\n')}` : null,
            `\n## Linked from\n${list(r.backlinks)}`,
            `\n## Sharing tags\n${r.sharing.length ? r.sharing.map((x) => `- ${x.title} (${x.path}): ${x.shared.map((t) => `#${t}`).join(' ')}`).join('\n') : '(none)'}`,
          ]
            .filter(Boolean)
            .join('\n'),
        );
      } catch (err) {
        return failed(err);
      }
    },
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks',
      description:
        'Checklist items ("- [ ] …") across the notes, newest note first, with the note, line and section each is in. ' +
        'Open tasks by default. Filter by tag, folder or since (notes changed on or after a date). Use complete_task to tick one.',
      inputSchema: {
        status: z.enum(['open', 'done', 'all']).optional().describe('Default "open"'),
        tag: z.string().optional(),
        folder: z.string().optional(),
        since: z.string().optional().describe('YYYY-MM-DD'),
        limit: z.number().int().min(1).max(500).optional().describe('Default 100'),
      },
      annotations: {readOnlyHint: true},
    },
    async ({status = 'open', tag, folder, since, limit = 100}) => {
      const tasks = listTasks({status, tag, folder, since});
      if (!tasks.length) return text(`No ${status === 'all' ? '' : `${status} `}tasks match.`);
      const byNote = new Map();
      for (const t of tasks.slice(0, limit)) byNote.set(t.path, [...(byNote.get(t.path) ?? []), t]);
      return text(
        `${tasks.length} ${status === 'all' ? '' : `${status} `}task(s)${tasks.length > limit ? `, showing ${limit}` : ''}\n\n` +
          [...byNote.values()]
            .map(
              (ts) =>
                `${ts[0].title} (${ts[0].path}, updated ${ts[0].updated.slice(0, 10)})\n` +
                ts.map((t) => `  - [${t.done ? 'x' : ' '}] ${t.text}  (line ${t.line}${t.section ? `, under "${t.section}"` : ''})`).join('\n'),
            )
            .join('\n\n'),
      );
    },
  );

  server.registerTool(
    'complete_task',
    {
      title: 'Tick or untick a task',
      description:
        'Marks a checklist item in a note as done (or not done). Pass the note, the line and the task text from list_tasks; ' +
        'if the note changed since, it refuses and says where the task is now. Only when the user asks.',
      inputSchema: {
        note: z.string().min(1).describe('Path from list_tasks'),
        line: z.number().int().min(1).describe('Line from list_tasks'),
        text: z.string().describe('The task text from list_tasks, as a check'),
        done: z.boolean().optional().describe('Default true; false unticks it'),
      },
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true},
    },
    async ({note: ref, line, text: taskText, done = true}) => {
      try {
        const r = setTask(ref, line, taskText, done);
        return text(`${r.changed ? (done ? 'Ticked' : 'Unticked') : `Already ${done ? 'done' : 'open'}`}: "${r.task.text}"\nnote: ${r.note.path}\nurl: ${siteUrl(r.note.path)}`);
      } catch (err) {
        return failed(err);
      }
    },
  );

  server.registerTool(
    'rename_note',
    {
      title: 'Rename a note',
      description: "Gives a note a new title (its file name) and updates the [[links]] to it in other notes. Only when the user asks.",
      inputSchema: {note: z.string().min(1).describe('Path or title'), title: z.string().min(1).max(120).describe('The new title')},
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true},
    },
    async ({note: ref, title}) => {
      try {
        const n = readNote(ref);
        const r = renameNote(n.path, title);
        return text(`${describe(r.note, 'Renamed to')}\nupdated ${r.linksUpdated} link(s) in ${r.notesUpdated} note(s)`);
      } catch (err) {
        return failed(err);
      }
    },
  );

  server.registerTool(
    'pin_note',
    {
      title: 'Pin or unpin a note',
      description: 'Pinned notes show at the top of the Notes list (a pinned: true property). Only when the user asks.',
      inputSchema: {note: z.string().min(1).describe('Path or title'), pinned: z.boolean().optional().describe('Default true; false unpins')},
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true},
    },
    async ({note: ref, pinned = true}) => {
      try {
        return text(describe(updateNote(ref, {pinned}), pinned ? 'Pinned' : 'Unpinned'));
      } catch (err) {
        return failed(err);
      }
    },
  );

  server.registerTool(
    'list_templates',
    {
      title: 'List note templates',
      description: 'Templates in the vault\'s Templates folder, for create_note\'s template option, with their headings so you can tell what each is for.',
      inputSchema: {},
      annotations: {readOnlyHint: true},
    },
    async () => {
      const ts = listTemplates();
      if (!ts.length) return text('No templates yet. They are notes in the Templates folder; save_template makes one (the Notes page can also add starter ones).');
      return text(
        ts
          .map((t) => {
            const hs = noteHeadings(readNote(t.path).body).filter((h) => h.level === 2);
            return `- ${t.title} (${t.path})${t.tags.length ? ` tags: ${t.tags.map((x) => `#${x}`).join(' ')}` : ''}${hs.length ? `\n  sections: ${hs.map((h) => h.text).join(', ')}` : ''}`;
          })
          .join('\n'),
      );
    },
  );

  server.registerTool(
    'save_template',
    {
      title: 'Save a note template',
      description:
        "Creates or updates a template in the vault's Templates folder, for create_note's template option and the Notes page. " +
        'Either from an existing note (from_note: its text, tags and properties; its title in the first heading becomes {{title}}) ' +
        'or from Markdown you write (body). Placeholders: {{title}}, {{date}}, {{time}}, {{date:YYYY-MM-DD HH:mm}}. ' +
        'Only when the user asks. Without replace, a taken name gets a number added; with replace, the template of that name is overwritten.',
      inputSchema: {
        name: z.string().max(120).optional().describe('Template name, e.g. "Sprint retro". Default with from_note: the note\'s title'),
        from_note: z.string().optional().describe('Path or title of a note to turn into a template'),
        body: z.string().optional().describe('The template, in Markdown (no front matter; tags go in `tags`). With from_note, replaces the note\'s text'),
        tags: z.array(z.string()).optional().describe('Tags every note made from it starts with, without #'),
        replace: z.boolean().optional().describe('Overwrite the existing template with this name (read it first with read_note)'),
      },
      annotations: {readOnlyHint: false, destructiveHint: true, idempotentHint: false},
    },
    async ({name, from_note, body, tags, replace}) => {
      try {
        if (!from_note && body === undefined) return {...text('Give from_note (a note to copy) or body (the template text).'), isError: true};
        return text(describe(saveTemplate({name, fromNote: from_note, body, tags, replace}), 'Saved template'));
      } catch (err) {
        return failed(err);
      }
    },
  );

  server.registerTool(
    'duplicate_note',
    {
      title: 'Duplicate a note',
      description:
        'Copies a note (text, tags and properties) to a new note, by default "<title> copy" in the same folder. Only when the user asks. ' +
        'Never overwrites: a taken title gets a number added.',
      inputSchema: {
        note: z.string().min(1).describe('Path or title of the note to copy'),
        title: z.string().max(120).optional().describe('Title of the copy'),
        folder: z.string().optional().describe('Folder for the copy ("" = the top level). Default: the same folder'),
      },
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false},
    },
    async ({note: ref, title, folder}) => {
      try {
        return text(describe(duplicateNote(ref, {title, folder}), 'Duplicated as'));
      } catch (err) {
        return failed(err);
      }
    },
  );

  server.registerTool(
    'list_attachments',
    {
      title: 'List note attachments',
      description: 'Images and PDFs in the vault, their size, and the notes that embed each. unused_only lists the ones no note uses.',
      inputSchema: {unused_only: z.boolean().optional()},
      annotations: {readOnlyHint: true},
    },
    async ({unused_only}) => {
      const all = listAttachments().filter((a) => !unused_only || !a.usedBy.length);
      if (!all.length) return text(unused_only ? 'Every attachment is used by a note.' : 'No attachments yet.');
      return text(
        `${all.length} file(s)\n\n` +
          all.map((a) => `- ${a.path} (${(a.size / 1024).toFixed(0)} KB)\n  used by: ${a.usedBy.length ? a.usedBy.map((u) => u.path).join(', ') : 'nothing'}`).join('\n'),
      );
    },
  );

  server.registerTool(
    'get_note_image',
    {
      title: 'Look at an image from the notes',
      description: 'Returns one image from the vault so you can see it: a screenshot, diagram or photo. Pass its name as in ![[name]], or its path from list_attachments. PNG, JPEG, GIF and WebP, up to 3 MB.',
      inputSchema: {image: z.string().min(1).describe('e.g. "Pasted image 20261015093000.png" or "attachments/diagram.png"')},
      annotations: {readOnlyHint: true},
    },
    async ({image}) => {
      try {
        const rel = findAttachment(image);
        if (!rel) return {...text(`No image "${image}" in the vault. list_attachments shows what's there.`), isError: true};
        const img = imageForAgent(rel);
        const usedBy = listAttachments().find((a) => a.path === rel)?.usedBy ?? [];
        return {
          content: [
            {type: 'text', text: `${rel} (${(img.size / 1024).toFixed(0)} KB)${usedBy.length ? `\nembedded in: ${usedBy.map((u) => u.path).join(', ')}` : ''}`},
            {type: 'image', data: img.data, mimeType: img.mimeType},
          ],
        };
      } catch (err) {
        return failed(err);
      }
    },
  );

  server.registerTool(
    'attach_image',
    {
      title: 'Add an image to the notes',
      description:
        "Saves an image (base64) in the vault's attachments folder and, if a note is given, embeds it at the end of that note as ![[name]]. " +
        'For images you produced or the user gave you. Only when the user asks.',
      inputSchema: {
        data: z.string().min(1).describe('The image, base64 encoded (no data: prefix)'),
        mime_type: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
        name: z.string().optional().describe('File name without extension, e.g. "Architecture diagram"; default "Pasted image <timestamp>"'),
        note: z.string().optional().describe('Path or title of a note to embed it in'),
        caption: z.string().optional().describe('A line of text under the image, in that note'),
      },
      annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: false},
    },
    async ({data, mime_type, name, note: ref, caption}) => {
      try {
        const bytes = Buffer.from(data.replace(/^data:[^,]+,/, ''), 'base64');
        const saved = saveAttachment(bytes, mime_type, name);
        if (!ref) return text(`Saved ${saved.path}. Embed it in a note with ![[${saved.name}]].`);
        const n = updateNote(ref, {append: `![[${saved.name}]]${caption ? `\n*${caption.trim()}*` : ''}`});
        return text(`Saved ${saved.path} and embedded it in "${n.title}"\nurl: ${siteUrl(n.path)}`);
      } catch (err) {
        return failed(err);
      }
    },
  );

  server.registerTool(
    'notes_for_doc',
    {
      title: 'Notes about a docs page',
      description: "The user's notes that link to a docs page (by URL or path). Use it with read_doc, to add what the user wrote down about that page.",
      inputSchema: {page: z.string().min(1).describe('Docs page URL or path, e.g. "/blue-core-repos/bluecore-stack/docs/keycloak" or a url from search_docs')},
      annotations: {readOnlyHint: true},
    },
    async ({page}) => {
      let p = page.trim();
      try {
        p = new URL(p, 'http://x').pathname;
      } catch {
        // keep as is
      }
      const ns = notesLinkingTo(p);
      return text(ns.length ? ns.map((n) => `- ${n.title} (${n.path}), updated ${n.updated.slice(0, 10)}\n  ${n.excerpt}`).join('\n') : `No notes link to ${p}.`);
    },
  );

  server.registerTool(
    'notes_health',
    {
      title: 'Notes health',
      description:
        'A tidy-up list for the notes: [[links]] to notes that don\'t exist, images nothing embeds, notes without tags, tags spelled differently (API / api), empty notes, and how much is in the trash.',
      inputSchema: {},
      annotations: {readOnlyHint: true},
    },
    async () => {
      const h = notesHealth();
      const section = (title, items, fmt) => `## ${title} (${items.length})\n${items.length ? items.slice(0, 50).map(fmt).join('\n') : '(none)'}`;
      return text(
        [
          `${h.notes} notes · ${h.trash} in the trash`,
          section('Links to notes that don\'t exist', h.brokenLinks, (b) => `- ${b.title} (${b.path}): ${b.links.map((l) => `[[${l}]]`).join(', ')}`),
          section('Images nothing embeds', h.unusedAttachments, (a) => `- ${a.path} (${(a.size / 1024).toFixed(0)} KB)`),
          section('Tags spelled more than one way', h.tagVariants, (v) => `- ${v.map((t) => `#${t}`).join(' / ')}`),
          section('Notes without tags', h.untagged, (n) => `- ${n.title} (${n.path})`),
          section('Empty notes', h.empty, (n) => `- ${n.title} (${n.path})`),
        ].join('\n\n'),
      );
    },
  );
}
