import type { RelatedBook } from './types';

export interface BookIdentityInput {
  readonly title: string;
  readonly author?: string;
  readonly authors?: readonly string[];
  readonly isbn?: string;
}

export interface BookIdentityEntry extends BookIdentityInput {
  readonly id: string;
}

const normalizedText = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

const normalizedAuthors = (value: BookIdentityInput): readonly string[] => {
  const authors = value.authors ?? (value.author === undefined ? [] : [value.author]);
  return [...new Set(authors.map(normalizedText).filter(Boolean))].sort();
};

/** Returns a compact ISBN only when the input is an ISBN-10 or ISBN-13. */
export function normalizeIsbn(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const isbn = value.normalize('NFKC').toUpperCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  return /^\d{9}[\dX]$/.test(isbn) || /^\d{13}$/.test(isbn) ? isbn : undefined;
}

/** ISBN is global; title and author are only a fallback identity. */
export function bookIdentity(value: BookIdentityInput): string {
  const isbn = normalizeIsbn(value.isbn);
  if (isbn !== undefined) return `isbn:${isbn}`;
  return `title:${normalizedText(value.title)}\u0000${normalizedAuthors(value).join('\u0000')}`;
}

const uniqueIds = (entries: readonly BookIdentityEntry[]): readonly string[] =>
  [...new Set(entries.map((entry) => entry.id))];

const matchResult = (entries: readonly BookIdentityEntry[]): {
  readonly linkedBookId?: string;
  readonly ambiguous: readonly string[];
} => {
  const ids = uniqueIds(entries);
  return ids.length === 1 ? { linkedBookId: ids[0], ambiguous: [] } : { ambiguous: ids };
};

/**
 * Matches only identities that are unambiguous enough to link without a reader decision.
 * A title alone is useful as a suggestion, but never enough to pick a shelf book.
 */
export function matchRelatedBook(
  candidate: RelatedBook,
  entries: readonly BookIdentityEntry[],
): { readonly linkedBookId?: string; readonly ambiguous: readonly string[] } {
  const isbn = normalizeIsbn(candidate.isbn);
  if (isbn !== undefined) {
    const isbnMatches = entries.filter((entry) => normalizeIsbn(entry.isbn) === isbn);
    return matchResult(isbnMatches);
  }

  const title = normalizedText(candidate.title);
  if (!title) return { ambiguous: [] };
  const titleMatches = entries.filter((entry) => normalizedText(entry.title) === title);
  const authors = normalizedAuthors(candidate);
  if (authors.length === 0) return { ambiguous: uniqueIds(titleMatches) };

  const authorMatches = titleMatches.filter((entry) => {
    const entryAuthors = normalizedAuthors(entry);
    return entryAuthors.length > 0 && entryAuthors.some((author) => authors.includes(author));
  });
  if (authorMatches.length > 0) return matchResult(authorMatches);

  return { ambiguous: uniqueIds(titleMatches.filter((entry) => normalizedAuthors(entry).length === 0)) };
}
