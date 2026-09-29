import { expect, test } from 'bun:test';
import type { LlmProvider, LlmRequest } from '@cairn/core/llm/types';
import type { CatalogStore } from '@cairn/core/store/catalog-disk';
import type { LibraryEntry } from '@cairn/core/store/library';
import type { Library } from '@cairn/core/store/library-disk';
import type { ReadingRecord } from '@cairn/core/store/reading';
import type { UniverseStore } from '@cairn/core/store/universe-disk';
import type { ChapterNote, Path } from '@cairn/core/types';
import { bookIdentity } from '@cairn/core/universe/identity';
import type { BookUniverse } from '@cairn/core/universe/types';
import { createUniverseService } from '../../../src/main/universe/service';

const generatedAt = '2026-09-28T08:00:00.000Z';
const privateSentence = 'PRIVATE NOTE SENTENCE MUST NEVER LEAVE THIS MACHINE';

const entries = [
  {
    id: 'seed-book', title: 'Thinking With Maps', author: 'Ada Reader', stations: 2, minutes: 4,
    budgetId: 'brief', generatedAt, complete: true,
  },
  {
    id: 'local-book', title: 'Related 1', author: 'A. Writer', stations: 2, minutes: 4,
    budgetId: 'brief', generatedAt, complete: true,
  },
] as const;

const notes = [{
  idx: 1, title: 'Maps and decisions', gist: privateSentence,
  keyPoints: [privateSentence], quotes: [privateSentence],
}];

const path = {
  bookId: 'local-book', title: 'Related 1', type: 'knowledge' as const,
  nodes: [{
    id: 'recap', idx: 0, title: 'Recap', kind: 'recap' as const, brief: '', keyPoints: [],
    sourceChapters: [1], estMinutes: 4,
  }],
  stages: [], totalMinutes: 4, generatedAt,
};

const reply = {
  books: Array.from({ length: 3 }, (_, index) => ({
    title: `Related ${index + 1}`,
    authors: ['A. Writer'],
    isbn: null,
    role: ['foundation', 'oppose', 'apply'][index],
    sharedTopics: ['decisions'],
    rationale: `Public evidence supports relationship ${index + 1}.`,
    sourceUrls: [`https://public.example/${index + 1}`],
  })),
};

function setup(overrides: {
  readonly entries?: readonly LibraryEntry[];
  readonly loadNotes?: (bookId: string) => Promise<ChapterNote[]>;
  readonly loadPath?: (bookId: string) => Promise<Path>;
  readonly readReadingRecord?: (bookId: string) => Promise<ReadingRecord | undefined>;
  readonly search?: (query: string) => Promise<readonly { title: string; url: string; snippet: string }[]>;
  readonly fetch?: (url: string) => Promise<{
    resultId: string;
    text: string;
    evidence: { resultId: string; source: 'web'; refs: readonly { url: string; title: string }[] };
  }>;
  readonly complete?: (request: LlmRequest) => Promise<string>;
} = {}) {
  const installed = new Map<string, BookUniverse>([['seed-book', priorUniverse()]]);
  const installs: BookUniverse[] = [];
  const requests: LlmRequest[] = [];
  const events: string[] = [];
  let providerCalls = 0;
  const provider: LlmProvider = {
    name: 'fake', suggestedConcurrency: 1, overheadTokens: 0,
    async complete(request) {
      events.push('model');
      requests.push(request);
      return overrides.complete?.(request) ?? JSON.stringify(reply);
    },
  };
  const library: Pick<Library, 'list' | 'loadNotes' | 'loadPath'> = {
    list: async () => overrides.entries ?? entries,
    loadNotes: async (bookId) => overrides.loadNotes?.(bookId) ?? notes,
    loadPath: async (bookId) => overrides.loadPath?.(bookId) ?? path,
  };
  const catalog: Pick<CatalogStore, 'read'> = {
    read: async () => ({
      version: 1,
      records: {
        'seed-book': {
          bookId: 'seed-book', category: 'Decision making', tags: ['Systems thinking'],
          categorySource: 'manual', tagsSource: 'manual', updatedAt: generatedAt,
        },
      },
    }),
  };
  const store: UniverseStore = {
    read: async (bookId) => installed.get(bookId),
    install: async (bookId, universe) => {
      events.push('install');
      installs.push(universe);
      installed.set(bookId, universe);
      return universe;
    },
    patch: async (bookId, mutation) => {
      const current = installed.get(bookId);
      if (current === undefined) return undefined;
      const next = mutation(current);
      events.push('install');
      installs.push(next);
      installed.set(bookId, next);
      return next;
    },
    remove: async (bookId) => { installed.delete(bookId); },
  };
  const readReadingRecord = async (bookId: string): Promise<ReadingRecord | undefined> =>
    overrides.readReadingRecord === undefined
      ? bookId === 'local-book' ? { pathGeneratedAt: generatedAt, finishedAt: generatedAt } : undefined
      : overrides.readReadingRecord(bookId);
  const service = createUniverseService({
    library,
    catalog,
    store,
    providerFor: async () => {
      providerCalls += 1;
      events.push('provider');
      return provider;
    },
    readReadingRecord,
    now: () => generatedAt,
  });
  return {
    service, installs, requests, events,
    current: (bookId = 'seed-book') => installed.get(bookId),
    providerCalls: () => providerCalls,
  };
}

