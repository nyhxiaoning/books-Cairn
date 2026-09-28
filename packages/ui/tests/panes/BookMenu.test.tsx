import { describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { LibraryEntry } from '@cairn/core/store/library';
import { SettingsProvider } from '../../src/settings/SettingsProvider';
import { BookMenu } from '../../src/panes/BookMenu';

const books: readonly LibraryEntry[] = [
  { id: 'thinking', title: 'Thinking, Fast and Slow', stations: 8, minutes: 42, budgetId: 'solid', generatedAt: '2026-09-28' },
  { id: 'analects', title: 'The Analects', stations: 6, minutes: 30, budgetId: 'brief', generatedAt: '2026-09-28' },
];

interface Mounted {
  readonly window: Window;
  readonly root: Root;
  readonly host: HTMLDivElement;
  close(): void;
}

function mount(props: Partial<React.ComponentProps<typeof BookMenu>> = {}): Mounted {
  const window = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    window, document: window.document, Node: window.Node, HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement, Event: window.Event, MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent, navigator: window.navigator, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const host = window.document.createElement('div');
  window.document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(
    <SettingsProvider storageKey="book-menu-test">
      <BookMenu title="Thinking, Fast and Slow" books={books} currentId="thinking" {...props} />
    </SettingsProvider>,
  ));
  return { window, root, host, close: () => act(() => root.unmount()) };
}

function button(mounted: Mounted, label: string): HTMLButtonElement {
  const found = [...mounted.host.querySelectorAll('button')].find((element) => element.textContent === label);
  if (!(found instanceof mounted.window.HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return found;
}

function click(mounted: Mounted, element: Element): void {
  act(() => element.dispatchEvent(new mounted.window.MouseEvent('click', { bubbles: true })));
}

function key(mounted: Mounted, value: string): void {
  act(() => mounted.window.document.dispatchEvent(new mounted.window.KeyboardEvent('keydown', { key: value, bubbles: true })));
}

describe('BookMenu', () => {
  test('only shows the supplied catalog actions', () => {
    const withoutActions = mount();
    try {
      click(withoutActions, button(withoutActions, 'Thinking, Fast and Slow'));
      expect(withoutActions.host.textContent).not.toContain('Book details');
      expect(withoutActions.host.textContent).not.toContain('Book universe');
    } finally {
      withoutActions.close();
    }

    const detailsOnly = mount({ onDetails: () => undefined });
    try {
      click(detailsOnly, button(detailsOnly, 'Thinking, Fast and Slow'));
      expect(detailsOnly.host.textContent).toContain('Book details');
      expect(detailsOnly.host.textContent).not.toContain('Book universe');
    } finally {
      detailsOnly.close();
    }

    const universeOnly = mount({ onUniverse: () => undefined });
    try {
      click(universeOnly, button(universeOnly, 'Thinking, Fast and Slow'));
      expect(universeOnly.host.textContent).not.toContain('Book details');
      expect(universeOnly.host.textContent).toContain('Book universe');
    } finally {
      universeOnly.close();
    }
  });

  test('walks catalog actions with arrow keys, closes, and calls each once', () => {
    const calls: string[] = [];
    const mounted = mount({
      onDetails: () => calls.push('details'),
      onUniverse: () => calls.push('universe'),
    });
    try {
      const trigger = button(mounted, 'Thinking, Fast and Slow');
      click(mounted, trigger);
      key(mounted, 'ArrowDown');
      key(mounted, 'ArrowDown');
      key(mounted, 'Enter');
      expect(calls).toEqual(['details']);
      expect(mounted.host.querySelector('[role="menu"]')).toBeNull();

      click(mounted, trigger);
      key(mounted, 'ArrowDown');
      key(mounted, 'ArrowDown');
      key(mounted, 'ArrowDown');
      key(mounted, 'Enter');
      expect(calls).toEqual(['details', 'universe']);
      expect(mounted.host.querySelector('[role="menu"]')).toBeNull();
    } finally {
      mounted.close();
    }
  });
});
