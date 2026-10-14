// "Ask the docs" chat box (bottom-right on every page). Questions go to the chat helper
// (chat/server.mjs, started by `make up` / `make prod`), which answers with the AI CLI you pick
// (Claude Code or Codex) and the docs MCP tools. Past conversations are kept in this browser
// (history.js) and can be reopened and continued from the History view.
import React, {useEffect, useRef, useState} from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Markdown from './Markdown';
import useWindowFrame from './useWindowFrame';
import {CliPicker, ProviderIcon, SetupCard, useCli} from './CliPicker';
import {clearHistory, deleteChat, groupByDay, loadHistory, newChatId, saveChat} from './history';
import styles from './styles.module.css';

const STORAGE_KEY = 'ask-docs-chat';
const SUGGESTIONS = [
  'How do I set up Blue Core locally?',
  'How do I export the Keycloak realm?',
  "What's in review on the MVP board?",
];

function load() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY)) ?? {messages: [], sessionId: null};
  } catch {
    return {messages: [], sessionId: null};
  }
}

function save(state) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // private mode / storage blocked: the chat just isn't kept between pages
  }
}

// POST the question and read the server-sent events from the response body.
async function streamAnswer(url, payload, onEvent, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'The chat helper is busy. Try again in a moment.' : `Chat helper error (HTTP ${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = block.match(/^event: (.*)$/m)?.[1];
      const data = block.match(/^data: (.*)$/m)?.[1];
      if (event && data) onEvent(event, JSON.parse(data));
    }
  }
}

export default function AskDocs() {
  const {siteConfig} = useDocusaurusContext();
  const apiUrl = siteConfig.customFields?.chatApiUrl;
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState({messages: [], sessionId: null});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const win = useWindowFrame(open);
  const cli = useCli(apiUrl, open);
  const [view, setView] = useState('chat'); // 'chat' | 'history'
  const [history, setHistory] = useState([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  // On small screens the panel is a fixed sheet (no moving or resizing)
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 549px)');
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => setChat(load()), []);
  useEffect(() => save(chat), [chat]);
  useEffect(() => setHistory(loadHistory()), []);
  // Save the conversation to the history once an answer has finished (not on every streamed word)
  useEffect(() => {
    if (!busy && chat.id) setHistory(saveChat(chat));
  }, [chat, busy]);
  useEffect(() => {
    listRef.current?.scrollTo({top: listRef.current.scrollHeight});
  }, [chat, open]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  // Links like /some-page?ask=How+do+I+… open the chat and ask that question
  // (add &cli=codex or &cli=claude to pick the assistant)
  const askedFromUrl = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('ask');
    const wanted = params.get('cli');
    if (q && apiUrl && !askedFromUrl.current) {
      setOpen(true);
      if (wanted && cli.providers?.some((p) => p.id === wanted) && cli.provider?.id !== wanted) {
        cli.setProvider(wanted);
        return;
      }
      if (!cli.provider?.ready) return; // ask once the CLI list has loaded
      askedFromUrl.current = true;
      ask(q);
    }
  });

  if (!apiUrl) return null; // e.g. the public GitHub Pages build

  const updateLast = (fn) =>
    setChat((c) => {
      const messages = [...c.messages];
      messages[messages.length - 1] = fn(messages[messages.length - 1]);
      return {...c, messages};
    });

  async function ask(question) {
    const q = question.trim();
    if (!q || busy) return;
    if (!cli.provider?.ready) return;
    setInput('');
    setBusy(true);
    const provider = cli.provider;
    // A conversation belongs to one CLI: switching CLI starts a new one (switching model doesn't)
    const sessionId = chat.sessionProvider === provider.id ? chat.sessionId : null;
    const switched = chat.messages.length > 0 && chat.sessionProvider && chat.sessionProvider !== provider.id;
    const meta = {provider: provider.id, providerName: provider.name, icon: provider.icon, model: provider.models.find((m) => m.id === cli.model)?.label ?? cli.model};
    setChat((c) => ({
      ...c,
      id: c.id ?? newChatId(),
      createdAt: c.createdAt ?? new Date().toISOString(),
      messages: [
        ...c.messages,
        ...(switched ? [{role: 'divider', text: `Switched to ${provider.name} · new conversation`}] : []),
        {role: 'user', text: q},
        {role: 'assistant', text: '', status: 'Thinking…', ...meta},
      ],
    }));
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamAnswer(
        `${apiUrl.replace(/\/$/, '')}/ask`,
        {question: q, sessionId, provider: provider.id, model: cli.model},
        (event, data) => {
          if (event === 'turn') updateLast((m) => ({...m, text: ''}));
          else if (event === 'delta') updateLast((m) => ({...m, text: m.text + data.text}));
          else if (event === 'status') updateLast((m) => ({...m, status: data.text}));
          else if (event === 'done') {
            updateLast((m) => ({...m, text: data.answer || m.text, status: null}));
            setChat((c) => ({...c, sessionId: data.sessionId, sessionProvider: provider.id}));
          } else if (event === 'error') updateLast((m) => ({...m, status: null, error: data.message}));
        },
        controller.signal,
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        const offline = err instanceof TypeError; // network error: helper not running
        updateLast((m) => ({
          ...m,
          status: null,
          error: offline ? "The chat helper isn't running. Restart `make up` (or run `make chat`), then ask again." : err.message,
        }));
      }
    } finally {
      updateLast((m) => (m.status ? {...m, status: null} : m));
      setBusy(false);
      abortRef.current = null;
    }
  }

  function newChat() {
    abortRef.current?.abort();
    setChat({messages: [], sessionId: null, sessionProvider: null});
    setView('chat');
  }

  // Reopen a saved conversation. Follow-ups continue it with the same assistant session.
  function openChat(entry) {
    setChat({id: entry.id, createdAt: entry.createdAt, messages: entry.messages, sessionId: entry.sessionId, sessionProvider: entry.sessionProvider});
    setView('chat');
  }

  function removeChat(id) {
    setHistory(deleteChat(id));
    if (chat.id === id) setChat({messages: [], sessionId: null, sessionProvider: null});
  }

  const ready = Boolean(cli.provider?.ready);
  // History only shows while the chat itself works (the helper is reachable and lists its CLIs)
  const chatAvailable = !cli.offline && Boolean(cli.providers?.length);
  const shownHistory = history.filter(
    (c) => !historyQuery || `${c.title} ${c.messages.map((m) => m.text).join(' ')}`.toLowerCase().includes(historyQuery.toLowerCase()),
  );
  const when = (iso) => {
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'})
      : d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
  };

  return (
    <>
      {!open && (
        <button type="button" className={styles.launcher} onClick={() => setOpen(true)} aria-label="Ask the docs">
          <span aria-hidden="true">✦</span> Ask the docs
        </button>
      )}
      {open && (
        <section
          className={`${styles.panel} ${win.fullscreen ? styles.fullscreen : ''} ${compact ? styles.compact : ''}`}
          style={!win.fullscreen && !compact && win.frame ? {left: win.frame.x, top: win.frame.y, width: win.frame.w, height: win.frame.h} : undefined}
          aria-label="Ask the docs">
          <header
            className={`${styles.header} ${!win.fullscreen && !compact ? styles.movable : ''}`}
            {...(!compact && win.moveHandle)}
            title={!win.fullscreen && !compact ? 'Drag to move · double-click for fullscreen' : undefined}>
            <span className={styles.title}>Ask the docs</span>
            <span className={styles.headerActions}>
              {chatAvailable && (
                <button
                  type="button"
                  onClick={() => (setView(view === 'history' ? 'chat' : 'history'), setConfirmClear(false))}
                  className={styles.textButton}
                  disabled={busy}
                  aria-pressed={view === 'history'}
                  title={busy ? 'Wait for the answer to finish' : 'Past conversations in this browser'}>
                  {view === 'history' ? 'Back to chat' : 'History'}
                </button>
              )}
              {(chat.messages.length > 0 || view === 'history') && (
                <button type="button" onClick={newChat} className={styles.textButton}>
                  New chat
                </button>
              )}
              {!compact && (
                <button
                  type="button"
                  onClick={win.toggleFullscreen}
                  className={styles.iconButton}
                  aria-label={win.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  title={win.fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}>
                  {win.fullscreen ? (
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path d="M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path d="M1 6V1h5M15 6V1h-5M1 10v5h5M15 10v5h-5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  )}
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className={styles.close} aria-label="Close">
                ×
              </button>
            </span>
          </header>
          {view === 'history' && chatAvailable ? (
            <div className={styles.messages}>
              <input
                type="search"
                className={styles.historySearch}
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="Search past conversations"
                aria-label="Search past conversations"
              />
              {shownHistory.length === 0 && (
                <p className={styles.intro}>{history.length ? 'No conversations match.' : 'No saved conversations yet. They appear here after your first question.'}</p>
              )}
              {groupByDay(shownHistory).map(([label, chats]) => (
                <section key={label} className={styles.historyGroup}>
                  <p className={styles.historyLabel}>{label}</p>
                  <ul className={styles.historyList}>
                    {chats.map((c) => (
                      <li key={c.id} className={`${styles.historyItem} ${c.id === chat.id ? styles.historyCurrent : ''}`}>
                        <button type="button" className={styles.historyOpen} onClick={() => openChat(c)}>
                          {c.icon && <ProviderIcon icon={c.icon} size={16} />}
                          <span className={styles.historyText}>
                            <span className={styles.historyTitle}>{c.title}</span>
                            <span className={styles.historyMeta} suppressHydrationWarning>
                              {c.questions} question{c.questions === 1 ? '' : 's'} · {c.providerName ?? 'Assistant'} · {when(c.updatedAt)}
                            </span>
                          </span>
                        </button>
                        <button type="button" className={styles.historyDelete} onClick={() => removeChat(c.id)} aria-label={`Delete “${c.title}”`} title="Delete">
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {history.length > 0 &&
                (confirmClear ? (
                  <p className={styles.historyClear}>
                    Delete all {history.length} conversations?{' '}
                    <button type="button" className={styles.textButton} onClick={() => (setHistory(clearHistory()), setConfirmClear(false), newChat())}>
                      Delete all
                    </button>
                    <button type="button" className={styles.textButton} onClick={() => setConfirmClear(false)}>
                      Cancel
                    </button>
                  </p>
                ) : (
                  <p className={styles.historyClear}>
                    <button type="button" className={styles.textButton} onClick={() => setConfirmClear(true)}>
                      Clear history
                    </button>
                  </p>
                ))}
              <p className={styles.historyNote}>Saved in this browser only. Opening a conversation lets you keep asking follow-ups.</p>
            </div>
          ) : (
          <>
          <CliPicker cli={cli} disabled={busy} />

          <div className={styles.messages} ref={listRef} aria-live="polite">
            {cli.offline && (
              <div className={styles.setup}>
                <p className={styles.setupTitle}>The chat helper isn't running</p>
                <p>It starts with <code>make up</code> or <code>make prod</code>. Restart one of them, or run <code>make chat</code> in a terminal.</p>
                <button type="button" className={styles.checkAgain} onClick={cli.refresh} disabled={cli.checking}>
                  {cli.checking ? 'Checking…' : 'Check again'}
                </button>
              </div>
            )}
            {cli.provider && !ready && <SetupCard cli={cli} />}
            {ready && chat.messages.length === 0 && (
              <div className={styles.intro}>
                <p>Ask anything about Blue Core. Answers come from these docs: the repos, wiki, Drive and Box documents, and the project board.</p>
                <div className={styles.suggestions}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className={styles.suggestion} onClick={() => ask(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chat.messages.map((m, i) =>
              m.role === 'divider' ? (
                <p key={i} className={styles.divider}>
                  {m.text}
                </p>
              ) : m.role === 'user' ? (
                <div key={i} className={styles.user}>
                  {m.text}
                </div>
              ) : (
                <div key={i} className={styles.assistant}>
                  {m.icon && (
                    <p className={styles.answeredBy}>
                      <ProviderIcon icon={m.icon} size={16} />
                      {m.providerName}
                      {m.model ? ` · ${m.model}` : ''}
                    </p>
                  )}
                  {m.text && <Markdown text={m.text} />}
                  {m.status && (
                    <p className={styles.status}>
                      <span className={styles.spinner} aria-hidden="true" />
                      {m.status}
                    </p>
                  )}
                  {m.error && (
                    <div className={styles.error}>
                      <Markdown text={m.error} />
                    </div>
                  )}
                </div>
              ),
            )}
          </div>

          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}>
            <textarea
              ref={inputRef}
              value={input}
              rows={2}
              disabled={!ready}
              placeholder={!ready ? 'Set up an assistant above to start' : chat.messages.length ? 'Ask a follow-up…' : `Ask ${cli.provider.name} a question…`}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  ask(input);
                }
              }}
            />
            <button type="submit" className={styles.send} disabled={busy || !ready || !input.trim()}>
              {busy ? '…' : 'Ask →'}
            </button>
          </form>
          <p className={styles.footnote}>
            Answered by {cli.provider?.name ?? 'your AI CLI'} from these docs, using your own account. Check the linked pages.
          </p>
          </>
          )}
          {!win.fullscreen &&
            !compact &&
            ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) => (
              <span key={dir} className={`${styles.resize} ${styles[`resize-${dir}`]}`} {...win.resizeHandle(dir)} aria-hidden="true" />
            ))}
        </section>
      )}
    </>
  );
}
