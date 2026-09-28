import { describe, expect, test } from 'bun:test';
import type { CatalogStore } from '@cairn/core/store/catalog-disk';
import type { Library, LibraryEntry } from '@cairn/core/store/library-disk';
import type { Weread } from '../../src/main/weread/service';
import type { UniverseService } from '../../src/main/universe/service';
import { createHandlers } from '../../src/main/rpc';

const entry: LibraryEntry = {
  id: 'thinking', title: 'Old Title', stations: 3, minutes: 6,
  budgetId: 'brief', generatedAt: '2026-09-29T00:00:00Z',
};

function handlersFor(fakeLibrary: Partial<Library>) {
  return createHandlers({
    books: {} as never,
    weread: {} as Weread,
    catalog: { read: async () => ({ version: 1, records: {} }) } as CatalogStore,
    universe: {
      get: async () => undefined, build: async () => { throw new Error('no'); },
      patch: async () => undefined, relink: async () => undefined,
    } as UniverseService,
    exporter: {} as never,
    providerFor: async () => ({}) as never,
    library: fakeLibrary as Pick<Library, 'list' | 'loadNotes' | 'patchEntry' | 'loadPath' | 'rewritePath'>,
    devBuild: false, menu: () => undefined,
    emit: { progress: () => undefined, companion: () => undefined },
  });
}

describe('renameBook handler', () => {
  test('patches the entry title and rewrites path.json with the new name', async () => {
    let patched: string | undefined;
    let rewritten: string | undefined;
    const handlers = handlersFor({
      patchEntry: async (bookId, patch) => {
        expect(bookId).toBe('thinking');
        patched = patch.title;
        return { ...entry, title: patch.title ?? entry.title };
      },
      loadPath: async () => ({ bookId: 'thinking', title: 'Old Title', type: 'knowledge', nodes: [], stages: [], totalMinutes: 6, generatedAt: 'x' }),
      rewritePath: async (path) => { rewritten = path.title; },
    });

    const updated = await handlers.renameBook({ bookId: 'thinking', title: '  新书名  ' });

    expect(patched).toBe('新书名');
    expect(rewritten).toBe('新书名');
    expect(updated.title).toBe('新书名');
  });

  test('rejects unsafe ids and empty titles before any write', async () => {
    let writes = 0;
    const handlers = handlersFor({
      patchEntry: async () => { writes += 1; return entry; },
      loadPath: async () => { throw new Error('must not read'); },
      rewritePath: async () => { writes += 1; },
    });

    await expect(handlers.renameBook({ bookId: '../evil', title: 'X' })).rejects.toThrow();
    await expect(handlers.renameBook({ bookId: 'thinking', title: '   ' })).rejects.toThrow();
    expect(writes).toBe(0);
  });

  test('a book missing from the shelf refuses with book_not_listed', async () => {
    const handlers = handlersFor({
      patchEntry: async () => undefined,
      loadPath: async () => { throw new Error('must not read'); },
      rewritePath: async () => undefined,
    });
    await expect(handlers.renameBook({ bookId: 'thinking', title: 'New' })).rejects.toThrow('book_not_listed');
  });
});
