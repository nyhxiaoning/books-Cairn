import { describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { BookUniverse } from '@cairn/core/universe/types';
import { LinkProvider, SettingsProvider } from '@cairn/ui';
import { UniversePanel, type UniversePanelState } from '../src/UniversePanel';
import type { UniverseChange } from '../src/shared/schema';

interface Mounted {
  readonly window: Window;
  readonly root: Root;
  readonly host: HTMLDivElement;
  close(): void;
}

function mount(
  state: UniversePanelState,
  options: {
    readonly section?: 'universe' | 'experts' | 'evidence';
    readonly onBuild?: () => void | Promise<void>;
    readonly onPatch?: (change: UniverseChange) => void | Promise<void>;
    readonly open?: (url: string) => void;
  } = {},
): Mounted {
  const window = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    window, document: window.document, Node: window.Node, HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement, HTMLInputElement: window.HTMLInputElement,
    HTMLSelectElement: window.HTMLSelectElement,
    Event: window.Event, MouseEvent: window.MouseEvent, navigator: window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const host = window.document.createElement('div');
  window.document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(
    <SettingsProvider storageKey="universe-panel-test">
      <LinkProvider open={options.open}>
        <UniversePanel
          section={options.section ?? 'universe'}
          state={state}
          onBuild={options.onBuild ?? (() => undefined)}
          onPatch={options.onPatch ?? (() => undefined)}
        />
      </LinkProvider>
    </SettingsProvider>,
  ));
  return { window, root, host, close: () => act(() => root.unmount()) };
}

function universe(books: BookUniverse['books']): BookUniverse {
  return {
    version: 1,
    bookId: 'seed-book',
    generatedAt: '2026-09-28T08:30:00.000Z',
    profile: { category: 'Psychology', topics: ['judgment'] },
    books,
    dismissed: [],
  };
}

const candidate: BookUniverse['books'][number] = {
  id: 'candidate-one',
  title: 'Noise',
  authors: ['Daniel Kahneman'],
  role: 'support',
  sharedTopics: ['judgment'],
  rationale: 'Extends the account of judgment errors.',
  sources: [{ title: 'Publisher page', url: 'https://example.com/noise' }],
  evidence: 'candidate',
  origin: 'generated',
};

function button(mounted: Mounted, label: string): HTMLButtonElement {
  const found = [...mounted.host.querySelectorAll('button')]
    .find((element) => element.textContent?.trim() === label);
  if (!(found instanceof mounted.window.HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return found;
}

function click(mounted: Mounted, element: Element): void {
  act(() => element.dispatchEvent(new mounted.window.MouseEvent('click', { bubbles: true })));
}

function enter(mounted: Mounted, field: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(mounted.window.HTMLInputElement.prototype, 'value')?.set;
  if (!set) throw new Error('Input value is not settable');
  act(() => {
    set.call(field, value);
    field.dispatchEvent(new mounted.window.Event('input', { bubbles: true }));
  });
}

describe('book universe panel', () => {
  test('requires an explicit first build after disclosing exactly what leaves the machine', () => {
    let builds = 0;
    const mounted = mount({ status: 'empty' }, { onBuild: () => { builds += 1; } });
    try {
      expect(mounted.host.textContent).toContain('title, author, and short topic phrases');
      expect(mounted.host.textContent).toContain('never chapters, full text, or private notes');
      click(mounted, button(mounted, 'Build'));
      expect(builds).toBe(1);
    } finally {
      mounted.close();
    }
  });

  test('groups an honest short result by role and routes public source links through LinkProvider', () => {
    const opened: string[] = [];
    const mounted = mount({ status: 'ready', universe: universe([
      { ...candidate, id: 'foundation-one', title: 'Thinking', role: 'foundation', evidence: 'sourced' },
      candidate,
    ]) }, { open: (url) => opened.push(url) });
    try {
      const list = mounted.host.querySelector('[aria-label="Books grouped by relationship"]');
      expect(list?.textContent).toContain('Foundation');
      expect(list?.textContent).toContain('Supports');
      expect(list?.textContent).toContain('Candidate');
      expect(mounted.host.textContent).toContain('Fewer reliable matches found');
      const source = [...mounted.host.querySelectorAll('a')]
        .find((link) => link.textContent === 'Publisher page');
      if (!source) throw new Error('Missing source link');
      click(mounted, source);
      expect(opened).toEqual(['https://example.com/noise']);
    } finally {
      mounted.close();
    }
  });

  test('offers Retry after a build fails without hiding the failure', () => {
    let retries = 0;
    const mounted = mount(
      { status: 'failed', message: 'Search is unavailable.' },
      { onBuild: () => { retries += 1; } },
    );
    try {
      expect(mounted.host.querySelector('[role="alert"]')?.textContent).toContain('Search is unavailable.');
      click(mounted, button(mounted, 'Retry'));
      expect(retries).toBe(1);
    } finally {
      mounted.close();
    }
  });

  test('does not offer expert action for an unlinked candidate', () => {
    const mounted = mount(
      { status: 'ready', universe: universe([candidate]) },
      { section: 'experts' },
    );
    try {
      expect(mounted.host.textContent).toContain('No books are ready as experts yet.');
      expect(mounted.host.textContent).not.toContain('Ask as expert');
    } finally {
      mounted.close();
    }
  });

  test('shows every evidence status and the last verification time', () => {
    const states = ['candidate', 'sourced', 'imported', 'mapped', 'finished'] as const;
    const mounted = mount({ status: 'ready', universe: universe(states.map((evidence, index) => ({
      ...candidate,
      id: `book-${index}`,
      title: `Book ${index}`,
      evidence,
      ...(evidence === 'imported' || evidence === 'mapped' || evidence === 'finished'
        ? { linkedBookId: `linked-${index}` }
        : {}),
    }))) }, { section: 'evidence' });
    try {
      for (const label of ['Candidate', 'Public sources', 'Imported', 'Preparing', 'Ready as expert', 'Finished']) {
        expect(mounted.host.textContent).toContain(label);
      }
      expect(mounted.host.textContent).toContain('Last verified');
    } finally {
      mounted.close();
    }
  });

  test('emits role, dismissal, and manual-candidate changes', () => {
    const changes: UniverseChange[] = [];
    const mounted = mount(
      { status: 'ready', universe: universe([candidate]) },
      { onPatch: (change) => { changes.push(change); } },
    );
    try {
      const role = mounted.host.querySelector('select[aria-label="Relationship for Noise"]');
      if (!(role instanceof mounted.window.HTMLSelectElement)) throw new Error('Missing role picker');
      act(() => {
        role.value = 'oppose';
        role.dispatchEvent(new mounted.window.Event('change', { bubbles: true }));
      });
      click(mounted, button(mounted, 'Dismiss Noise'));
      click(mounted, button(mounted, 'Add a book manually'));

      const title = mounted.host.querySelector('input[aria-label="Book title"]');
      const authors = mounted.host.querySelector('input[aria-label="Authors"]');
      if (!(title instanceof mounted.window.HTMLInputElement) ||
        !(authors instanceof mounted.window.HTMLInputElement)) throw new Error('Missing manual fields');
      enter(mounted, title, 'The Undoing Project');
      enter(mounted, authors, 'Michael Lewis');
      click(mounted, button(mounted, 'Add candidate'));

      expect(changes).toEqual([
        { type: 'setRole', id: 'candidate-one', role: 'oppose' },
        { type: 'dismiss', id: 'candidate-one' },
        { type: 'add', title: 'The Undoing Project', authors: ['Michael Lewis'], role: 'support' },
      ]);
    } finally {
      mounted.close();
    }
  });
});
