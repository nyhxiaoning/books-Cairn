# Cloud Sync Progress Design

## Goal

Make Cloudflare book synchronization observable at book and resource level so a reader can see how many books have completed and identify the exact book, phase, and resource where a run is waiting or failing.

## Scope

- Add progress data to the existing main-process-to-webview sync status.
- Report progress while reading the cloud manifest, processing each book, uploading or downloading each resource, and installing a downloaded book.
- Render an overall progress bar, current book, current phase, and current resource in the settings page.
- Preserve the existing remote-first conflict behavior and the rule that chapter text, generation cache, and all MP3 audio never sync.
- Add tests for progress emission and the settings rendering.

## Data contract

`SyncStatus` gains an optional `progress` object:

- `totalBooks`: number of books in the current run.
- `completedBooks`: number of books whose processing finished successfully.
- `currentBookIndex`: one-based position in the current run.
- `currentBookId` and `currentBookTitle`: the book being processed.
- `phase`: `manifest`, `uploading`, `downloading`, `installing`, or `complete`.
- `completedResources` and `totalResources`: resource-level progress for the current book.
- `currentResourcePath`: the resource currently being transferred, when applicable.

The object is optional while the service is disabled or idle. On failure, the last progress object remains in the error status alongside the existing error message and failed book IDs.

## Data flow

The sync service emits progress immediately before and after each meaningful operation. A local-only book reports manifest upload followed by each non-audio resource upload. A cloud-only or changed book reports each non-audio resource download followed by local installation. MP3 files are excluded when building the local manifest and are never requested from R2. The UI receives the existing `syncStatus` message, so no new polling or renderer-to-worker access is needed.

The service counts the union of local and cloud book IDs once the cloud manifest is read. Books are processed in the existing order: remote books first, then local-only books. A failed book advances the overall run and remains in `failedBookIds`, allowing later books to continue.

## UI

When syncing, the settings page shows:

1. A percentage/progress bar based on completed books.
2. `completed / total` book count.
3. The current book title and its one-based position.
4. A translated phase label and resource count/path when a resource is active.

After an error, the last known current book and resource remain visible, followed by the existing retry control and failed-book count. When complete, the progress summary remains visible until the next run.

## Error handling

Progress reporting must not change sync failure semantics. A progress callback is bookkeeping only; an exception in the sync operation still marks that book as failed and allows the next book to run. MP3 filtering must happen at the shared sync allowlist so neither upload nor download can include audio. The final status is `success` only when no book or top-level operation failed.

## Verification

- Unit-test service progress for local upload, cloud download/install, and a failed resource.
- Unit-test the settings page with an active progress object and verify the book/resource details are rendered.
- Run `bun test`, all four typechecks, and `cd apps/desktop && bun run build`.
