import type { WebSearch } from '@cairn/core/companion/web-search';
import type { LlmProvider } from '@cairn/core/llm/types';
import type { CatalogStore } from '@cairn/core/store/catalog-disk';
import type { LibraryEntry } from '@cairn/core/store/library';
import type { Library } from '@cairn/core/store/library-disk';
import { isFinished, type ReadingRecord } from '@cairn/core/store/reading';
import type { UniverseMutation, UniverseStore } from '@cairn/core/store/universe-disk';
import { discoverRelations, type PublicEvidencePage } from '@cairn/core/universe/discover';
import { matchRelatedBook } from '@cairn/core/universe/identity';
import { deriveBookProfile, type BookProfile } from '@cairn/core/universe/profile';
import { mergeUniverse, parseUniverse, type BookUniverse, type RelatedBook, type UniverseRole } from '@cairn/core/universe/types';
import type { ShellSettingsValues } from '../../shared/settings';
import { effectiveSearchKey } from '../settings';
import type { FetchedWebResult } from '../companion/web-tools';

const ROLES: readonly UniverseRole[] = ['foundation', 'support', 'oppose', 'verify', 'apply', 'extend'];
const MAX_QUERY_LENGTH = 200;
const MAX_PAGES = 12;
const MAX_PAGE_TEXT = 4_000;

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
  readonly readSettings: () => Promise<ShellSettingsValues>;
  readonly webSearch: (
    provider: ShellSettingsValues['searchProvider'], key?: string,
  ) => Pick<WebSearch, 'search'>;
  readonly fetchWeb: (url: string, dependencies?: {}, signal?: AbortSignal) => Promise<FetchedWebResult>;
  readonly readReadingRecord: (bookId: string) => Promise<ReadingRecord | undefined>;
  readonly now: () => string;
}

const queryFor = (profile: BookProfile, role: UniverseRole): string => [
  role, 'related books for', `"${profile.title}"`, profile.author, profile.category, ...profile.topics,
].filter((part): part is string => Boolean(part)).join(' ').slice(0, MAX_QUERY_LENGTH);

const uniqueUrls = (results: readonly (readonly { readonly url: string }[])[]): readonly string[] => {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const result of results.flat()) {
    if (!result.url || seen.has(result.url)) continue;
    seen.add(result.url);
    urls.push(result.url);
    if (urls.length === MAX_PAGES) break;
  }
  return urls;
};

const evidencePage = (url: string, fetched: FetchedWebResult): PublicEvidencePage => {
  const source = fetched.evidence.refs[0];
  return {
    title: source !== undefined && 'url' in source ? source.title || url : url,
    url: source !== undefined && 'url' in source ? source.url || url : url,
    text: fetched.text.slice(0, MAX_PAGE_TEXT),
  };
};

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
    const profile = deriveBookProfile(entry, catalog.records[bookId], notes);
    const settings = await deps.readSettings();
    const search = deps.webSearch(settings.searchProvider, effectiveSearchKey(settings));
    const results = await Promise.all(ROLES.map((role) => search.search(queryFor(profile, role), signal)));
    const urls = uniqueUrls(results);
    const fetched = await Promise.all(urls.map(async (url) =>
      evidencePage(url, await deps.fetchWeb(url, {}, signal))));
    const discovered = fetched.length === 0
      ? []
      : await discoverRelations(profile, fetched, await deps.providerFor(bookId), signal);
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
