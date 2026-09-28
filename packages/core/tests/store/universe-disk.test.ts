import { beforeEach, expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BookUniverse, RelatedBook } from '../../src/universe/types';
import { openUniverseStore, type UniverseStore } from '../../src/store/universe-disk';

let root = '';
let store: UniverseStore;

const related = (id: string): RelatedBook => ({
  id,
  title: `Related ${id}`,
  authors: ['A. Writer'],
  role: 'support',
  sharedTopics: ['reasoning'],
  rationale: 'Explains a useful complementary perspective.',
  sources: [{ title: 'Publisher page', url: `https://example.com/${id}` }],
  evidence: 'sourced',
  origin: 'generated',
});

const universe = (over: Partial<BookUniverse> = {}): BookUniverse => ({
  version: 1,
  bookId: 'seed-book',
  generatedAt: '2026-09-28T00:00:00.000Z',
  profile: { category: 'Philosophy', topics: ['reasoning'] },
  books: [related('first')],
  dismissed: [],
  ...over,
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cairn-universe-'));
  store = openUniverseStore(root);
});

test('a missing universe reads as absent', async () => {
  expect(await store.read('seed-book')).toBeUndefined();
});

test('refuses ids that could leave the book directory', async () => {
  expect(await store.read('../seed-book')).toBeUndefined();
  await expect(store.install('../seed-book', universe())).rejects.toThrow('Invalid book id');
  await expect(store.patch('../seed-book', (current) => current)).rejects.toThrow('Invalid book id');
  await expect(store.remove('../seed-book')).rejects.toThrow('Invalid book id');
});

test('installs and reads back a validated universe', async () => {
  await store.install('seed-book', universe());

  expect(await store.read('seed-book')).toEqual(universe());
});

test('a failed serialization leaves the installed universe intact', async () => {
  await store.install('seed-book', universe());
  const stringify = JSON.stringify;
  JSON.stringify = () => { throw new Error('disk full'); };

  try {
    await expect(store.install('seed-book', universe({ books: [related('replacement')] })))
      .rejects.toThrow('disk full');
  } finally {
    JSON.stringify = stringify;
  }

  expect(await store.read('seed-book')).toEqual(universe());
});

test('serializes concurrent patches for one book', async () => {
  await store.install('seed-book', universe());

  await Promise.all([
    store.patch('seed-book', (current) => ({ ...current, dismissed: ['first'] })),
    store.patch('seed-book', (current) => ({ ...current, books: [...current.books, related('second')] })),
  ]);

  expect(await store.read('seed-book')).toMatchObject({
    dismissed: ['first'],
    books: [related('first'), related('second')],
  });
});

test('stores the validated shape rather than a data-directory path attached by a caller', async () => {
  await store.install('seed-book', {
    ...universe(),
    ...({ dataDirectory: root } as Record<string, unknown>),
  } as BookUniverse);

  const saved = await readFile(join(root, 'books', 'seed-book', 'universe.json'), 'utf8');
  expect(saved).not.toContain(root);
});
