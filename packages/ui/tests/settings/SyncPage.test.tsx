import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsProvider } from '../../src/settings/SettingsProvider';
import { SyncPage } from '../../src/settings/SyncPage';
import type { ShellSettings } from '../../src/settings/shell';

const shell: ShellSettings = {
  prefs: {
    providers: {}, generationProvider: 'openai', chatProvider: 'inherit', chatModel: '',
    narration: 'follow', voices: { en: 'en-US-AndrewNeural', zh: 'zh-CN-YunjianNeural' },
    wereadKey: '', trace: false,
  },
  setPref: () => {},
  setProvider: () => {},
  providers: [],
  voicesFor: () => [],
  recheckModel: () => {},
  previewVoice: () => {},
  dataDir: '/tmp',
  devBuild: false,
  revealDataDir: () => {},
  clearCache: async () => {},
  sync: {
    workerUrl: 'https://books.example.workers.dev',
    username: 'reader',
    status: {
      state: 'success', failedBookIds: [], lastSuccessAt: '2026-11-26T00:00:00.000Z',
      progress: {
        totalBooks: 18, completedBooks: 2, currentBookIndex: 3, currentBookId: 'book-3',
        currentBookTitle: '测试书', phase: 'uploading', completedResources: 4, totalResources: 7,
        currentResourcePath: 'decks/n3.json',
      },
    },
    configure: async () => undefined,
    login: async () => {},
    logout: async () => {},
    syncBook: async () => {},
  },
};

const render = (value: ShellSettings | undefined): string => renderToStaticMarkup(
  createElement(SettingsProvider, null, createElement(SyncPage, { shell: value })),
);

test('sync page exposes configuration and login controls without a global sync button', () => {
  const html = render(shell);
  expect(html).toContain('Worker URL');
  expect(html).toContain('Username');
  expect(html).toContain('Password');
  expect(html).toContain('Log in');
  expect(html).not.toContain('Sync now');
  expect(html).toContain('Last successful sync:');
  expect(html).toContain('2/18');
  expect(html).toContain('测试书');
  expect(html).toContain('Uploading resources');
  expect(html).toContain('decks/n3.json');
  expect(html).toMatch(/type="url"[^>]*value="https:\/\/books\.example\.workers\.dev"/);
  expect(html).toMatch(/autoComplete="username"[^>]*value="reader"/);
});

test('sync page stays honest outside the desktop shell', () => {
  expect(render(undefined)).toContain('Needs the desktop shell');
});
