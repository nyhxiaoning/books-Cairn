import { describe, expect, test } from 'bun:test';
import { buildNode, deckKey } from '../../src/pipeline/build';
import type { LlmProvider } from '../../src/llm/types';
import type { ChapterNote, Path, PathNode } from '../../src/types';
import type { Narrator } from '../../src/pipeline/tts';

const node = (over: Partial<PathNode> = {}): PathNode => ({
  id: 'n0',
  idx: 0,
  title: '微习惯的力量',
  kind: 'concept',
  brief: '说清为什么 1% 的改进会复利',
  keyPoints: ['复利', '体系胜过目标'],
  sourceChapters: [0, 1, 2],
  estMinutes: 3,
  ...over,
});

describe('deckKey', () => {
  test('the same station yields the same key, so a resume reuses its deck', () => {
    expect(deckKey(node())).toBe(deckKey(node()));
  });

  /**
   * The bug this key exists for: `reduce` re-runs on every generation and ids
   * are positional, so `n0` at one budget is a different station than `n0` at
   * another — while both write into one shared audio directory.
   */
  test('a different station at the same position gets a different key', () => {
    const brief = node({ title: '目标与体系', brief: '区分目标和体系', sourceChapters: [3, 4] });
    const solid = node({ title: '身份认同', brief: '从身份出发建立习惯', sourceChapters: [5, 6] });
    expect(deckKey(brief)).not.toBe(deckKey(solid));
  });

  test('every field the narration depends on changes the key', () => {
    const base = deckKey(node());
    expect(deckKey(node({ title: '别的标题' }))).not.toBe(base);
    expect(deckKey(node({ brief: '别的任务' }))).not.toBe(base);
    expect(deckKey(node({ keyPoints: ['别的要点'] }))).not.toBe(base);
    expect(deckKey(node({ sourceChapters: [9] }))).not.toBe(base);
    // estMinutes drives how much narration is written, so it is part of the key
    expect(deckKey(node({ estMinutes: 5 }))).not.toBe(base);
    expect(deckKey(node({ kind: 'argument' }))).not.toBe(base);
  });

  test('a different voice is different audio, so it is a different key', () => {
    expect(deckKey(node(), 'zh-CN-XiaoxiaoNeural')).not.toBe(deckKey(node()));
  });

  test('an omitted voice matches the default explicitly named', () => {
    expect(deckKey(node(), 'zh-CN-YunjianNeural')).toBe(deckKey(node()));
  });

  test('audio mode is part of the cache identity', () => {
    expect(deckKey(node(), undefined, false)).not.toBe(deckKey(node()));
    expect(deckKey(node(), undefined, true)).toBe(deckKey(node()));
  });

  test('position alone does not change what the deck is', () => {
    // idx is display order, not content; it must not invalidate the cache
    expect(deckKey(node({ idx: 7 }))).toBe(deckKey(node()));
  });

  test('keeps the station id readable at the front of the key', () => {
    expect(deckKey(node({ id: 'n12' }))).toMatch(/^n12-[0-9a-f]{16}$/);
  });

  test('the same station at two positions is two keys, never one file', () => {
    // Guards the audio filename: these become n0-….mp3 and n1-….mp3
    expect(deckKey(node({ id: 'n0' }))).not.toBe(deckKey(node({ id: 'n1' })));
  });
});

describe('buildNode', () => {
  test('no-audio builds skip narrator readiness and synthesis', async () => {
    const provider: LlmProvider = {
      name: 'test',
      suggestedConcurrency: 1,
      overheadTokens: 0,
      complete: async () => JSON.stringify({ sentences: ['One sentence.'], slides: [] }),
    };
    const narrator: Narrator = {
      name: 'unavailable',
      ensureReady: async () => { throw new Error('narrator should not be checked'); },
      speak: async () => { throw new Error('narrator should not be called'); },
    };
    const notes: readonly ChapterNote[] = [{ idx: 0, title: 'Chapter', gist: 'g', keyPoints: [], quotes: [] }];
    const path: Path = {
      bookId: 'b1', title: 'Book', type: 'knowledge', nodes: [node()], stages: [],
      totalMinutes: 3, generatedAt: '2026-01-01T00:00:00.000Z',
    };

    const deck = await buildNode(
      node(), path, new Map([[0, notes[0]!]]), '/tmp/cairn-audio', provider, narrator,
      { locale: 'en', generateAudio: false },
    );

    expect(deck.audioPath).toBeUndefined();
    expect(deck.durationMs).toBeGreaterThan(0);
  });
});
