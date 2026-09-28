import { expect, test } from 'bun:test';
import type { BookBuilder } from '@cairn/core/books/builder';
import type { CatalogFile, CatalogPatch } from '@cairn/core/catalog/types';
import type { CatalogStore } from '@cairn/core/store/catalog-disk';
import type { Library } from '@cairn/core/store/library-disk';
import type { Weread } from '../../src/main/weread/service';
import { createHandlers } from '../../src/main/rpc';

const catalog: CatalogFile = {
  version: 1,
  records: {
    'book-one': {
      bookId: 'book-one', category: 'Reader shelf', tags: ['kept'],
      categorySource: 'manual', tagsSource: 'manual', updatedAt: '2026-09-28T00:00:00.000Z',
    },
  },
};

function handlersFor(fakeCatalog: CatalogStore, books: BookBuilder = {} as BookBuilder) {
  return createHandlers({
    books,
    weread: {} as Weread,
    catalog: fakeCatalog,
    providerFor: async () => ({}) as never,
    library: {} as Pick<Library, 'list' | 'loadNotes'>,
    devBuild: false,
    menu: () => undefined,
    emit: { progress: () => undefined, companion: () => undefined },
  });
}

test('catalog patches reject unsafe ids before writing and return a manual patch unchanged', async () => {
  let patches = 0;
  const patch: CatalogPatch = { category: 'Reader shelf', tags: ['kept'], source: 'manual' };
  const fakeCatalog: CatalogStore = {
    read: async () => catalog,
    patch: async (bookId, received) => {
      patches += 1;
      expect(bookId).toBe('book-one');
      expect(received).toEqual(patch);
      return catalog;
    },
    remove: async () => undefined,
  };
  const handlers = handlersFor(fakeCatalog);

  await expect(handlers.catalogPatch({ bookId: '../unsafe', patch })).rejects.toThrow();
  expect(patches).toBe(0);
  await expect(handlers.catalogPatch({ bookId: 'book-one', patch })).resolves.toEqual(catalog);
  expect(patches).toBe(1);
});

test('a successful book deletion removes its catalog record afterwards', async () => {
  const calls: string[] = [];
  const fakeCatalog: CatalogStore = {
    read: async () => catalog,
    patch: async () => catalog,
    remove: async (bookId) => { calls.push(`catalog:${bookId}`); },
  };
  const books = {
    remove: async (bookId: string) => {
      calls.push(`book:${bookId}`);
      return true;
    },
  } as BookBuilder;

  await expect(handlersFor(fakeCatalog, books).deleteBook({ bookId: 'book-one' })).resolves.toBe(true);
  expect(calls).toEqual(['book:book-one', 'catalog:book-one']);
});