function priorUniverse(): BookUniverse {
  return {
    version: 1, bookId: 'seed-book', generatedAt: '2026-09-27T08:00:00.000Z',
    profile: { category: 'Old', topics: [] }, books: [], dismissed: [],
  };
}

test('builds and installs an honest universe from the model\'s own knowledge', async () => {
  const { service, installs, requests, events } = setup();

  const universe = await service.build('seed-book');

  expect(universe.books).toHaveLength(3);
  expect(universe.books[0]).toMatchObject({ linkedBookId: 'local-book', evidence: 'finished' });
  expect(installs).toEqual([universe]);
  expect(events.filter((event) => event.startsWith('fetch:'))).toHaveLength(0);
  expect(events.at(-1)).toBe('install');

  const externalRequests = JSON.stringify(requests);
  expect(externalRequests).not.toContain(privateSentence);
  expect(requests[0]?.prompt.length).toBeLessThan(20_000);
});

test.each([
  ['model', setup({ complete: async () => { throw new Error('model failed'); } })],
  ['invalid model output', setup({ complete: async () => 'not json' })],
  ['missing books output', setup({ complete: async () => '{}' })],
] as const)('%s failure retains the prior universe', async (_stage, state) => {
  await expect(state.service.build('seed-book')).rejects.toThrow();
  expect(state.installs).toHaveLength(0);
  expect(state.current()).toEqual(priorUniverse());
});

test('a valid empty model result installs an honest empty universe', async () => {
  const state = setup({ complete: async () => '{"books":[]}' });

  const universe = await state.service.build('seed-book');

  expect(universe.books).toEqual([]);
  expect(state.installs).toEqual([universe]);
  expect(universe.generatedAt).toBe(generatedAt);
});

test('local links become mapped only with notes, and ambiguous matches stay unlinked', async () => {
  const imported = setup({
    loadNotes: async (bookId) => bookId === 'local-book' ? [] : notes,
  });
  const importedUniverse = await imported.service.build('seed-book');
  expect(importedUniverse.books[0]).toMatchObject({ linkedBookId: 'local-book', evidence: 'imported' });

  const mapped = setup({ readReadingRecord: async () => undefined });
  const mappedUniverse = await mapped.service.build('seed-book');
  expect(mappedUniverse.books[0]).toMatchObject({ linkedBookId: 'local-book', evidence: 'mapped' });

  const duplicate: LibraryEntry = {
    ...entries[1], id: 'duplicate-local-book',
  };
  const ambiguous = setup({ entries: [...entries, duplicate] });
  const ambiguousUniverse = await ambiguous.service.build('seed-book');
  expect(ambiguousUniverse.books[0]?.linkedBookId).toBeUndefined();
  // Knowledge-mode candidates carry no sources, so an ambiguous local match
  // stays an honest candidate.
  expect(ambiguousUniverse.books[0]?.evidence).toBe('candidate');
});

test('same-book builds share one promise while another book builds independently', async () => {
  let releaseModel = () => undefined;
  const modelGate = new Promise<void>((resolve) => { releaseModel = resolve; });
  const second: LibraryEntry = {
    id: 'second-seed', title: 'Other Seed', author: 'B. Reader', stations: 1, minutes: 2,
    budgetId: 'brief', generatedAt, complete: true,
  };
  const state = setup({
    entries: [...entries, second],
    complete: async (request) => {
      if (request.prompt.includes('Thinking With Maps')) await modelGate;
      return JSON.stringify(reply);
    },
  });

  const first = state.service.build('seed-book');
  const duplicate = state.service.build('seed-book');
  const independent = state.service.build('second-seed');

  expect(duplicate).toBe(first);
  await expect(independent).resolves.toMatchObject({ bookId: 'second-seed' });
  expect(state.current('seed-book')).toEqual(priorUniverse());
  releaseModel();
  await expect(first).resolves.toMatchObject({ bookId: 'seed-book' });
  expect(state.installs).toHaveLength(2);
});

test('a manual patch completed during discovery survives the final build merge', async () => {
  let releaseModel = () => undefined;
  let modelStarted = () => undefined;
  const modelGate = new Promise<void>((resolve) => { releaseModel = resolve; });
  const started = new Promise<void>((resolve) => { modelStarted = resolve; });
  const state = setup({
    complete: async () => {
      modelStarted();
      await modelGate;
      return JSON.stringify(reply);
    },
  });
  const manual = {
    id: 'manual-book', title: 'Reader choice', authors: ['Reader'], role: 'extend' as const,
    sharedTopics: ['decisions'], rationale: 'Added by the reader.', sources: [],
    evidence: 'candidate' as const, origin: 'manual' as const,
  };
  const dismissedIdentity = bookIdentity({ title: 'Related 2', authors: ['A. Writer'] });

  const building = state.service.build('seed-book');
  await started;
  await state.service.patch('seed-book', (current) => ({
    ...current,
    books: [...current.books, manual],
    dismissed: [...current.dismissed, dismissedIdentity],
  }));
  releaseModel();
  const universe = await building;

  expect(universe.books).toContainEqual(manual);
  expect(universe.dismissed).toContain(dismissedIdentity);
  expect(universe.books.some((book) => book.title === 'Related 2')).toBe(false);
  expect(state.current()).toEqual(universe);
});
