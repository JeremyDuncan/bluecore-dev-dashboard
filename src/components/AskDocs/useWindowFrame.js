// Makes the chat panel behave like a small window: drag the title bar to move it, drag an edge
// or corner to resize it, or switch to fullscreen. Position and size are remembered per browser.
import {useCallback, useEffect, useRef, useState} from 'react';

const STORAGE_KEY = 'ask-docs-frame';
const MIN_W = 320;
const MIN_H = 360;
const MARGIN = 8; // keep the panel this far inside the window
const DEFAULT = {w: 440, h: 640, right: 24, bottom: 24};

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

function writeSaved(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // storage blocked: the layout just isn't remembered
  }
}

// Fit a frame inside the current window
function clamp({x, y, w, h}) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(Math.max(w, MIN_W), vw - 2 * MARGIN);
  const height = Math.min(Math.max(h, MIN_H), vh - 2 * MARGIN);
  return {
    w: width,
    h: height,
    x: Math.min(Math.max(x, MARGIN), vw - width - MARGIN),
    y: Math.min(Math.max(y, MARGIN), vh - height - MARGIN),
  };
}

function defaultFrame() {
  const w = DEFAULT.w;
  const h = Math.min(DEFAULT.h, window.innerHeight - 120);
  return clamp({w, h, x: window.innerWidth - w - DEFAULT.right, y: window.innerHeight - h - DEFAULT.bottom});
}

export default function useWindowFrame(open) {
  const [frame, setFrame] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const drag = useRef(null);

  // Restore the saved layout when the panel opens, and keep it inside the window on resize
  useEffect(() => {
    if (!open) return undefined;
    const saved = readSaved();
    setFrame(saved?.frame ? clamp(saved.frame) : defaultFrame());
    setFullscreen(Boolean(saved?.fullscreen));
    const onResize = () => setFrame((f) => (f ? clamp(f) : f));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  useEffect(() => {
    if (frame) writeSaved({frame, fullscreen});
  }, [frame, fullscreen]);

  // Esc leaves fullscreen
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setFullscreen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const onPointerMove = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    let {x, y, w, h} = d.start;
    if (d.mode === 'move') {
      x += dx;
      y += dy;
    } else {
      // d.mode is a direction like 'n', 'se', 'w'
      if (d.mode.includes('e')) w += dx;
      if (d.mode.includes('s')) h += dy;
      if (d.mode.includes('w')) {
        const nw = Math.max(MIN_W, w - dx);
        x += w - nw;
        w = nw;
      }
      if (d.mode.includes('n')) {
        const nh = Math.max(MIN_H, h - dy);
        y += h - nh;
        h = nh;
      }
    }
    setFrame(clamp({x, y, w, h}));
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
    document.body.classList.remove('ask-docs-dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
  }, [onPointerMove]);

  const startDrag = (mode) => (e) => {
    if (fullscreen || e.button !== 0 || !frame) return;
    if (mode === 'move' && e.target.closest('button, a, input, textarea')) return;
    e.preventDefault();
    drag.current = {mode, startX: e.clientX, startY: e.clientY, start: frame};
    document.body.classList.add('ask-docs-dragging'); // no text selection while dragging
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  };

  useEffect(() => endDrag, [endDrag]); // clean up if the panel closes mid-drag

  return {
    frame,
    fullscreen,
    toggleFullscreen: () => setFullscreen((f) => !f),
    reset: () => {
      setFullscreen(false);
      setFrame(defaultFrame());
    },
    // Spread onto the title bar
    moveHandle: {onPointerDown: startDrag('move'), onDoubleClick: (e) => !e.target.closest('button') && setFullscreen((f) => !f)},
    // Call with a direction ('n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw') for each edge/corner handle
    resizeHandle: (dir) => ({onPointerDown: startDrag(dir)}),
  };
}
