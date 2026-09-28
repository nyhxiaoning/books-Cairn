import { expect, test } from 'bun:test';
import type { Path } from '../../src/types';
import { audioPlan, exportFileName } from '../../src/export/audio-plan';

const path: Path = {
  bookId: 'book-a', title: 'Thinking', type: 'knowledge',
  nodes: [
    { id: 'n0', idx: 0, title: 'Start', kind: 'concept', brief: '', keyPoints: [], sourceChapters: [1], estMinutes: 2 },
    { id: 'n1', idx: 1, title: 'Middle', kind: 'argument', brief: '', keyPoints: [], sourceChapters: [2], estMinutes: 3 },
    { id: 'n2', idx: 2, title: 'End', kind: 'recap', brief: '', keyPoints: [], sourceChapters: [2], estMinutes: 1 },
  ],
  stages: [], totalMinutes: 6, generatedAt: '2026-09-28T00:00:00Z',
};

test('orders stations by path and reports missing ones', () => {
  const plan = audioPlan(path, new Set(['n0', 'n2']), '/lib');
  expect(plan.order).toEqual(['n0', 'n2']);
  expect(plan.missing).toEqual(['n1']);
});

test('list lines are quoted absolute file directives in order', () => {
  const plan = audioPlan(path, new Set(['n0', 'n1', 'n2']), '/lib');
  expect(plan.listText.split('\n')).toEqual([
    "file '/lib/books/book-a/audio/n0.mp3'",
    "file '/lib/books/book-a/audio/n1.mp3'",
    "file '/lib/books/book-a/audio/n2.mp3'",
  ]);
});

test('nothing installed yields an empty plan', () => {
  const plan = audioPlan(path, new Set(), '/lib');
  expect(plan.order).toEqual([]);
  expect(plan.missing).toEqual(['n0', 'n1', 'n2']);
  expect(plan.listText).toBe('');
});

test('export file names carry a sanitized title and the export date', () => {
  // The shelf name is kept readable, including non-ASCII and punctuation;
  // only characters illegal in file names are replaced.
  expect(exportFileName('Thinking, Fast & Slow!', '2026-09-28', 'mp3')).toBe('Thinking, Fast & Slow!-2026-09-28.mp3');
  expect(exportFileName('乡土中国', '2026-09-28', 'html')).toBe('乡土中国-2026-09-28.html');
  expect(exportFileName('a/b:c*d?"e<f>g|h', '2026-09-28', 'mp3')).toBe('a-b-c-d--e-f-g-h-2026-09-28.mp3');
  expect(exportFileName('。。。', '2026-09-28', 'mp3')).toBe('。。。-2026-09-28.mp3');
});
