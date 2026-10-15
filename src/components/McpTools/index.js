// The MCP tools guide (docs/guides/mcp-tools/): tool cards, the tool index and group navigation,
// prompts, recipes and example prompts. The text lives in the .mdx pages (as props and children) so
// the docs search and the MCP server's search_docs index it like any other page.
import React, {useState} from 'react';
import Link from '@docusaurus/Link';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import {Card, Cards, Icon} from '../Welcome';
import {GROUPS, TOOLS, groupPath, toolPath} from './tools';
import styles from './styles.module.css';

const SOURCES = {
  docs: 'Docs index',
  github: 'Live GitHub',
  api: 'Live OpenAPI',
  notes: 'Notes vault',
};

// Copies text, falling back to a hidden textarea where the Clipboard API is refused
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = Object.assign(document.createElement('textarea'), {value: text});
    area.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

function useCopy(text) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    copyText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return [copied, copy];
}

// A small copy button with an icon; `label` names what it copies, for screen readers
export function CopyButton({text, label = 'Copy', className = ''}) {
  const [copied, copy] = useCopy(text);
  return (
    <button type="button" onClick={copy} className={`${styles.copyButton} ${copied ? styles.copied : ''} ${className}`} title={copied ? 'Copied' : label} aria-label={copied ? 'Copied' : label}>
      <span className={styles.copyIcon} aria-hidden="true" />
      <span className={styles.copyText} aria-live="polite">
        {copied ? 'Copied' : 'Copy'}
      </span>
    </button>
  );
}

// "Try: <a question>" with a copy button
function Ask({text}) {
  return (
    <div className={styles.ask}>
      <span className={styles.askLabel}>Try</span>
      <span className={styles.askText}>{text}</span>
      <CopyButton text={text} label="Copy this prompt" />
    </div>
  );
}

// The endpoint and a few numbers, above the catalog
export function McpHero({tools, writes, prompts, endpoint = 'http://localhost:3001/mcp'}) {
  const [copied, copy] = useCopy(endpoint);
  return (
    <div className={styles.hero}>
      <div className={styles.heroMain}>
        <span className={styles.eyebrow}>Model Context Protocol · Streamable HTTP</span>
        <p className={styles.heroLead}>One server that gives any AI agent the Blue Core docs, live GitHub data, the API spec and your notes.</p>
        <div className={styles.endpoint}>
          <code>{endpoint}</code>
          <button type="button" onClick={copy} className={styles.copy} aria-live="polite">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <dl className={styles.stats}>
        <div>
          <dt>Tools</dt>
          <dd>{tools}</dd>
        </div>
        <div>
          <dt>Read-only</dt>
          <dd>{tools - writes}</dd>
        </div>
        <div>
          <dt>Write notes</dt>
          <dd>{writes}</dd>
        </div>
        <div>
          <dt>Prompts</dt>
          <dd>{prompts}</dd>
        </div>
      </dl>
    </div>
  );
}

// Links to every group's page, with the current one marked
export function GroupNav({current}) {
  return (
    <nav className={styles.groupNav} aria-label="Tool groups">
      <Link to="/guides/mcp-tools/tools/" className={!current ? styles.on : ''} aria-current={!current ? 'page' : undefined}>
        All tools
      </Link>
      {GROUPS.map((g) => (
        <Link key={g.id} to={groupPath(g.id)} className={current === g.id ? styles.on : ''} aria-current={current === g.id ? 'page' : undefined}>
          <Icon name={g.icon} size={15} />
          {g.title}
        </Link>
      ))}
    </nav>
  );
}

// A card per group, for the overview page
export function GroupCards() {
  return (
    <Cards>
      {GROUPS.map((g) => {
        const tools = TOOLS.filter((t) => t.group === g.id);
        return (
          <Card key={g.id} icon={g.icon} title={g.title} to={groupPath(g.id)} meta={`${tools.length} tools`}>
            {g.blurb}
          </Card>
        );
      })}
      <Card icon="search" title="All tools" to="/guides/mcp-tools/tools/" meta={`${TOOLS.length} tools, filterable`}>
        Every tool on one page. Filter by name or what it does.
      </Card>
    </Cards>
  );
}

// A group page's tools: a "jump to" bar, then the cards
export function Tools({children}) {
  const tools = React.Children.toArray(children).filter((c) => c?.props?.name);
  return (
    <>
      <nav className={styles.jump} aria-label="Tools on this page">
        <span>Jump to</span>
        {tools.map((t) => (
          <a key={t.props.name} href={`#${t.props.name}`} className={t.props.access === 'write' ? styles.jumpWrite : ''}>
            {t.props.name}
          </a>
        ))}
      </nav>
      <div className={styles.toolGrid}>{tools}</div>
    </>
  );
}

