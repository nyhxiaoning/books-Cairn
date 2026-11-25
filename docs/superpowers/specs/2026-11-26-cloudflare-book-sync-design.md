# Cloudflare Book Sync Design

**Date:** 2026-11-26  
**Status:** Proposed

## Goal

Add optional Cloudflare-backed synchronization for Cairn's local bookshelf, with a single administrator account, automatic synchronization after login and book creation, and cloud-preferred conflict resolution.

## Scope and boundaries

The cloud copy contains only resources needed to restore and play a generated book:

- book index metadata and catalog metadata;
- `path.json`;
- installed deck JSON files and deck readiness metadata;
- installed narration audio;
- cover metadata/assets when present;
- reading progress.

The cloud copy does not contain `chapters.json`, generated pipeline cache, model traces, companion conversations, or source files. Chapter text remains local, preserving Cairn's current local-data boundary. A restored cloud book is playable, but chapter-grounded companion questions remain available only on the machine that still has the source chapters.

The attached `cloudflare-d1-workers-deployment.md` is treated as deployment reference material, not as an implementation contract. Its shared access token and single-row snapshot are insufficient for Cairn's administrator login and binary resources.

## Recommended architecture

```text
Cairn desktop
    │ HTTPS + short-lived session token
    ▼
Cloudflare Worker
    ├── D1: admin, sessions, book manifests, versions, progress
    └── R2: book resource objects (JSON, MP3, cover assets)
```

The desktop application never receives a Cloudflare API token. The Worker owns all D1/R2 access. Wrangler credentials and deployment secrets remain deployment-time concerns.

### Cloudflare Worker

The Worker exposes authentication and synchronization endpoints, validates the session on every protected request, and performs all D1/R2 operations. It provides a health endpoint and returns structured error codes suitable for the existing RPC error encoding.

### D1 schema

The first migration creates:

- `admin_account`: one administrator row containing a normalized username, password hash, password salt/parameters, and timestamps;
- `sessions`: hashed session token, expiry, creation and last-used timestamps;
- `books`: one manifest per user-owned book, including Cairn book id, title, author, budget, language, voice, generated timestamp, resource version, deletion state, and timestamps;
- `book_resources`: resource key, byte size, content type, content hash, version, and update time;
- `reading_progress`: current station and updated time;
- indexes for session expiry, book id, and resource lookup.

Only one administrator exists in the initial product. The schema keeps ownership explicit so a later multi-user migration does not require rewriting resource keys.

### R2 object layout

R2 keys are scoped and validated by the Worker:

```text
users/<admin-id>/books/<book-id>/path.json
users/<admin-id>/books/<book-id>/decks/index.json
users/<admin-id>/books/<book-id>/decks/<node-id>.json
users/<admin-id>/books/<book-id>/audio/<node-id>.mp3
users/<admin-id>/books/<book-id>/cover/<file>
```

The Worker accepts only an allowlist of resource paths and content types. It never accepts an arbitrary R2 key from the desktop.

## Authentication

The deployment command initializes the administrator username and password. The password is hashed with a salted, intentionally expensive password derivation function available in the Worker runtime; the plaintext password is never written to D1, source, `wrangler.jsonc`, or logs.

Login returns a randomly generated session token. The server stores only a hash of that token and an expiry. The desktop stores the usable token in its local application credential store when available, with a settings-file fallback clearly documented as local-machine sensitive data. Logout revokes the session server-side and clears the local token.

The Worker applies bounded login failure handling and does not reveal whether a username exists. The desktop presents localized login and sync errors without exposing response bodies or credentials.

## Synchronization model

The cloud is canonical for the first version.

### Login/startup flow

1. The desktop verifies or requests a session.
2. It fetches the cloud manifest.
3. Cloud books absent locally are downloaded resource-by-resource.
4. Local books absent in the cloud are uploaded.
5. Books present in both locations use the higher cloud version; the cloud version replaces local derived resources.
6. Reading progress is pulled from the cloud, with the cloud value winning ties and conflicts.
7. A failed resource transfer leaves local data intact and marks the book sync as failed for retry.

