import { describe, expect, test } from 'bun:test';
import {
  audioFile, bookDir, bookFile, bookSlug, deckFile, deckIndexFile, isBookId, normalizeEntry,
} from '../../src/store/library';

describe('library paths', () => {
  test('每本书一个目录，互不覆盖', () => {
    expect(bookDir('a')).not.toBe(bookDir('b'));
  });
  test('书内文件都在自己目录下', () => {
    expect(bookFile('pro-git', 'path.json')).toBe('books/pro-git/path.json');
    expect(audioFile('pro-git', 'n0')).toBe('books/pro-git/audio/n0.mp3');
  });
});

describe('bookSlug', () => {
  // Distinct hashes per input, as a real hash would give
  const hash = (s: string): string => `${[...s].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)}`;

  test('书名进入 slug，便于辨认', () => {
    expect(bookSlug('Pro Git', hash, '/a.epub')).toMatch(/^pro-git-/);
  });
  test('大小写与标点归一', () => {
    expect(bookSlug('Pro  Git!!', hash, '/a.epub')).toBe(bookSlug('Pro Git', hash, '/a.epub'));
  });
  test('同名但不同文件不会互相覆盖 —— 译本与原著可以共存', () => {
    expect(bookSlug('Pro Git', hash, '/zh.epub')).not.toBe(bookSlug('Pro Git', hash, '/en.epub'));
  });
  test('同一文件重新生成落在同一个 id', () => {
    expect(bookSlug('Pro Git', hash, '/a.epub')).toBe(bookSlug('Pro Git', hash, '/a.epub'));
  });
  test('中文书名仍然产出 ASCII 目录名', () => {
    const s = bookSlug('思考，快与慢', hash, '/a.epub');
    expect(s).toMatch(/^book-/);
    expect(s).toMatch(/^[\x20-\x7e]+$/);
  });
  test('过长书名被截断', () => {
    expect(bookSlug('a'.repeat(200), hash, '/a.epub').length).toBeLessThanOrEqual(40);
  });
});

describe('deck 文件布局', () => {
  test('每站一个 deck 文件——一站建好就能单独落盘', () => {
    expect(deckFile('pro-git', 'n3')).toBe('books/pro-git/decks/n3.json');
  });
  test('就绪清单和 deck 放在一起', () => {
    expect(deckIndexFile('pro-git')).toBe('books/pro-git/decks/index.json');
  });
});

describe('normalizeEntry', () => {
  test('老库里没有的字段按“已完成”补齐，而不是显示成没建', () => {
    const old = {
      id: 'a', title: 'A', stations: 12, minutes: 40,
      budgetId: 'solid', generatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(normalizeEntry(old)).toMatchObject({ complete: true, built: 12 });
  });

  test('新库的字段原样保留', () => {
    const fresh = {
      id: 'a', title: 'A', stations: 12, minutes: 40,
      budgetId: 'solid', generatedAt: '2026-01-01T00:00:00.000Z',
      complete: false, built: 3,
    };
    expect(normalizeEntry(fresh)).toMatchObject({ complete: false, built: 3 });
  });

  test('preserves the local sync timestamp', () => {
    const entry = normalizeEntry({
      id: 'a', title: 'A', stations: 12, minutes: 40,
      budgetId: 'solid', generatedAt: '2026-01-01T00:00:00.000Z',
      lastSyncedAt: '2026-11-26T00:00:00.000Z',
    });
    expect(entry.lastSyncedAt).toBe('2026-11-26T00:00:00.000Z');
  });
});

describe('isBookId', () => {
  const hash = (s: string): string => `${s.length}a1b2c3`.slice(0, 6);

  test('accepts what bookSlug produces', () => {
    expect(isBookId(bookSlug('Atomic Habits', hash, '/books/ah.epub'))).toBe(true);
    expect(isBookId(bookSlug('原子习惯', hash, '/books/zh.epub'))).toBe(true);
  });

  /** A delete joins this onto the library root, so traversal must never parse. */
  test('rejects anything that could leave the library directory', () => {
    expect(isBookId('..')).toBe(false);
    expect(isBookId('../..')).toBe(false);
    expect(isBookId('a/../..')).toBe(false);
    expect(isBookId('books/a')).toBe(false);
    expect(isBookId('.hidden')).toBe(false);
    expect(isBookId('')).toBe(false);
    expect(isBookId('-leading-dash')).toBe(false);
    expect(isBookId('a'.repeat(65))).toBe(false);
  });
});
