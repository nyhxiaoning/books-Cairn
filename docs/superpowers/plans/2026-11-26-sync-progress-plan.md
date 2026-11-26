# Cloud Sync Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show overall book progress and current resource/phase details during Cloudflare sync, while excluding every MP3 file from the sync contract.

**Architecture:** Extend the existing sanitized `SyncStatus` RPC payload with optional progress data. The main-process sync service emits progress at book and resource boundaries; the renderer only displays the payload. Enforce MP3 exclusion in the shared core sync allowlist so export, Worker validation, upload, and download all use the same rule.

**Tech Stack:** TypeScript, Bun test, React, Electrobun RPC, Cloudflare Worker/D1/R2.

## Global Constraints

- Chapter text, `.cache`, traces, chats, source files, and MP3 audio never leave the local machine.
- Remote-first conflict behavior remains unchanged.
- The renderer must receive sanitized status only; it must not hold Worker credentials or tokens.
- Product-facing copy must be available in English and Chinese.
- Strict TypeScript, immutable domain values, and no `any` or non-null assertions.
- Preserve unrelated user changes in `README.zh-CN.md`, `apps/sync-worker/wrangler.jsonc`, and `cloudflare复盘记录文档/`.

---

### Task 1: Exclude MP3 from the shared sync allowlist

**Files:**
- Modify: `packages/core/src/sync/manifest.ts`
- Modify: `packages/core/tests/sync/manifest.test.ts`
- Modify: `apps/sync-worker/tests/sync/resources.test.ts`

**Interfaces:**
- `isSyncablePath(path)` and `syncContentType(path)` must return false/undefined for every `.mp3` path.
- Existing JSON and cover paths keep their current content types.

- [ ] **Step 1: Write the failing tests**

Add assertions that `isSyncablePath('audio/n0.mp3')` is false, `syncContentType('audio/n0.mp3')` is undefined, and `buildSyncManifest` excludes an MP3 file while retaining `path.json`, a deck, and a cover.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `bun test packages/core/tests/sync/manifest.test.ts`

Expected: the new MP3 assertions fail because the current allowlist accepts MP3 audio.

- [ ] **Step 3: Implement the minimal allowlist change**

Remove the MP3 branch from `contentTypeFor` and leave all other path rules unchanged. The Worker imports these shared rules, so no duplicate audio rule is introduced.

- [ ] **Step 4: Run focused tests**

Run: `bun test packages/core/tests/sync/manifest.test.ts apps/sync-worker/tests/sync/resources.test.ts`

Expected: PASS, including existing resource upload/download tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sync/manifest.ts packages/core/tests/sync/manifest.test.ts apps/sync-worker/tests/sync/resources.test.ts
git commit -m "fix: exclude audio from cloud sync"
```

### Task 2: Add progress to the shared status contract

**Files:**
- Modify: `apps/desktop/src/shared/schema.ts`
- Modify: `packages/ui/src/settings/shell.ts`
- Modify: `packages/ui/src/i18n/messages/en.ts`
- Modify: `packages/ui/src/i18n/messages/zh.ts`

**Interfaces:**
- Add `SyncProgressPhase = 'manifest' | 'uploading' | 'downloading' | 'installing' | 'complete'`.
- Add `SyncProgress` with `totalBooks`, `completedBooks`, `currentBookIndex`, `currentBookId`, `currentBookTitle`, `phase`, `completedResources`, `totalResources`, and optional `currentResourcePath`.
- Add `progress?: SyncProgress` to `SyncStatus` and `SyncStatusView`.
- Add bilingual labels for each phase and progress text.

- [ ] **Step 1: Add type-level expectations in tests**

Update the existing sync schema/UI test fixtures with a status containing `progress`, including one active resource path and each required counter.

- [ ] **Step 2: Run typecheck to verify the new fixture fails before the type exists**

Run: `bun run typecheck`

Expected: FAIL with missing `progress` types or translation keys.

- [ ] **Step 3: Implement the shared types and translations**

Define the readonly progress interfaces in the shared schema, mirror them in the UI shell view type, and add English/Chinese phase labels plus strings for `completed / total`, current book, and current resource.

- [ ] **Step 4: Run the relevant typechecks**

Run: `bun run typecheck`

Expected: PASS for all four projects.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/schema.ts packages/ui/src/settings/shell.ts packages/ui/src/i18n/messages/en.ts packages/ui/src/i18n/messages/zh.ts
git commit -m "feat: add sync progress status contract"
```

