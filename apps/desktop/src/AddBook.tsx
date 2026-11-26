import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { BudgetId } from '@cairn/core/pipeline/budget';
import type { LibraryEntry } from '@cairn/core/store/library';
import { errorText, useT } from '@cairn/ui';
import { payloadOf } from '@cairn/core/errors';
import { cancelGenerateBook, generateBook, onProgress, pickBook, progressNow, wereadQuotes } from './bridge';
import { QuoteCycle } from './QuoteCycle';
import { VOICES } from './shared/settings';
import type { BookPreview, Progress } from './shared/types';

/** The voice's own name, without repeating the language beside it. */
function voiceName(id: string): string {
  return Object.values(VOICES).flat().find((v) => v.id === id)?.name ?? id;
}

/** Slow enough to be free, fast enough that a finished batch shows up promptly. */
const POLL_MS = 1500;
const STALL_MS = 5 * 60_000;

/**
 * Adding a book, in three steps: pick a file, choose how long you want to spend,
 * then watch it build. The budget choice comes after parsing so it can be made
 * knowing how long the book actually is.
 */
export function AddBook({
  onDone, onClose, autoPick = false,
}: {
  onDone: (entry: LibraryEntry) => void;
  onClose: () => void;
  /** Opened from the drop zone, where picking a file was already the click. */
  autoPick?: boolean;
}): ReactElement {
  const t = useT();
  const [preview, setPreview] = useState<BookPreview>();
  const [progress, setProgress] = useState<Progress>();
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string>();
  const [quotes, setQuotes] = useState<readonly string[]>([]);
  const [stalled, setStalled] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const lastProgressAt = useRef(0);
  const progressSignature = useRef<string | undefined>(undefined);
  const cancelRequested = useRef(false);
  /** The native dialog is not idempotent: opening it twice stacks two windows. */
  const picked = useRef(false);

  const polling = parsing || (progress !== undefined && progress.stage !== 'done');

  const observeProgress = (next: Progress): void => {
    const signature = `${next.stage}:${next.done}:${next.total}:${next.note ?? ''}`;
    if (signature !== progressSignature.current) {
      progressSignature.current = signature;
      lastProgressAt.current = Date.now();
      setStalled(false);
    }
    setProgress(next);
  };

  useEffect(() => onProgress(observeProgress), []);

  // Fetched while the budget is being chosen, so they are there when the wait starts
  useEffect(() => {
    if (!preview) return;
    let live = true;
    void wereadQuotes(preview.title, preview.author).then((q) => { if (live) setQuotes(q); });
    return () => { live = false; };
  }, [preview]);

  // A run takes minutes; one dropped message would freeze the bar for all of it
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      if (Date.now() - lastProgressAt.current >= STALL_MS) setStalled(true);
      void progressNow().then((p) => { if (p) observeProgress(p); });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling]);

  useEffect(() => {
    // Mount only, and only once: StrictMode runs mount effects twice in dev, and
    // a second openFileDialog puts a second native window over the first.
    if (!autoPick || picked.current) return;
    picked.current = true;
    void pick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (): Promise<void> => {
    setError(undefined);
    cancelRequested.current = false;
    progressSignature.current = 'parsing';
    lastProgressAt.current = Date.now();
    setStalled(false);
    setParsing(true);
    try {
      const chosen = await pickBook();
      // Cancelling the dialog is not an error; close rather than sit on a dead screen
      if (chosen) setPreview(chosen); else if (autoPick) onClose();
    } catch (e) {
      if (cancelRequested.current) return;
      setError(errorText(payloadOf(e), t));
    } finally {
      setParsing(false);
    }
  };

  const run = async (budgetId: BudgetId): Promise<void> => {
    if (!preview) return;
    setError(undefined);
    cancelRequested.current = false;
    progressSignature.current = undefined;
    observeProgress({ stage: 'map', done: 0, total: 1 });
    try {
      onDone(await generateBook(preview.filePaths, budgetId));
    } catch (e) {
      if (cancelRequested.current) return;
      setError(errorText(payloadOf(e), t));
      setProgress(undefined);
    }
  };

  const cancel = async (): Promise<void> => {
    cancelRequested.current = true;
    setCancelling(true);
    await cancelGenerateBook().catch(() => false);
    setProgress(undefined);
    setStalled(false);
    setCancelling(false);
    onClose();
  };

  const running = progress !== undefined;

  return (
    <div className="modal-scrim" onClick={running ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {!preview && !running && (
          <>
            <h2>{t.add.title}</h2>
            <p className="modal-sub">
              {/* A 14 MB EPUB takes a moment to parse, and a frozen dialog looks broken */}
              {parsing ? t.add.parsing : t.add.supported}
            </p>
            <button type="button" className="primary" onClick={pick} disabled={parsing}>
              {parsing ? t.add.picking : t.add.pick}
            </button>
            {parsing && stalled && (
              <button type="button" className="ghost" disabled={cancelling} onClick={() => void cancel()}>
                {cancelling ? t.add.cancelling : t.add.cancelUpload}
              </button>
            )}
          </>
        )}

        {preview && !running && (
          <>
            <h2>{preview.title}</h2>
            <p className="modal-sub">
              {preview.author ? `${preview.author} · ` : ''}
              {t.unit.count(preview.chapters)} · {t.unit.words(preview.words)}
            </p>
            {/* Before the budget, because it is the one decision that cannot be
                changed afterwards without rebuilding the whole book. */}
            <p className="modal-narration">
              {t.add.narratedIn(
                t.add.languageName[preview.narration.locale],
                voiceName(preview.narration.voice),
              )}
            </p>
            <p className="modal-label">{t.add.howLong}</p>
            <div className="budget-list">
              {preview.budgets.map((b) => (
                <button
                  type="button"
                  key={b.id}
                  className={b.recommended ? 'budget recommended' : 'budget'}
                  onClick={() => void run(b.id)}
                >
                  <span className="budget-label">
                    {t.add.budgetLabel(
                      t.unit.duration(b.minutes),
                      t.settings.narration.budgets[b.id],
                    )}
                    {b.recommended && <em>{t.add.recommended}</em>}
                  </span>
                  {/* A budget that would distort this book is offered, but labelled */}
                  {!b.honest && b.wordsPerNode !== undefined && (
                    <span className="budget-note">⚠ {t.add.budgetWarning(b.wordsPerNode)}</span>
                  )}
                </button>
              ))}
            </div>
            <button type="button" className="ghost" onClick={() => setPreview(undefined)}>
              {t.add.another}
            </button>
          </>
        )}

        {running && progress && (
          <>
            <h2>{preview?.title ?? t.add.generating}</h2>
            <p className="modal-sub">
              {t.add.stages[progress.stage]}
              {progress.total > 1 && ` · ${progress.done}/${progress.total}`}
            </p>
            <div className="prog">
              <i style={{ width: `${pct(progress)}%` }} />
            </div>
            <QuoteCycle quotes={quotes} fallback={t.add.note} />
            {stalled && (
              <button type="button" className="ghost" disabled={cancelling} onClick={() => void cancel()}>
                {cancelling ? t.add.cancelling : t.add.cancelUpload}
              </button>
            )}
          </>
        )}

        {error && <p className="modal-error">{error}</p>}
      </div>
    </div>
  );
}

/** Weight the stages by how long they actually take, so the bar does not stall. */
function pct(p: Progress): number {
  const spans: Record<Progress['stage'], [number, number]> = {
    map: [0, 55], classify: [55, 60], reduce: [60, 68], decks: [68, 100], done: [100, 100],
  };
  const [from, to] = spans[p.stage];
  const within = p.total > 0 ? p.done / p.total : 0;
  return Math.round(from + (to - from) * within);
}
