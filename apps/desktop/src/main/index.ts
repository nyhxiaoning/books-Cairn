/**
 * Electrobun main process, and its composition root: every process-scoped
 * object is built here and passed to what needs it. Nothing else constructs a
 * builder or holds a setter for the window.
 *
 * The renderer cannot spawn processes, so everything touching the model, the
 * file system or the network lives in this process and is reached over RPC.
 */
import { ApplicationMenu, BrowserView, BrowserWindow, Updater } from 'electrobun/main';
import { createBookBuilder } from '@cairn/core/books/builder';
import { openCatalog } from '@cairn/core/store/catalog-disk';
import { openUniverseStore } from '@cairn/core/store/universe-disk';
import { edgeTtsNarrator } from '@cairn/core/runtime';
import { fetchWeb } from './companion/web-tools';
import { webSearch } from './companion/search-provider';
import { createHandlers } from './rpc';
import { installMenu, OPEN_SETTINGS, OPEN_INSPECTOR } from './menu';
import { providerFor } from './provider';
import { readReadingRecord } from './reading';
import { effectiveWereadKey, readSettings, writeSettings } from './settings';
import { createUniverseService } from './universe/service';
import { createWeread } from './weread/service';
import { DATA_DIR, library } from './store';
import { voiceFor, type UiLocale } from '../shared/settings';
import type { CairnRPC } from '../shared/schema';

const DEV_SERVER = 'http://localhost:5173';

const devBuild = (await Updater.localInfo.channel()) === 'dev';
const menu = (locale?: UiLocale): void => installMenu(locale, { inspector: devBuild });

// The trace switch is shown in dev builds only; one left on from before would stay on unseen
if (!devBuild && (await readSettings()).trace) await writeSettings({ trace: false });

async function viewUrl(): Promise<string> {
  if (!devBuild) return 'views://mainview/index.html';
  try {
    await fetch(DEV_SERVER, { method: 'HEAD' });
    return DEV_SERVER;
  } catch {
    return 'views://mainview/index.html';
  }
}

// Without an application menu macOS has nowhere to route ⌘C / ⌘V / ⌘A. The
// language is the default until the webview reports the reader's choice.
menu();

// Messages go out through the window's RPC, which exists only once the
// handlers do; these are only ever called after that.
const send = (): typeof rpc.send => rpc.send;

const books = createBookBuilder({
  library,
  narrator: edgeTtsNarrator(),
  providerFor,
  voiceFor: async (language) => voiceFor(await readSettings(), language).voice,
  // Stations keep arriving after the progress modal has closed
  onDeckStatus: (status) => send().deckStatus(status),
  onDeckFailed: (bookId, nodeId, error) => console.error('deck failed', bookId, nodeId, error),
});

const weread = createWeread({
  library,
  keyOf: async () => effectiveWereadKey(await readSettings()),
});

const catalog = openCatalog(DATA_DIR);
const universeStore = openUniverseStore(DATA_DIR);
const universe = createUniverseService({
  library,
  catalog,
  store: universeStore,
  providerFor,
  readSettings,
  webSearch,
  fetchWeb,
  readReadingRecord,
  now: () => new Date().toISOString(),
});

const handlers = createHandlers({
  books,
  weread,
  catalog,
  providerFor,
  library,
  devBuild,
  menu,
  emit: {
    progress: (p) => send().progress(p),
    companion: (event) => send().companion(event),
  },
});

ApplicationMenu.on('application-menu-clicked', (event) => {
  const action = (event as { data?: { action?: string } }).data?.action;
  if (action === OPEN_SETTINGS) send().openSettings(null);
  // Open, never toggle: Electrobun's toggle crashes the process on the closing call
  if (action === OPEN_INSPECTOR) mainWindow.webview?.openDevTools();
});

const rpc = BrowserView.defineRPC<CairnRPC>({ handlers: { requests: handlers, messages: {} } });

const mainWindow = new BrowserWindow({
  title: 'Cairn',
  url: await viewUrl(),
  frame: { width: 1400, height: 900, x: 80, y: 60 },
  rpc,
});
