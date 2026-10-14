// Saved "Ask the docs" conversations, kept in this browser's localStorage (never on a server, so
// visitors through a shared tunnel only ever see their own). The newest MAX_CHATS are kept; when the
// browser runs out of storage, the oldest are dropped.
const KEY = 'ask-docs-history';
const MAX_CHATS = 50;

export function loadHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function store(list) {
  for (let keep = list.length; keep >= 0; keep = keep > 1 ? Math.floor(keep / 2) : keep - 1) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, keep)));
      return list.slice(0, keep);
    } catch {
      // storage full (or blocked): try again with fewer chats
    }
  }
  return list;
}

// Messages worth keeping: no in-progress status, no dividers-only chats
const clean = (messages) => messages.map(({status, ...m}) => m);

// Adds or updates a conversation (newest first). `chat` is the panel's state.
export function saveChat(chat) {
  if (!chat.id || !chat.messages.some((m) => m.role === 'user')) return loadHistory();
  const previous = loadHistory().find((c) => c.id === chat.id);
  // Just reopening a conversation doesn't make it newer: only a new message does
  const changed = !previous || previous.messages.length !== chat.messages.length || previous.sessionId !== (chat.sessionId ?? null);
  const first = chat.messages.find((m) => m.role === 'user');
  const last = [...chat.messages].reverse().find((m) => m.role === 'assistant');
  const entry = {
    id: chat.id,
    title: first.text.length > 90 ? `${first.text.slice(0, 89)}…` : first.text,
    createdAt: chat.createdAt ?? new Date().toISOString(),
    updatedAt: changed ? new Date().toISOString() : previous.updatedAt,
    questions: chat.messages.filter((m) => m.role === 'user').length,
    providerName: last?.providerName ?? null,
    icon: last?.icon ?? null,
    sessionId: chat.sessionId ?? null,
    sessionProvider: chat.sessionProvider ?? null,
    messages: clean(chat.messages),
  };
  const others = loadHistory().filter((c) => c.id !== chat.id);
  // Newest first, by when each conversation last changed
  return store([entry, ...others].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_CHATS));
}

export function deleteChat(id) {
  return store(loadHistory().filter((c) => c.id !== id));
}

export function clearHistory() {
  return store([]);
}

// "Today", "Yesterday", "Last 7 days", "Older" → [[label, chats], …]
export function groupByDay(list) {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const day = 86400000;
  const label = (iso) => {
    const t = new Date(iso).getTime();
    if (t >= startOfToday) return 'Today';
    if (t >= startOfToday - day) return 'Yesterday';
    if (t >= startOfToday - 7 * day) return 'Last 7 days';
    return 'Older';
  };
  const groups = new Map();
  for (const c of list) {
    const k = label(c.updatedAt);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  return [...groups];
}

export const newChatId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
