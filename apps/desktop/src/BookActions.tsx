import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { errorText, useT } from '@cairn/ui';
import { payloadOf } from '@cairn/core/errors';

export function BookActions({
  bookId, title, onDetails, onEditCatalog, onBuildUniverse, onExportAudio, onExportSlides, onRename, onDelete,
}: {
  bookId: string;
  title: string;
  onDetails?: (bookId: string) => void;
  onEditCatalog?: (bookId: string) => void;
  onBuildUniverse?: (bookId: string) => void;
  onExportAudio?: (bookId: string) => void | Promise<void>;
  onExportSlides?: (bookId: string) => void | Promise<void>;
  /** Put the row into inline rename; Home owns the editing state. */
  onRename?: (bookId: string) => void;
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
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);

  const actions = [
    ...(onDetails ? [{ label: t.home.bookDetails, run: () => onDetails(bookId) }] : []),
    ...(onBuildUniverse ? [{ label: t.home.buildUniverse, run: () => onBuildUniverse(bookId) }] : []),
    ...(onEditCatalog ? [{ label: t.home.editCatalog, run: () => onEditCatalog(bookId) }] : []),
    ...(onExportAudio ? [{ label: t.home.exportAudio, run: () => void onExportAudio(bookId) }] : []),
    ...(onExportSlides ? [{ label: t.home.exportSlides, run: () => void onExportSlides(bookId) }] : []),
    ...(onRename ? [{ label: t.home.rename, run: () => onRename(bookId) }] : []),
    ...(onDelete ? [{ label: t.home.delete, run: () => setConfirming(true), danger: true }] : []),
  ];
  const focus = (index: number): void => {
    setActive(index);
    items.current[index]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    setActive(0);
    items.current[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || trigger.current?.contains(target)) return;
      close(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
    };

    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [close, open]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (actions.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      focus((active + step + actions.length) % actions.length);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const index = items.current.findIndex((item) => item === event.target);
      if (index < 0) return;
      event.preventDefault();
      actions[index]?.run();
      close(false);
    }
  };

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
        <div className="shelf-menu" id={menuId} ref={menu} role="menu" onKeyDown={onMenuKeyDown}>
          {actions.map((action, index) => (
            <button
              key={action.label}
              type="button"
              ref={(element) => { items.current[index] = element; }}
              role="menuitem"
              tabIndex={index === active ? 0 : -1}
              className={['shelf-menu-item', index === active ? 'active' : '', action.danger ? 'danger' : ''].filter(Boolean).join(' ')}
              onFocus={() => setActive(index)}
              onMouseEnter={() => focus(index)}
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
