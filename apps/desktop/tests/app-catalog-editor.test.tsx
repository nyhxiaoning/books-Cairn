import { describe, expect, mock, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { CatalogFile, CatalogPatch } from '@cairn/core/catalog/types';
import type { LibraryEntry } from '@cairn/core/store/library';
import { SettingsProvider } from '@cairn/ui';

const book: LibraryEntry = {
  id: 'thinking', title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman',
  stations: 8, minutes: 42, budgetId: 'solid', generatedAt: '2026-09-28',
};

let catalog: CatalogFile;

function resetCatalog(): void {
  catalog = {
    version: 1,
    records: {
      thinking: {
        bookId: book.id, category: 'Psychology', tags: ['bias'],
        categorySource: 'automatic', tagsSource: 'automatic', updatedAt: '2026-09-28',
      },
    },
  };
}

mock.module('../src/bridge', () => ({
  inShell: false,
  libraryBase: async () => '.',
  listBooks: async () => [book],
  getCatalog: async () => catalog,
  patchCatalog: async (bookId: string, patch: CatalogPatch) => {
    const current = catalog.records[bookId];
    if (!current) throw new Error(`Unknown book: ${bookId}`);
    catalog = {
      ...catalog,
      records: {
        ...catalog.records,
        [bookId]: {
          ...current,
          ...patch,
          categorySource: patch.source,
          tagsSource: patch.source,
          updatedAt: '2026-09-28',
        },
      },
    };
    return catalog;
  },
  suggestCatalogFor: async () => ({ catalog, suggestion: undefined }),
  bookMeta: async () => null,
  chatCancel: async () => false,
  chatClear: async () => false,
  chatHistory: async () => ({ pathGeneratedAt: '', messages: [], evidence: [] }),
  chatSend: async () => false,
  clearCache: async () => undefined,
  dataDir: async () => '',
  deleteBook: async () => false,
  devBuild: async () => false,
  focusStation: () => undefined,
  getSettings: async () => undefined,
  markBookFinished: async () => false,
  modelStatus: async () => undefined,
  onCompanionEvent: () => () => undefined,
  onDeckStatus: () => () => undefined,
  onOpenSettings: () => () => undefined,
  onProgress: () => () => undefined,
  pickBook: async () => null,
  previewVoice: async () => '',
  progressNow: async () => undefined,
  generateBook: async () => book,
  revealDataDir: async () => undefined,
  resumeBook: async () => undefined,
  retryBook: async () => false,
  setMenuLocale: () => undefined,
  setSettings: async () => undefined,
  wereadQuotes: async () => [],
  wereadStart: async () => null,
}));

const { App } = await import('../src/App');

interface Mounted {
  readonly window: Window;
  readonly root: Root;
  readonly host: HTMLDivElement;
  close(): void;
}

async function mount(): Promise<Mounted> {
  resetCatalog();
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
  await act(async () => root.render(<SettingsProvider storageKey="app-catalog-editor-test"><App /></SettingsProvider>));
  return { window, root, host, close: () => act(() => root.unmount()) };
}

function button(mounted: Mounted, label: string): HTMLButtonElement {
  const found = [...mounted.host.querySelectorAll('button')].find((element) => element.textContent === label);
  if (!(found instanceof mounted.window.HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return found;
}

function input(mounted: Mounted, label: string): HTMLInputElement {
  const found = mounted.host.querySelector(`input[aria-label="${label}"]`);
  if (!(found instanceof mounted.window.HTMLInputElement)) throw new Error(`Missing input: ${label}`);
  return found;
}

function click(mounted: Mounted, element: Element): void {
  act(() => element.dispatchEvent(new mounted.window.MouseEvent('click', { bubbles: true })));
}

function key(mounted: Mounted, value: string): void {
  act(() => mounted.window.document.dispatchEvent(new mounted.window.KeyboardEvent('keydown', { key: value, bubbles: true })));
}

function enter(mounted: Mounted, field: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(mounted.window.HTMLInputElement.prototype, 'value')?.set;
  if (!set) throw new Error('Input value is not settable');
  act(() => {
    set.call(field, value);
    field.dispatchEvent(new mounted.window.Event('input', { bubbles: true }));
  });
}

describe('App catalog editor', () => {
  test('returns from editor Escape and save to the recreated details action', async () => {
    const mounted = await mount();
    try {
      const more = mounted.host.querySelector('.shelf-more');
      if (!(more instanceof mounted.window.HTMLButtonElement)) throw new Error('Missing shelf actions');
      click(mounted, more);
      click(mounted, button(mounted, 'Book details'));
      click(mounted, button(mounted, 'Edit category and tags'));
      expect(mounted.window.document.activeElement).toBe(input(mounted, 'Category'));

      key(mounted, 'Escape');
      expect(mounted.host.querySelector('.book-details')).not.toBeNull();
      expect(mounted.window.document.activeElement).toBe(button(mounted, 'Edit category and tags'));

      click(mounted, button(mounted, 'Edit category and tags'));
      enter(mounted, input(mounted, 'Category'), 'Decision making');
      click(mounted, button(mounted, 'Save'));
      await act(async () => undefined);

      expect(mounted.host.textContent).toContain('Decision making');
      expect(mounted.window.document.activeElement).toBe(button(mounted, 'Edit category and tags'));
    } finally {
      mounted.close();
    }
  });
});
