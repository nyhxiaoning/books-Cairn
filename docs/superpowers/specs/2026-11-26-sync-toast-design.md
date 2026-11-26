# Sync status toast design

## Goal

Move the shelf-level cloud sync status out of the document flow so it does not
push or narrow the book shelf. The toast must remain useful for progress,
errors, and cloud-version conflicts.

## Behavior

- Render one fixed toast when the desktop shell has a non-disabled sync status.
- Keep the current localized status text and successful-sync timestamp.
- While syncing, show the existing single-book progress details inside the toast.
- Show a close button with an accessible label. Closing hides only the current
  status snapshot; a later status change shows the toast again.
- Keep conflict confirmation in the existing per-book sync action. The toast
  reports the conflict but does not silently overwrite or download anything.
- Do not add an auto-dismiss timer: sync progress and errors need to remain
  available until the reader dismisses them.

## Implementation boundary

- Replace the in-flow `ShelfSyncStatus` output in `apps/desktop/src/App.tsx`
  with a `SyncStatusToast` rendered alongside the home screen.
- Track dismissed status identity locally in the App. The identity is derived
  from sync state, message, progress phase, current book, and resource counts,
  so progress updates can refresh the visible toast.
- Add localized close-button copy only; existing sync messages remain unchanged.
- Add CSS in `packages/ui/src/app.css` for a fixed, layered toast that respects
  the existing tokens and remains usable at narrow widths.

## Verification

- Unit-test that the toast renders status and progress, closes, and reappears
  after a new status snapshot.
- Run the relevant desktop tests, all typechecks, and the desktop webview build.
- Verify the real Electrobun window because fixed positioning and shell status
  are not fully proven by the Vite bundle alone.
