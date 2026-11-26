# Manual Per-Book Cloud Sync Design

## Goal

Replace automatic whole-shelf synchronization with an explicit per-book action, and show each book's latest successful sync time.

## Behavior

- Startup, login, book generation, and deck-ready events never start cloud sync.
- The shelf's book action menu gets `Sync this book`.
- The action synchronizes only the selected book. The existing remote-first conflict rule remains unchanged.
- The settings page keeps Worker configuration, login, and current status, but no longer offers a whole-shelf sync action.
- A successful sync writes `lastSyncedAt` into that book's local library entry. A failed or cancelled sync does not change it.
- The shelf renders the timestamp per book; a later successful sync replaces it.
- The current book's resource progress remains visible while that book is syncing, including the resource path on failure.

## Data model and RPC

`LibraryEntry` gains optional `lastSyncedAt?: string`. It is local bookkeeping and is not included in `SyncManifest`, so it never leaves the desktop.

The sync service exposes `syncBook(bookId): Promise<SyncSummary>`. The RPC bridge and UI shell expose the same operation. `syncNow` is removed from user-facing controls and automatic callers; no whole-shelf synchronization remains in the desktop flow.

The sync status keeps the existing progress payload, but a manual run has `totalBooks: 1` and `currentBookId` equal to the selected book. A successful result updates the selected local library entry before the RPC resolves so the shelf can refresh immediately.

## UI

Each shelf book's three-dot action menu contains the manual sync action. While that book is active, the action is disabled and displays the existing busy state. The shelf row displays the last successful sync time below the book metadata when present.

The settings page displays the connection state and current one-book progress, but does not show a global sync button. The status bar may still offer retry for the failed current book through the same per-book operation only when the failed book is known.

## Error handling

- An unknown book ID is rejected before network work.
- Only the selected book is processed; other local or cloud books are not uploaded, downloaded, or installed.
- A failed run preserves the existing local book and its previous `lastSyncedAt`.
- Logging out clears authentication but does not erase per-book sync timestamps.

## Verification

- Test that startup/login/generation/deck-ready paths do not call sync.
- Test `syncBook` uploads or downloads exactly one book and updates its timestamp only after success.
- Test failed sync retains the previous timestamp.
- Test the shelf renders the action and timestamp, and disables the action for the active book.
- Run `bun test`, all four typechecks, and `cd apps/desktop && bun run build`.
