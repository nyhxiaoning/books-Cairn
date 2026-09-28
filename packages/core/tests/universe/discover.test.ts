import { expect, test } from 'bun:test';
import { discoverRelations, type PublicEvidencePage } from '../../src/universe/discover';
import type { LlmProvider, LlmRequest } from '../../src/llm/types';
import type { BookProfile } from '../../src/universe/profile';

const profile: BookProfile = {
  title: 'Thinking With Maps', author: 'Ada Reader', category: 'Decision making', topics: ['Systems thinking'],
};

const pages: readonly PublicEvidencePage[] = [
  { title: 'Publisher: Supported Book', url: 'https://example.com/supported', text: 'Public publisher description.' },
  { title: 'Library: Another Book', url: 'https://example.com/another', text: 'Public library catalogue entry.' },
];

const candidate = (index: number, patch: Record<string, unknown> = {}) => ({
  title: `Book ${index}`,
  authors: ['A. Writer'],
  isbn: `9780306406${String(index).padStart(3, '0')}`,
  role: 'support',
  sharedTopics: ['Systems thinking'],
  rationale: 'Its public description supports the same decision-making question.',
  sourceUrls: ['https://example.com/supported'],
  ...patch,
});

function fakeProvider(reply: unknown, inspect?: (request: LlmRequest) => void): LlmProvider {
  return {
    name: 'fake', suggestedConcurrency: 1, overheadTokens: 0,
    async complete(request) {
      inspect?.(request);
      return JSON.stringify(reply);
    },
  };
}

test('keeps only supported, source-backed, distinct candidates', async () => {
  const result = await discoverRelations(profile, pages, fakeProvider({
    books: [
      candidate(0),
      candidate(1, { title: 'Same book, duplicate identity', isbn: '978-0-306-40600-0' }),
      candidate(2, { title: 'Book 1', isbn: '978-0-306-40600-1' }),
      candidate(3, { role: 'invented' }),
      candidate(4, { sourceUrls: ['https://example.com/not-supplied'] }),
      ...Array.from({ length: 7 }, (_, index) => candidate(index + 5)),
    ],
  }, (request) => {
    expect(request.label).toBe('universe');
    expect(request.schema).toMatchObject({
      type: 'object', additionalProperties: false, required: ['books'],
      properties: {
        books: {
          items: {
            required: ['title', 'authors', 'isbn', 'role', 'sharedTopics', 'rationale', 'sourceUrls'],
          },
        },
      },
    });
    expect(request.prompt).toContain('Thinking With Maps');
    expect(request.prompt).toContain('https://example.com/supported');
    expect(request.prompt).toContain('Public publisher description.');
  }));

  expect(result).toHaveLength(9);
  expect(result.map((book) => book.title)).toEqual([
    'Book 0', 'Book 1', 'Book 5', 'Book 6', 'Book 7',
    'Book 8', 'Book 9', 'Book 10', 'Book 11',
  ]);
  expect(result.every((book) => book.role === 'support')).toBe(true);
  expect(result.every((book) => book.sources.every((source) => pages.some((page) => page.url === source.url)))).toBe(true);
  expect(result.every((book) => book.evidence === 'sourced' && book.origin === 'generated')).toBe(true);
});

test('returns an honest smaller result instead of padding candidates', async () => {
  const result = await discoverRelations(profile, pages, fakeProvider({ books: [candidate(1)] }));
  expect(result).toHaveLength(1);
});

test('caps twelve otherwise-valid proposals at ten', async () => {
  const result = await discoverRelations(profile, pages, fakeProvider({
    books: Array.from({ length: 12 }, (_, index) => candidate(index)),
  }));
  expect(result).toHaveLength(10);
});
