import { useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { CatalogRecord } from '@cairn/core/catalog/types';
import type { LibraryEntry } from '@cairn/core/store/library';
import { useT } from '@cairn/ui';
import type { BookMeta } from './shared/types';
import { UniversePanel, type UniversePanelState } from './UniversePanel';
import type { UniverseChange } from './shared/schema';

export type DetailsSection = 'overview' | 'universe' | 'experts' | 'evidence';

const SECTIONS: readonly DetailsSection[] = ['overview', 'universe', 'experts', 'evidence'];

export function BookDetails({
  book, meta, record, base, section = 'overview', focusCatalogEditor = false,
  universeState = { status: 'empty' }, onBuildUniverse = () => undefined,
  onPatchUniverse = () => undefined, onEditCatalog, onClose,
}: {
  book: LibraryEntry;
  meta?: BookMeta;
  record?: CatalogRecord;
  base?: string;
  section?: DetailsSection;
  focusCatalogEditor?: boolean;
  universeState?: UniversePanelState;
  onBuildUniverse?: () => void | Promise<void>;
  onPatchUniverse?: (change: UniverseChange) => void | Promise<void>;
  onEditCatalog: () => void;
  onClose: () => void;
}): ReactElement {
  const t = useT();
  const titleId = useId();
  const close = useRef<HTMLButtonElement>(null);
  const editCatalog = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [active, setActive] = useState<DetailsSection>(section);

  useEffect(() => { setActive(section); }, [section]);
  useEffect(() => { close.current?.focus(); }, []);
  useEffect(() => {
    if (focusCatalogEditor) editCatalog.current?.focus();
  }, [focusCatalogEditor]);
  const dismiss = (): void => {
    opener.current?.focus();
    onClose();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <div className="modal-scrim" onClick={dismiss}>
      <section className="modal book-details" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <div className="details-title-row">
          <h2 id={titleId}>{book.title}</h2>
          <button ref={close} type="button" className="details-close" onClick={dismiss}>{t.details.close}</button>
        </div>
        <div className="details-tabs" role="tablist" aria-label={t.details.title}>
          {SECTIONS.map((value) => (
            <button key={value} type="button" role="tab" aria-selected={active === value}
              className={active === value ? 'active' : ''} onClick={() => setActive(value)}>
              {t.details.sections[value]}
            </button>
          ))}
        </div>
        {active === 'overview' ? (
          <div className="details-overview">
            {meta?.cover && <img className="details-cover" src={base ? `${base}/${meta.cover}` : meta.cover} alt="" />}
            <div className="details-summary">
              {book.author && <p>{book.author}</p>}
              <p>{t.unit.count(book.stations)} · {t.unit.minutes(book.minutes)}</p>
              {meta?.rating !== undefined && <p>{t.home.rating(meta.rating)}</p>}
            </div>
            <dl className="details-catalog">
              <dt>{t.details.category}</dt><dd>{record?.category ?? t.details.none}</dd>
              <dt>{t.details.tags}</dt><dd>{record?.tags.length ? record.tags.join(', ') : t.details.none}</dd>
            </dl>
            {meta?.intro && <p className="details-intro">{meta.intro}</p>}
            <button ref={editCatalog} type="button" className="shelf-act" onClick={onEditCatalog}>{t.details.editCatalog}</button>
          </div>
        ) : <UniversePanel section={active} state={universeState}
          onBuild={onBuildUniverse} onPatch={onPatchUniverse} />}
      </section>
    </div>
  );
}
