import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { catalogCategories, filterCatalog } from '@cairn/core/catalog/search';
import type { CatalogFile } from '@cairn/core/catalog/types';
import { FEATURED_FORMATS } from '@cairn/core/parse/format';
import type { LibraryEntry } from '@cairn/core/store/library';
import { GearMark, useT } from '@cairn/ui';
import { bookMeta, inShell } from './bridge';
import { BookActions } from './BookActions';
import type { BookMeta } from './shared/types';
import { shortcuts } from './shortcut';

/**
 * The first screen: put a book in.
 *
 * Opening straight into whichever book happens to be first in the library made
 * the app look like it owned that book. The entry point is the drop zone; the
 * shelf below it is for walking a path again, and nothing opens until it is picked.
 */
export function Home({
  books, catalog, base, onAdd, onOpen, onDetails, onEditCatalog, onBuildUniverse, onDelete, onSettings,
}: {
  books: readonly LibraryEntry[];
  catalog: CatalogFile;
  /** The library server's base URL, for covers. */
  base?: string;
  onAdd: () => void;
  onOpen: (bookId: string) => void;
  onDetails?: (bookId: string) => void;
  onEditCatalog?: (bookId: string) => void;
  onBuildUniverse?: (bookId: string) => void;
  /** Absent outside the desktop shell, where there is no main process to delete with. */
  onDelete?: (bookId: string) => Promise<void>;
  onSettings: () => void;
}): ReactElement {
  const t = useT();
  const [meta, setMeta] = useState<Readonly<Record<string, BookMeta>>>({});
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const ids = books.map((b) => b.id).join('\n');
  // One at a time: a first launch with a key looks every book up, and a burst helps nobody
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const id of ids.split('\n').filter(Boolean)) {
        const found = await bookMeta(id);
        if (!live) return;
        if (found) setMeta((m) => ({ ...m, [id]: found }));
      }
    })();
    return () => { live = false; };
  }, [ids]);

  const categories = useMemo(() => catalogCategories(books, catalog), [books, catalog]);
  const visible = useMemo(() => filterCatalog(books, catalog, query, category), [books, catalog, query, category]);

  return (
    <div className="home">
      <header className="home-head">
        <h1>Cairn</h1>
        <p>{t.home.tagline}</p>
        {/* The only way in from the shelf; inside a book it is in the book menu. */}
        <button
          type="button"
          className="home-gear"
          onClick={onSettings}
          aria-label={t.home.settings}
          title={`${t.home.settings} (${shortcuts.label(',')})`}
        >
          <GearMark />
        </button>
      </header>

      <button type="button" className="drop-zone" onClick={onAdd} disabled={!inShell}>
        <span className="drop-title">{t.home.dropTitle}</span>
        <span className="drop-sub">{t.home.dropSub(FEATURED_FORMATS)}</span>
        <span className="drop-cta">{inShell ? t.home.dropCta : t.home.devCta}</span>
      </button>

      {books.length > 0 && (
        <section className="shelf">
          <h2 className="shelf-title">{t.home.shelf}</h2>
          <div className="shelf-filters">
            <input
              type="search"
              className="shelf-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.home.searchBooks}
              aria-label={t.home.searchBooks}
            />
            <div className="shelf-categories" aria-label={t.home.shelf}>
              <CategoryButton active={category === 'all'} onClick={() => setCategory('all')}>{t.home.all}</CategoryButton>
              <CategoryButton active={category === 'uncategorized'} onClick={() => setCategory('uncategorized')}>
                {t.home.uncategorized}
              </CategoryButton>
              {categories.map((name) => (
                <CategoryButton key={name} active={category === name} onClick={() => setCategory(name)}>{name}</CategoryButton>
              ))}
            </div>
          </div>
          {visible.map((b) => (
            <div className="shelf-row" key={b.id}>
              <button type="button" className="shelf-item" onClick={() => onOpen(b.id)}>
                <ShelfText book={b} meta={meta[b.id]} {...(base ? { base } : {})} />
              </button>
              <BookActions
                bookId={b.id}
                title={b.title}
                {...(onDetails ? { onDetails } : {})}
                {...(onEditCatalog ? { onEditCatalog } : {})}
                {...(onBuildUniverse ? { onBuildUniverse } : {})}
                {...(onDelete ? { onDelete } : {})}
              />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function CategoryButton({ active, children, onClick }: {
  active: boolean;
  children: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button type="button" className={active ? 'shelf-category active' : 'shelf-category'} onClick={onClick}>
      {children}
    </button>
  );
}

function ShelfText({ book: b, meta, base }: {
  book: LibraryEntry;
  meta?: BookMeta | undefined;
  base?: string;
}): ReactElement {
  const t = useT();
  return (
    <>
      {meta?.cover && base && <img className="shelf-cover" src={`${base}/${meta.cover}`} alt="" />}
      <span className="shelf-text">
        <span className="shelf-name">{b.title}</span>
        <span className="shelf-meta">
          {t.unit.count(b.stations)} · {b.complete === false ? t.unit.approx : ''}
          {t.unit.minutes(b.minutes)}
          {b.complete === false && (
            <span className="shelf-building">
              {t.home.built(b.built ?? 0, b.stations)}
            </span>
          )}
          {b.author ? ` · ${b.author}` : ''}
          {meta?.rating !== undefined ? ` · ${t.home.rating(meta.rating)}` : ''}
        </span>
        {meta?.intro && <span className="shelf-intro">{meta.intro}</span>}
      </span>
    </>
  );
}
