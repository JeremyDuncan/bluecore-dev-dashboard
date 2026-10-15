// Who wrote a note, for display: you, or an AI agent (Claude Code, Codex, …) and its model.
// Notes store `author` ("you", "Claude Code", "Codex") and `model` (an exact id); notes saved before
// models were recorded say "Ask the docs" or "Ask the docs (Codex)", which show as the agent alone.

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

// "claude-sonnet-4-5-20250929" → "Claude Sonnet 4.5", "gpt-5.1-codex-max" → "GPT-5.1-Codex-Max"
export function prettyModel(id) {
  if (!id) return null;
  const s = String(id).trim();
  let m = s.match(/^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i);
  if (m) return `Claude ${cap(m[1])} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
  m = s.match(/^claude-(\d+)(?:-(\d+))?-(opus|sonnet|haiku)(?:-\d{8})?$/i); // claude-3-5-sonnet-20241022
  if (m) return `Claude ${m[1]}${m[2] ? `.${m[2]}` : ''} ${cap(m[3])}`;
  if (/^(opus|sonnet|haiku|fable)$/i.test(s)) return `Claude ${cap(s.toLowerCase())}`; // an alias, version unknown
  m = s.match(/^gpt-(.+)$/i);
  if (m) return `GPT-${m[1].split('-').map((p, i) => (i === 0 ? p : cap(p))).join('-')}`;
  return s;
}

// Which company's logo to show (static/img/providers/<icon>.svg)
function providerOf(name, model) {
  const text = `${name ?? ''} ${model ?? ''}`;
  if (/claude|anthropic|opus|sonnet|haiku/i.test(text)) return 'claude';
  if (/codex|openai|\bgpt|\bo\d/i.test(text)) return 'codex';
  return null;
}

// {ai, name, provider, model (readable), modelId} for a note's author, or for its last AI editor
export function writer(author, model) {
  if (!author || author === 'you') return {ai: false, name: 'You', provider: null, model: null, modelId: null};
  const legacy = author.match(/^Ask the docs(?: \((.+)\))?$/);
  const name = legacy ? legacy[1] || 'AI assistant' : author;
  return {ai: true, name, provider: providerOf(name, model), model: prettyModel(model), modelId: model ?? null};
}