// Every tool by group, with a filter: links to each tool's card
export function ToolIndex() {
  const [query, setQuery] = useState('');
  const [access, setAccess] = useState('all');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (t) =>
    (access === 'all' || t.access === access) && words.every((w) => `${t.name} ${t.title} ${GROUPS.find((g) => g.id === t.group).title}`.toLowerCase().replace(/_/g, ' ').includes(w.replace(/_/g, ' ')));
  const shown = TOOLS.filter(match);
  return (
    <div className={styles.index}>
      <div className={styles.toolbarRow}>
        <label className={styles.search}>
          <span className={styles.srOnly}>Filter tools</span>
          <input
            id="mcp-tool-filter"
            type="search"
            value={query}
            placeholder="Filter tools: “pull request”, “flaky”, “template”…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          />
        </label>
        <div className={styles.segmented} role="radiogroup" aria-label="Access">
          {[
            ['all', 'All'],
            ['read', 'Read-only'],
            ['write', 'Writes'],
          ].map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={access === value} className={access === value ? styles.on : ''} onClick={() => setAccess(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.resultLine} aria-live="polite">
        {shown.length === 0 ? (
          <>
            No tools match.{' '}
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                setQuery('');
                setAccess('all');
              }}>
              Clear the filters
            </button>
          </>
        ) : (
          `${shown.length} ${shown.length === 1 ? 'tool' : 'tools'}`
        )}
      </div>
      <div className={styles.indexGroups}>
        {GROUPS.map((g) => {
          const tools = shown.filter((t) => t.group === g.id);
          if (!tools.length) return null;
          return (
            <section key={g.id} className={styles.indexGroup}>
              <Link to={groupPath(g.id)} className={styles.indexGroupHead}>
                <span className={styles.groupIcon}>
                  <Icon name={g.icon} size={18} />
                </span>
                {g.title}
              </Link>
              <ul>
                {tools.map((t) => (
                  <li key={t.name}>
                    <Link to={toolPath(t.name)}>
                      <code>{t.name}</code>
                      <span>{t.title}</span>
                      {t.access === 'write' && <em className={`${styles.badge} ${styles.badgeWrite}`}>Writes</em>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// "query*, limit" → pills, required ones marked
function Args({args}) {
  const list = (args ?? '').split(',').map((a) => a.trim()).filter(Boolean);
  if (!list.length) return <span className={styles.noArgs}>No arguments</span>;
  return list.map((a) => {
    const required = a.endsWith('*');
    const name = a.replace(/\*$/, '');
    return (
      <code key={name} className={`${styles.arg} ${required ? styles.argRequired : ''}`} title={required ? 'Required' : 'Optional'}>
        {name}
        {required && <span aria-label="required">*</span>}
      </code>
    );
  });
}

export function Tool({name, title, access = 'read', source, args, uses, ask, children}) {
  const write = access === 'write';
  useBrokenLinks().collectAnchor(name); // so links to #<name> from other pages pass the build's anchor check
  return (
    <article className={`${styles.tool} ${write ? styles.toolWrite : ''}`} id={name}>
      <header className={styles.toolHead}>
        <a href={`#${name}`} className={styles.toolName}>
          {name}
        </a>
        <span className={`${styles.badge} ${write ? styles.badgeWrite : styles.badgeRead}`}>{write ? 'Writes' : 'Read-only'}</span>
      </header>
      <div className={styles.toolTitle}>
        {title}
        {source && <span className={`${styles.source} ${styles[`src_${source}`] ?? ''}`}>{SOURCES[source]}</span>}
      </div>
      <div className={styles.toolText}>{children}</div>
      {uses?.length > 0 && (
        <ul className={styles.uses}>
          {uses.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      )}
      {ask && <Ask text={ask} />}
      <footer className={styles.args}>
        <Args args={args} />
      </footer>
    </article>
  );
}

export function Prompts({children}) {
  return <div className={styles.prompts}>{children}</div>;
}

// An MCP prompt: in Claude Code it's the slash command /mcp__docs__<name>
export function Prompt({name, args, children}) {
  return (
    <div className={styles.prompt}>
      <div className={styles.promptHead}>
        <code className={styles.slash}>/mcp__docs__{name}</code>
        <CopyButton text={`/mcp__docs__${name}`} label="Copy the slash command" />
      </div>
      <div className={styles.promptText}>{children}</div>
      {args && (
        <div className={styles.args}>
          <Args args={args} />
        </div>
      )}
    </div>
  );
}

export function Recipes({children}) {
  return <div className={styles.recipes}>{children}</div>;
}

// A question and the tools an agent chains to answer it, in order
export function Recipe({title, ask, steps}) {
  return (
    <div className={styles.recipe}>
      <h3 className={styles.recipeTitle}>{title}</h3>
      {ask && <Ask text={ask} />}
      <ol className={styles.steps}>
        {steps.map(([tool, why]) => (
          <li key={tool + why}>
            <Link to={toolPath(tool)} className={styles.stepTool}>
              {tool}
            </Link>
            <span className={styles.stepWhy}>{why}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Example prompts, with a category filter. Each <Example> has the prompt as `prompt` (so it copies
// exactly as written) and the tools an agent will likely call as `tools`.
export function ExamplePrompts({children}) {
  const examples = React.Children.toArray(children).filter((c) => c?.props?.prompt);
  const categories = [...new Set(examples.map((e) => e.props.category))];
  const [category, setCategory] = useState('all');
  const shown = examples.filter((e) => category === 'all' || e.props.category === category);
  return (
    <div className={styles.examples}>
      <div className={styles.chips} role="radiogroup" aria-label="Category">
        {['all', ...categories].map((c) => (
          <button key={c} type="button" role="radio" aria-checked={category === c} className={category === c ? styles.on : ''} onClick={() => setCategory(c)}>
            {c === 'all' ? 'All' : c}
            <span className={styles.chipCount}>{c === 'all' ? examples.length : examples.filter((e) => e.props.category === c).length}</span>
          </button>
        ))}
      </div>
      <div className={styles.exampleGrid}>{shown}</div>
    </div>
  );
}

export function Example({prompt, category, tools}) {
  return (
    <figure className={styles.example}>
      <figcaption className={styles.exampleHead}>
        <span className={styles.exampleCategory}>{category}</span>
        <CopyButton text={prompt} label="Copy this prompt" />
      </figcaption>
      <blockquote className={styles.examplePrompt}>{prompt}</blockquote>
      {tools && (
        <div className={styles.exampleTools}>
          <span>Uses</span>
          {tools
            .split(',')
            .map((t) => t.trim())
            .map((t) => (
              <Link key={t} to={toolPath(t)}>
                {t}
              </Link>
            ))}
        </div>
      )}
    </figure>
  );
}
