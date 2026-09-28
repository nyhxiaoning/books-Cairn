import { expect, test } from 'bun:test';
import { catalogCategories, filterCatalog } from '../../src/catalog/search';
import type { CatalogFile, CatalogRecord } from '../../src/catalog/types';
import type { LibraryEntry } from '../../src/store/library';

const entry = (id: string, title: string, author?: string): LibraryEntry => ({
  id,
  title,
  ...(author === undefined ? {} : { author }),
  stations: 1,
  minutes: 1,
  budgetId: 'gist',
  generatedAt: '2026-09-28T00:00:00.000Z',
});

const record = (bookId: string, category: string | undefined, tags: readonly string[]): CatalogRecord => ({
  bookId,
  ...(category === undefined ? {} : { category }),
  tags,
  categorySource: 'manual',
  tagsSource: 'manual',
  updatedAt: '2026-09-28T00:00:00.000Z',
});

const file = (records: Readonly<Record<string, CatalogRecord>>): CatalogFile => ({ version: 1, records });

test('searches title, author, category and tags without changing shelf order', () => {
  const books = [entry('a', 'Thinking, Fast and Slow', 'Daniel Kahneman'), entry('b', '乡土中国', '费孝通')];
  const catalog = file({
    a: record('a', 'Psychology', ['bias', 'decision']),
    b: record('b', '社会学', ['乡村', '信任']),
  });

  expect(filterCatalog(books, catalog, 'BIAS', 'all').map((book) => book.id)).toEqual(['a']);
  expect(filterCatalog(books, catalog, 'psychology', 'all').map((book) => book.id)).toEqual(['a']);
  expect(filterCatalog(books, catalog, '费孝通', '社会学').map((book) => book.id)).toEqual(['b']);
  expect(filterCatalog(books, catalog, 'thinking', 'all').map((book) => book.id)).toEqual(['a']);
});

test('normalizes Unicode and repeated whitespace in queries and catalog text', () => {
  const books = [entry('a', 'Cafe\u0301   Society', '  DANIEL\tKAHNEMAN ')];
  const catalog = file({ a: record('a', '  Cognitive\nScience ', ['  Decision\tMaking ']) });

  expect(filterCatalog(books, catalog, 'CAFÉ SOCIETY', 'all').map((book) => book.id)).toEqual(['a']);
  expect(filterCatalog(books, catalog, 'daniel kahneman', 'all').map((book) => book.id)).toEqual(['a']);
  expect(filterCatalog(books, catalog, 'decision making', 'all').map((book) => book.id)).toEqual(['a']);
});

test('lists each category represented on the shelf once', () => {
  const books = [entry('a', 'First'), entry('b', 'Second'), entry('c', 'Third')];
  const catalog = file({
    a: record('a', 'Psychology', []),
    b: record('b', 'Psychology', []),
    ignored: record('ignored', 'Sociology', []),
  });

  expect(catalogCategories(books, catalog)).toEqual(['Psychology']);
});

test('keeps all matching books for an empty query and recognizes uncategorized legacy books', () => {
  const books = [entry('a', 'First'), entry('b', 'Second'), entry('c', 'Third')];
  const catalog = file({
    a: record('a', 'Psychology', []),
    b: record('b', undefined, ['legacy']),
  });

  expect(filterCatalog(books, catalog, '   ', 'all').map((book) => book.id)).toEqual(['a', 'b', 'c']);
  expect(filterCatalog(books, catalog, '', 'uncategorized').map((book) => book.id)).toEqual(['b', 'c']);
  expect(filterCatalog(books, catalog, '', 'Psychology').map((book) => book.id)).toEqual(['a']);
});