The local bookshelf remains usable while synchronization runs. Downloaded books are installed atomically: resource files land in a temporary book directory, are hash-checked against the manifest, then replace the local book directory and index entry together.

### Book creation flow

After `generateBook` installs the path and begins building decks, the desktop enqueues a best-effort sync. It uploads the manifest and currently available resources, then uploads newly installed decks/audio as they become ready. A failed upload does not fail book generation; the local library remains authoritative for playback until retry succeeds.

### Deletion and rename

Deletion is a tombstone operation in D1 followed by R2 cleanup, so an older offline desktop cannot resurrect a deleted book during its next sync. Rename updates the manifest and local `path.json` through the existing library/RPC path, then syncs the new metadata version.

### Versioning

Each book has a monotonic server version. Resource updates are idempotent and carry a content hash. The Worker rejects malformed or stale mutation requests unless they target the current manifest version; the desktop refetches the manifest and retries with the cloud-preferred result. This avoids last-write-wins races between two desktop instances.

## Desktop integration

New main-process services are constructed in `apps/desktop/src/main/index.ts`, preserving the repository rule that process-scoped objects are composed in one place:

- `CloudSyncClient`: HTTPS client for Worker API calls;
- `SessionStore`: local session-token persistence and logout cleanup;
- `SyncService`: manifest comparison, upload/download queue, retry state, and atomic local installation.

The renderer reaches these through typed RPC additions in `apps/desktop/src/shared/schema.ts` and `apps/desktop/src/bridge.ts`. The main process owns network access and credentials; the webview receives only sanitized account and sync status.

The settings UI gains a Cloudflare sync page with Worker URL, username, login/logout, sync-now, and status. The Worker URL is configuration, not a secret. Product-facing copy is added to both Chinese and English dictionaries.

`Library` gains narrowly scoped export/import support for the allowed sync manifest and playable resource files. Existing cache, chapters, companion, and source-file APIs remain local-only.

## Deployment package

Create a separate Worker package with:

- `wrangler.jsonc` containing bindings but no real IDs or secrets;
- D1 migration files;
- Worker routes and tests;
- scripts for local D1/R2 development, migration, admin initialization, preflight, and deploy;
- a sample environment/configuration document with placeholders only.

The desktop receives the Worker URL through application settings or build-time configuration; it never receives D1 credentials. Deployment documentation will distinguish local development, first deployment, admin initialization, and subsequent migrations.

## Error handling and recovery

- Authentication errors clear the local session and require login again.
- Network, timeout, R2, and D1 failures are represented as sync failures, not book-generation failures.
- Hash mismatches discard the temporary download and preserve the current local book.
- A retry is safe because uploads use content hashes and server versions.
- Logout does not delete local books; it only stops remote access.
- The UI shows the last successful sync time and the first actionable failure, without logging tokens or resource contents.

## Testing and acceptance

Worker tests cover password initialization, login success/failure, session expiry/revocation, ownership checks, path allowlisting, manifest version conflicts, tombstones, hash validation, and R2/D1 failure responses.

Core tests cover sync manifest construction, excluded files, deterministic resource keys, cloud-preferred merge behavior, and atomic import decisions.

Desktop tests cover typed RPC wiring, login/logout state, automatic sync triggers after login and generation, retry behavior, and the rule that a sync failure leaves local playback available.

Acceptance checks:

1. A new book completes locally without a configured Worker.
2. A configured Worker accepts the administrator login and shows a healthy session.
3. A newly generated book appears in the cloud manifest and its playable resources download to a clean local library.
4. `chapters.json` and `.cache` never appear in the upload manifest.
5. Two desktop instances converge to the cloud version after login.
6. Offline startup still opens and plays existing local books.
7. `bun test`, all four typechecks, and `cd apps/desktop && bun run build` pass.

## Explicit non-goals

- Public registration or password reset;
- multi-user sharing;
- cloud storage of source books or chapter text;
- cloud execution of Cairn's generation pipeline;
- direct desktop access to D1/R2;
- automatic conflict merging of two local edits.
