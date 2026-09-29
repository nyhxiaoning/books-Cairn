import { LlmError, type LlmProvider, parseJsonOutput } from '../llm/types';
import { bookIdentity, normalizeIsbn } from './identity';
import type { BookProfile } from './profile';
import type { RelatedBook, UniverseRole, UniverseSource } from './types';

export interface PublicEvidencePage {
  readonly title: string;
  readonly url: string;
  readonly text: string;
}

const ROLES: readonly UniverseRole[] = ['foundation', 'support', 'oppose', 'verify', 'apply', 'extend'];
const MAX_PAGES = 12;
const MAX_PAGE_TITLE = 240;
const MAX_PAGE_URL = 2_048;
const MAX_PAGE_TEXT = 4_000;
const MAX_CANDIDATES = 10;
const MAX_TITLE = 240;
const MAX_AUTHORS = 8;
const MAX_AUTHOR = 120;
const MAX_TOPICS = 8;
const MAX_TOPIC = 60;
const MAX_RATIONALE = 1_000;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['books'],
  properties: {
    books: {
      type: 'array', maxItems: 20,
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'authors', 'isbn', 'role', 'sharedTopics', 'rationale', 'sourceUrls'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: MAX_TITLE },
          authors: {
            type: 'array', maxItems: MAX_AUTHORS,
            items: { type: 'string', minLength: 1, maxLength: MAX_AUTHOR },
          },
          isbn: { type: ['string', 'null'], maxLength: 32 },
          role: { type: 'string', enum: ROLES as unknown as string[] },
          sharedTopics: {
            type: 'array', minItems: 1, maxItems: MAX_TOPICS,
            items: { type: 'string', minLength: 1, maxLength: MAX_TOPIC },
          },
          rationale: { type: 'string', minLength: 1, maxLength: MAX_RATIONALE },
          sourceUrls: {
            type: 'array', minItems: 1, maxItems: MAX_PAGES,
            items: { type: 'string', minLength: 1, maxLength: MAX_PAGE_URL },
          },
        },
      },
    },
  },
} as const;

interface RawBook {
  readonly title?: unknown;
  readonly authors?: unknown;
  readonly isbn?: unknown;
  readonly role?: unknown;
  readonly sharedTopics?: unknown;
  readonly rationale?: unknown;
  readonly sourceUrls?: unknown;
}

interface RawResponse {
  readonly books?: unknown;
}

const string = (value: unknown, maximum: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 && normalized.length <= maximum ? normalized : undefined;
};

const strings = (value: unknown, maximumItems: number, maximumLength: number): readonly string[] | undefined => {
  if (!Array.isArray(value) || value.length > maximumItems) return undefined;
  const normalized = value.map((item) => string(item, maximumLength));
  return normalized.every((item): item is string => item !== undefined) ? normalized : undefined;
};

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const cleanPage = (page: PublicEvidencePage): PublicEvidencePage | undefined => {
  const title = string(page.title, MAX_PAGE_TITLE);
  const url = string(page.url, MAX_PAGE_URL);
  const text = string(page.text, MAX_PAGE_TEXT);
  return title === undefined || url === undefined || text === undefined || !isHttpUrl(url)
    ? undefined
    : { title, url, text };
};

const sourceMap = (pages: readonly PublicEvidencePage[]): ReadonlyMap<string, UniverseSource> => {
  const sources = new Map<string, UniverseSource>();
  for (const page of pages) {
    if (!sources.has(page.url)) sources.set(page.url, { title: page.title, url: page.url });
  }
  return sources;
};

const generatedId = (identity: string): string => {
  let left = 2_166_136_261;
  let right = 5_381;
  for (let index = 0; index < identity.length; index += 1) {
    const code = identity.charCodeAt(index);
    left = Math.imul(left ^ code, 16_777_619);
    right = Math.imul(right, 33) ^ code;
  }
  return `generated:${(left >>> 0).toString(16)}${(right >>> 0).toString(16)}`;
};

const isRole = (value: unknown): value is UniverseRole =>
  typeof value === 'string' && ROLES.includes(value as UniverseRole);