### Task 3: Emit book and resource progress from the sync service

**Files:**
- Modify: `apps/desktop/src/main/sync/service.ts`
- Modify: `apps/desktop/tests/main/sync/service.test.ts`

**Interfaces:**
- `SyncStatus.progress` is updated through the existing `emit` callback.
- Each sync run computes the union of cloud and local book IDs after fetching the manifest.

- [ ] **Step 1: Write failing service tests**

Add tests that capture emitted statuses and assert:

```ts
expect(progress.map((item) => item.phase)).toContain('uploading');
expect(progress.at(-1)?.completedBooks).toBe(1);
expect(progress.at(-1)?.totalResources).toBe(2);
expect(progress.some((item) => item.currentResourcePath === 'path.json')).toBe(true);
```

Add a download/install case and a failed resource case asserting the error status retains the last book and resource location.

- [ ] **Step 2: Run the focused service tests and verify failure**

Run: `bun test apps/desktop/tests/main/sync/service.test.ts`

Expected: FAIL because the service currently emits statuses without progress.

- [ ] **Step 3: Implement progress emission**

Add a local immutable progress variable inside `run`. Emit `manifest` before the cloud manifest fetch, then set the total book count. Before each book, emit its index/title and reset resource counters. Before every upload/download emit the phase and path; after each resource increment `completedResources`. After installation and successful book processing increment `completedBooks`. On failure, preserve the latest progress in the error status. Use filtered sync files so MP3s are not counted or transferred.

- [ ] **Step 4: Run the focused service tests**

Run: `bun test apps/desktop/tests/main/sync/service.test.ts`

Expected: PASS with upload, download, and failure progress coverage.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/sync/service.ts apps/desktop/tests/main/sync/service.test.ts
git commit -m "feat: report sync book progress"
```

### Task 4: Render progress and stuck-resource details in Settings

**Files:**
- Modify: `packages/ui/src/settings/SyncPage.tsx`
- Modify: `packages/ui/tests/settings/SyncPage.test.tsx`

**Interfaces:**
- Consume `shell.sync.status.progress` without adding a new RPC or polling loop.
- Render progress for syncing, success, and error states.

- [ ] **Step 1: Write the failing UI test**

Provide a status with `completedBooks: 2`, `totalBooks: 18`, current title `测试书`, phase `uploading`, and path `decks/n3.json`; assert the rendered output contains `2/18`, the title, the phase label, and the resource path.

- [ ] **Step 2: Run the focused UI test and verify failure**

Run: `bun test packages/ui/tests/settings/SyncPage.test.tsx`

Expected: FAIL because the page currently renders only the generic status message.

- [ ] **Step 3: Implement the progress display**

Add a native progress bar with a clamped percentage based on completed books, book counters, current title, translated phase, and resource counter/path. Keep the last progress visible for an error status and retain the existing retry and failed-book controls. Avoid exposing tokens or passwords.

- [ ] **Step 4: Run the focused UI test**

Run: `bun test packages/ui/tests/settings/SyncPage.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/settings/SyncPage.tsx packages/ui/tests/settings/SyncPage.test.tsx
git commit -m "feat: show sync progress in settings"
```

### Task 5: Run the complete verification suite

**Files:**
- No source changes expected.

- [ ] **Step 1: Run all tests**

Run: `bun test`

Expected: all tests pass.

- [ ] **Step 2: Run all four typechecks**

Run: `bun run typecheck`

Expected: core, UI, desktop webview, and desktop main all pass.

- [ ] **Step 3: Build the desktop webview**

Run: `cd apps/desktop && bun run build`

Expected: build succeeds; only the existing chunk-size warning may remain.

- [ ] **Step 4: Check the diff and repository state**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and only the intended implementation commits plus the user-owned files remain.

- [ ] **Step 5: Commit any required verification-only fix**

If verification reveals a real defect, add a focused regression test and commit it with a conventional message; otherwise leave the tree unchanged.
