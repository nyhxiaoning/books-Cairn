import { expect, test } from 'bun:test';
import { slidesDocument } from '../../src/export/slides-html';

const stations = [
  { id: 'n0', title: 'Start <here>', durationMs: 61_000, slideMarkup: ['<div class="slide">A</div>'], narrationText: 'First words.' },
  { id: 'n1', title: 'End', durationMs: 59_000, slideMarkup: ['<div class="slide">B</div>', '<div class="slide">C</div>'], narrationText: 'Last words.' },
];

const base = { title: 'Thinking', author: 'A. Writer', exportDate: '2026-09-28', styleCss: '.s{}' };

test('assembles a cover, one section per station and print css', () => {
  const html = slidesDocument({ ...base, stations });
  if (!html) throw new Error('expected a document');
  expect(html).toContain('Thinking');
  expect(html).toContain('A. Writer');
  expect(html).toContain('2026-09-28');
  expect(html.match(/<section class="station"/g)).toHaveLength(2);
  expect(html).toContain('@media print');
  expect(html).toContain('<details>');
  expect(html).toContain('First words.');
});

test('escapes metadata but keeps slide markup verbatim', () => {
  const html = slidesDocument({ ...base, stations });
  if (!html) throw new Error('expected a document');
  expect(html).toContain('Start &lt;here&gt;');
  expect(html).toContain('<div class="slide">A</div>');
});

test('refuses an empty book', () => {
  expect(slidesDocument({ ...base, stations: [] })).toBeUndefined();
});
