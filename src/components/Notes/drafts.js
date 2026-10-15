// Unsaved editor text, kept in this browser (localStorage) while you type, so closing the tab or a
// crash doesn't lose it. Offered back the next time that note (or a new note) is opened in the editor,
// and removed when the note is saved or the edit is cancelled.
import {useEffect, useRef, useState} from 'react';

const key = (path) => `notes-draft:${path ?? '(new)'}`;

export function readDraft(path) {
  try {
    return JSON.parse(localStorage.getItem(key(path)));
  } catch {
    return null;
  }
}

export function clearDraft(path) {
  try {
    localStorage.removeItem(key(path));
  } catch {
    // storage blocked
  }
}

// Saves `form` under the note's path a moment after each change, while `dirty`
export function useDraftAutosave(path, form, dirty, enabled = true) {
  const [savedAt, setSavedAt] = useState(null);
  const timer = useRef(null);
  useEffect(() => {
    if (!enabled || !form || !dirty) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const at = new Date().toISOString();
        localStorage.setItem(key(path), JSON.stringify({...form, savedAt: at}));
        setSavedAt(at);
      } catch {
        // storage full or blocked: the draft just isn't kept
      }
    }, 600);
    return () => clearTimeout(timer.current);
  }, [path, form, dirty, enabled]);
  return savedAt;
}
