import { describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { CatalogRecord } from '@cairn/core/catalog/types';
import type { LibraryEntry } from '@cairn/core/store/library';
import { SettingsProvider } from '@cairn/ui';
import { BookDetails } from '../src/BookDetails';
import { CategoryEditor } from '../src/CategoryEditor';

const book: LibraryEntry = {
  id: 'thinking', title: 'Thinking, Fast and Slow', author: 'Daniel Kahneman',
  stations: 8, minutes: 42, budgetId: 'solid', generatedAt: '2026-09-28',
};

const record: CatalogRecord = {
  bookId: book.id, category: 'Psychology', tags: ['bias'],
  categorySource: 'automatic', tagsSource: 'automatic', updatedAt: '2026-09-28',
};

interface Mounted {
  readonly window: Window;
  readonly root: Root;
  readonly host: HTMLDivElement;
  close(): void;
}

function mount(element: React.ReactNode, beforeRender?: (window: Window) => void): Mounted {
  const window = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    window, document: window.document, Node: window.Node, HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement, HTMLInputElement: window.HTMLInputElement,
    Event: window.Event, MouseEvent: window.MouseEvent, KeyboardEvent: window.KeyboardEvent,
    navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const host = window.document.createElement('div');
  window.document.body.append(host);
  beforeRender?.(window);
  const root = createRoot(host);
  act(() => root.render(<SettingsProvider storageKey="book-details-test">{element}</SettingsProvider>));
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

describe('book details', () => {
  test('is an accessible overview dialog that closes with Escape and returns focus', () => {
    let opener: HTMLButtonElement | undefined;
    const closed: string[] = [];
    const mounted = mount(
      <BookDetails book={book} meta={{ intro: 'How judgment works.', rating: 89 }} record={record}
        onEditCatalog={() => undefined} onClose={() => closed.push('closed')} />,
      (window) => {
        opener = window.document.createElement('button');
        window.document.body.append(opener);
        opener.focus();
      },
    );
    try {
      const dialog = mounted.host.querySelector('[role="dialog"]');
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
      expect(mounted.window.document.activeElement?.textContent).toBe('Close');
      expect(mounted.host.textContent).toContain('Daniel Kahneman');
      expect(mounted.host.textContent).toContain('Psychology');
      expect(mounted.host.textContent).toContain('bias');
      expect(mounted.host.textContent).toContain('8 chapters');
      expect(mounted.host.textContent).toContain('42 min');
      expect(mounted.host.textContent).toContain('How judgment works.');

      key(mounted, 'Escape');
      expect(closed).toEqual(['closed']);
      expect(mounted.window.document.activeElement).toBe(opener);
    } finally {
      mounted.close();
    }
  });

  test('trims a manual catalog save and leaves a rejected save visible', async () => {
    const patches: unknown[] = [];
    const mounted = mount(
      <CategoryEditor record={record} onSuggest={async () => undefined}
        onSave={async (patch) => { patches.push(patch); }} />,
    );
    try {
      enter(mounted, input(mounted, 'Category'), '  Behavioral science  ');
      enter(mounted, input(mounted, 'Tags'), ' bias,  decisions , bias,  ');
      click(mounted, button(mounted, 'Save'));
      await act(async () => undefined);
      expect(patches).toEqual([{
        category: 'Behavioral science', tags: ['bias', 'decisions'], source: 'manual',
      }]);
    } finally {
      mounted.close();
    }
  });

  test('category editor closes with Escape and returns focus to its opener', () => {
    let opener: HTMLButtonElement | undefined;
    const closed: string[] = [];
    const mounted = mount(
      <CategoryEditor record={record} onSuggest={async () => undefined} onSave={() => undefined}
        onClose={() => closed.push('closed')} />,
      (window) => {
        opener = window.document.createElement('button');
        window.document.body.append(opener);
        opener.focus();
      },
    );
    try {
      expect(mounted.window.document.activeElement).toBe(input(mounted, 'Category'));
      key(mounted, 'Escape');
      expect(closed).toEqual(['closed']);
      expect(mounted.window.document.activeElement).toBe(opener);
    } finally {
      mounted.close();
    }
  });

  test('shows automatic values for review and does not dismiss a failed save', async () => {
    const mounted = mount(
      <CategoryEditor record={record}
        onSuggest={async () => ({ category: 'Behavioral science', tags: ['choice', 'judgment'] })}
        onSave={async () => { throw new Error('The shelf is unavailable.'); }} />,
    );
    try {
      click(mounted, button(mounted, 'Suggest category and tags'));
      await act(async () => undefined);
      expect(input(mounted, 'Category').value).toBe('Behavioral science');
      expect(input(mounted, 'Tags').value).toBe('choice, judgment');

      click(mounted, button(mounted, 'Save'));
      await act(async () => undefined);
      expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain('The shelf is unavailable.');
      expect(input(mounted, 'Category').value).toBe('Behavioral science');
    } finally {
      mounted.close();
    }
  });
});
