import { describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import type { NodeDeck, PathNode } from '@cairn/core/types';
import { SettingsProvider } from '../../src/settings/SettingsProvider';
import { DeckPane } from '../../src/panes/DeckPane';

const node: PathNode = {
  id: 'n0', idx: 0, title: 'Station', kind: 'concept', brief: 'Brief',
  keyPoints: [], sourceChapters: [0], estMinutes: 1,
};

const deck: NodeDeck = {
  nodeId: 'n0', slides: [], narration: [{ text: 'Read this aloud.', startMs: 0, endMs: 1_000 }],
  durationMs: 1_000,
};

interface Mounted {
  readonly window: Window;
  readonly host: HTMLDivElement;
  readonly audio: HTMLAudioElement;
  close(): void;
}

function mount(nextDeck: NodeDeck, speech?: SpeechSynthesis): Mounted {
  const window = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    window,
    document: window.document,
    Node: window.Node,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    navigator: window.navigator,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  if (speech) {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: speech });
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class {
        readonly text: string;
        lang = '';
        rate = 1;

        constructor(text: string) { this.text = text; }
      },
    });
  }
  const host = window.document.createElement('div');
  window.document.body.append(host);
  const root: Root = createRoot(host);
  act(() => root.render(
    <SettingsProvider storageKey="deck-pane-test">
      <DeckPane
        node={node}
        deck={nextDeck}
        audioSrc="http://localhost/audio.mp3"
        onSelect={() => undefined}
        onEnded={() => undefined}
      />
    </SettingsProvider>,
  ));
  const audio = host.querySelector('audio');
  if (!(audio instanceof window.HTMLAudioElement)) throw new Error('Missing audio element');
  return { window, host, audio, close: () => act(() => root.unmount()) };
}

function speechStub(): { speech: SpeechSynthesis; spoken: string[] } {
  const spoken: string[] = [];
  const speech = {
    cancel: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    speak: (utterance: SpeechSynthesisUtterance) => spoken.push(utterance.text),
  } as SpeechSynthesis;
  return { speech, spoken };
}

describe('DeckPane audio fallback', () => {
  test('starts system speech directly when the deck has no audio path', () => {
    const { speech, spoken } = speechStub();
    const mounted = mount(deck, speech);
    try {
      expect(mounted.host.querySelector('.deck-fallback')?.textContent).toBe('Reading aloud locally');
      expect(spoken).toEqual(['Read this aloud.']);
    } finally {
      mounted.close();
    }
  });

  test('starts visual playback directly when system speech is unavailable', () => {
    const mounted = mount(deck);
    try {
      expect(mounted.host.querySelector('.deck-fallback')?.textContent).toBe('Visual playback only');
    } finally {
      mounted.close();
    }
  });

  test('uses the same fallback when an audio-backed deck reports an error', () => {
    const { speech, spoken } = speechStub();
    const mounted = mount({ ...deck, audioPath: '/audio/n0.mp3' }, speech);
    try {
      expect(mounted.host.querySelector('.deck-fallback')).toBeNull();
      act(() => mounted.audio.dispatchEvent(new mounted.window.Event('error')));
      expect(mounted.host.querySelector('.deck-fallback')?.textContent).toBe('Reading aloud locally');
      expect(spoken).toEqual(['Read this aloud.']);
    } finally {
      mounted.close();
    }
  });
});
