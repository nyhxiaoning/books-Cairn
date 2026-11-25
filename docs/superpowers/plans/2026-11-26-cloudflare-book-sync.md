# Cloudflare Book Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-admin Cloudflare Worker/D1/R2 backend and integrate automatic, cloud-preferred bookshelf synchronization into the Cairn desktop app without uploading chapter text or generation cache.

**Architecture:** The Worker is the only component that talks to D1 and R2. D1 stores the admin account, sessions, manifests, versions, tombstones, and progress; R2 stores allowlisted playable book resources. Cairn's main process owns the HTTPS client, session token, and sync queue, exposes sanitized state over typed RPC, and keeps local playback independent of network availability.

**Tech Stack:** TypeScript, Bun tests, Cloudflare Workers, D1 SQLite, R2, Wrangler, Electrobun RPC, React, Cairn core `Library` store.

## Global Constraints

- Do not upload `chapters.json`, source files, `.cache`, model traces, companion conversations, or pipeline job state.
- Do not put a Cloudflare API token, admin password, or session token in source control, `wrangler.jsonc`, logs, or renderer state.
- Keep all process-scoped services constructed in `apps/desktop/src/main/index.ts`.
- Keep `packages/core` free of framework imports and keep renderer-imported modules free of `node:*` imports.
- Preserve offline local playback and make synchronization failure non-fatal to book generation.
- Use cloud-preferred conflict resolution with monotonic book versions and tombstones.
- Product-facing strings must be added to both Chinese and English dictionaries.
- Run focused tests after each task; before completion run `bun test`, all four typechecks, and `cd apps/desktop && bun run build`.

---

### Task 1: Add the Cloudflare Worker package and deployment skeleton

**Files:**
- Create: `apps/sync-worker/package.json`
- Create: `apps/sync-worker/tsconfig.json`
- Create: `apps/sync-worker/wrangler.jsonc`
- Create: `apps/sync-worker/src/index.ts`
- Create: `apps/sync-worker/tests/health.test.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces `GET /api/health` returning `{ ok: true, database: 'd1' }` when the D1 binding is available.
- Produces typed Worker environment bindings: `DB: D1Database`, `BOOKS: R2Bucket`, `SESSION_SECRET: string`.

- [ ] **Step 1: Write the failing health test**

```ts
test('health reports the configured storage bindings', async () => {
  const response = await app.fetch(new Request('https://cairn.test/api/health'), testEnv);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, database: 'd1', storage: 'r2' });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `bun test apps/sync-worker/tests/health.test.ts`
Expected: FAIL because `apps/sync-worker/src/index.ts` does not exist.

- [ ] **Step 3: Implement the minimal Worker entrypoint**

Export `app` with a fetch handler that checks the pathname, returns the health JSON, and returns a JSON 404 for all other paths. Define the environment type and bindings in `wrangler.jsonc` without real IDs or secrets.

- [ ] **Step 4: Run the focused test**

Run: `bun test apps/sync-worker/tests/health.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/sync-worker package.json .gitignore
git commit -m "feat: add Cloudflare sync worker skeleton"
```

### Task 2: Create D1 migrations and password/session primitives

**Files:**
- Create: `apps/sync-worker/migrations/0001_sync.sql`
- Create: `apps/sync-worker/src/auth/password.ts`
- Create: `apps/sync-worker/src/auth/session.ts`
- Create: `apps/sync-worker/tests/auth/password.test.ts`
- Create: `apps/sync-worker/tests/auth/session.test.ts`

**Interfaces:**
- `hashPassword(password: string, salt?: Uint8Array): Promise<PasswordHash>`
- `verifyPassword(password: string, stored: PasswordHash): Promise<boolean>`
- `createSession(db: D1Database, adminId: string, now: Date): Promise<{ token: string; expiresAt: string }>`
- `readSession(db: D1Database, token: string, now: Date): Promise<Session | undefined>`
- `revokeSession(db: D1Database, token: string): Promise<void>`

- [ ] **Step 1: Write failing password and session tests**

Cover different salts producing different stored values, correct/incorrect password verification, token non-persistence in plaintext, expiry rejection, and revocation.

- [ ] **Step 2: Run tests to verify failure**

Run: `bun test apps/sync-worker/tests/auth`
Expected: FAIL with missing module/function errors.

- [ ] **Step 3: Add the migration**

Create `admin_account`, `sessions`, `books`, `book_resources`, and `reading_progress` tables. Include a unique normalized admin username, hashed session token, expiry index, book tombstone fields, resource hash/version fields, and foreign keys.

- [ ] **Step 4: Implement password and session primitives**

