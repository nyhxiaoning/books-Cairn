import { describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { CatalogFile } from '@cairn/core/catalog/types';
import type { LibraryEntry } from '@cairn/core/store/library';
import { SettingsProvider } from '@cairn/ui';
import { Home } from '../src/Home';

const books: readonly LibraryEntry[] = [
  { id: 'thinking', title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman', stations: 8, minutes: 42, budgetId: 'solid', generatedAt: '2026-09-28' },
  { id: 'legacy', title: 'The Analects', stations: 6, minutes: 30, budgetId: 'brief', generatedAt: '2026-09-28' },
];

const catalog: CatalogFile = {
  version: 1,
  records: {
    thinking: {
      bookId: 'thinking', category: 'Psychology', tags: ['bias', 'decision making'],
      categorySource: 'manual', tagsSource: 'manual', updatedAt: '2026-09-28',
    },
  },
};

interface Shelf {
  readonly window: Window;
  readonly root: Root;
  readonly host: HTMLDivElement;
  readonly opened: readonly string[];
  readonly built: readonly string[];
  readonly edited: readonly string[];
  close(): void;
}

function mount(): Shelf {
  const window = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    window,
    document: window.document,
    Node: window.Node,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLInputElement: window.HTMLInputElement,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    navigator: window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const host = window.document.createElement('div');
  window.document.body.append(host);
  const root = createRoot(host);
  const opened: string[] = [];
  const built: string[] = [];
  const edited: string[] = [];

  act(() => root.render(
    <SettingsProvider storageKey="catalog-view-test">
      <Home
        books={books}
        catalog={catalog}
        onAdd={() => undefined}
        onOpen={(id) => opened.push(id)}
        onDetails={() => undefined}
        onEditCatalog={(id) => edited.push(id)}
        onBuildUniverse={(id) => built.push(id)}
        onSettings={() => undefined}
      />
    </SettingsProvider>,
  ));
  return { window, root, host, opened, built, edited, close: () => act(() => root.unmount()) };
}

function button(shelf: Shelf, label: string): HTMLButtonElement {
  const found = [...shelf.host.querySelectorAll('button')].find((element) => element.textContent === label);
  if (!(found instanceof shelf.window.HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return found;
}

function click(shelf: Shelf, element: Element): void {
  act(() => element.dispatchEvent(new shelf.window.MouseEvent('click', { bubbles: true })));
}

function key(shelf: Shelf, value: string): void {
  const target = shelf.window.document.activeElement ?? shelf.window.document;
  act(() => target.dispatchEvent(new shelf.window.KeyboardEvent('keydown', { key: value, bubbles: true })));
}

function enter(shelf: Shelf, input: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(shelf.window.HTMLInputElement.prototype, 'value')?.set;
  if (!set) throw new Error('Input value is not settable');
  act(() => {
    input.focus();
    set.call(input, value);
    input.dispatchEvent(new shelf.window.Event('input', { bubbles: true }));
    input.dispatchEvent(new shelf.window.Event('change', { bubbles: true }));
  });
}

describe('catalog shelf', () => {
  test('filters by a tag and includes legacy books under Uncategorized', () => {
    const shelf = mount();
    try {
      const search = shelf.host.querySelector('input');
      if (!(search instanceof shelf.window.HTMLInputElement)) throw new Error('Missing catalog search');
      enter(shelf, search, 'bias');

      expect(shelf.host.textContent).toContain('Thinking, Fast and Slow');
      expect(shelf.host.textContent).not.toContain('The Analects');

      enter(shelf, search, '');
      click(shelf, button(shelf, 'Uncategorized'));
      expect(shelf.host.textContent).toContain('The Analects');
      expect(shelf.host.textContent).not.toContain('Thinking, Fast and Slow');
    } finally {
      shelf.close();
    }
  });

  test('opens a shelf row while its more menu stays isolated and keyboard-accessible', () => {
    const shelf = mount();
    try {
      const body = shelf.host.querySelector('.shelf-item');
      if (!(body instanceof shelf.window.HTMLButtonElement)) throw new Error('Missing shelf row');
      click(shelf, body);
      expect(shelf.opened).toEqual(['thinking']);

      const more = shelf.host.querySelector('.shelf-more');
      if (!(more instanceof shelf.window.HTMLButtonElement)) throw new Error('Missing more actions');
      click(shelf, more);
      expect(shelf.opened).toEqual(['thinking']);
      expect(shelf.window.document.activeElement?.textContent).toBe('Book details');

      key(shelf, 'ArrowDown');
      expect(shelf.window.document.activeElement?.textContent).toBe('Build book universe');
      key(shelf, ' ');
      expect(shelf.built).toEqual(['thinking']);

      click(shelf, more);
      const edit = button(shelf, 'Edit category and tags');
      act(() => edit.focus());
      key(shelf, 'Enter');
      expect(shelf.edited).toEqual(['thinking']);

      click(shelf, more);
      key(shelf, 'Escape');
      expect(shelf.window.document.activeElement).toBe(more);
    } finally {
      shelf.close();
    }
  });
});
