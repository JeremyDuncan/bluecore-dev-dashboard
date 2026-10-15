// A confirmation dialog for anything that can't easily be undone. A native <dialog>: focus stays
// inside, Esc or a click outside cancels, and Cancel has the focus first, so Enter doesn't confirm.
import React, {useEffect, useId, useRef, useState} from 'react';
import {TrashIcon, XIcon} from './icons';
import styles from './styles.module.css';

// open: show it; onConfirm: async, the dialog shows its error if it throws
export default function ConfirmDialog({open, title, children, confirmLabel, busyLabel = 'Working…', onConfirm, onCancel}) {
  const ref = useRef(null);
  const titleId = useId();
  const [state, setState] = useState(null); // {busy} | {error}

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setState(null);
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  const cancel = () => !state?.busy && onCancel();
  const confirm = async () => {
    setState({busy: true});
    try {
      await onConfirm();
      setState(null);
    } catch (err) {
      setState({error: err.message});
    }
  };

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault(); // Esc: close through React state
        cancel();
      }}
      onClick={(e) => e.target === ref.current && cancel()} // a click on the backdrop
    >
      {open && (
        <div className={styles.dialogBody}>
          <h2 id={titleId} className={styles.dialogTitle}>
            <TrashIcon size={20} />
            {title}
          </h2>
          {children}
          {state?.error && (
            <p className={styles.error} role="alert">
              {state.error}
            </p>
          )}
          <div className={styles.dialogActions}>
            <button type="button" className={`button button--secondary ${styles.withIcon}`} onClick={cancel} autoFocus disabled={state?.busy}>
              <XIcon size={15} /> Cancel
            </button>
            <button type="button" className={`button button--danger ${styles.withIcon}`} onClick={confirm} disabled={state?.busy}>
              <TrashIcon size={15} />
              {state?.busy ? busyLabel : confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
