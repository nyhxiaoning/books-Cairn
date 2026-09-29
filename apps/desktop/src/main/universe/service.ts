import type { LlmProvider } from '@cairn/core/llm/types';
import type { CatalogStore } from '@cairn/core/store/catalog-disk';
import type { LibraryEntry } from '@cairn/core/store/library';
import type { Library } from '@cairn/core/store/library-disk';
import { isFinished, type ReadingRecord } from '@cairn/core/store/reading';
import type { UniverseMutation, UniverseStore } from '@cairn/core/store/universe-disk';
import { discoverRelations } from '@cairn/core/universe/discover';
import { matchRelatedBook } from '@cairn/core/universe/identity';
import { deriveBookProfile, type BookProfile } from '@cairn/core/universe/profile';
import { mergeUniverse, parseUniverse, type BookUniverse, type RelatedBook, type UniverseRole } from '@cairn/core/universe/types';
const ROLES: readonly UniverseRole[] = ['foundation', 'support', 'oppose', 'verify', 'apply', 'extend'];

export interface UniverseService {
  get(bookId: string): Promise<BookUniverse | undefined>;
  build(bookId: string, signal?: AbortSignal): Promise<BookUniverse>;
  patch(bookId: string, change: UniverseMutation): Promise<BookUniverse | undefined>;
  relink(): Promise<void>;
}

interface UniverseServiceDependencies {
  readonly library: Pick<Library, 'list' | 'loadNotes' | 'loadPath'>;
  readonly catalog: Pick<CatalogStore, 'read'>;
  readonly store: UniverseStore;
  readonly providerFor: (bookId: string) => Promise<LlmProvider>;
  readonly readReadingRecord: (bookId: string) => Promise<ReadingRecord | undefined>;
  readonly now: () => string;
}

async function enrichBook(
  book: RelatedBook,
  entries: readonly LibraryEntry[],
  deps: Pick<UniverseServiceDependencies, 'library' | 'readReadingRecord'>,
): Promise<RelatedBook> {
  const { linkedBookId: _linkedBookId, ...unlinked } = book;
  const linkedBookId = matchRelatedBook(book, entries).linkedBookId;
  if (linkedBookId === undefined) {
    return { ...unlinked, evidence: book.sources.length > 0 ? 'sourced' : 'candidate' };
  }

  const imported: RelatedBook = { ...unlinked, linkedBookId, evidence: 'imported' };
  let notes;
  try {
    notes = await deps.library.loadNotes(linkedBookId);
  } catch {
    return imported;
  }
  if (notes.length === 0) return imported;

  const mapped: RelatedBook = { ...imported, evidence: 'mapped' };
  const entry = entries.find((candidate) => candidate.id === linkedBookId);
  if (entry === undefined) return mapped;
  try {
    const [path, record] = await Promise.all([
      deps.library.loadPath(linkedBookId),
      deps.readReadingRecord(linkedBookId),
    ]);
    return isFinished(entry, path, record) ? { ...mapped, evidence: 'finished' } : mapped;
  } catch {
    return mapped;
  }
}

async function enrichBooks(
  books: readonly RelatedBook[],
  entries: readonly LibraryEntry[],
  deps: Pick<UniverseServiceDependencies, 'library' | 'readReadingRecord'>,
): Promise<readonly RelatedBook[]> {
  return Promise.all(books.map((book) => enrichBook(book, entries, deps)));
}

export function createUniverseService(deps: UniverseServiceDependencies): UniverseService {
  const inFlight = new Map<string, Promise<BookUniverse>>();

  const runBuild = async (bookId: string, signal?: AbortSignal): Promise<BookUniverse> => {
    const entries = await deps.library.list();
    const entry = entries.find((candidate) => candidate.id === bookId);
    if (entry === undefined) throw new Error(`Book not found: ${bookId}`);

    const [catalog, notes] = await Promise.all([
      deps.catalog.read(),
      deps.library.loadNotes(bookId),
    ]);
    // No external search adapters: candidates come from the model's own
    // knowledge, validated against the shelf and local notes.
    const profile = deriveBookProfile(entry, catalog.records[bookId], notes);
    const discovered = await discoverRelations(profile, [], await deps.providerFor(bookId), signal);
    const books = await enrichBooks(discovered, entries, deps);
    const generated = parseUniverse({
      version: 1,
      bookId,
      generatedAt: deps.now(),
      profile: { category: profile.category, topics: profile.topics },
      books,
      dismissed: [],
    });
    if (generated === undefined) throw new Error('Invalid generated universe');
    const merged = await deps.store.patch(bookId, (current) => {
      const validated = parseUniverse(mergeUniverse(current, generated));
      if (validated === undefined) throw new Error('Invalid merged universe');
      return validated;
    });
    return merged ?? deps.store.install(bookId, generated);
  };

  const build = (bookId: string, signal?: AbortSignal): Promise<BookUniverse> => {
    const current = inFlight.get(bookId);
    if (current !== undefined) return current;
    const pending = runBuild(bookId, signal);
    inFlight.set(bookId, pending);
    void pending.finally(() => {
      if (inFlight.get(bookId) === pending) inFlight.delete(bookId);
    }).catch(() => undefined);
    return pending;
  };

  return {
    get: (bookId) => deps.store.read(bookId),
    build,
    patch: (bookId, change) => deps.store.patch(bookId, change),
    async relink() {
      const entries = await deps.library.list();
      await Promise.all(entries.map(async (entry) => {
        const current = await deps.store.read(entry.id);
        if (current === undefined) return;
        const books = await enrichBooks(current.books, entries, deps);
        if (JSON.stringify(books) === JSON.stringify(current.books)) return;
        await deps.store.install(entry.id, { ...current, books });
      }));
    },
  };
}
