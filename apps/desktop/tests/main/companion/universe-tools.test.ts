import { expect, test } from 'bun:test';
import type { Chapter, ChapterNote } from '@cairn/core/types';
import { consultUniverse, readUniverseChapters } from '../../../src/main/companion/universe-tools';

const notes: readonly ChapterNote[] = [
  { idx: 1, title: 'Anchoring', gist: 'Initial numbers shape judgement', keyPoints: ['anchors persist'], quotes: [] },
  { idx: 2, title: 'Framing', gist: 'Presentation changes choice', keyPoints: [], quotes: [] },
];

const chapter: Chapter = { idx: 1, title: 'Anchoring', text: 'An anchor is the first number you hear.', wordCount: 8 };

const experts = [
  { bookId: 'expert-a', bookTitle: 'Judgment' },
  { bookId: 'expert-b', bookTitle: 'Noise' },
];

test('retrieval searches only experts, ranks notes and emits expert refs', async () => {
  const result = await consultUniverse('anchors shape judgement', 'seed-book', {
    experts: async () => experts,
    loadNotes: async (bookId) => (bookId === 'expert-a' ? notes : []),
  });

  expect(result.evidence.source).toBe('expert');
  expect(result.evidence.refs).toEqual([
    { bookId: 'expert-a', bookTitle: 'Judgment', chapter: 1, title: 'Anchoring' },
  ]);
  expect(result.text).toContain('source="expert"');
  expect(result.text).toContain('Anchoring');
});

test('at most four books and eight excerpts are returned', async () => {
  const many = Array.from({ length: 6 }, (_, index) => ({
    bookId: `expert-${index}`, bookTitle: `Book ${index}`,
  }));
  const manyNotes: readonly ChapterNote[] = Array.from({ length: 4 }, (_, index) => ({
    idx: index + 1, title: `Anchors ${index}`, gist: 'anchors', keyPoints: [], quotes: [],
  }));
  const result = await consultUniverse('anchors', 'seed-book', {
    experts: async () => many,
    loadNotes: async () => manyNotes,
  });

  expect(new Set(result.evidence.refs.map((ref) => ref.bookId)).size).toBeLessThanOrEqual(4);
  expect(result.evidence.refs.length).toBeLessThanOrEqual(8);
});

test('chapter reads accept only allowlisted experts', async () => {
  const deps = {
    allowedBookIds: async () => ['expert-a'],
    loadChapter: async () => chapter,
  };
  await expect(readUniverseChapters('expert-a', [1], 'seed-book', deps)).resolves.toMatchObject({
    evidence: { source: 'expert', refs: [{ bookId: 'expert-a', chapter: 1 }] },
  });
  await expect(readUniverseChapters('expert-b', [1], 'seed-book', deps)).rejects.toThrow();
  await expect(readUniverseChapters('seed-book', [1], 'seed-book', deps)).rejects.toThrow();
});

test('empty queries and missing chapters are refused', async () => {
  await expect(consultUniverse('   ', 'seed-book', {
    experts: async () => experts,
    loadNotes: async () => [],
  })).rejects.toThrow();
  await expect(readUniverseChapters('expert-a', [9], 'seed-book', {
    allowedBookIds: async () => ['expert-a'],
    loadChapter: async () => undefined,
  })).rejects.toThrow();
});
