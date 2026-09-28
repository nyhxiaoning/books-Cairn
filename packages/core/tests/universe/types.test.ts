import { expect, test } from 'bun:test';
import { mergeUniverse, parseUniverse, type BookUniverse, type RelatedBook } from '../../src/universe/types';

const sourced = (id: string, title = id): RelatedBook => ({
  id,
  title,
  authors: ['A. Writer'],
  role: 'support',
  sharedTopics: ['reasoning'],
  rationale: 'Explains a useful complementary perspective.',
  sources: [{ title: 'Publisher page', url: `https://example.com/${id}` }],
  evidence: 'sourced',
  origin: 'generated',
});

const universeWith = (count: number): BookUniverse => ({
  version: 1,
  bookId: 'seed-book',
  generatedAt: '2026-09-28T00:00:00.000Z',
  profile: { category: 'Philosophy', topics: ['reasoning'] },
  books: Array.from({ length: count }, (_, index) => sourced(`book-${index}`)),
  dismissed: [],
});

const previousUniverse = (): BookUniverse => ({
  ...universeWith(0),
  books: [
    { ...sourced('manual'), origin: 'manual', sources: [], evidence: 'candidate' },
    { ...sourced('edited', 'Edited'), role: 'oppose', roleEdited: true },
  ],
  dismissed: ['title:dismissed\u0000awriter'],
});

const generatedUniverse = (): BookUniverse => ({
  ...universeWith(0),
  books: [
    sourced('edited', 'Edited'),
    sourced('dismissed', 'Dismissed'),
  ],
});

test('refresh preserves manual books, edited roles and dismissed identities', () => {
  const merged = mergeUniverse(previousUniverse(), generatedUniverse());
  expect(merged.books.find((book) => book.origin === 'manual')).toBeDefined();
  expect(merged.books.find((book) => book.id === 'edited')?.role).toBe('oppose');
  expect(merged.books.some((book) => book.id === 'dismissed')).toBe(false);
});

test('a universe with three sourced candidates remains valid', () => {
  expect(parseUniverse(universeWith(3))).toBeDefined();
});

test('parsing discards invalid candidates but rejects an invalid root', () => {
  const parsed = parseUniverse({
    ...universeWith(1),
    books: [...universeWith(1).books, { ...sourced('broken'), role: 'unknown' }],
  });
  expect(parsed?.books).toHaveLength(1);
  expect(parseUniverse({ ...universeWith(1), version: 2 })).toBeUndefined();
});

test('parsing keeps no more than ten generated candidates and rejects duplicate identities', () => {
  const many = universeWith(11);
  expect(parseUniverse(many)?.books).toHaveLength(10);
  expect(parseUniverse({ ...universeWith(2), books: [sourced('one', 'Same'), sourced('two', 'Same')] })?.books)
    .toHaveLength(1);
});

test('source URLs must be HTTP(S)', () => {
  expect(parseUniverse({
    ...universeWith(1),
    books: [{ ...sourced('bad-url'), sources: [{ title: 'Bad', url: 'file:///private/book' }] }],
  })?.books).toHaveLength(0);
});