Use a salted PBKDF2 derivation supported by Workers Web Crypto, store algorithm parameters with the encoded hash, generate session tokens from `crypto.getRandomValues`, and store only a SHA-256 token digest. Compare derived bytes in constant-time style rather than comparing raw passwords.

- [ ] **Step 5: Run tests to verify success**

Run: `bun test apps/sync-worker/tests/auth`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/sync-worker/migrations apps/sync-worker/src/auth apps/sync-worker/tests/auth
git commit -m "feat: add sync authentication storage"
```

### Task 3: Implement admin initialization and authentication routes

**Files:**
- Create: `apps/sync-worker/src/auth/routes.ts`
- Create: `apps/sync-worker/src/auth/init-admin.ts`
- Create: `apps/sync-worker/tests/auth/routes.test.ts`
- Modify: `apps/sync-worker/src/index.ts`
- Modify: `apps/sync-worker/package.json`
- Create: `apps/sync-worker/README.md`

**Interfaces:**
- `POST /api/auth/login` accepts `{ username, password }` and returns `{ expiresAt }` with an `HttpOnly` session cookie or bearer-compatible session response.
- `POST /api/auth/logout` revokes the current session.
- `POST /api/auth/init` is a deployment-only command path protected by `ADMIN_INIT_SECRET`, and refuses to overwrite an existing administrator.

- [ ] **Step 1: Write failing route tests**

Test successful login, wrong credentials with the same response shape as an unknown username, expired sessions, logout, repeated initialization rejection, and missing init secret rejection.

- [ ] **Step 2: Run focused tests**

Run: `bun test apps/sync-worker/tests/auth/routes.test.ts`
Expected: FAIL with unimplemented route behavior.

- [ ] **Step 3: Implement routes**

Normalize usernames, enforce bounded request sizes, use the password/session modules, return structured `{ code, message }` errors, set secure same-site session cookies, and never include credential material in errors.

- [ ] **Step 4: Add initialization commands and documentation**

Document local and remote migration plus an interactive `bun run init-admin` flow that reads the password without echoing it and sends the initialization request using a deployment secret. Keep all examples placeholder-only.

- [ ] **Step 5: Run tests**

Run: `bun test apps/sync-worker/tests/auth`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/sync-worker/src/auth apps/sync-worker/src/index.ts apps/sync-worker/tests/auth apps/sync-worker/README.md
git commit -m "feat: add single-admin worker login"
```

### Task 4: Define sync manifests, resource allowlists, and Worker storage routes

**Files:**
- Create: `packages/core/src/sync/manifest.ts`
- Create: `packages/core/tests/sync/manifest.test.ts`
- Create: `apps/sync-worker/src/sync/resources.ts`
- Create: `apps/sync-worker/src/sync/routes.ts`
- Create: `apps/sync-worker/tests/sync/resources.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/sync-worker/src/index.ts`

**Interfaces:**
- `buildSyncManifest(entry: LibraryEntry, files: readonly SyncFile[]): SyncManifest`
- `isSyncablePath(relativePath: string): boolean`
- `resourceKey(adminId: string, bookId: string, relativePath: string): string`
- `GET /api/sync/manifest`
- `PUT /api/sync/books/:bookId/manifest`
- `PUT /api/sync/books/:bookId/resource/:resourcePath`
- `GET /api/sync/books/:bookId/resource/:resourcePath`

- [ ] **Step 1: Write failing manifest tests**

Assert that `path.json`, decks, audio, covers, catalog metadata, and progress are included; `chapters.json`, `.cache`, traces, chat files, source files, and path traversal are excluded; resource keys are deterministic and admin-scoped.

- [ ] **Step 2: Run the focused core test**

Run: `bun test packages/core/tests/sync/manifest.test.ts`
Expected: FAIL because the sync module is missing.

- [ ] **Step 3: Implement the pure manifest/allowlist module**

Use normalized forward-slash paths, reject absolute paths and `..`, include content type/size/hash, and keep the type renderer-safe.

- [ ] **Step 4: Write failing Worker route tests**

Test authenticated manifest reads, ownership checks, rejected path/content type, R2 put/get, D1 resource metadata, and hash mismatch rejection.

- [ ] **Step 5: Implement Worker storage routes**

Validate sessions, book IDs, resource paths, content lengths, and hashes before writing R2. Update D1 metadata in the same logical operation and return the book version plus resource hash.

- [ ] **Step 6: Run tests**

