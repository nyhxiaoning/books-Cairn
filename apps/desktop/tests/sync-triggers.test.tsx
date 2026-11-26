import { expect, mock, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { LibraryEntry } from '@cairn/core/store/library';
import { SettingsProvider } from '@cairn/ui';
import { DEFAULT_SHELL_SETTINGS } from '../src/shared/settings';

const book: LibraryEntry = {
  id: 'book-one', title: 'Book one', stations: 1, minutes: 1, budgetId: 'gist',
  generatedAt: '2026-01-01', complete: false, built: 0,
};

let deckStatus: ((status: { bookId: string; total: number; ready: number; failed: number; complete: boolean }) => void) | undefined;
let syncStatus: ((status: { state: 'disabled' | 'idle' | 'syncing' | 'success' | 'error' | 'conflict'; failedBookIds: readonly string[]; message?: string }) => void) | undefined;
let syncBookCalls = 0;

mock.module('../src/bridge', () => ({
  inShell: true,
  libraryBase: async () => '.',
  listBooks: async () => [book],
  getCatalog: async () => ({ version: 1, records: {} }),
  syncBook: async () => { syncBookCalls += 1; return { uploadedBookIds: [], downloadedBookIds: [], failedBookIds: [], status: { state: 'success', failedBookIds: [] } }; },
  onDeckStatus: (listener: typeof deckStatus) => { deckStatus = listener; return () => { deckStatus = undefined; }; },
  onCompanionEvent: () => () => undefined,
  onOpenSettings: () => () => undefined,
  onProgress: () => () => undefined,
  chatHistory: async () => ({ pathGeneratedAt: '', messages: [], evidence: [] }),
  chatCancel: async () => false,
  chatClear: async () => false,
  chatSend: async () => false,
  wereadStart: async () => null,
  bookMeta: async () => null,
  setMenuLocale: () => undefined,
  setSettings: async () => undefined,
  previewVoice: async () => '',
  dataDir: async () => '',
  revealDataDir: async () => undefined,
  resumeBook: async () => undefined,
  focusStation: () => undefined,
  getSettings: async () => DEFAULT_SHELL_SETTINGS,
  modelStatus: async () => undefined,
  devBuild: async () => false,
  generateBook: async () => book,
  renameBook: async () => book,
  pickBook: async () => null,
  progressNow: async () => undefined,
  wereadQuotes: async () => [],
  deleteBook: async () => false,
  markBookFinished: async () => false,
  retryBook: async () => false,
  catalogGet: async () => ({ version: 1, records: {} }),
  patchCatalog: async () => ({ version: 1, records: {} }),
  suggestCatalogFor: async () => ({ catalog: { version: 1, records: {} }, suggestion: undefined }),
  universeGet: async () => null,
  universeBuild: async () => { throw new Error('not used'); },
  universePatch: async () => { throw new Error('not used'); },
  exportAudio: async () => ({ path: '', missing: [] }),
  exportSlides: async () => ({ path: '' }),
  clearCache: async () => undefined,
  getSyncSettings: async () => undefined,
  syncConfigure: async () => ({ state: 'disabled', failedBookIds: [] }),
  syncLogin: async () => ({ authenticated: true, username: 'test' }),
  syncLogout: async () => undefined,
  onSyncStatus: (listener: typeof syncStatus) => { syncStatus = listener; return () => { syncStatus = undefined; }; },
  syncStatus: async () => ({ state: 'disabled', failedBookIds: [] }),
}));

const { App } = await import('../src/App');

async function mount(): Promise<{ readonly root: Root; close(): void }> {
  deckStatus = undefined;
  syncStatus = undefined;
  syncBookCalls = 0;
  const window = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    window, document: window.document, Node: window.Node, HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement, HTMLInputElement: window.HTMLInputElement,
    Event: window.Event, MouseEvent: window.MouseEvent, KeyboardEvent: window.KeyboardEvent,
    navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const host = window.document.createElement('div');
  window.document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SettingsProvider storageKey="sync-triggers-test"><App /></SettingsProvider>));
  return { root, close: () => act(() => root.unmount()) };
}

test('does not sync after the shelf loads', async () => {
  const mounted = await mount();
  try {
    expect(syncBookCalls).toBe(0);
  } finally {
    mounted.close();
  }
});

test('does not sync when a deck becomes ready', async () => {
  const mounted = await mount();
  try {
    expect(deckStatus).toBeDefined();
    await act(async () => deckStatus?.({ bookId: book.id, total: 1, ready: 1, failed: 0, complete: true }));
    expect(syncBookCalls).toBe(0);
  } finally {
    mounted.close();
  }
});

test('shows a dismissible sync toast and reopens it for a new status', async () => {
  const mounted = await mount();
  try {
    await act(async () => syncStatus?.({ state: 'success', failedBookIds: [] }));
    expect(document.querySelector('.sync-toast')).not.toBeNull();
    const closeButton = document.querySelector('.sync-toast-close');
    if (!(closeButton instanceof window.HTMLButtonElement)) throw new Error('Missing sync toast close button');
    await act(async () => closeButton.click());
    expect(document.querySelector('.sync-toast')).toBeNull();
    await act(async () => syncStatus?.({ state: 'error', failedBookIds: ['book-one'], message: 'network down' }));
    expect(document.querySelector('.sync-toast')?.textContent).toContain('network down');
  } finally {
    mounted.close();
  }
});
