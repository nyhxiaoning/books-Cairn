import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataPage } from '../../src/settings/pages';
import { SettingsProvider } from '../../src/settings/SettingsProvider';
import type { ShellSettings } from '../../src/settings/shell';

const shell = (devBuild: boolean): ShellSettings => ({
  prefs: {
    providers: {}, generationProvider: 'openai', chatProvider: 'inherit', chatModel: '',
    narration: 'follow', voices: { en: 'en-US-AndrewNeural', zh: 'zh-CN-YunjianNeural' },
    searchProvider: 'firecrawl', braveKey: '', firecrawlKey: '', tavilyKey: '', wereadKey: '', trace: false,
  },
  setPref: () => {},
  setProvider: () => {},
  providers: [],
  voicesFor: () => [],
  recheckModel: () => {},
  previewVoice: () => {},
  dataDir: '/tmp',
  devBuild,
  revealDataDir: () => {},
  clearCache: async () => {},
});

const render = (devBuild: boolean): string =>
  renderToStaticMarkup(createElement(SettingsProvider, null, createElement(DataPage, { shell: shell(devBuild) })));

test('recording model calls is offered in a dev build only', () => {
  expect(render(true)).toContain('role="switch"');
  expect(render(false)).not.toContain('role="switch"');
});
