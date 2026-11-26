/**
 * Build stage: one station, into a playable deck — slides, then narration.
 *
 * Driven station by station by `scheduler.ts` through `books/builder.ts`, in
 * the order the reader walks. What a deck is, and where its audio lands, is
 * decided here once; `deckKey` is what makes a built deck reusable.
 */
import type { LlmProvider } from '../llm/types';
import type { ChapterNote, NodeDeck, Path, PathNode, SourceKind } from '../types';
import { fingerprint } from './fingerprint';
import type { ContentLocale } from '../parse/language';
import { isRecap, makeRecapDeck } from './recap';
import { makeDeck } from './slides';
import {
  DEFAULT_VOICE, deckAudioPath, estimateNarration, type Narrator, type TtsOptions,
} from './tts';
import { CairnError } from '../errors';

/**
 * The cache key for one station's deck, and the name of its audio file.
 *
 * Derived from what the deck is made of, never from the station's position.
 * `reduce` re-runs on every generation and the model is not deterministic, so
 * `n0` routinely means a different station than it did last time — and the audio
 * directory is shared by every budget, so a positional name let one budget's
 * synthesis overwrite another's. Both failures land the same way: the right
 * subtitles playing over the wrong voice track.
 *
 * The station id stays as a prefix for legibility when reading the cache dir;
 * only the fingerprint decides reuse.
 */
export function deckKey(node: PathNode, voice?: string, generateAudio = true): string {
  return `${node.id}-${fingerprint({
    title: node.title,
    kind: node.kind,
    brief: node.brief,
    keyPoints: node.keyPoints,
    sourceChapters: node.sourceChapters,
    estMinutes: node.estMinutes,
    voice: voice ?? DEFAULT_VOICE,
    generateAudio,
  })}`;
}

/** What synthesis needs, plus the language the content itself is written in. */
export interface NodeBuildOptions extends TtsOptions {
  readonly locale?: ContentLocale;
  readonly kind?: SourceKind;
  readonly generateAudio?: boolean;
}

export async function buildNode(
  node: PathNode,
  path: Path,
  byChapter: ReadonlyMap<number, ChapterNote>,
  audioDir: string,
  provider: LlmProvider,
  narrator: Narrator,
  options: NodeBuildOptions = {},
): Promise<NodeDeck> {
  const locale = options.locale ?? 'zh';
  const draft = isRecap(node)
    // The closing station recaps the path, so its material is the other
    // stations, not the book. Sending it the chapters its sourceChapters point
    // at would be the whole book in one prompt.
    ? await makeRecapDeck(
      node, path.nodes.filter((n) => !isRecap(n)), path.title, provider, options.signal, locale, options.kind,
    )
    : await makeDeck(node, chapterNotes(node, byChapter), provider, options.signal, locale, options.kind);

  if (options.generateAudio === false) return estimateNarration(draft, locale);
  const key = deckKey(node, options.voice, true);
  return narrator.speak(draft, deckAudioPath(audioDir, key), options);
}

function chapterNotes(
  node: PathNode,
  byChapter: ReadonlyMap<number, ChapterNote>,
): readonly ChapterNote[] {
  const notes = node.sourceChapters
    .map((idx) => byChapter.get(idx))
    .filter((n): n is ChapterNote => n !== undefined);

  if (notes.length === 0) {
    throw new CairnError('missing_source_chapter', { n: node.idx + 1, title: node.title });
  }
  return notes;
}

export function notesByChapter(
  notes: readonly ChapterNote[],
): ReadonlyMap<number, ChapterNote> {
  return new Map(notes.map((n) => [n.idx, n]));
}

export function realMinutes(decks: readonly NodeDeck[]): number {
  return Math.round(decks.reduce((sum, d) => sum + d.durationMs, 0) / 60_000);
}

/**
 * A quote slide with no `source` means the model's "verbatim" line was not found
 * in any note it was given. That is the one hallucination this pipeline cannot
 * catch structurally, so it is counted rather than hidden.
 */
export function countUnsourcedQuotes(decks: readonly NodeDeck[]): number {
  let count = 0;
  for (const deck of decks) {
    for (const slide of deck.slides) {
      if (slide.layout === 'quote' && slide.source === undefined) count += 1;
    }
  }
  return count;
}
