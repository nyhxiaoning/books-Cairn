import { expect, test } from 'bun:test';
import type { BookBuilder } from '@cairn/core/books/builder';
import { applyCatalogPatch, type CatalogFile } from '@cairn/core/catalog/types';
import type { LlmProvider } from '@cairn/core/llm/types';
import type { CatalogStore } from '@cairn/core/store/catalog-disk';
import type { Library } from '@cairn/core/store/library-disk';
import type { Weread } from '../../src/main/weread/service';
import { createHandlers } from '../../src/main/rpc';

const automatic: CatalogFile = {
  version: 1,
  records: {
    'book-one': {
      bookId: 'book-one', category: 'Psychology', tags: ['Bias'],
      categorySource: 'automatic', tagsSource: 'automatic', updatedAt: '2026-09-28T00:00:00.000Z',
    },
  },
};

const manual: CatalogFile = {
  version: 1,
  records: {
    'book-one': {
      bookId: 'book-one', category: 'Reader shelf', tags: ['kept'],
      categorySource: 'manual', tagsSource: 'manual', updatedAt: '2026-09-28T00:00:00.000Z',
    },
  },
};

function handlersFor(catalog: CatalogStore, response: string) {
  const provider: LlmProvider = {
    name: 'fake', suggestedConcurrency: 1, overheadTokens: 0,
    async complete() { return response; },
  };
  const library: Pick<Library, 'list' | 'loadNotes'> = {
    list: async () => [{
      id: 'book-one', title: 'Thinking', stations: 1, minutes: 1, budgetId: 'quick',
      generatedAt: '2026-09-28T00:00:00.000Z', language: 'en',
    }],
    loadNotes: async () => [{
      idx: 1, title: 'Thinking clearly', gist: 'How cognitive biases distort decisions.',
      keyPoints: [], quotes: [],
    }],
  };
  return createHandlers({
    books: {} as BookBuilder,
    weread: {} as Weread,
    catalog,
    providerFor: async () => provider,
    library,
    devBuild: false,
    menu: () => undefined,
    emit: { progress: () => undefined, companion: () => undefined },
  });
}

test('explicit catalog suggestions patch automatic fields only', async () => {
  const patches: unknown[] = [];
  const catalog: CatalogStore = {
    read: async () => automatic,
    patch: async (bookId, patch) => {
      patches.push({ bookId, patch });
      return automatic;
    },
    remove: async () => undefined,
  };

  await expect(handlersFor(catalog, '{"category":"Psychology","tags":["Bias"]}')
    .catalogSuggest({ bookId: 'book-one' })).resolves.toEqual(automatic);
  expect(patches).toEqual([{
    bookId: 'book-one', patch: { category: 'Psychology', tags: ['Bias'], source: 'automatic' },
  }]);
});

test('an explicit suggestion cannot replace manual catalog fields', async () => {
  let current = manual;
  const catalog: CatalogStore = {
    read: async () => current,
    patch: async (_bookId, patch) => {
      expect(patch.source).toBe('automatic');
      current = applyCatalogPatch(current, 'book-one', patch, '2026-09-29T00:00:00.000Z');
      return current;
    },
    remove: async () => undefined,
  };

  await expect(handlersFor(catalog, '{"category":"Psychology","tags":["Bias"]}')
    .catalogSuggest({ bookId: 'book-one' })).resolves.toEqual(manual);
  expect(current).toEqual(manual);
});
