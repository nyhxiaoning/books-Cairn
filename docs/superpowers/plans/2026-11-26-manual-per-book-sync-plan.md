# Manual Per-Book Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace automatic whole-shelf Cloudflare sync with explicit per-book sync actions and display each book's latest successful sync time.

**Architecture:** Keep cloud transfer logic in the main-process sync service, but parameterize a run by one validated book ID. Store the successful timestamp in the local library entry and expose a typed `syncBook` bridge method. Add the action and timestamp to the existing shelf row/menu, while removing all automatic and global sync callers.

**Tech Stack:** TypeScript, Bun test, React, Electrobun RPC, existing Cloudflare Worker sync client.

## Global Constraints

- Never sync chapter text, cache, traces, chats, source files, or MP3 audio.
- Do not upload, download, or process books other than the selected book.
- Keep remote-first conflict behavior unchanged.
- Preserve the selected book's previous timestamp on failure.
- Keep credentials and session tokens in the main process only.
- Product copy must be present in English and Chinese.
- Preserve user-owned changes in `README.zh-CN.md`, `apps/sync-worker/wrangler.jsonc`, and `cloudflare复盘记录文档/`.

---

### Task 1: Add local per-book sync timestamp

**Files:**
- Modify: `packages/core/src/store/library.ts`
- Modify: `packages/core/tests/store/library.test.ts`
- Modify: `packages/core/src/sync/local.ts`

**Interfaces:**
- `LibraryEntry.lastSyncedAt?: string` is optional and remains local-only.
- `entryFromManifest` does not copy a cloud timestamp into the manifest contract.

- [ ] **Step 1: Write the failing test**

Add a library entry fixture with `lastSyncedAt`, normalize it, and assert the field survives. Add a sync bundle assertion that the manifest does not contain `lastSyncedAt`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `bun test packages/core/tests/store/library.test.ts packages/core/tests/sync/local.test.ts`

Expected: FAIL because the field is not part of the local entry type or manifest conversion.

- [ ] **Step 3: Implement the local-only field**

Add the optional field to `LibraryEntry`, preserve it through normalization/storage, and leave `SyncManifest` unchanged. Ensure `entryFromManifest` creates a local entry without inventing a timestamp.

- [ ] **Step 4: Run focused tests**

Run: `bun test packages/core/tests/store/library.test.ts packages/core/tests/sync/local.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/store/library.ts packages/core/tests/store/library.test.ts packages/core/src/sync/local.ts
git commit -m "feat: record per-book sync timestamps"
```

### Task 2: Make sync service operate on one book

**Files:**
- Modify: `apps/desktop/src/main/sync/service.ts`
- Modify: `apps/desktop/tests/main/sync/service.test.ts`

**Interfaces:**
- Add `syncBook(bookId: string): Promise<SyncSummary>` to the returned service.
- The run fetches the cloud manifest for authentication and version data, then processes only the selected local/cloud book.

- [ ] **Step 1: Write failing service tests**

Add tests proving a selected local book uploads while another local book is untouched, a selected cloud book installs while another cloud book is untouched, and a successful run updates only the selected entry's `lastSyncedAt`.

- [ ] **Step 2: Run the focused service tests and verify failure**

Run: `bun test apps/desktop/tests/main/sync/service.test.ts`

Expected: FAIL because the service has only whole-shelf `syncNow` behavior and does not write timestamps.

- [ ] **Step 3: Implement `syncBook`**

Validate that the book exists locally or in the cloud manifest, set progress totals to one book, reuse the existing upload/download conflict paths for the target only, and call `library.patchEntry(bookId, { lastSyncedAt: new Date().toISOString() })` only after all transfers/install steps succeed. Preserve the previous value on any exception. Keep `syncNow` internal only if needed by tests during the transition, but do not expose it to UI callers.

- [ ] **Step 4: Run focused service tests**

Run: `bun test apps/desktop/tests/main/sync/service.test.ts`

