// The MCP tools by group, for the MCP tools guide's navigation: the tool index, the group switcher
// and links from examples and recipes to each tool's card. Each tool's description lives in its group's
// page (docs/guides/mcp-tools/tools/<group>.mdx); keep this list in step with those pages.

export const GROUPS = [
  {id: 'docs', title: 'Docs', icon: 'page', blurb: 'Search and read this site: guides, repo docs, the wiki, Drive and Box.'},
  {id: 'project', title: 'Project and issues', icon: 'status-board', blurb: 'The project board, issues, pull requests and releases, live from GitHub.'},
  {id: 'code', title: 'Source code', icon: 'code', blurb: 'Read the Blue Core repositories on GitHub, and your own stack checkout.'},
  {id: 'ci', title: 'CI, tests and deploys', icon: 'status-tests', blurb: "Build and test health, failure diagnosis, and what's deployed."},
  {id: 'api', title: 'Blue Core API', icon: 'stack', blurb: 'Endpoints and schemas from the live OpenAPI spec.'},
  {id: 'notes-read', title: 'Notes: read', icon: 'notes', blurb: 'Search, read and follow links in your notes vault.'},
  {id: 'notes-write', title: 'Notes: write', icon: 'notes', blurb: 'Add and change notes, only when you ask. None deletes.'},
  {id: 'notebooks', title: 'Jupyter Notebooks', icon: 'notebook', blurb: 'Write and run Jupyter notebooks that debug your local stack, dev or stage.'},
];

// [name, title, group, access]
export const TOOLS = [
  ['search_docs', 'Search documentation', 'docs'],
  ['read_doc', 'Read a documentation page', 'docs'],
  ['list_docs', 'List documentation pages', 'docs'],
  ['docs_health', 'Docs health', 'docs'],
  ['project_board', 'GitHub project board', 'project'],
  ['list_issues', 'Open repo issues', 'project'],
  ['get_issue', 'Read an issue or pull request', 'project'],
  ['search_issues', 'Search issues and pull requests', 'project'],
  ['list_pull_requests', 'Open pull requests', 'project'],
  ['recent_changes', 'Recently merged pull requests', 'project'],
  ['list_releases', 'Releases', 'project'],
  ['search_code', 'Search source code', 'code'],
  ['list_files', 'List files in a repo', 'code'],
  ['get_file', 'Read a source file', 'code'],
  ['fork_changes', 'What a fork changed', 'code'],
  ['local_stack', 'Your local stack checkout', 'code'],
  ['ci_status', 'CI status (GitHub Actions)', 'ci'],
  ['integration_tests', 'Test metrics', 'ci'],
  ['diagnose_test_failure', 'Diagnose a failing test run', 'ci'],
  ['version_drift', 'Version drift', 'ci'],
  ['api_endpoints', 'List API endpoints', 'api'],
  ['api_endpoint', 'Describe an API endpoint', 'api'],
  ['api_schema', 'Describe an API schema', 'api'],
  ['search_notes', 'Search notes', 'notes-read'],
  ['list_notes', 'List notes', 'notes-read'],
  ['read_note', 'Read a note', 'notes-read'],
  ['related_notes', 'Related notes', 'notes-read'],
  ['list_tasks', 'List tasks', 'notes-read'],
  ['list_note_tags', 'List note tags', 'notes-read'],
  ['list_templates', 'List note templates', 'notes-read'],
  ['notes_for_doc', 'Notes about a docs page', 'notes-read'],
  ['list_attachments', 'List note attachments', 'notes-read'],
  ['get_note_image', 'Look at an image from the notes', 'notes-read'],
  ['notes_health', 'Notes health', 'notes-read'],
  ['create_note', 'Create a note', 'notes-write', 'write'],
  ['update_note', 'Update a note', 'notes-write', 'write'],
  ['complete_task', 'Tick or untick a task', 'notes-write', 'write'],
  ['rename_note', 'Rename a note', 'notes-write', 'write'],
  ['pin_note', 'Pin or unpin a note', 'notes-write', 'write'],
  ['duplicate_note', 'Duplicate a note', 'notes-write', 'write'],
  ['save_template', 'Save a note template', 'notes-write', 'write'],
  ['attach_image', 'Add an image to the notes', 'notes-write', 'write'],
  ['list_notebooks', 'List notebooks', 'notebooks'],
  ['read_notebook', 'Read a notebook', 'notebooks'],
  ['create_notebook', 'Create a notebook', 'notebooks', 'write'],
  ['update_notebook', 'Update a notebook', 'notebooks', 'write'],
  ['run_notebook', 'Run a notebook', 'notebooks', 'write'],
].map(([name, title, group, access = 'read']) => ({name, title, group, access}));

export const groupPath = (id) => `/guides/mcp-tools/tools/${id}`;

// A tool's card, on its group's page
export function toolPath(name) {
  const tool = TOOLS.find((t) => t.name === name);
  return tool ? `${groupPath(tool.group)}#${name}` : '/guides/mcp-tools/tools/';
}
