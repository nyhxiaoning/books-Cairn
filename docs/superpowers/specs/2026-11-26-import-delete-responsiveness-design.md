# Import and Delete Responsiveness Design

## Goal

Make book import and deletion feel responsive for large books and partially built
books. Import must expose meaningful progress and remain cancellable. Deletion must
remove the book from the shelf promptly while safely finishing filesystem and derived
data cleanup in the background.

The existing partial-generation cache and resume behavior remains unchanged for an
import that is cancelled or interrupted. A confirmed deletion is different: it removes
the book and its partial data permanently, subject only to the short-lived cleanup
staging area.

## Task lifecycle

### Import

`activeImport` remains the single process-scoped import controller. Both preview parsing
and generation use it. Parsing gains an optional progress callback and checks the
abort signal at natural boundaries. Generation keeps its existing stage progress and
five-minute stalled-progress watchdog.

The parser returns the same complete `ParsedBook` as today. Progress is observational;
it does not change budget calculation, chapter ordering, cache keys, or the pipeline
data model.

### Delete

Deletion has three ordered phases:

1. Stop the book scheduler and prevent new deck work from starting.
2. Atomically delist the book and move its book directory and generation cache into a
   data-directory cleanup area.
3. Return success to the RPC caller. A background cleanup task removes the staged
   files, catalog record, and universe links.

The UI removes the row after phase 2, so its response time is independent of audio/cache
size and universe relinking. A cleanup record survives process restart. Startup retries
pending cleanup records and removes a record only after the staged files are gone.

If stopping the scheduler or staging either directory fails, the book remains listed and
the RPC reports failure. Derived-data cleanup is best effort after a successful delist;
failure is logged and retried without restoring the book to the shelf.

The scheduler stop path must not allow an in-flight deck install to recreate or mutate
the staged book directory. The implementation should use the existing cancellation
boundary and make the install path reject work for a deleted book.

## Progress and UI

Preview parsing reports format-appropriate progress:

- PDF: pages processed out of total pages.
- EPUB/DOCX/MOBI: archive/content units processed where the format exposes them.
- TXT/Markdown: bounded text chunks processed, with event-loop yields between chunks.

The progress signature is monotonic within a phase. AddBook shows parsing progress and
retains the existing five-minute no-change cancellation affordance. Cancelling an import
closes the current import UI and does not remove any previously installed partial book.

Deletion confirmation uses explicit deleting/removing copy while the RPC is pending. Once
staging succeeds, the confirmation row disappears immediately because the parent removes
the book from local state. Background cleanup has no blocking UI state.

## Error handling

- Invalid or unsafe book ids are rejected before filesystem work.
- A cancellation is reported as the existing `cancelled` error and never installs a
  preview or a new path.
- Cleanup failures do not re-add a successfully deleted book. They leave a retryable
  cleanup record and log the book id and cause.
- Catalog and universe maintenance remain derived operations. Their failures are logged,
  not allowed to turn a successful filesystem deletion into a visible failure.

## Testing and verification

Add tests at the real seams:

- parser progress is emitted in order and cancellation stops parsing before returning a
  book;
- deletion stages the book and returns without waiting for long-running scheduler work;
- a staged cleanup is retried after failure and removed after success;
- cancelled imports do not install a path while existing partial data still resumes;
- the desktop handler returns deletion success without waiting for universe relink.

Run the focused tests first, then `bun test`, `bun run typecheck`, and
`cd apps/desktop && bun run build`. Finally verify the import and delete flows in the
real Electrobun shell with the Cairn desktop verification skill.

## Scope boundaries

This change does not alter budget arithmetic, cache-key derivation, narration behavior,
the library data model visible to the player, or any network behavior. It does not add
OCR, sync, or a general job framework; the cleanup record is limited to deletion recovery.
