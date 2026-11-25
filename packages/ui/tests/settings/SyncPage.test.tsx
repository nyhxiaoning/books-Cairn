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
    status: { state: 'success', failedBookIds: [], lastSuccessAt: '2026-11-26T00:00:00.000Z' },
    configure: async () => undefined,
    login: async () => {},
    logout: async () => {},
    syncNow: async () => {},
  },
};

const render = (value: ShellSettings | undefined): string => renderToStaticMarkup(
  createElement(SettingsProvider, null, createElement(SyncPage, { shell: value })),
);

test('sync page exposes configuration, login and retry controls', () => {
  const html = render(shell);
  expect(html).toContain('Worker URL');
  expect(html).toContain('Username');
  expect(html).toContain('Password');
  expect(html).toContain('Log in');
  expect(html).toContain('Sync now');
  expect(html).toContain('Last successful sync:');
  expect(html).toMatch(/type="url"[^>]*value="https:\/\/books\.example\.workers\.dev"/);
  expect(html).toMatch(/autoComplete="username"[^>]*value="reader"/);
});

test('sync page stays honest outside the desktop shell', () => {
  expect(render(undefined)).toContain('Needs the desktop shell');
});