Run: `bun test packages/core/tests/sync/manifest.test.ts apps/sync-worker/tests/sync`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sync packages/core/tests/sync apps/sync-worker/src/sync apps/sync-worker/tests/sync apps/sync-worker/src/index.ts packages/core/src/index.ts
git commit -m "feat: add cloud book resource sync API"
```

### Task 5: Add cloud-preferred versioning, progress, and tombstones

**Files:**
- Create: `apps/sync-worker/src/sync/versions.ts`
- Create: `apps/sync-worker/tests/sync/versions.test.ts`
- Modify: `apps/sync-worker/src/sync/routes.ts`
- Modify: `apps/sync-worker/src/index.ts`

**Interfaces:**
- `PUT /api/sync/books/:bookId/manifest` accepts `baseVersion` and returns `409 { code: 'stale_version', cloudManifest }` when stale.
- `PUT /api/sync/progress/:bookId` and `GET /api/sync/progress/:bookId`.
- `DELETE /api/sync/books/:bookId` creates a tombstone before cleanup.

- [ ] **Step 1: Write failing version tests**

Cover first manifest creation, monotonic increments, stale mutation rejection, idempotent same-hash retry, cloud progress winning a conflict, and deleted books not being resurrected by stale uploads.

- [ ] **Step 2: Run focused tests**

Run: `bun test apps/sync-worker/tests/sync/versions.test.ts`
Expected: FAIL with missing version logic.

- [ ] **Step 3: Implement transaction-safe version updates**

Use D1 conditional updates keyed by book id and expected version. Return the current cloud manifest on conflict so the desktop can converge without last-write-wins behavior.

- [ ] **Step 4: Implement progress and tombstone routes**

Keep progress small and metadata-only. Mark deletion before attempting R2 cleanup; cleanup can be retried without allowing a stale client to recreate the row.

- [ ] **Step 5: Run tests**

Run: `bun test apps/sync-worker/tests/sync/versions.test.ts apps/sync-worker/tests/sync`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/sync-worker/src/sync apps/sync-worker/tests/sync
git commit -m "feat: enforce cloud sync versions"
```

### Task 6: Add local sync export/import primitives

**Files:**
- Create: `packages/core/src/sync/local.ts`
- Create: `packages/core/tests/sync/local.test.ts`
- Modify: `packages/core/src/store/library-disk.ts`
- Modify: `packages/core/src/store/library.ts`

**Interfaces:**
- `exportSyncBook(library: Library, bookId: string): Promise<SyncBundle>`
- `validateSyncBundle(bundle: unknown): SyncBundle`
- `installSyncBook(library: Library, bundle: SyncBundle, tempRoot: string): Promise<LibraryEntry>`

- [ ] **Step 1: Write failing local sync tests**

Create a fixture book with chapters, cache, decks, audio, catalog, and reading data. Assert export excludes chapters/cache/source/chat files, preserves playable resources, validates hashes, rejects malformed ids, and installs into a temporary directory before replacement.

- [ ] **Step 2: Run focused tests**

Run: `bun test packages/core/tests/sync/local.test.ts`
Expected: FAIL because sync export/import is missing.

- [ ] **Step 3: Extend the Library interface minimally**

Add read/export methods for the allowlisted resource set and an atomic import method; do not expose raw root paths to renderer code.

- [ ] **Step 4: Implement export, validation, and atomic install**

Read bytes from the existing library, calculate hashes, reject incomplete required files, write downloads under a sibling temporary directory, fsync/rename at the boundary available in the existing runtime, and update the library index only after all hashes pass.

- [ ] **Step 5: Run tests**

