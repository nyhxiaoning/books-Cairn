import { expect, test } from 'bun:test';
import { applyCatalogPatch, emptyCatalog, parseCatalog } from '../../src/catalog/types';

test('missing or malformed catalog data becomes an empty versioned file', () => {
  expect(parseCatalog(undefined)).toEqual({ version: 1, records: {} });
  expect(parseCatalog({ records: [] })).toEqual({ version: 1, records: {} });
});

test('automatic refresh does not replace reader-owned category or tags', () => {
  const manual = applyCatalogPatch(emptyCatalog(), 'book-a', {
    category: 'My category', tags: ['mine'], source: 'manual',
  }, '2026-09-28T00:00:00.000Z');
  const refreshed = applyCatalogPatch(manual, 'book-a', {
    category: 'Psychology', tags: ['bias'], source: 'automatic',
  }, '2026-09-29T00:00:00.000Z');
  expect(refreshed.records['book-a']).toMatchObject({
    category: 'My category', tags: ['mine'],
    categorySource: 'manual', tagsSource: 'manual',
  });
});

test('parsing keeps valid records while discarding malformed neighbors', () => {
  expect(parseCatalog({
    version: 1,
    records: {
      'book-a': {
        bookId: 'book-a', category: '  Cognitive   science  ', tags: ['Bias', ' bias ', ' habit '],
        categorySource: 'automatic', tagsSource: 'automatic', updatedAt: '2026-09-28T00:00:00.000Z',
      },
      '../unsafe': {
        bookId: '../unsafe', tags: [], categorySource: 'automatic', tagsSource: 'automatic', updatedAt: '',
      },
    },
  })).toEqual({
    version: 1,
    records: {
      'book-a': {
        bookId: 'book-a', category: 'Cognitive science', tags: ['Bias', 'habit'],
        categorySource: 'automatic', tagsSource: 'automatic', updatedAt: '2026-09-28T00:00:00.000Z',
      },
    },
  });
});

test('patches normalize metadata without mutating the original file', () => {
  const original = emptyCatalog();
  const updated = applyCatalogPatch(original, 'book-a', {
    category: '  Social   science  ', tags: [' Habit ', 'habit', 'Bias'], source: 'automatic',
  }, '2026-09-28T00:00:00.000Z');

  expect(original).toEqual(emptyCatalog());
  expect(updated.records['book-a']).toMatchObject({
    category: 'Social science', tags: ['Habit', 'Bias'],
  });
});

test('automatic updates can still fill a field the reader has not claimed', () => {
  const categorized = applyCatalogPatch(emptyCatalog(), 'book-a', {
    category: 'My category', source: 'manual',
  }, '2026-09-28T00:00:00.000Z');
  const refreshed = applyCatalogPatch(categorized, 'book-a', {
    tags: ['bias'], source: 'automatic',
  }, '2026-09-29T00:00:00.000Z');

  expect(refreshed.records['book-a']).toMatchObject({
    category: 'My category', categorySource: 'manual', tags: ['bias'], tagsSource: 'automatic',
  });
});

test('unsafe book ids are rejected', () => {
  expect(() => applyCatalogPatch(emptyCatalog(), '../book-a', {
    source: 'manual',
  }, '2026-09-28T00:00:00.000Z')).toThrow();
});
