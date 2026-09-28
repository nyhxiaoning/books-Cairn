import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { filterCatalog } from '@cairn/core/catalog/search';
import type { CatalogFile } from '@cairn/core/catalog/types';
import type { LibraryEntry } from '@cairn/core/store/library';
import { SettingsProvider } from '@cairn/ui';
import { Home } from '../src/Home';

const books: readonly LibraryEntry[] = [
  { id: 'thinking', title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', stations: 8, minutes: 42, budgetId: 'solid', generatedAt: '2026-09-28' },
  { id: 'legacy', title: 'The Analects', stations: 6, minutes: 30, budgetId: 'brief', generatedAt: '2026-09-28' },
];

const catalog: CatalogFile = {
  version: 1,
  records: {
    thinking: {
      bookId: 'thinking', category: 'Psychology', tags: ['bias', 'decision making'],
      categorySource: 'manual', tagsSource: 'manual', updatedAt: '2026-09-28',
    },
  },
};

function render(): string {
  return renderToStaticMarkup(
    <SettingsProvider storageKey="catalog-view-test">
      <Home
        books={books}
        catalog={catalog}
        onAdd={() => undefined}
        onOpen={() => undefined}
        onDetails={() => undefined}
        onEditCatalog={() => undefined}
        onBuildUniverse={() => undefined}
        onSettings={() => undefined}
      />
    </SettingsProvider>,
  );
}

describe('catalog shelf', () => {
  test('renders search, category filters, and per-book menus', () => {
    const html = render();

    expect(html).toContain('placeholder="Search books"');
    expect(html).toContain('>All<');
    expect(html).toContain('>Uncategorized<');
    expect(html).toContain('aria-haspopup="menu"');
  });

  test('narrows by a tag and includes a legacy book under Uncategorized', () => {
    expect(filterCatalog(books, catalog, 'bias', 'all').map((book) => book.id)).toEqual(['thinking']);
    expect(filterCatalog(books, catalog, '', 'uncategorized').map((book) => book.id)).toEqual(['legacy']);
  });
});
