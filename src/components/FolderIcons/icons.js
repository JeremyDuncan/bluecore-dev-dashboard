// The line icons a folder, note or notebook can have (the icon picker's "Icons" tab), in the site's
// stroke style: 24×24, drawn with currentColor. Stored as "line:<name>"; the names, labels and search
// words are shared with the server in mcp/icon-names.mjs.
import React from 'react';
import {LINE_ICON_NAMES} from '../../../mcp/icon-names.mjs';

const C = (cx, cy, r) => <circle cx={cx} cy={cy} r={r} />;
const P = (d) => <path d={d} />;
const R = (x, y, w, h, rx = 2) => <rect x={x} y={y} width={w} height={h} rx={rx} />;

// Each icon's drawing, by name (the names, labels and search words are in mcp/icon-names.mjs)
const DRAWINGS = {
  'book': [P('M4 19.5A2.5 2.5 0 0 1 6.5 17H20'), P('M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z')],
  'book-open': [P('M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z'), P('M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z')],
  'file-text': [P('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'), P('M14 2v6h6'), P('M8 13h8M8 17h6')],
  'pen': [P('M12 20h9'), P('M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z')],
  'list': [P('M8 6h13M8 12h13M8 18h13'), P('M3 6h.01M3 12h.01M3 18h.01')],
  'check-square': [R(3, 3, 18, 18), P('m9 12 2 2 4-4')],
  'calendar': [R(3, 4, 18, 18), P('M16 2v4M8 2v4M3 10h18')],
  'clock': [C(12, 12, 10), P('M12 6v6l4 2')],
  'inbox': [P('M22 12h-6l-2 3h-4l-2-3H2'), P('M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z')],
  'archive': [R(2, 3, 20, 5, 1), P('M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8'), P('M10 12h4')],
  'bookmark': [P('m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z')],
  'tag': [P('M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z'), P('M7 7h.01')],
  'flag': [P('M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z'), P('M4 22v-7')],
  'star': [<polygon key="s" points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />],
  'lightbulb': [P('M9 18h6M10 22h4'), P('M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14')],
  'target': [C(12, 12, 10), C(12, 12, 6), C(12, 12, 2)],
  'briefcase': [R(2, 7, 20, 14), P('M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2'), P('M2 13h20')],
  'graduation': [P('M22 10 12 5 2 10l10 5 10-5z'), P('M6 12v5c3 3 9 3 12 0v-5')],
  'users': [P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), C(9, 7, 4), P('M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75')],
  'user': [P('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'), C(12, 7, 4)],
  'message': [P('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z')],
  'mail': [R(2, 4, 20, 16), P('m22 7-10 6L2 7')],
  'heart': [P('M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z')],
  'code': [P('m16 18 6-6-6-6'), P('m8 6-6 6 6 6')],
  'terminal': [P('m4 17 6-6-6-6'), P('M12 19h8')],
  'bug': [R(8, 6, 8, 14, 4), P('M19 7l-3 2M5 7l3 2M19 19l-3-2M5 19l3-2M20 13h-4M4 13h4M10 4l1 2M14 4l-1 2')],
  'git-branch': [P('M6 3v12'), C(18, 6, 3), C(6, 18, 3), P('M18 9a9 9 0 0 1-9 9')],
  'git-pull': [C(18, 18, 3), C(6, 6, 3), P('M13 6h3a2 2 0 0 1 2 2v7'), P('M6 9v12')],
  'database': [<ellipse key="e" cx="12" cy="5" rx="9" ry="3" />, P('M3 5v14a9 3 0 0 0 18 0V5'), P('M3 12a9 3 0 0 0 18 0')],
  'server': [R(2, 2, 20, 8), R(2, 14, 20, 8), P('M6 6h.01M6 18h.01')],
  'layers': [P('m12 2 10 5-10 5L2 7z'), P('m2 17 10 5 10-5'), P('m2 12 10 5 10-5')],
  'package': [P('M16.5 9.4 7.55 4.24'), P('M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'), P('M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12')],
  'cloud': [P('M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z')],
  'globe': [C(12, 12, 10), P('M2 12h20'), P('M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z')],
  'flask': [P('M9 3h6'), P('M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3')],
  'chart': [P('M3 3v18h18'), P('m7 15 4-4 3 3 5-6')],
  'zap': [P('M13 2 3 14h9l-1 8 10-12h-9l1-8z')],
  'rocket': [P('M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z'), P('m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z'), P('M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5')],
  'wrench': [P('M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z')],
  'sliders': [P('M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6')],
  'lock': [R(3, 11, 18, 11), P('M7 11V7a5 5 0 0 1 10 0v4')],
  'key': [C(7.5, 15.5, 5.5), P('m21 2-9.6 9.6'), P('m15.5 7.5 3 3L22 7l-3-3')],
  'shield': [P('M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z')],
  'search': [C(11, 11, 7), P('m20 20-3.5-3.5')],
  'image': [R(3, 3, 18, 18), C(9, 9, 2), P('m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21')],
  'home': [P('M3 10.5 12 3l9 7.5'), P('M5 9v12h14V9'), P('M10 21v-6h4v6')],
};

