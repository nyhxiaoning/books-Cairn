/**
 * Failures the reader is told about, named rather than written out.
 *
 * Every user-visible failure crosses at least one boundary before it is shown:
 * core throws, the main process wraps, the RPC bridge serializes, and only then
 * does a React component render it. A sentence cannot survive that trip in two
 * languages — the process that throws does not know what language the reader
 * chose, and should not have to. So a failure carries a `code` and its
 * parameters, and the renderer — the only layer that knows the locale — turns
 * it into words.
 *
 * `ParseError` already worked this way (its doc comment said "callers turn the
 * code into a message"); this generalises it to the rest of the pipeline rather
 * than inventing a second mechanism beside it.
 */
import { LlmError } from './llm/types';
import { ParseError } from './types';

export type ErrorCode =
  // Parsing a file the reader chose
  | 'unsupported_format' | 'empty_file' | 'corrupt_archive' | 'no_content' | 'decode_failed'
  | 'scanned_pdf' | 'unreadable_pdf' | 'drm_protected' | 'mixed_selection'
  // The model
  | 'llm_timeout' | 'llm_aborted' | 'llm_bad_output' | 'llm_failed' | 'no_model'
  // Synthesis
  | 'tts_missing' | 'tts_failed' | 'tts_no_cues' | 'tts_unaligned'
  // The pipeline itself
  | 'map_empty' | 'reduce_empty' | 'no_narration' | 'missing_source_chapter'
  | 'node_failed' | 'generation_stopped' | 'unknown_node' | 'cancelled'
  // The desktop shell
  | 'book_not_listed' | 'delete_failed' | 'main_silent' | 'bundle_failed'
  | 'tavily_key_missing' | 'tavily_failed'
  | 'brave_key_missing' | 'brave_failed' | 'firecrawl_failed'
  | 'weread_failed'
  // The exports folder
  | 'export_failed' | 'ffmpeg_missing' | 'no_audio'
  // Asked of a webview with no main process behind it (`bun run dev`)
  | 'offline_pick' | 'offline_generate' | 'offline_delete'
  | 'offline_chat' | 'offline_settings'
  /** A code this build does not know — an older shell talking to a newer player. */
  | 'unknown';

export type ErrorParams = Readonly<Record<string, string | number>>;

export interface ErrorPayload {
  readonly code: ErrorCode;
  readonly params: ErrorParams;
  /** Untranslated technical tail (a stderr snippet, an exit code) shown verbatim. */
  readonly detail?: string;
}

/**
 * The `message` is for the terminal and the stack trace, never for the reader —
 * it is deliberately not a sentence, so nobody is tempted to render it.
 */
export class CairnError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly params: ErrorParams = {},
    readonly detail?: string,
  ) {
    super(`${code}${Object.keys(params).length ? ` ${JSON.stringify(params)}` : ''}`);
    this.name = 'CairnError';
  }
}

const LLM_CODES: Readonly<Record<LlmError['code'], ErrorCode>> = {
  timeout: 'llm_timeout',
  aborted: 'llm_aborted',
  bad_output: 'llm_bad_output',
  provider_failed: 'llm_failed',
};

/**
 * What to show for any thrown value.
 *
 * `ParseError` and `LlmError` predate this module and already carry codes, so
 * they are mapped rather than rewritten — rewriting them would have meant
 * touching every parser for no gain.
 */
export function payloadOf(cause: unknown): ErrorPayload {
  if (cause instanceof CairnError) {
    return { code: cause.code, params: cause.params, ...(cause.detail ? { detail: cause.detail } : {}) };
  }
  if (cause instanceof ParseError) {
    return { code: cause.code, params: cause.params };
  }
  if (cause instanceof LlmError) {
    return {
      code: LLM_CODES[cause.code],
      params: {},
      ...(cause.detail ? { detail: cause.detail } : {}),
    };
  }
  // Anything else is a bug rather than an expected failure: keep the text, so
  // the reader has something to report even though it will not be translated.
  return {
    code: 'unknown',
    params: {},
    detail: cause instanceof Error ? cause.message : String(cause),
  };
}
