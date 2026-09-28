import type { LibraryEntry } from '../store/library';
import type { CatalogFile } from './types';

type CatalogCategory = 'all' | 'uncategorized' | string;

const normalized = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

export function catalogCategories(
  books: readonly LibraryEntry[],
  catalog: CatalogFile,
): readonly string[] {
  const categories = new Set<string>();

  for (const book of books) {
    const category = catalog.records[book.id]?.category;
    if (category !== undefined && category !== 'all' && category !== 'uncategorized') {
      categories.add(category);
    }
  }

  return [...categories];
}

export function filterCatalog(
  books: readonly LibraryEntry[],
  catalog: CatalogFile,
  query: string,
  category: CatalogCategory,
): readonly LibraryEntry[] {
  const needle = normalized(query);

  return books.filter((book) => {
    const record = catalog.records[book.id];
    const inCategory = category === 'all'
      || (category === 'uncategorized' ? !record?.category : record?.category === category);
    const haystack = normalized([
      book.title,
      book.author ?? '',
      record?.category ?? '',
      ...(record?.tags ?? []),
    ].join(' '));
    return inCategory && (!needle || haystack.includes(needle));
  });
}
