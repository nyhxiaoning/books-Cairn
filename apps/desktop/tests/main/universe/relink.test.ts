import { expect, test } from 'bun:test';
import type { LibraryEntry } from '@cairn/core/store/library';
import type { UniverseStore } from '@cairn/core/store/universe-disk';
import type { BookUniverse } from '@cairn/core/universe/types';
import { DEFAULT_SHELL_SETTINGS } from '../../../src/shared/settings';
import { createUniverseService } from '../../../src/main/universe/service';

const generatedAt = '2026-09-28T08:00:00.000Z';

const entry: LibraryEntry = {
  id: 'local-book', title: 'Related 1', author: 'A. Writer', stations: 1, minutes: 2,
  budgetId: 'brief', generatedAt, complete: true,
};

const notes = [{ idx: 1, title: 'T', gist: 'G', keyPoints: [], quotes: [] }];

function candidateUniverse(): BookUniverse {
  return {
    version: 1, bookId: 'local-book', generatedAt,
    profile: { category: 'C', topics: [] }, dismissed: [],
    books: [{
      id: 'gen1', title: 'Related 1', authors: ['A. Writer'], role: 'oppose',
      sharedTopics: [], rationale: 'Public evidence.', sources: [],
      evidence: 'sourced', origin: 'generated',
    }],
  };
}

function setup(entries: readonly LibraryEntry[], withNotes: boolean) {
  const installed = new Map<string, BookUniverse>([['local-book', candidateUniverse()]]);
  const installs: BookUniverse[] = [];
  const store: UniverseStore = {
    read: async (bookId) => installed.get(bookId),
    install: async (_bookId, universe) => {
      installs.push(universe);
      installed.set(universe.bookId, universe);
      return universe;
    },
    patch: async () => undefined,
    remove: async () => undefined,
  };
  const service = createUniverseService({
    library: {
      list: async () => entries,
      loadNotes: async () => (withNotes ? notes : []),
      loadPath: async () => {
        throw new Error('relink must not read paths');
      },
    },
    catalog: { read: async () => ({ version: 1, records: {} }) },
    store,
    providerFor: async () => { throw new Error('relink must not call the model'); },
    readSettings: async () => DEFAULT_SHELL_SETTINGS,
    webSearch: () => ({ search: async () => { throw new Error('relink must not search'); } }),
    fetchWeb: async () => { throw new Error('relink must not fetch'); },
    readReadingRecord: async () => undefined,
    now: () => generatedAt,
  });
  return { service, installs, current: () => installed.get('local-book') };
}

test('adding matching notes upgrades a sourced candidate to mapped', async () => {
  const state = setup([entry], true);

  await state.service.relink();

  expect(state.current()?.books[0]).toMatchObject({ linkedBookId: 'local-book', evidence: 'mapped' });
  expect(state.installs).toHaveLength(1);
});

test('a candidate with no matching entry and no sources downgrades to candidate state', async () => {
  const staleUniverse: BookUniverse = {
    ...candidateUniverse(),
    books: candidateUniverse().books.map((book) => ({
      ...book, linkedBookId: 'local-book', evidence: 'mapped' as const,
    })),
  };
  const seen: BookUniverse[] = [];
  const otherEntry: LibraryEntry = {
    id: 'other-book', title: 'Other', stations: 1, minutes: 2, budgetId: 'brief', generatedAt, complete: true,
  };
  const service = createUniverseService({
    library: {
      list: async () => [otherEntry],
      loadNotes: async () => [],
      loadPath: async () => {
        throw new Error('relink must not read paths');
      },
    },
    catalog: { read: async () => ({ version: 1, records: {} }) },
    store: {
      read: async () => staleUniverse,
      install: async (_bookId, universe) => {
        seen.push(universe);
        return universe;
      },
      patch: async () => undefined,
      remove: async () => undefined,
    },
    providerFor: async () => { throw new Error('relink must not call the model'); },
    readSettings: async () => DEFAULT_SHELL_SETTINGS,
    webSearch: () => ({ search: async () => { throw new Error('relink must not search'); } }),
    fetchWeb: async () => { throw new Error('relink must not fetch'); },
    readReadingRecord: async () => undefined,
    now: () => generatedAt,
  });

  await service.relink();

  expect(seen).toHaveLength(1);
  const book = seen[0]?.books[0];
  expect(book).toMatchObject({
    title: 'Related 1', role: 'oppose', rationale: 'Public evidence.',
    // The linked entry disappeared and no sources were recorded, so the honest
    // state after relinking is a plain candidate.
    evidence: 'candidate',
  });
  expect(book?.linkedBookId).toBeUndefined();
});

test('two identical entries leave the candidate ambiguous and untouched', async () => {
  const state = setup([entry, { ...entry, id: 'local-book-2' }], false);

  await state.service.relink();

  expect(state.current()?.books[0]?.linkedBookId).toBeUndefined();
  expect(state.current()?.books[0]?.evidence).toBe('candidate');
  expect(state.installs).toHaveLength(1);
});
