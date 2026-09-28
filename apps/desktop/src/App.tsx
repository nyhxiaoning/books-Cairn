import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { CairnError, payloadOf } from '@cairn/core/errors';
import { audioFile } from '@cairn/core/store/library';
import type { LibraryEntry } from '@cairn/core/store/library';
import { emptyCatalog, type CatalogFile, type CatalogPatch } from '@cairn/core/catalog/types';
import { stationHeat } from '@cairn/core/store/asks';
import {
  CompanionPane, DeckPane, StagePane, Splitter, PanelToggle, SettingsPanel, useSplit, useResume,
  useUi, columnWidth,
  DEFAULT_LEFT, DEFAULT_RIGHT, LEFT_LIMITS, RIGHT_LIMITS, errorText,
} from '@cairn/ui';
import { AddBook } from './AddBook';
import { BookDetails, type DetailsSection } from './BookDetails';
import { CategoryEditor } from './CategoryEditor';
import { Home } from './Home';
import {
  bookMeta, chatCancel, chatClear, chatHistory, chatSend, deleteBook, focusStation, getCatalog, inShell, libraryBase,
  listBooks, onCompanionEvent, onDeckStatus, onOpenSettings, markBookFinished, resumeBook, retryBook, setMenuLocale,
  suggestCatalogFor, patchCatalog, wereadStart,
  universeBuild, universeGet, universePatch,
  exportAudio, exportSlides,
} from './bridge';
import { shortcuts } from './shortcut';
import { useBundle } from './useBundle';
import { useShellSettings } from './useShellSettings';
import { applyCompanionEvent, beginCompanionTurn, emptyCompanionView } from './companion-state';
import type { BookMeta } from './shared/types';
import type { UniversePanelState } from './UniversePanel';
import type { UniverseChange } from './shared/schema';
import { renderSlidesHtml } from './export/slide-html';
import { exportFileName } from '@cairn/core/export/audio-plan';

/** Typed in the companion's box, it clears the conversation instead of asking the model. */
const CLEAR_COMMAND = '/clear';
type DetailsTarget = { readonly bookId: string; readonly section: DetailsSection };