Expected: PASS with one-book isolation and timestamp coverage.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/sync/service.ts apps/desktop/tests/main/sync/service.test.ts
git commit -m "feat: sync one selected book"
```

### Task 3: Change the RPC and remove automatic sync triggers

**Files:**
- Modify: `apps/desktop/src/shared/schema.ts`
- Modify: `apps/desktop/src/bridge.ts`
- Modify: `apps/desktop/src/main/rpc.ts`
- Modify: `apps/desktop/src/useShellSettings.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/tests/sync-triggers.test.tsx`

**Interfaces:**
- Add `syncBook: { params: { bookId: string }; response: SyncSummary }` to the RPC schema and bridge.
- Replace `ShellSettings.sync.syncNow` with `syncBook(bookId)`.

- [ ] **Step 1: Write failing trigger tests**

Assert that shelf mount, login completion, book generation completion, and deck-ready messages do not call a sync method. Add an RPC/bridge fixture for `syncBook`.

- [ ] **Step 2: Run focused trigger tests and verify failure**

Run: `bun test apps/desktop/tests/sync-triggers.test.tsx apps/desktop/tests/main/rpc.test.ts`

Expected: FAIL because the current app invokes `syncNow` at startup, login, generation, and deck-ready events.

- [ ] **Step 3: Implement the new bridge contract**

Add the typed request and bridge helper, route it to `sync.syncBook`, remove automatic calls from `App.tsx` and `rpc.ts`, and remove the global `syncNow` method from `useShellSettings` and the settings shell interface.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `bun test apps/desktop/tests/sync-triggers.test.tsx apps/desktop/tests/main/rpc.test.ts && bun run typecheck`

Expected: PASS for all trigger tests and all four typechecks.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/schema.ts apps/desktop/src/bridge.ts apps/desktop/src/main/rpc.ts apps/desktop/src/useShellSettings.ts apps/desktop/src/App.tsx apps/desktop/tests/sync-triggers.test.tsx
git commit -m "fix: stop automatic whole-shelf sync"
```

### Task 4: Add per-book action and timestamp display

**Files:**
- Modify: `apps/desktop/src/Home.tsx`
- Modify: `apps/desktop/src/BookActions.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `packages/ui/src/i18n/messages/en.ts`
- Modify: `packages/ui/src/i18n/messages/zh.ts`
- Modify: relevant shelf tests under `apps/desktop/tests/`

**Interfaces:**
- `Home` receives `onSyncBook?: (bookId: string) => Promise<void>` and the current sync status/book ID.
- `BookActions` receives an optional `onSync` and disables it while that book is active.

- [ ] **Step 1: Write failing shelf tests**

Render a book with `lastSyncedAt` and assert the timestamp appears. Assert the action menu exposes the per-book sync action, invokes the selected ID, and disables the action when that ID is active.

- [ ] **Step 2: Run focused shelf tests and verify failure**

Run: `bun test apps/desktop/tests/rename.test.tsx apps/desktop/tests/sync-triggers.test.tsx`

Expected: FAIL because the shelf has no sync action or timestamp rendering.

- [ ] **Step 3: Implement the shelf UI**

Add localized action text and timestamp text, pass a per-book sync callback from `App`, update the in-memory `books` list after successful sync, and show the existing progress/error status for the selected book without changing unrelated shelf actions.

- [ ] **Step 4: Run focused UI tests**

Run: `bun test apps/desktop/tests/rename.test.tsx apps/desktop/tests/sync-triggers.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/Home.tsx apps/desktop/src/BookActions.tsx apps/desktop/src/App.tsx packages/ui/src/i18n/messages/en.ts packages/ui/src/i18n/messages/zh.ts apps/desktop/tests
git commit -m "feat: add per-book sync action"
```

### Task 5: Remove the global sync control and update documentation

**Files:**
- Modify: `packages/ui/src/settings/SyncPage.tsx`
- Modify: `packages/ui/tests/settings/SyncPage.test.tsx`
- Modify: `docs/CLOUDFLARE_SYNC.md`
- Modify: `apps/sync-worker/README.md`

- [ ] **Step 1: Write the failing settings test**

Assert the settings page still shows configuration/login/status but no longer renders a whole-shelf “Sync now” control, and explains that books are synced from the shelf action.

- [ ] **Step 2: Implement the settings change and docs**

Remove the global button, keep current one-book progress/error details, and document that sync is manual per book with `lastSyncedAt` local to the desktop library.

- [ ] **Step 3: Run focused tests**

Run: `bun test packages/ui/tests/settings/SyncPage.test.tsx`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/settings/SyncPage.tsx packages/ui/tests/settings/SyncPage.test.tsx docs/CLOUDFLARE_SYNC.md apps/sync-worker/README.md
git commit -m "docs: explain manual per-book sync"
```

### Task 6: Run complete verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run full tests**

Run: `bun test`

Expected: all tests pass.

- [ ] **Step 2: Run all typechecks**

Run: `bun run typecheck`

Expected: core, UI, desktop webview, and desktop main all pass.

- [ ] **Step 3: Build the desktop app**

Run: `cd apps/desktop && bun run build`

Expected: build succeeds.

- [ ] **Step 4: Check the diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only intended commits plus user-owned files remain.
