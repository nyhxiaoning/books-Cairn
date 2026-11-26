/**
 * Which voice a book gets when nobody has chosen one.
 *
 * Its own file, not a corner of `tts.ts`, because the renderer needs these and
 * `tts.ts` imports `node:path` — allowed there (it is path arithmetic) but not
 * something a webview bundle can resolve. Anything the player and the pipeline
 * both need has to be free of `node:*`, and putting it here is how that stays
 * true rather than being rediscovered by a failing build.
 */
import type { ContentLocale } from '../parse/language';

/**
 * Microsoft tunes both of these for audiobooks and commentary. There is one per
 * language because a voice reading a language it was not built for is the
 * failure the whole content-locale split exists to prevent — and it is not a
 * loud failure: edge-tts will happily read English in a Chinese voice.
 */
export const DEFAULT_VOICES: Readonly<Record<ContentLocale, string>> = {
  zh: 'zh-CN-YunjianNeural',
  en: 'en-US-AndrewNeural',
};

export function defaultVoiceFor(locale: ContentLocale): string {
  return DEFAULT_VOICES[locale];
}

/**
 * The Chinese default, kept under its old name because it is what every book
 * built before voices were recorded was built with. See invariant 9.
 */
export const DEFAULT_VOICE = DEFAULT_VOICES.zh;

/**
 * Measured, not guessed. Three samples per language, default rate:
 *   zh-CN-YunjianNeural  4.59 / 4.85 / 5.18 chars/s  (and 4.49 / 4.62 / 4.87 on
 *                        a re-measure, which is why the value sits at the top
 *                        of the range rather than at its mean)
 *   en-US-AndrewNeural  17.19 / 17.16 / 16.56 chars/s
 *
 * Re-measure if the voice or the rate changes — station length derives from
 * these, and an error here is silent: the stations simply come out the wrong
 * length and nothing checks.
 */
export const CHARS_PER_SECOND: Readonly<Record<ContentLocale, number>> = {
  zh: 4.9,
  en: 17.0,
};

/**
 * English narration is commissioned in *words*, not characters.
 *
 * Same three samples: 3.25 / 2.86 / 2.62 words per second. A model counts words
 * far more reliably than it counts characters, and "write about 520 words" lands
 * much closer to the target than "write about 3060 characters" does.
 */
export const WORDS_PER_SECOND = 2.9;

/** How many narration characters fill a station of the given length. */
export function targetChars(minutes: number, locale: ContentLocale = 'zh'): number {
  return Math.round(minutes * 60 * CHARS_PER_SECOND[locale]);
}

/** The same length, in the unit an English prompt should ask for. */
export function targetWords(minutes: number): number {
  return Math.round(minutes * 60 * WORDS_PER_SECOND);
}

/** Predicted duration before synthesis, for progress display. */
export function estimateMs(text: string, locale: ContentLocale = 'zh'): number {
  const amount = locale === 'en'
    ? text.trim().split(/\s+/).filter(Boolean).length
    : text.length;
  const rate = locale === 'en' ? WORDS_PER_SECOND : CHARS_PER_SECOND[locale];
  return Math.round((amount / rate) * 1000);
}
