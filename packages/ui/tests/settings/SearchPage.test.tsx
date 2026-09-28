import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SearchPage } from '../../src/settings/pages';
import { SettingsProvider } from '../../src/settings/SettingsProvider';
import type { ShellSettings } from '../../src/settings/shell';

function shellWith(overrides: Partial<ShellSettings['prefs']> = {}): ShellSettings {
  return {
    prefs: {
      providers: {}, generationProvider: 'openai', chatProvider: 'inherit',
      narration: 'follow', voices: { en: 'en-US-AndrewNeural', zh: 'zh-CN-YunjianNeural' },
      searchProvider: 'firecrawl', braveKey: '', firecrawlKey: '', tavilyKey: '', wereadKey: '', trace: false,
      searchMaxPages: 12, searchMaxPageChars: 4_000, searchAllowedDomains: [],
      ...overrides,
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
  };
}

const render = (shell?: ShellSettings): string =>
  renderToStaticMarkup(createElement(SettingsProvider, null, createElement(SearchPage, { shell })));

describe('SearchPage', () => {
  test('every search provider says where its key comes from', () => {
    const html = render(shellWith());
    expect(html).toContain('api-dashboard.search.brave.com');
    expect(html).toContain('firecrawl.dev');
    expect(html).toContain('tavily.com');
  });

  test('a stored key sits in the field, hidden until the eye is pressed', () => {
    const html = render(shellWith({ braveKey: 'brave-secret' }));
    expect(html).toMatch(/type="password"[^>]*value="brave-secret"/);
    expect(html).toContain('set-eye');
  });

  test('a $NAME reference shows as typed', () => {
    const html = render(shellWith({ braveKey: '$BRAVE_SEARCH_API_KEY' }));
    expect(html).toMatch(/type="text"[^>]*value="\$BRAVE_SEARCH_API_KEY"/);
  });

  test('without a shell it says so instead of pretending the controls work', () => {
    expect(render(undefined)).toContain('bun run start');
  });
});