Run: `bun test packages/core/tests/sync/local.test.ts packages/core/tests/store`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/sync packages/core/tests/sync packages/core/src/store/library.ts packages/core/src/store/library-disk.ts
git commit -m "feat: export and install playable sync bundles"
```

### Task 7: Add the main-process Cloudflare client and session store

**Files:**
- Create: `apps/desktop/src/main/sync/client.ts`
- Create: `apps/desktop/src/main/sync/session-store.ts`
- Create: `apps/desktop/src/main/sync/types.ts`
- Create: `apps/desktop/tests/main/sync/client.test.ts`
- Create: `apps/desktop/tests/main/sync/session-store.test.ts`
- Modify: `apps/desktop/src/main/settings.ts`

**Interfaces:**
- `CloudSyncClient.login(credentials): Promise<SessionInfo>`
- `CloudSyncClient.fetchManifest(): Promise<CloudManifest>`
- `CloudSyncClient.uploadResource(input): Promise<ResourceReceipt>`
- `CloudSyncClient.downloadResource(input): Promise<Uint8Array>`
- `SessionStore.read(): Promise<StoredSession | undefined>`
- `SessionStore.write(session): Promise<void>`
- `SessionStore.clear(): Promise<void>`

- [ ] **Step 1: Write failing client/session tests**

Mock `fetch` and assert URL joining, authorization headers, bounded response parsing, structured error conversion, no token logging, and session clear on 401.

- [ ] **Step 2: Run focused tests**

Run: `bun test apps/desktop/tests/main/sync`
Expected: FAIL with missing modules.

- [ ] **Step 3: Add sync settings**

Extend shell settings with optional Worker URL and sync-enabled state. Preserve legacy settings parsing and never persist the password.

- [ ] **Step 4: Implement the HTTPS client**

Use main-process `fetch`, normalize the configured URL, send only the session token, enforce response size limits for JSON, and map server codes to typed local errors.

- [ ] **Step 5: Implement session persistence**

Use the platform credential store if already available in the project; otherwise use a private settings-side file with restrictive permissions and document the fallback. Store only the session token and expiry.

- [ ] **Step 6: Run tests and commit**

Run: `bun test apps/desktop/tests/main/sync`
Expected: PASS.

```bash
git add apps/desktop/src/main/sync apps/desktop/src/main/settings.ts apps/desktop/tests/main/sync
git commit -m "feat: add desktop cloud sync client"
```

### Task 8: Add SyncService and typed RPC integration

**Files:**
- Create: `apps/desktop/src/main/sync/service.ts`
- Create: `apps/desktop/tests/main/sync/service.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/rpc.ts`
- Modify: `apps/desktop/src/shared/schema.ts`
- Modify: `apps/desktop/src/bridge.ts`

**Interfaces:**
- `SyncService.login(username: string, password: string): Promise<AccountStatus>`
- `SyncService.logout(): Promise<void>`
- `SyncService.syncNow(): Promise<SyncSummary>`
- `SyncService.status(): SyncStatus`
- RPC requests: `syncLogin`, `syncLogout`, `syncNow`, `syncStatus`.
- RPC message: `syncStatus` with sanitized status only.

- [ ] **Step 1: Write failing service tests**

Test local-only operation without a Worker, login-triggered sync, cloud-new download, local-new upload, cloud-preferred replacement, stale conflict retry, failed transfer preservation, and generation upload not rejecting `generateBook`.

- [ ] **Step 2: Run focused tests**

Run: `bun test apps/desktop/tests/main/sync/service.test.ts`
Expected: FAIL because `SyncService` and RPC methods are missing.

- [ ] **Step 3: Compose the service in `main/index.ts`**

Construct `SessionStore`, `CloudSyncClient`, and `SyncService` once, inject the library and catalog stores, and pass the service to `createHandlers`.

- [ ] **Step 4: Implement the sync queue**

Serialize sync runs, expose progress states, create manifests from the allowlisted local bundle, upload/download by hash, install downloads atomically, and return failures without throwing through book generation.

- [ ] **Step 5: Wire RPC and renderer bridge**

Add exact request/response types to the shared schema, add bridge wrappers with offline errors, and emit only `{ state, lastSuccessAt, failedBookIds, message }` to the renderer.

- [ ] **Step 6: Run tests**

Run: `bun test apps/desktop/tests/main/sync apps/desktop/tests/main/rpc.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/sync apps/desktop/src/main/index.ts apps/desktop/src/main/rpc.ts apps/desktop/src/shared/schema.ts apps/desktop/src/bridge.ts apps/desktop/tests/main/sync
git commit -m "feat: integrate desktop sync service"
```

### Task 9: Trigger automatic sync after login and book generation

**Files:**
- Modify: `apps/desktop/src/main/rpc.ts`
- Modify: `apps/desktop/src/main/sync/service.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/AddBook.tsx`
- Create: `apps/desktop/tests/sync-triggers.test.tsx`

**Interfaces:**
- Login invokes `syncNow()` after storing a valid session.
- `generateBook` invokes a best-effort sync after returning the local entry and schedules follow-up uploads from deck-ready events.
- Startup invokes a background sync only when a valid session exists.

- [ ] **Step 1: Write failing trigger tests**

Assert login calls sync, book creation remains successful when sync rejects, deck-ready events enqueue the matching resource, and startup does not block the first local shelf render.

- [ ] **Step 2: Run focused tests**

Run: `bun test apps/desktop/tests/sync-triggers.test.tsx`
Expected: FAIL because triggers are not wired.

- [ ] **Step 3: Implement non-blocking triggers**

Start background sync after the local operation has completed. Avoid duplicate concurrent runs by relying on `SyncService` serialization.

- [ ] **Step 4: Run tests**

Run: `bun test apps/desktop/tests/sync-triggers.test.tsx apps/desktop/tests/main/sync`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/rpc.ts apps/desktop/src/main/sync/service.ts apps/desktop/src/App.tsx apps/desktop/src/AddBook.tsx apps/desktop/tests/sync-triggers.test.tsx
git commit -m "feat: sync books after login and generation"
```

