import { describe, expect, test } from 'bun:test';
import { alignSentences, assembleDeck, estimateNarration, parseSrt } from '../../src/pipeline/tts';
import type { DraftDeck } from '../../src/types';

const SRT = `1
00:00:00,100 --> 00:00:05,937
锚定效应是指人们过度依赖最先接触到的信息。

2
00:00:05,887 --> 00:00:09,237
受试者先转一个做过手脚的轮盘。

3
00:00:09,237 --> 00:00:12,525
停在十的人平均猜二十五。
`;

describe('parseSrt', () => {
  test('解析出全部字幕与毫秒时间', () => {
    const cues = parseSrt(SRT);
    expect(cues).toHaveLength(3);
    expect(cues[0]!.startMs).toBe(100);
    expect(cues[2]!.endMs).toBe(12_525);
  });

  test('修正重叠——第一条结束时间晚于第二条开始', () => {
    const cues = parseSrt(SRT);
    expect(cues[0]!.endMs).toBe(cues[1]!.startMs);
  });

  test('空串返回空数组', () => expect(parseSrt('')).toHaveLength(0));

  test('缺时间行的块被跳过', () => {
    expect(parseSrt('1\n没有时间行\n\n2\n00:00:01,000 --> 00:00:02,000\n有的')).toHaveLength(1);
  });
});

describe('alignSentences', () => {
  const cues = parseSrt(SRT);

  test('句子切分与字幕一致时逐条对上', () => {
    const out = alignSentences(
      ['锚定效应是指人们过度依赖最先接触到的信息。', '受试者先转一个做过手脚的轮盘。', '停在十的人平均猜二十五。'],
      cues);
    expect(out.map((c) => c.startMs)).toEqual([100, 5887, 9237]);
  });

  test('我们切得比字幕细时，仍按字符位置落到正确的字幕', () => {
    // edge-tts 按句号切，我们额外切了逗号——两句都该落在第一条字幕内
    const out = alignSentences(
      ['锚定效应是指人们', '过度依赖最先接触到的信息。', '受试者先转一个做过手脚的轮盘。', '停在十的人平均猜二十五。'],
      cues);
    expect(out[0]!.startMs).toBe(100);
    expect(out[1]!.startMs).toBe(100);
    expect(out[2]!.startMs).toBe(5887);
  });

  test('时间轴单调不回退', () => {
    const out = alignSentences(['甲。', '乙。', '丙。', '丁。'], cues);
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i]!.startMs).toBeGreaterThanOrEqual(out[i - 1]!.startMs);
    }
  });

  test('句子多于字幕时全部有时间，不留空', () => {
    const out = alignSentences(Array.from({ length: 10 }, (_, i) => `第${i}句。`), cues);
    expect(out).toHaveLength(10);
    expect(out.every((c) => c.startMs >= 0 && c.endMs > 0)).toBe(true);
  });
});

describe('语速常数', () => {
  test('目标字数随时长线性增长', async () => {
    const { targetChars } = await import('../../src/pipeline/tts');
    expect(targetChars(4)).toBeGreaterThan(targetChars(2));
    expect(targetChars(4) / targetChars(2)).toBeCloseTo(2, 1);
  });

  test('4 分钟约 1176 字 —— 实测 4.9 字/秒', async () => {
    const { targetChars } = await import('../../src/pipeline/tts');
    expect(targetChars(4)).toBeGreaterThan(1050);
    expect(targetChars(4)).toBeLessThan(1300);
  });

  test('反向估算与目标字数自洽', async () => {
    const { targetChars, estimateMs } = await import('../../src/pipeline/tts');
    const ms = estimateMs('甲'.repeat(targetChars(3)));
    expect(ms / 1000 / 60).toBeCloseTo(3, 1);
  });
});

describe('assembleDeck', () => {
  const draft: DraftDeck = {
    nodeId: 'n0',
    sentences: ['锚定效应是指人们过度依赖最先接触到的信息。', '受试者先转一个做过手脚的轮盘。'],
    slides: [
      { slide: { layout: 'title', title: '锚定' }, atSentence: 0 },
      { slide: { layout: 'points', heading: '要点', points: ['先入为主'] }, atSentence: 1 },
    ],
  };

  test('把幻灯钉在它那句话的起点上', () => {
    const deck = assembleDeck(draft, parseSrt(SRT), '/tmp/n0.mp3');
    expect(deck.slides[0]!.atMs).toBe(deck.narration[0]!.startMs);
    expect(deck.slides[1]!.atMs).toBe(deck.narration[1]!.startMs);
    expect(deck.slides[1]!.atMs).toBeGreaterThan(deck.slides[0]!.atMs);
  });

  test('时长取最后一句的结尾', () => {
    const deck = assembleDeck(draft, parseSrt(SRT), '/tmp/n0.mp3');
    expect(deck.durationMs).toBe(deck.narration[deck.narration.length - 1]!.endMs);
  });

  test('atSentence 越界时夹到最后一句，而不是崩掉', () => {
    const deck = assembleDeck(
      { ...draft, slides: [{ slide: { layout: 'title', title: 'x' }, atSentence: 99 }] },
      parseSrt(SRT), '/tmp/n0.mp3',
    );
    expect(deck.slides[0]!.atMs).toBeGreaterThanOrEqual(0);
  });

  test('没有字幕就报错，而不是产出一个没有时间轴的 deck', () => {
    expect(() => assembleDeck(draft, [], '/tmp/n0.mp3')).toThrow();
  });
});

describe('estimateNarration', () => {
  test('中文按实测字速生成无音频时间轴，并给幻灯片定时', () => {
    const deck = estimateNarration({
      nodeId: 'n0',
      sentences: ['你好。', '再见。'],
      slides: [
        { slide: { layout: 'title', title: '问候' }, atSentence: 0 },
        { slide: { layout: 'points', heading: '结束', points: ['再见'] }, atSentence: 1 },
      ],
    }, 'zh');

    expect(deck.audioPath).toBeUndefined();
    expect(deck.narration.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 612], [612, 1224],
    ]);
    expect(deck.slides.map((slide) => slide.atMs)).toEqual([0, 612]);
    expect(deck.durationMs).toBe(1224);
  });

  test('英文按实测词速生成确定性时间轴', () => {
    const deck = estimateNarration({
      nodeId: 'n1',
      sentences: ['Read two words.', 'Then read.'],
      slides: [],
    }, 'en');

    expect(deck.audioPath).toBeUndefined();
    expect(deck.narration.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([
      [0, 1034], [1034, 1724],
    ]);
    expect(deck.durationMs).toBe(1724);
  });
});
