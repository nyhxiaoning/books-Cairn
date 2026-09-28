import { expect, test } from 'bun:test';
import { bookIdentity, matchRelatedBook, normalizeIsbn } from '../../src/universe/identity';
import type { RelatedBook } from '../../src/universe/types';

const candidate = (patch: Partial<RelatedBook> = {}): RelatedBook => ({
  id: 'candidate',
  title: 'The Signal',
  authors: ['Ada Lovelace'],
  role: 'support',
  sharedTopics: ['reasoning'],
  rationale: 'A related book.',
  sources: [],
  evidence: 'candidate',
  origin: 'generated',
  ...patch,
});

test('normalizes ISBN-10 and ISBN-13 punctuation', () => {
  expect(normalizeIsbn('0-306-40615-2')).toBe('0306406152');
  expect(normalizeIsbn('978-0-306-40615-7')).toBe('9780306406157');
});

test('ISBN takes precedence over title and author', () => {
  expect(matchRelatedBook(candidate({ isbn: '978-0-306-40615-7' }), [{
    id: 'local', title: 'Different metadata', author: 'Different author', isbn: '9780306406157',
  }])).toEqual({ linkedBookId: 'local', ambiguous: [] });
});

test('an unmatched ISBN does not link a same-title edition', () => {
  expect(matchRelatedBook(candidate({ isbn: '978-0-306-40615-7' }), [{
    id: 'other-edition', title: 'The Signal', author: 'Ada Lovelace', isbn: '9780306406164',
  }])).toEqual({ ambiguous: [] });
});

test('normalizes NFKC title punctuation and author case', () => {
  expect(bookIdentity(candidate({ title: 'Ｔｈｅ：Ｓｉｇｎａｌ！', authors: ['ADA LOVELACE'] })))
    .toBe(bookIdentity(candidate()));
  expect(matchRelatedBook(candidate(), [{ id: 'local', title: 'The: Signal!', author: 'ada lovelace' }]))
    .toEqual({ linkedBookId: 'local', ambiguous: [] });
});

test('a title match without candidate authors remains uncertain', () => {
  expect(matchRelatedBook(candidate({ authors: [] }), [{
    id: 'local', title: 'The Signal', author: 'Ada Lovelace',
  }])).toEqual({ ambiguous: ['local'] });
});

test('two matching editions remain ambiguous', () => {
  expect(matchRelatedBook(candidate(), [
    { id: 'paperback', title: 'The Signal', author: 'Ada Lovelace' },
    { id: 'hardcover', title: 'The Signal', author: 'Ada Lovelace' },
  ])).toEqual({ ambiguous: ['paperback', 'hardcover'] });
});