const normalizeBook = (
  raw: unknown,
  sourcesByUrl: ReadonlyMap<string, UniverseSource>,
): RelatedBook | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const candidate = raw as RawBook;
  const title = string(candidate.title, MAX_TITLE);
  const authors = strings(candidate.authors, MAX_AUTHORS, MAX_AUTHOR);
  const role = isRole(candidate.role) ? candidate.role : undefined;
  const sharedTopics = strings(candidate.sharedTopics, MAX_TOPICS, MAX_TOPIC);
  const rationale = string(candidate.rationale, MAX_RATIONALE);
  const sourceUrls = strings(candidate.sourceUrls, MAX_PAGES, MAX_PAGE_URL);
  const rawIsbn = candidate.isbn;
  const isbn = rawIsbn === null ? undefined : typeof rawIsbn === 'string' ? normalizeIsbn(rawIsbn) : undefined;
  if (title === undefined || authors === undefined || role === undefined || sharedTopics === undefined ||
    sharedTopics.length === 0 || rationale === undefined || sourceUrls === undefined || sourceUrls.length === 0 ||
    (rawIsbn !== null && isbn === undefined)) return undefined;

  const sources: UniverseSource[] = [];
  for (const url of sourceUrls) {
    const source = sourcesByUrl.get(url);
    if (source === undefined) return undefined;
    if (!sources.some((existing) => existing.url === source.url)) sources.push(source);
  }

  const identity = bookIdentity({ title, authors, ...(isbn === undefined ? {} : { isbn }) });
  return {
    id: generatedId(identity), title, authors, ...(isbn === undefined ? {} : { isbn }), role, sharedTopics,
    rationale, sources, evidence: 'sourced', origin: 'generated',
  };
};

/**
 * Knowledge-mode candidates carry no web sources: their evidence is the
 * model's own command of published non-fiction, so they enter the universe as
 * plain candidates and the rationale is the reader-visible justification.
 */
const normalizeKnowledgeBook = (raw: unknown): RelatedBook | undefined => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const candidate = raw as RawBook;
  const title = string(candidate.title, MAX_TITLE);
  const authors = strings(candidate.authors, MAX_AUTHORS, MAX_AUTHOR);
  const role = isRole(candidate.role) ? candidate.role : undefined;
  const sharedTopics = strings(candidate.sharedTopics, MAX_TOPICS, MAX_TOPIC);
  const rationale = string(candidate.rationale, MAX_RATIONALE);
  const rawIsbn = candidate.isbn;
  const isbn = rawIsbn === null ? undefined : typeof rawIsbn === 'string' ? normalizeIsbn(rawIsbn) : undefined;
  if (title === undefined || authors === undefined || role === undefined || sharedTopics === undefined ||
    sharedTopics.length === 0 || rationale === undefined ||
    (rawIsbn !== null && isbn === undefined)) return undefined;

  const identity = bookIdentity({ title, authors, ...(isbn === undefined ? {} : { isbn }) });
  return {
    id: generatedId(identity), title, authors, ...(isbn === undefined ? {} : { isbn }), role, sharedTopics,
    rationale, sources: [], evidence: 'candidate', origin: 'generated',
  };
};

const promptFor = (profile: BookProfile, pages: readonly PublicEvidencePage[]): string =>
  JSON.stringify({ profile, evidencePages: pages });

const SYSTEM_EVIDENCE = 'Identify related books using only the supplied book profile and public evidence pages. Every candidate must cite one or more supplied source URLs. Do not invent sources, metadata, or relationships. Return JSON only.';

const SYSTEM_KNOWLEDGE = 'Identify related books for the supplied book profile from your own knowledge of published non-fiction. Prefer well-known works a reader could actually find. Do not invent ISBNs or publishers. Every candidate must explain, in the rationale, why it holds the stated relationship to the profile book. Return JSON only.';

interface DiscoverySchema {
  readonly required: readonly string[];
}

/** Discovers externally verifiable candidates from public evidence, never local chapter notes. */
export async function discoverRelations(
  profile: BookProfile,
  evidencePages: readonly PublicEvidencePage[] | undefined,
  provider: LlmProvider,
  signal?: AbortSignal,
): Promise<readonly RelatedBook[]> {
  const pages = (evidencePages ?? []).slice(0, MAX_PAGES).map(cleanPage)
    .filter((page): page is PublicEvidencePage => page !== undefined);
  const sourcesByUrl = sourceMap(pages);
  const fromEvidence = pages.length > 0;

  const raw = await provider.complete({
    label: 'universe',
    system: fromEvidence ? SYSTEM_EVIDENCE : SYSTEM_KNOWLEDGE,
    prompt: fromEvidence ? promptFor(profile, pages) : JSON.stringify({ profile }),
    schema: SCHEMA, signal,
  });
  const parsed = parseJsonOutput<RawResponse>(raw);
  if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.books)) {
    throw new LlmError('Universe output is missing its books array', 'bad_output');
  }

  const identities = new Set<string>();
  const ids = new Set<string>();
  const books: RelatedBook[] = [];
  for (const rawBook of parsed.books) {
    const book = fromEvidence
      ? normalizeBook(rawBook, sourcesByUrl)
      : normalizeKnowledgeBook(rawBook);
    if (book === undefined) continue;
    const identity = bookIdentity(book);
    if (identities.has(identity) || ids.has(book.id)) continue;
    identities.add(identity);
    ids.add(book.id);
    books.push(book);
    if (books.length === MAX_CANDIDATES) break;
  }
  return books;
}
