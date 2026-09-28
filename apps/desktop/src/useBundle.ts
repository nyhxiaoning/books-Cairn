import { CairnError } from '@cairn/core/errors';
import { useCallback, useEffect, useRef, useState } from 'react';
import { bookFile, type DeckIndex, deckFile, deckIndexFile } from '@cairn/core/store/library';
import type { NodeDeck, Path } from '@cairn/core/types';
import { onDeckStatus } from './bridge';

export interface Bundle {
  readonly path: Path;
  readonly decks: ReadonlyMap<string, NodeDeck>;
  /** Stations that will never arrive, so the UI can say so instead of spinning. */
  readonly failed: ReadonlySet<string>;
  readonly complete: boolean;
}

/** While a book is still being built, ask again this often. */
const POLL_MS = 2000;

/** What books generated before the per-station split still carry. */
const LEGACY_DECKS = 'decks-ordered.json';

/**
 * Loads one generated book from the local library. Nothing leaves the machine.
 *
 * The path arrives first and the decks trickle in behind it, so this hook has to
 * keep looking rather than load once. Readiness travels as a plain file next to
 * the decks rather than over RPC, which means the same code works in
 * `bun run dev`, where there is no main process to ask.
 */
export function useBundle(bookId: string | undefined, base: string | undefined): {
  bundle: Bundle | undefined;
  error: string | undefined;
  reload: () => void;
} {
  const [bundle, setBundle] = useState<Bundle>();
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);

  /** Decks already fetched, so a poll only asks for what is new. */
  const loaded = useRef(new Map<string, NodeDeck>());
  /** Set once the path is in hand, so a pushed status can pull the new decks. */
  const syncNow = useRef<() => void>(() => undefined);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!bookId || !base) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    loaded.current = new Map();
    setBundle(undefined);
    setError(undefined);

    const sync = async (path: Path): Promise<void> => {
      const index = await fetchJson<DeckIndex>(base, deckIndexFile(bookId)).catch(() => undefined);

      // No readiness list means a book generated before decks were split into
      // one file per station. Those are finished by definition, and their decks
      // are still in the single array — read it rather than showing every
      // station as pending forever.
      if (!index) {
        const legacy = await fetchJson<NodeDeck[]>(base, bookFile(bookId, LEGACY_DECKS))
          .catch(() => [] as NodeDeck[]);
        if (!live) return;
        for (const deck of legacy) loaded.current.set(deck.nodeId, deck);
        setBundle({
          path, decks: new Map(loaded.current), failed: new Set(), complete: true,
        });
        return;
      }

      const missing = index.ready.filter((id) => !loaded.current.has(id));

      const fetched = await Promise.all(
        missing.map(async (id) =>
          [id, await fetchJson<NodeDeck>(base, deckFile(bookId, id)).catch(() => undefined)] as const),
      );
      if (!live) return;

      for (const [id, deck] of fetched) if (deck) loaded.current.set(id, deck);

      setBundle({
        path,
        decks: new Map(loaded.current),
        failed: new Set(index.failed),
        complete: index.complete,
      });

      if (!index.complete) timer = setTimeout(() => void sync(path), POLL_MS);
    };

    void (async () => {
      try {
        const path = await fetchJson<Path>(base, bookFile(bookId, 'path.json'));
        if (!live) return;
        syncNow.current = () => {
          if (timer) clearTimeout(timer);
          void sync(path);
        };
        await sync(path);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();

    return () => {
      live = false;
      syncNow.current = () => undefined;
      if (timer) clearTimeout(timer);
    };
  }, [bookId, base, nonce]);

  // The poll is what guarantees a station is never missed; this only makes it
  // feel immediate. It pulls the new decks in rather than reloading the book,
  // which would drop everything already fetched and flash the loading state.
  useEffect(() => onDeckStatus((s) => {
    if (s.bookId === bookId) syncNow.current();
  }), [bookId]);

  return { bundle, error, reload };
}

/**
 * Load one book's full bundle outside the hook's lifecycle — the slides export
 * needs the decks of a book the player may not have open. Same files, same
 * legacy handling, just one shot instead of a poll.
 */
export async function loadBundle(bookId: string, base: string): Promise<Bundle> {
  const index = await fetchJson<DeckIndex>(base, deckIndexFile(bookId)).catch(() => undefined);
  const path = await fetchJson<Path>(base, bookFile(bookId, 'path.json'));
  if (!index) {
    const legacy = await fetchJson<NodeDeck[]>(base, bookFile(bookId, LEGACY_DECKS))
      .catch(() => [] as NodeDeck[]);
    return { path, decks: new Map(legacy.map((deck) => [deck.nodeId, deck])), failed: new Set(), complete: true };
  }
  const fetched = await Promise.all(
    index.ready.map(async (id) =>
      [id, await fetchJson<NodeDeck>(base, deckFile(bookId, id)).catch(() => undefined)] as const),
  );
  const decks = new Map(fetched.flatMap(([id, deck]) => (deck ? [[id, deck] as const] : [])));
  return { path, decks, failed: new Set(index.failed), complete: index.complete };
}

async function fetchJson<T>(base: string, path: string): Promise<T> {
  const res = await fetch(`${base}/${path}`);
  if (!res.ok) throw new CairnError('bundle_failed', { path, status: res.status });
  return res.json() as Promise<T>;
}
