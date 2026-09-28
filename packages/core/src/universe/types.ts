import { isBookId } from '../store/library';
import { bookIdentity, normalizeIsbn } from './identity';

export type UniverseRole = 'foundation' | 'support' | 'oppose' | 'verify' | 'apply' | 'extend';
export type UniverseEvidence = 'candidate' | 'sourced' | 'imported' | 'mapped' | 'finished';

export interface UniverseSource {
  readonly title: string;
  readonly url: string;
}

export interface RelatedBook {
  readonly id: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly isbn?: string;
  readonly role: UniverseRole;
  readonly sharedTopics: readonly string[];
  readonly rationale: string;
  readonly sources: readonly UniverseSource[];
  readonly evidence: UniverseEvidence;
  readonly linkedBookId?: string;
  readonly origin: 'generated' | 'manual';
  readonly roleEdited?: boolean;
}

export interface BookUniverse {
  readonly version: 1;
  readonly bookId: string;
  readonly generatedAt: string;
  readonly profile: {
    readonly category: string;
    readonly topics: readonly string[];
  };
  readonly books: readonly RelatedBook[];
  /** Stable identities of generated candidates the reader declined. */
  readonly dismissed: readonly string[];
}

const ROLES: readonly UniverseRole[] = ['foundation', 'support', 'oppose', 'verify', 'apply', 'extend'];
const EVIDENCE: readonly UniverseEvidence[] = ['candidate', 'sourced', 'imported', 'mapped', 'finished'];

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const string = (value: unknown, maximum: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maximum ? trimmed : undefined;
};

const strings = (value: unknown, maximumItems: number, maximumLength: number): readonly string[] | undefined => {
  if (!Array.isArray(value) || value.length > maximumItems) return undefined;
  const parsed = value.map((item) => string(item, maximumLength));
  return parsed.every((item): item is string => item !== undefined) ? parsed : undefined;
};

const isRole = (value: unknown): value is UniverseRole =>
  typeof value === 'string' && ROLES.includes(value as UniverseRole);

const isEvidence = (value: unknown): value is UniverseEvidence =>
  typeof value === 'string' && EVIDENCE.includes(value as UniverseEvidence);

const isUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const parseSource = (value: unknown): UniverseSource | undefined => {
  if (!isObject(value)) return undefined;
  const title = string(value.title, 240);
  const url = string(value.url, 2_048);
  return title === undefined || url === undefined || !isUrl(url) ? undefined : { title, url };
};

const parseSources = (value: unknown): readonly UniverseSource[] | undefined => {
  if (!Array.isArray(value) || value.length > 12) return undefined;
  const sources = value.map(parseSource);
  return sources.every((source): source is UniverseSource => source !== undefined) ? sources : undefined;
};

const parseBook = (value: unknown): RelatedBook | undefined => {
  if (!isObject(value)) return undefined;
  const id = string(value.id, 160);
  const title = string(value.title, 240);
  const authors = strings(value.authors, 8, 120);
  const role = isRole(value.role) ? value.role : undefined;
  const sharedTopics = strings(value.sharedTopics, 8, 60);
  const rationale = string(value.rationale, 1_000);
  const sources = parseSources(value.sources);
  const evidence = isEvidence(value.evidence) ? value.evidence : undefined;
  const origin = value.origin === 'generated' || value.origin === 'manual' ? value.origin : undefined;
  const rawIsbn = value.isbn === undefined ? undefined : string(value.isbn, 32);
  const isbn = rawIsbn === undefined ? undefined : normalizeIsbn(rawIsbn);
  const linkedBookId = value.linkedBookId === undefined ? undefined : string(value.linkedBookId, 64);
  const roleEdited = value.roleEdited === undefined ? undefined
    : typeof value.roleEdited === 'boolean' ? value.roleEdited : undefined;

  if (!id || !title || !authors || !role || !sharedTopics || !rationale || !sources || !evidence || !origin ||
    (value.isbn !== undefined && isbn === undefined) ||
    (linkedBookId !== undefined && !isBookId(linkedBookId)) ||
    (value.roleEdited !== undefined && roleEdited === undefined) ||
    (evidence === 'sourced' && sources.length === 0)) return undefined;

  return {
    id, title, authors, ...(isbn === undefined ? {} : { isbn }), role, sharedTopics, rationale,
    sources, evidence, ...(linkedBookId === undefined ? {} : { linkedBookId }), origin,
    ...(roleEdited === undefined ? {} : { roleEdited }),
  };
};

const parseProfile = (value: unknown): BookUniverse['profile'] | undefined => {
  if (!isObject(value)) return undefined;
  const category = string(value.category, 80);
  const topics = strings(value.topics, 8, 60);
  return category === undefined || topics === undefined ? undefined : { category, topics };
};

/** Parses persisted data defensively, keeping valid candidate neighbours. */
export function parseUniverse(input: unknown): BookUniverse | undefined {
  if (!isObject(input) || input.version !== 1 || typeof input.bookId !== 'string' || !isBookId(input.bookId) ||
    !Array.isArray(input.books)) return undefined;
  const generatedAt = string(input.generatedAt, 64);
  const profile = parseProfile(input.profile);
  const dismissed = input.dismissed === undefined ? [] : strings(input.dismissed, 100, 400);
  if (generatedAt === undefined || profile === undefined || dismissed === undefined) return undefined;

  const seenIds = new Set<string>();
  const seenIdentities = new Set<string>();
  let generated = 0;
  const books: RelatedBook[] = [];
  for (const candidate of input.books) {
    const book = parseBook(candidate);
    if (book === undefined || seenIds.has(book.id) || seenIdentities.has(bookIdentity(book))) continue;
    if (book.origin === 'generated' && generated === 10) continue;
    seenIds.add(book.id);
    seenIdentities.add(bookIdentity(book));
    if (book.origin === 'generated') generated += 1;
    books.push(book);
  }

  return { version: 1, bookId: input.bookId, generatedAt, profile, books, dismissed: [...new Set(dismissed)] };
}

/** Retains reader-owned candidates, roles and dismissals while replacing generated proposals. */
export function mergeUniverse(previous: BookUniverse, generated: BookUniverse): BookUniverse {
  const dismissed = [...new Set([...previous.dismissed, ...generated.dismissed])];
  const manual = previous.books.filter((book) => book.origin === 'manual');
  const manualIdentities = new Set(manual.map(bookIdentity));
  const previousGenerated = new Map(
    previous.books.filter((book) => book.origin === 'generated').map((book) => [bookIdentity(book), book]),
  );
  const books = [...manual];
  const ids = new Set(books.map((book) => book.id));

  for (const book of generated.books) {
    if (book.origin !== 'generated') continue;
    const identity = bookIdentity(book);
    if (dismissed.includes(identity) || manualIdentities.has(identity) || ids.has(book.id)) continue;
    const existing = previousGenerated.get(identity);
    const merged = existing?.roleEdited
      ? { ...book, id: existing.id, role: existing.role, roleEdited: true }
      : book;
    if (ids.has(merged.id)) continue;
    ids.add(merged.id);
    books.push(merged);
  }

  return { ...generated, books, dismissed };
}
