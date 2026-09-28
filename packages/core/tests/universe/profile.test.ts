import { expect, test } from 'bun:test';
import { deriveBookProfile } from '../../src/universe/profile';
import type { CatalogRecord } from '../../src/catalog/types';
import type { LibraryEntry } from '../../src/store/library';
import type { ChapterNote } from '../../src/types';

const entry: LibraryEntry = {
  id: 'private-book', title: 'Thinking With Maps', author: 'Ada Reader', stations: 8, minutes: 24,
  budgetId: 'read', generatedAt: '2026-09-28T00:00:00.000Z',
};

const catalog: CatalogRecord = {
  bookId: entry.id, category: 'Decision making', tags: ['Systems thinking', 'Long tag '.repeat(20)],
  categorySource: 'manual', tagsSource: 'manual', updatedAt: entry.generatedAt,
};

const noteWith = (secret: string): ChapterNote => ({
  idx: 1, title: 'Maps and choices', gist: `This gist contains ${secret}.`,
  keyPoints: [`A key point contains ${secret}.`], quotes: [`A quotation contains ${secret}.`],
});

test('derives bounded public topics without serializing private note prose', () => {
  const profile = deriveBookProfile(entry, catalog, [noteWith('PRIVATE SENTENCE')]);

  expect(profile).toMatchObject({ title: entry.title, author: entry.author, category: 'Decision making' });
  expect(profile.topics.length).toBeLessThanOrEqual(8);
  expect(profile.topics.every((topic) => topic.length <= 60)).toBe(true);
  expect(JSON.stringify(profile)).not.toContain('PRIVATE SENTENCE');
  expect(JSON.stringify(profile)).not.toContain('This gist contains');
  expect(JSON.stringify(profile)).not.toContain('A key point contains');
  expect(JSON.stringify(profile)).not.toContain('A quotation contains');
});
