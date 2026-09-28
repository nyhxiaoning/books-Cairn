import type { RPCSchema } from 'electrobun/view';
import type { BudgetId } from '@cairn/core/pipeline/budget';
import type { CatalogFile, CatalogPatch, CatalogSuggestionResult } from '@cairn/core/catalog/types';
import type { LibraryEntry } from '@cairn/core/store/library';
import type { ChatSession } from '@cairn/core/companion/types';
import type { BookUniverse, UniverseRole } from '@cairn/core/universe/types';
import type { CompanionEvent } from './companion-events';
import type { ContentLocale, ModelStatus, ShellSettingsValues, UiLocale } from './settings';
import type { BookMeta, BookPreview, DeckStatus, Progress } from './types';

/**
 * The bridge contract, shared by both sides so they cannot drift.
 *
 * Generation is a request that can run for minutes, so its progress comes back
 * as a one-way message rather than being folded into the response.
 */
export type BunSchema = RPCSchema<{
  requests: {
    libraryBase: { params: void; response: string };
    progressNow: { params: void; response: Progress | null };
    pickBook: { params: void; response: BookPreview | null };
    generateBook: { params: { filePaths: readonly string[]; budgetId: BudgetId }; response: LibraryEntry };
    chatHistory: { params: { bookId: string }; response: ChatSession };
    chatSend: { params: { turnId: string; bookId: string; nodeId?: string; question: string; locale: UiLocale; selection?: string }; response: boolean };
    chatCancel: { params: { turnId: string }; response: boolean };
    /** `/clear`: forget this path's conversation and the model's working context. */
    chatClear: { params: { bookId: string }; response: boolean };
    /**
     * Tell the builder which station the reader is on, so the next ones built
     * are the next ones they will reach.
     */
    focusStation: { params: { bookId: string; nodeId: string }; response: null };
    /** Pick a half-built book back up when it is opened. */
    resumeBook: { params: { bookId: string }; response: boolean };
    /** Build the book's failed stations again. */
    retryBook: { params: { bookId: string }; response: boolean };
    catalogGet: { params: void; response: CatalogFile };
    catalogPatch: { params: { bookId: string; patch: CatalogPatch }; response: CatalogFile };
    catalogSuggest: { params: { bookId: string }; response: CatalogSuggestionResult };
    universeGet: { params: { bookId: string }; response: BookUniverse | null };
    universeBuild: { params: { bookId: string }; response: BookUniverse };
    universePatch: { params: { bookId: string; change: UniverseChange }; response: BookUniverse };
    markBookFinished: { params: { bookId: string; nodeId: string }; response: boolean };
    /* ---- WeChat Reading; each answers empty when no key is set ---- */
    wereadQuotes: { params: { title: string; author?: string }; response: readonly string[] };
    bookMeta: { params: { bookId: string }; response: BookMeta | null };
    wereadStart: { params: { bookId: string }; response: string | null };
    /** Remove a book, its decks, its audio and its cache. Irreversible. */
    deleteBook: { params: { bookId: string }; response: boolean };

    /* ---- settings the main process owns; the renderer's own live in localStorage ---- */
    getSettings: { params: void; response: ShellSettingsValues };
    setSettings: { params: Partial<ShellSettingsValues>; response: ShellSettingsValues };
    /** Whether this is a dev build, which shows the switches only a developer needs. */
    devBuild: { params: void; response: boolean };
    /** The library path, for showing and for revealing in the file manager. */
    dataDir: { params: void; response: string };
    /** Writes a sample under the library root and returns its relative path. */
    previewVoice: { params: { locale: ContentLocale }; response: string };
    revealDataDir: { params: void; response: null };
    /** Throws away everything derived from the books, keeping the books. */
    clearCache: { params: void; response: null };
    /**
     * The menu bar is drawn by the OS, so its words cannot come from the
     * renderer's dictionary. The webview tells the main process which language
     * it is in and the menu is rebuilt in place.
     */
    setMenuLocale: { params: { locale: UiLocale }; response: null };
    /** Which model route the current settings resolve to, and whether it can run. */
    modelStatus: { params: void; response: ModelStatus };
    /** The webview cannot open a new window, so links leave through the system browser. */
    openExternal: { params: { url: string }; response: boolean };
  };
}>;

/**
 * Messages are declared by the side that RECEIVES them: the bun side's outgoing
 * `send` is typed from this schema, and so is the webview's listener.
 */
export type WebviewSchema = RPCSchema<{
  requests: Record<never, never>;
  messages: {
    progress: Progress;
    deckStatus: DeckStatus;
    companion: CompanionEvent;
    /** The native menu's Settings item, which the webview owns the panel for. */
    openSettings: null;
  };
}>;

export type CairnRPC = { bun: BunSchema; webview: WebviewSchema };

/** Reader-owned universe edits that can cross the process boundary safely. */
export type UniverseChange =
  | { readonly type: 'setRole'; readonly id: string; readonly role: UniverseRole }
  | { readonly type: 'dismiss'; readonly id: string }
  | {
    readonly type: 'add';
    readonly title: string;
    readonly authors: readonly string[];
    readonly role: UniverseRole;
  };

/** One request's params, for the places that name them outside a call. */
export type RequestParams<K extends keyof BunSchema['requests']> = BunSchema['requests'][K]['params'];
export type { BookMeta, BookPreview, DeckStatus, Progress };
