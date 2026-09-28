import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { errorText, useT } from '@cairn/ui';
import { payloadOf } from '@cairn/core/errors';

export function BookActions({
  bookId, title, onDetails, onEditCatalog, onBuildUniverse, onDelete,
}: {
  bookId: string;
  title: string;
  onDetails?: (bookId: string) => void;
  onEditCatalog?: (bookId: string) => void;
  onBuildUniverse?: (bookId: string) => void;
  onDelete?: (bookId: string) => Promise<void>;
}): ReactElement {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);

  const actions = [
    ...(onDetails ? [{ label: t.home.bookDetails, run: () => onDetails(bookId) }] : []),
    ...(onBuildUniverse ? [{ label: t.home.buildUniverse, run: () => onBuildUniverse(bookId) }] : []),
    ...(onEditCatalog ? [{ label: t.home.editCatalog, run: () => onEditCatalog(bookId) }] : []),
    ...(onDelete ? [{ label: t.home.delete, run: () => setConfirming(true), danger: true }] : []),
  ];
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    if (!open) return;
    setActive(0);
    menu.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || trigger.current?.contains(target)) return;
      close(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const count = actionsRef.current.length;
        if (count > 0) setActive((at) => (at + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        actionsRef.current[active]?.run();
        close(false);
      }
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [active, close, open]);

  const remove = async (): Promise<void> => {
    if (!onDelete) return;
    setBusy(true);
    setFailed(undefined);
    try {
      await onDelete(bookId);
      setConfirming(false);
    } catch (cause) {
      setFailed(errorText(payloadOf(cause), t));
    } finally {
      setBusy(false);
    }
  };

  if (confirming) {
    return (
      <span className="shelf-confirm">
        <span className={failed ? 'shelf-ask bad' : 'shelf-ask'} title={failed}>{failed ?? t.home.deleteAsk}</span>
        <button type="button" className="shelf-act danger" disabled={busy} onClick={() => void remove()}>
          {busy ? t.home.deleting : t.home.delete}
        </button>
        <button type="button" className="shelf-act" disabled={busy} onClick={() => { setConfirming(false); setFailed(undefined); }}>
          {t.home.cancel}
        </button>
      </span>
    );
  }

  return (
    <div className="shelf-actions">
      <button
        ref={trigger}
        type="button"
        className="shelf-more"
        aria-label={t.home.moreAria(title)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {open && (
        <div className="shelf-menu" id={menuId} ref={menu} role="menu" tabIndex={-1}>
          {actions.map((action, index) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              className={['shelf-menu-item', index === active ? 'active' : '', action.danger ? 'danger' : ''].filter(Boolean).join(' ')}
              onMouseEnter={() => setActive(index)}
              onClick={(event) => {
                event.stopPropagation();
                action.run();
                close(false);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
