// Choosing the AI CLI that answers (Claude Code, Codex, …) and its model, plus setup help for
// CLIs that aren't installed or logged in yet. The list comes from the chat helper (/providers).
import React, {useCallback, useEffect, useState} from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './styles.module.css';

const STORAGE_KEY = 'ask-docs-cli';

export function ProviderIcon({icon, size = 18, title}) {
  const src = useBaseUrl(`/img/providers/${icon}.svg`);
  return <img src={src} width={size} height={size} alt={title ?? ''} className={styles.providerIcon} />;
}

// Loads the CLIs from the helper and remembers the chosen CLI and model per browser.
export function useCli(apiUrl, open) {
  const [state, setState] = useState({providers: null, offline: false, checking: false});
  const [choice, setChoice] = useState({provider: null, models: {}});

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) setChoice(saved);
    } catch {
      // storage blocked: use the defaults
    }
  }, []);
  useEffect(() => {
    try {
      if (choice.provider) localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } catch {
      // ignore
    }
  }, [choice]);

  const load = useCallback(
    async (refresh = false) => {
      setState((s) => ({...s, checking: true}));
      try {
        const res = await fetch(`${apiUrl.replace(/\/$/, '')}/providers${refresh ? '?refresh=1' : ''}`);
        const data = await res.json();
        setState({providers: data.providers, offline: false, checking: false});
        setChoice((c) => (c.provider && data.providers.some((p) => p.id === c.provider) ? c : {...c, provider: data.defaultProvider}));
      } catch {
        setState({providers: null, offline: true, checking: false});
      }
    },
    [apiUrl],
  );

  useEffect(() => {
    if (open && apiUrl) load();
  }, [open, apiUrl, load]);

  const provider = state.providers?.find((p) => p.id === choice.provider) ?? null;
  const modelIds = provider?.models.map((m) => m.id) ?? [];
  const saved = provider && choice.models[provider.id];
  const model = provider ? (modelIds.includes(saved) ? saved : provider.defaultModel) : null;

  return {
    ...state,
    provider,
    model,
    refresh: () => load(true),
    setProvider: (id) => setChoice((c) => ({...c, provider: id})),
    setModel: (id) => setChoice((c) => ({...c, models: {...c.models, [c.provider]: id}})),
  };
}

function StatusDot({p}) {
  const label = p.unsupported ? 'Not available' : p.ready ? 'Ready' : p.installed ? 'Not logged in' : 'Not installed';
  return <span className={`${styles.dot} ${p.ready ? styles.dotReady : styles.dotMissing}`} title={label} aria-label={label} />;
}

// Toolbar under the title bar: one button per CLI (with its icon and status) and the model menu.
export function CliPicker({cli, disabled}) {
  if (!cli.providers) return null;
  return (
    <div className={styles.picker}>
      <div className={styles.providers} role="radiogroup" aria-label="AI assistant">
        {cli.providers.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={cli.provider?.id === p.id}
            className={`${styles.providerButton} ${cli.provider?.id === p.id ? styles.providerActive : ''}`}
            onClick={() => cli.setProvider(p.id)}
            disabled={disabled}>
            <ProviderIcon icon={p.icon} />
            {p.name}
            <StatusDot p={p} />
          </button>
        ))}
      </div>
      {cli.provider?.ready && cli.provider.models.length > 0 && (
        <label className={styles.modelSelect}>
          <span className={styles.visuallyHidden}>Model</span>
          <select value={cli.model ?? ''} onChange={(e) => cli.setModel(e.target.value)} disabled={disabled} title="Model">
            {cli.provider.models.map((m) => (
              <option key={m.id} value={m.id} title={m.description}>
                {m.label}
                {m.id === cli.provider.defaultModel ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function Command({label, command}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.command}>
      <span className={styles.commandLabel}>{label}</span>
      <div className={styles.commandRow}>
        <code>{command}</code>
        <button
          type="button"
          className={styles.copy}
          onClick={() => {
            navigator.clipboard?.writeText(command).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

// Shown instead of the chat when the chosen CLI can't answer yet.
export function SetupCard({cli}) {
  const p = cli.provider;
  if (!p) return null;
  return (
    <div className={styles.setup}>
      <p className={styles.setupTitle}>
        <ProviderIcon icon={p.icon} size={22} /> Set up {p.name}
      </p>
      {p.unsupported ? (
        <p>{p.unsupported}</p>
      ) : (
        <>
          <p>
            {p.installed
              ? `${p.name} is installed${p.version ? ` (${p.version})` : ''} but not logged in.`
              : `${p.name} isn't installed on this machine yet.`}{' '}
            Run these in a terminal, then click <strong>Check again</strong>.
          </p>
          {!p.installed && (
            <>
              <p className={styles.step}>1. Install</p>
              {p.setup.install.map((c) => (
                <Command key={c.command} {...c} />
              ))}
            </>
          )}
          <p className={styles.step}>{p.installed ? '' : '2. '}Log in</p>
          {p.setup.login.map((c) => (
            <Command key={c.command} {...c} />
          ))}
          <p className={styles.setupNote}>
            Answers use your own {p.name} account and its usage limits. <a href={p.setup.docs}>{p.name} docs</a>
          </p>
        </>
      )}
      <button type="button" className={styles.checkAgain} onClick={cli.refresh} disabled={cli.checking}>
        {cli.checking ? 'Checking…' : 'Check again'}
      </button>
    </div>
  );
}
