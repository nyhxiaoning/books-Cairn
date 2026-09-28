import { beforeEach, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCatalog, type CatalogStore } from '../../src/store/catalog-disk';

let root = '';
let store: CatalogStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cairn-catalog-'));
  store = openCatalog(root, () => '2026-09-28T00:00:00.000Z');
});

test('a missing catalog reads as an empty versioned file', async () => {
  expect(await store.read()).toEqual({ version: 1, records: {} });
});

test('concurrent patches keep both records', async () => {
  await Promise.all([
    store.patch('book-a', { category: 'A', source: 'manual' }),
    store.patch('book-b', { tags: ['B'], source: 'manual' }),
  ]);

  expect(Object.keys((await store.read()).records).sort()).toEqual(['book-a', 'book-b']);
});

test('an automatic patch respects fields claimed manually', async () => {
  await store.patch('book-a', {
    category: 'Reader category', tags: ['reader tag'], source: 'manual',
  });
  await store.patch('book-a', {
    category: 'Automatic category', tags: ['automatic tag'], source: 'automatic',
  });

  expect((await store.read()).records['book-a']).toMatchObject({
    category: 'Reader category', tags: ['reader tag'],
    categorySource: 'manual', tagsSource: 'manual',
  });
});

test('remove deletes only the requested record', async () => {
  await store.patch('book-a', { category: 'A', source: 'manual' });
  await store.patch('book-b', { category: 'B', source: 'manual' });

  await store.remove('book-a');

  expect(Object.keys((await store.read()).records)).toEqual(['book-b']);
});