### Task 10: Add bilingual login/settings UI and sync status

**Files:**
- Create: `packages/ui/src/settings/SyncPage.tsx`
- Modify: `packages/ui/src/settings/SettingsPanel.tsx`
- Modify: `packages/ui/src/settings/shell.ts`
- Modify: `packages/ui/src/i18n/messages/en.ts`
- Modify: `packages/ui/src/i18n/messages/zh.ts`
- Modify: `apps/desktop/src/useShellSettings.ts`
- Modify: `apps/desktop/src/App.tsx`
- Create: `packages/ui/tests/settings/SyncPage.test.tsx`

**Interfaces:**
- Settings page accepts `ShellSettings`, `AccountStatus`, `SyncStatus`, and callbacks for login/logout/sync-now.
- No password is retained in React state after the login request resolves.

- [ ] **Step 1: Write failing UI tests**

Test logged-out form, disabled submit for empty fields, logged-in account state, sync-now action, failure message, and bilingual labels.

- [ ] **Step 2: Run focused tests**

Run: `bun test packages/ui/tests/settings/SyncPage.test.tsx`
Expected: FAIL because the page and messages are missing.

- [ ] **Step 3: Implement the page and dictionaries**

Add Worker URL, username, password, login/logout, sync-now, status, last successful sync, and retry copy in both locales. Clear password state immediately after request completion.

- [ ] **Step 4: Add shelf status rendering**

Show a compact non-blocking status for active sync and failed books; do not hide or disable local books while synchronization is running.

- [ ] **Step 5: Run tests**

Run: `bun test packages/ui/tests/settings/SyncPage.test.tsx apps/desktop/tests`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/settings packages/ui/src/i18n/messages apps/desktop/src/useShellSettings.ts apps/desktop/src/App.tsx packages/ui/tests/settings/SyncPage.test.tsx
git commit -m "feat: add bilingual cloud sync settings"
```

### Task 11: Add deployment verification and documentation

**Files:**
- Create: `apps/sync-worker/scripts/preflight.ts`
- Create: `apps/sync-worker/scripts/verify.ts`
- Modify: `apps/sync-worker/README.md`
- Modify: `cloudflare-d1-workers-deployment.md`
- Create: `docs/CLOUDFLARE_SYNC.md`

**Interfaces:**
- `bun run cf:preflight` fails on placeholder IDs, missing Wrangler login, or missing required secret names.
- `bun run cf:verify` checks health, login, empty manifest, upload/download hash round trip, and logout without printing secrets.

- [ ] **Step 1: Write failing script tests**

Cover placeholder detection, required binding checks, and verification failure on a non-healthy Worker.

- [ ] **Step 2: Implement scripts and documentation**

Document `wrangler login`, D1 creation, R2 creation, local/remote migration, `SESSION_SECRET`, admin initialization, Worker URL configuration, and rollback/retry behavior. Explain explicitly that the attached kitchen document is a reference pattern and that Cairn does not upload chapter text.

- [ ] **Step 3: Run local verification**

Run: `bun run cf:preflight` with placeholder config and confirm it fails safely; run the Worker test suite with local bindings and confirm health/auth/sync pass.

- [ ] **Step 4: Commit**

```bash
git add apps/sync-worker/scripts apps/sync-worker/README.md cloudflare-d1-workers-deployment.md docs/CLOUDFLARE_SYNC.md
git commit -m "docs: document Cloudflare sync deployment"
```

### Task 12: Run the full project verification

**Files:**
- Modify only files required by failures found in the preceding tasks.

- [ ] **Step 1: Run all tests**

Run: `bun test`
Expected: PASS with no generated books, audio, cache, or secrets staged.

- [ ] **Step 2: Run all four typechecks**

Run: `bun run typecheck`
Expected: core, UI, desktop renderer, and desktop main typechecks all run and pass.

- [ ] **Step 3: Build the desktop webview**

Run: `cd apps/desktop && bun run build`
Expected: PASS without `node:*` leakage into the renderer bundle.

- [ ] **Step 4: Inspect the final diff and status**

Run: `git diff --check` and `git status --short`
Expected: no whitespace errors; only intentional source, migration, test, and documentation files are tracked; the user-provided attachment remains unchanged unless its deployment instructions were explicitly updated.

- [ ] **Step 5: Commit verification fixes only**

```bash
git add <only-files-fixed-after-verification>
git commit -m "fix: resolve Cloudflare sync verification failures"
```