export function App(): ReactElement {
  const [books, setBooks] = useState<readonly LibraryEntry[]>([]);
  const [catalog, setCatalog] = useState<CatalogFile>(() => emptyCatalog());
  const [bookId, setBookId] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [details, setDetails] = useState<DetailsTarget>();
  const [editingCatalog, setEditingCatalog] = useState<string>();
  const [focusCatalogEditor, setFocusCatalogEditor] = useState(false);
  const [detailsMeta, setDetailsMeta] = useState<Readonly<Record<string, BookMeta>>>({});
  const [universeView, setUniverseView] = useState<{
    readonly bookId: string;
    readonly state: UniversePanelState;
  }>();
  /** Port and token are new on every launch, so every URL is built from this. */
  const [base, setBase] = useState<string>();
  const { bundle, error, reload } = useBundle(bookId, base);

  const { prefs, t } = useUi();
  /**
   * Read at mount only. As a dependency it would reopen the last book the
   * moment the reader toggled this setting, which is not what the switch says.
   */
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const shell = useShellSettings();
  const resume = useResume();
  const left = useSplit('pane.left', DEFAULT_LEFT, LEFT_LIMITS, 'left');
  const right = useSplit('pane.right', DEFAULT_RIGHT, RIGHT_LIMITS, 'right');

  const [currentId, setCurrentId] = useState<string>();
  const [chat, setChat] = useState(() => emptyCompanionView(''));
  const [selection, setSelection] = useState<string>();

  useEffect(() => {
    void (async () => {
      setBase(await libraryBase().catch(() => '.'));
      const [shelf, organization] = await Promise.all([
        listBooks().catch(() => []),
        getCatalog().catch(() => emptyCatalog()),
      ]);
      setBooks(shelf);
      setCatalog(organization);
      // Reopen whatever was being read, if it is still on the shelf. A path is
      // walked over several sittings; landing on the drop zone every launch
      // makes the reader find their place by hand.
      const last = resume.lastBookId;
      if (prefsRef.current.resume && last !== undefined && shelf.some((b) => b.id === last)) {
        setBookId(last);
      }
    })();
  }, [resume]);

  // The menu bar is the one surface our dictionary cannot reach
  useEffect(() => setMenuLocale(prefs.locale), [prefs.locale]);

  // A book closed mid-build would otherwise sit unfinished forever
  useEffect(() => {
    if (bookId) void resumeBook(bookId);
  }, [bookId]);

  // The shelf is read once at launch, so without this its progress is frozen
  // at whatever it was then — which read as "0 built" for the whole run.
  useEffect(() => onDeckStatus((s) => {
    setBooks((list) => list.map(
      (b) => (b.id === s.bookId ? { ...b, built: s.ready, complete: s.complete } : b),
    ));
  }), []);

  useEffect(() => {
    if (!bookId || !bundle?.path) return;
    const generation = bundle.path.generatedAt;
    let live = true;
    setChat(emptyCompanionView(bookId));
    void chatHistory(bookId).then((session) => {
      if (live && session.pathGeneratedAt === generation) {
        setChat((state) => state.bookId === bookId && !state.pendingTurn
          ? { ...state, messages: session.messages } : state);
      }
    }).catch((cause: unknown) => console.error('chatHistory', cause));
    return () => { live = false; };
  }, [bookId, bundle?.path?.generatedAt]);

  useEffect(() => onCompanionEvent((event) => {
    setChat((state) => applyCompanionEvent(state, event));
    if (event.type === 'final' || event.type === 'error') {
      void chatHistory(event.bookId).then((session) => {
        setChat((state) => state.bookId === event.bookId && !state.pendingTurn
          ? { ...state, messages: session.messages } : state);
      }).catch((cause: unknown) => console.error('chatHistory', cause));
    }
  }), []);

  const heat = useMemo(() => stationHeat(chat.messages.flatMap((message) =>
    message.role === 'user' && message.atNode
      ? [{ at: message.at, nodeId: message.atNode, question: message.text, grounded: true }]
      : [])), [chat.messages]);

  const path = bundle?.path;
  /** Where the reader stopped in this book, read once per book, before any render. */
  const place = useMemo(
    () => (prefs.resume && path ? resume.placeFor(path.bookId) : undefined),
    [prefs.resume, path, resume],
  );
  /** A book never played here starts where the reader stopped in WeChat Reading. */
  const [wereadAt, setWereadAt] = useState<{ readonly bookId: string; readonly nodeId?: string }>();
  const askWeread = prefs.resume && path !== undefined && place === undefined;
  useEffect(() => {
    if (!askWeread || !path) return;
    let live = true;
    void wereadStart(path.bookId).then((nodeId) => {
      if (live) setWereadAt({ bookId: path.bookId, ...(nodeId ? { nodeId } : {}) });
    });
    return () => { live = false; };
  }, [askWeread, path?.bookId]);
  const lookingUp = askWeread && inShell && wereadAt?.bookId !== path?.bookId;
  const fromWeread = wereadAt?.bookId === path?.bookId ? wereadAt?.nodeId : undefined;

  // The stored station is the fallback, not an effect that sets state afterwards:
  // setting it later would render — and start playing — the first station first.
  const node = useMemo(
    () => path?.nodes.find((n) => n.id === (currentId ?? place?.nodeId ?? fromWeread)) ?? path?.nodes[0],
    [path, currentId, place, fromWeread],
  );

  const step = useCallback((delta: number) => {
    if (!path || !node) return;
    const next = path.nodes[node.idx + delta];
    if (next) setCurrentId(next.id);
  }, [path, node]);

  // Build what the reader is about to reach, not what follows where they began.
  // Keyed on the station and on whether anything is left to build — not on the
  // bundle, which is a fresh object on every poll and would re-send every 2s.
  const building = bundle !== undefined && !bundle.complete;
  useEffect(() => {
    if (bookId && node && building) focusStation(bookId, node.id);
  }, [bookId, node, building]);

  useEffect(() => onOpenSettings(() => setSettingsOpen(true)), []);

  // Stations only. Transport keys (← → space) belong to the deck.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // ⌘, opens settings, as it does in every macOS app
      if (shortcuts.matches(e, ',')) {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      // ⌘B / ⌘J fold the side panes, as they do in an editor
      if (shortcuts.matches(e, 'b') || shortcuts.matches(e, 'j')) {
        e.preventDefault();
        (e.key === 'b' ? left : right).toggleCollapsed();
        return;
      }
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, left, right]);

  const askQuestion = useCallback((question: string) => {
    if (!node || !bookId) return;
    if (question.trim().toLowerCase() === CLEAR_COMMAND) {
      void chatClear(bookId)
        .then((cleared) => { if (cleared) setChat(emptyCompanionView(bookId)); })
        .catch((cause: unknown) => console.error('chatClear', cause));
      return;
    }
    const id = crypto.randomUUID();
    const sel = selection;
    setSelection(undefined);
    setChat((state) => beginCompanionTurn(state, id, question, sel, node.id));
    void chatSend({ turnId: id, bookId, nodeId: node.id, question, locale: prefs.locale, selection: sel })
      .then((started) => {
        if (!started) setChat((state) => applyCompanionEvent(state, {
          bookId, turnId: id, type: 'error', code: 'busy', message: t.companion.busy,
        }));
      })
      .catch((cause: unknown) => setChat((state) => applyCompanionEvent(state, {
        bookId, turnId: id, type: 'error', code: 'request_failed',
        message: cause instanceof Error ? cause.message : String(cause),
      })));
  }, [node, bookId, selection, prefs.locale, t.companion.busy]);

  /** Opening a book is what makes it the one to reopen next launch. */
  const openBook = useCallback((id: string) => {
    resume.open(id);
    setBookId(id);
  }, [resume]);

  const onAdded = useCallback((entry: LibraryEntry) => {
    setBooks((b) => [entry, ...b.filter((x) => x.id !== entry.id)]);
    setAdding(false);
    setCurrentId(undefined);
    setChat(emptyCompanionView(entry.id));
    if (entry.id === bookId) reload(); else openBook(entry.id);
  }, [bookId, reload, openBook]);

  /** Deleting drops the stored position too: re-adding the same file reuses its id. */
  const removeBook = useCallback(async (id: string) => {
    await deleteBook(id);
    setBooks((b) => b.filter((x) => x.id !== id));
    resume.forget(id);
  }, [resume]);

  const openDetails = useCallback((id: string, section: DetailsSection = 'overview') => {
    setFocusCatalogEditor(false);
    setDetails({ bookId: id, section });
    void bookMeta(id).then((meta) => {
      if (meta) setDetailsMeta((current) => ({ ...current, [id]: meta }));
    });
    setUniverseView({ bookId: id, state: { status: 'loading' } });
    void universeGet(id).then((next) => {
      setUniverseView((current) => current?.bookId === id
        ? { bookId: id, state: next ? { status: 'ready', universe: next } : { status: 'empty' } }
        : current);
    }).catch((cause: unknown) => {
      setUniverseView((current) => current?.bookId === id
        ? { bookId: id, state: { status: 'failed', message: errorText(payloadOf(cause), t) } }
        : current);
    });
  }, [t]);

  const buildUniverse = useCallback(async (id: string) => {
    const previous = universeView?.bookId === id ? universeView.state : undefined;
    const prior = previous && 'universe' in previous ? previous.universe : undefined;
    setUniverseView({ bookId: id, state: { status: 'building', ...(prior ? { universe: prior } : {}) } });
    try {
      const next = await universeBuild(id);
      setUniverseView((current) => current?.bookId === id
        ? { bookId: id, state: { status: 'ready', universe: next } }
        : current);
    } catch (cause) {
      setUniverseView((current) => current?.bookId === id
        ? {
          bookId: id,
          state: { status: 'failed', message: errorText(payloadOf(cause), t), ...(prior ? { universe: prior } : {}) },
        }
        : current);
    }
  }, [t, universeView]);

  const patchUniverse = useCallback(async (id: string, change: UniverseChange) => {
    try {
      const next = await universePatch(id, change);
      setUniverseView((current) => current?.bookId === id
        ? { bookId: id, state: { status: 'ready', universe: next } }
        : current);
    } catch (cause) {
      setUniverseView((current) => {
        if (current?.bookId !== id) return current;
        const prior = 'universe' in current.state ? current.state.universe : undefined;
        return {
          bookId: id,
          state: { status: 'failed', message: errorText(payloadOf(cause), t), ...(prior ? { universe: prior } : {}) },
        };
      });
    }
  }, [t]);

  const exportBookAudio = useCallback(async (id: string) => {
    await exportAudio(id);
  }, []);

  const exportBookSlides = useCallback(async (id: string) => {
    // Slides render from the open bundle only: exporting a book that is not on
    // screen would need a second loader for no real reader gain.
    if (!bundle || bundle.path.bookId !== id) throw new CairnError('no_audio');
    const html = await renderSlidesHtml(bundle.path, bundle.decks);
    if (!html) throw new CairnError('no_audio');
    await exportSlides(id, exportFileName(bundle.path.title, new Date().toISOString().slice(0, 10), 'html'), html);
  }, [bundle]);

  const saveCatalog = useCallback(async (id: string, patch: CatalogPatch) => {
    const next = await patchCatalog(id, patch);
    setCatalog(next);
    setEditingCatalog(undefined);
    setFocusCatalogEditor(true);
  }, []);

  const suggestCatalog = useCallback(async (id: string) => {
    const next = await suggestCatalogFor(id);
    setCatalog(next.catalog);
    return next.suggestion;
  }, []);

  const goHome = useCallback(() => {
    // Going back to the shelf is deliberate, so the next launch opens there too.
    // The position inside each book is kept.
    resume.close();
    setBookId(undefined);
    setCurrentId(undefined);
    if (chat.pendingTurn) void chatCancel(chat.pendingTurn);
    setChat(emptyCompanionView(''));
  }, [resume, chat.pendingTurn]);

  const detailBook = details ? books.find((book) => book.id === details.bookId) : undefined;

  const modal = (
    <>
      {adding && <AddBook autoPick onDone={onAdded} onClose={() => setAdding(false)} />}
      {settingsOpen && (
        <SettingsPanel shell={shell} onClose={() => setSettingsOpen(false)} />
      )}
      {editingCatalog ? (
        <CategoryEditor
          record={catalog.records[editingCatalog]}
          onSuggest={() => suggestCatalog(editingCatalog)}
          onSave={(patch) => saveCatalog(editingCatalog, patch)}
          onClose={() => {
            setEditingCatalog(undefined);
            setFocusCatalogEditor(true);
          }}
        />
      ) : details && detailBook && (
        <BookDetails
          book={detailBook}
          meta={detailsMeta[details.bookId]}
          record={catalog.records[details.bookId]}
          base={base}
          section={details.section}
          focusCatalogEditor={focusCatalogEditor}
          universeState={universeView?.bookId === details.bookId
            ? universeView.state
            : { status: 'loading' }}
          onBuildUniverse={() => buildUniverse(details.bookId)}
          onPatchUniverse={(change) => patchUniverse(details.bookId, change)}
          onExportAudio={() => exportBookAudio(details.bookId)}
          onExportSlides={() => exportBookSlides(details.bookId)}
          onEditCatalog={() => {
            setFocusCatalogEditor(false);
            setEditingCatalog(details.bookId);
          }}
          onClose={() => {
            setFocusCatalogEditor(false);
            setDetails(undefined);
          }}
        />
      )}
    </>
  );

  if (!bookId) {
    return (
      <div className="shell empty">
        <Home
          books={books}
          catalog={catalog}
          {...(base ? { base } : {})}
          onAdd={() => setAdding(true)}
          onOpen={openBook}
          onDetails={openDetails}
          onEditCatalog={(id) => { openDetails(id); setEditingCatalog(id); }}
          onBuildUniverse={(id) => openDetails(id, 'universe')}
          {...(inShell ? {
            onExportAudio: (id: string) => { void exportBookAudio(id).catch((cause: unknown) => console.error('exportAudio', cause)); },
            onExportSlides: (id: string) => { openBook(id); },
          } : {})}
          onSettings={() => setSettingsOpen(true)}
          {...(inShell ? { onDelete: removeBook } : {})}
        />
        {modal}
      </div>
    );
  }

  if (!bundle || !path || !node || lookingUp) {
    return (
      <div className="shell empty">
        <div className="deck-empty">
          {error ?? t.app.loading}
          <button type="button" className="ghost" onClick={goHome}>{t.app.backToShelf}</button>
        </div>
        {modal}
      </div>
    );
  }

  return (
    <div
      className={[
        'shell',
        left.state.collapsed ? 'left-off' : '',
        right.state.collapsed ? 'right-off' : '',
      ].filter(Boolean).join(' ')}
      style={{
        gridTemplateColumns:
          `${columnWidth(left.state)}px 1px 1fr 1px ${columnWidth(right.state)}px`,
      }}
    >
      {/* Both switches are pinned to the shell, not to the panes they control:
          a switch that moves when its pane folds is a switch you have to find
          again, and one that lives inside the pane vanishes with it. */}
      <PanelToggle
        control={{ collapsed: left.state.collapsed, toggle: left.toggleCollapsed }}
        side="left"
        label={t.panel.stagePane}
        hint={shortcuts.label('b')}
      />
      <PanelToggle
        control={{ collapsed: right.state.collapsed, toggle: right.toggleCollapsed }}
        side="right"
        label={t.panel.askPane}
        hint={shortcuts.label('j')}
      />

      <StagePane
        path={path}
        decks={bundle.decks}
        currentId={node.id}
        onPick={setCurrentId}
        books={books}
        onSwitchBook={(id) => { if (chat.pendingTurn) void chatCancel(chat.pendingTurn); openBook(id); setCurrentId(undefined); setChat(emptyCompanionView(id)); }}
        onDetails={() => openDetails(path.bookId)}
        onUniverse={() => openDetails(path.bookId, 'universe')}
        onAdd={inShell ? () => setAdding(true) : undefined}
        onHome={goHome}
        onSettings={() => setSettingsOpen(true)}
        failed={bundle.failed}
        heat={heat}
        complete={bundle.complete}
        collapsed={left.state.collapsed}
      />

      <Splitter split={left} label={t.panel.stagePane} />

      <DeckPane
        node={node}
        deck={bundle.decks.get(node.id)}
        build={bundle.failed.has(node.id) ? 'failed' : 'pending'}
        {...(inShell ? {
          onRetry: () => retryBook(path.bookId).then(() => undefined)
            .catch((cause: unknown) => console.error('retryBook', cause)),
        } : {})}
        audioSrc={`${base ?? '.'}/${audioFile(path.bookId, node.id)}`}
        stageTitle={path.stages.find((st) => st.nodeIds.includes(node.id))?.title}
        resumeAt={place}
        onSelect={setSelection}
        // The reader chose whether a finished chapter rolls into the next one
        onEnded={() => {
          if (node.kind === 'recap') {
            void markBookFinished(path.bookId, node.id).catch((cause: unknown) => console.error('markBookFinished', cause));
          }
          if (prefs.autoNext) step(1);
        }}
        onProgress={(ms) => resume.record(path.bookId, { nodeId: node.id, ms })}
      />

      <Splitter split={right} label={t.panel.askPane} />

      <CompanionPane
        messages={chat.messages}
        pending={chat.pendingTurn !== undefined}
        draftAnswer={chat.draft}
        error={chat.error}
        errorCode={chat.errorCode}
        onAsk={askQuestion}
        onCancel={() => { if (chat.pendingTurn) void chatCancel(chat.pendingTurn); }}
        onJumpToChapter={(chapter) => {
          const target = path.nodes.find((item) => item.sourceChapters.includes(chapter));
          if (target) setCurrentId(target.id);
          return target !== undefined;
        }}
        onOpenShelf={(id, nodeId) => { if (chat.pendingTurn) void chatCancel(chat.pendingTurn); openBook(id); setCurrentId(nodeId); setChat(emptyCompanionView(id)); }}
        selection={selection}
        onClearSelection={() => setSelection(undefined)}
        collapsed={right.state.collapsed}
      />

      {modal}
    </div>
  );
}
