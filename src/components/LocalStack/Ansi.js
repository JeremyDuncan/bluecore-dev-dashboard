// Terminal output with its colors: the stack's scripts color their output (and docker compose its
// service names), so the page keeps the bold, dim and the 16 basic colors (256-color codes map to the
// nearest basic one) and drops every other escape code. A line a progress bar rewrote with \r shows its
// last state.
import React from 'react';
import styles from './styles.module.css';

const BASIC = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

function color256(n) {
  if (n < 16) return n < 8 ? BASIC[n] : `bright-${BASIC[n - 8]}`;
  if (n >= 232) return n > 243 ? 'white' : 'bright-black';
  const v = n - 16;
  const [r, g, b] = [Math.floor(v / 36), Math.floor(v / 6) % 6, v % 6];
  const idx = (r > 2 ? 1 : 0) | (g > 2 ? 2 : 0) | (b > 2 ? 4 : 0);
  return BASIC[idx];
}

// "text with \x1b[1;31mcodes\x1b[0m" → [{text, bold, dim, color}]
export function parseAnsi(input) {
  const text = String(input)
    .replace(/\u001b\][^\u0007]*\u0007/g, '')
    .split('\n')
    .map((l) => (l.includes('\r') ? l.split('\r').filter(Boolean).pop() ?? '' : l))
    .join('\n');
  const parts = [];
  let style = {};
  const re = /\u001b\[([0-9;?]*)([A-Za-z])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({text: text.slice(last, m.index), ...style});
    last = re.lastIndex;
    if (m[2] !== 'm') continue; // cursor moves, line clears: not shown
    const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) style = {};
      else if (c === 1) style = {...style, bold: true};
      else if (c === 2) style = {...style, dim: true};
      else if (c === 22) style = {...style, bold: false, dim: false};
      else if (c >= 30 && c <= 37) style = {...style, color: BASIC[c - 30]};
      else if (c >= 90 && c <= 97) style = {...style, color: `bright-${BASIC[c - 90]}`};
      else if (c === 39) style = {...style, color: undefined};
      else if (c === 38 && codes[i + 1] === 5) {
        style = {...style, color: color256(codes[i + 2] ?? 7)};
        i += 2;
      } else if (c === 38 && codes[i + 1] === 2) {
        i += 4; // 24-bit colors: kept plain
      } else if (c === 48) i += codes[i + 1] === 5 ? 2 : 4; // backgrounds: ignored
    }
  }
  if (last < text.length) parts.push({text: text.slice(last), ...style});
  return parts;
}

export const stripAnsi = (text) => parseAnsi(text).map((p) => p.text).join('');

export default function Ansi({text}) {
  return parseAnsi(text).map((p, i) =>
    p.bold || p.dim || p.color ? (
      <span key={i} className={[p.bold && styles.ansiBold, p.dim && styles.ansiDim, p.color && styles[`ansi-${p.color}`]].filter(Boolean).join(' ')}>
        {p.text}
      </span>
    ) : (
      <React.Fragment key={i}>{p.text}</React.Fragment>
    ),
  );
}