export const LINE_ICONS = LINE_ICON_NAMES.filter((i) => DRAWINGS[i.name]).map((i) => ({...i, svg: DRAWINGS[i.name]}));

export const LINE_ICON = Object.fromEntries(LINE_ICONS.map((i) => [i.name, i]));

export function LineIcon({name, size = 16}) {
  const icon = LINE_ICON[name];
  if (!icon) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {icon.svg.map((el, i) => React.cloneElement(el, {key: i}))}
    </svg>
  );
}

// The emoji tab: a set to search by name and keywords ([emoji, words]). Any other emoji can be pasted.
export const EMOJI = [
  // Files and work
  ['📁', 'folder file directory'], ['📂', 'open folder file'], ['🗂️', 'dividers index folders organize'], ['🗃️', 'card box archive files'],
  ['📚', 'books library docs reading'], ['📖', 'open book reading docs guide'], ['📓', 'notebook journal'], ['📒', 'ledger notebook'],
  ['📝', 'memo note write draft'], ['🗒️', 'notepad notes spiral'], ['📄', 'page document file'], ['📋', 'clipboard list checklist'],
  ['📌', 'pin pushpin important'], ['📎', 'paperclip attachment'], ['🔖', 'bookmark tag saved'], ['🏷️', 'label tag'],
  ['📅', 'calendar date schedule'], ['🗓️', 'calendar spiral planning'], ['⏰', 'alarm clock time deadline'], ['⏳', 'hourglass waiting time'],
  ['📥', 'inbox incoming tray'], ['📤', 'outbox outgoing tray'], ['📦', 'package box release shipping'], ['🗄️', 'cabinet archive storage files'],
  // Status
  ['✅', 'check done complete yes'], ['☑️', 'checkbox done task'], ['❌', 'cross no wrong failed'], ['⚠️', 'warning caution alert'],
  ['❗', 'exclamation important urgent'], ['❓', 'question help unknown'], ['🚧', 'construction wip work in progress'], ['🚫', 'blocked no forbidden'],
  ['⭐', 'star favorite'], ['🌟', 'glowing star favorite highlight'], ['🔥', 'fire hot urgent'], ['💡', 'idea lightbulb tip'],
  ['🎯', 'target goal focus'], ['🏁', 'finish flag done milestone'], ['🚩', 'red flag issue'], ['🏆', 'trophy win award'],
  ['🟢', 'green circle ok'], ['🟡', 'yellow circle pending'], ['🟠', 'orange circle'], ['🔴', 'red circle error stop'], ['🔵', 'blue circle'], ['🟣', 'purple circle'],
  // Code and systems
  ['💻', 'laptop computer code dev'], ['🖥️', 'desktop computer screen'], ['⌨️', 'keyboard typing'], ['🖱️', 'mouse computer'],
  ['🐛', 'bug debug issue error'], ['🐞', 'ladybug bug beetle'], ['🧪', 'test tube lab experiment testing'], ['🔬', 'microscope research science'],
  ['🔧', 'wrench tool fix config'], ['🛠️', 'tools hammer wrench build'], ['⚙️', 'gear settings config'], ['🔩', 'nut bolt hardware'],
  ['🔒', 'lock private secure'], ['🔓', 'unlock open'], ['🔑', 'key auth login password'], ['🛡️', 'shield security protect'],
  ['🔍', 'search magnifier find research'], ['🔗', 'link chain url'], ['🌐', 'globe web internet'], ['☁️', 'cloud deploy hosting'],
  ['🗄️', 'database server cabinet'], ['💾', 'floppy save disk'], ['🧩', 'puzzle piece plugin integration'], ['🤖', 'robot ai bot agent'],
  ['🧠', 'brain ai thinking'], ['✨', 'sparkles ai magic new'], ['⚡', 'lightning fast power'], ['🚀', 'rocket launch release ship deploy'],
  ['📊', 'bar chart stats metrics'], ['📈', 'chart up growth trend'], ['📉', 'chart down decline'], ['🧮', 'abacus math calculate'],
  // People and talk
  ['👥', 'people team users group'], ['👤', 'person user profile'], ['🙋', 'person raising hand question'], ['🤝', 'handshake deal partner'],
  ['💬', 'speech bubble chat comment'], ['🗨️', 'speech balloon discussion'], ['📣', 'megaphone announcement'], ['📢', 'loudspeaker announcement'],
  ['📮', 'postbox mail'], ['✉️', 'envelope email letter'], ['📞', 'phone call'], ['🎓', 'graduation learning training'],
  // Places, things and colors
  ['🏠', 'home house'], ['🏢', 'office building work'], ['🏛️', 'library institution building'], ['🗺️', 'map plan'],
  ['🎨', 'art palette design'], ['🖼️', 'picture image frame'], ['📷', 'camera photo screenshot'], ['🎬', 'film video'],
  ['🎵', 'music note'], ['🎉', 'party celebration'], ['☕', 'coffee break'], ['🌱', 'seedling new growth'],
  ['❤️', 'red heart love'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'], ['💙', 'blue heart'], ['💜', 'purple heart'],
].filter(([e], i, all) => all.findIndex(([x]) => x === e) === i);
