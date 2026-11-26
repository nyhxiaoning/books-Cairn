# Import Cancellation and Audio Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let readers skip MP3 synthesis for new imports, use system speech for those books, and cancel an import after five minutes without progress while preserving resumable work.

**Architecture:** Store `generateAudio` in main-process settings and snapshot it into each `LibraryEntry` as `audioEnabled`. Core deck construction always creates narration cues; the audio-enabled branch uses the existing narrator, while the disabled branch estimates deterministic cue timings locally. A single import `AbortController` flows through parsing boundaries, model calls, deck scheduling, and TTS; the webview exposes cancellation only after five minutes without an observed progress change.

**Tech Stack:** TypeScript strict, Bun tests, React, Electrobun RPC, existing `SpeechSynthesis` fallback, existing `AbortSignal` support.

## Global Constraints

- Preserve unrelated dirty changes in `README.zh-CN.md`, `apps/desktop/src/Home.tsx`, `apps/sync-worker/wrangler.jsonc`, `packages/ui/src/app.css`, and the untracked Cloudflare document directory.
- Default `generateAudio` to `true`; old settings and old library entries must retain current audio behavior.
- Keep audio generation fixed for one import and for later resume; current settings affect only newly started imports.
- Do not delete partial map caches, paths, decks, or audio when cancellation occurs.
- Keep `packages/core` framework-free and keep renderer-imported modules free of `node:*` imports.
- Use existing interfaces and dependencies; do not add a new audio or cancellation framework.
- Verify with `bun test`, all four typechecks, `cd apps/desktop && bun run build`, and real desktop behavior where possible.

## File Map

- `apps/desktop/src/shared/settings.ts`, `apps/desktop/src/main/settings.ts`, `packages/ui/src/settings/shell.ts`, `packages/ui/src/settings/pages.tsx`, and locale dictionaries own the persisted import-audio setting and its UI copy.
- `apps/desktop/src/shared/schema.ts`, `apps/desktop/src/bridge.ts`, `apps/desktop/src/main/rpc.ts`, `apps/desktop/src/main/inspect.ts`, and `apps/desktop/src/AddBook.tsx` own the import request, cancellation RPC, progress watchdog, and modal state.
- `packages/core/src/types.ts`, `packages/core/src/store/library.ts`, and `packages/core/src/store/library-disk.ts` own the persisted audio-enabled metadata and optional deck audio path.
- `packages/core/src/pipeline/voice.ts`, `packages/core/src/pipeline/tts.ts`, `packages/core/src/pipeline/build.ts`, `packages/core/src/pipeline/scheduler.ts`, and `packages/core/src/books/builder.ts` own estimated cues, audio-mode cache identity, signal propagation, and resumable construction.
- `packages/ui/src/panes/DeckPane.tsx` and `apps/desktop/src/App.tsx` own no-audio playback selection and audio URL behavior.
- Tests mirror each changed source area under `packages/core/tests`, `apps/desktop/tests`, and `packages/ui/tests`.

### Task 1: Add the persisted audio-generation setting

**Files:**
- Modify: `apps/desktop/src/shared/settings.ts`
- Modify: `apps/desktop/src/main/settings.ts` only if parsing needs an explicit boolean helper
- Modify: `packages/ui/src/settings/shell.ts`
- Modify: `packages/ui/src/settings/pages.tsx`
- Modify: `packages/ui/src/i18n/messages/zh.ts`
- Modify: `packages/ui/src/i18n/messages/en.ts`
- Test: `apps/desktop/tests/shared/settings.test.ts`, `apps/desktop/tests/main/settings.test.ts`, and `packages/ui/tests/settings/ModelsPage.test.tsx`

**Interfaces:**
- Produces `ShellSettingsValues.generateAudio: boolean`, defaulting to `true`.
- Produces `ShellPrefs.generateAudio: boolean` and a settings row that calls `shell.setPref('generateAudio', value)`.

- [ ] **Step 1: Add a failing settings test** asserting a missing `generateAudio` field normalizes to `true`, and explicit `false` persists as `false`.
- [ ] **Step 2: Run `bun test apps/desktop/tests/shared/settings.test.ts apps/desktop/tests/main/settings.test.ts packages/ui/tests/settings/ModelsPage.test.tsx` and verify the new assertions fail before implementation.
- [ ] **Step 3: Add the boolean to the shared settings type, defaults, parser, shell adapter, and the narration settings page; add Chinese and English label/hint strings.** Use the existing row/control pattern and do not change unrelated settings.
- [ ] **Step 4: Run the focused settings test and relevant UI settings tests; verify they pass.**
- [ ] **Step 5: Commit:** `feat: add import audio generation setting`.

### Task 2: Make decks valid without MP3 files

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/store/library.ts`
- Modify: `packages/core/src/store/library-disk.ts`
- Modify: `packages/core/src/pipeline/voice.ts`
- Modify: `packages/core/src/pipeline/tts.ts`
- Modify: `packages/core/src/pipeline/build.ts`
- Test: `packages/core/tests/pipeline/tts.test.ts`
- Test: `packages/core/tests/pipeline/build.test.ts`
- Test: `packages/core/tests/store/library-disk.test.ts`

**Interfaces:**
- Produces `estimateNarration(deck: DraftDeck, locale: ContentLocale): NodeDeck` or an equivalently named pure function returning narration cues, duration, and timed slides without an audio path.
- Extends `NodeBuildOptions` with `generateAudio?: boolean`.
- `NodeDeck.audioPath` becomes `string | undefined`; persisted decks omit it when there is no MP3.

- [ ] **Step 1: Write failing tests** for Chinese and English estimated cue durations, timed slides in a no-audio deck, and `installDeck` not creating an audio file when `audioPath` is absent.
- [ ] **Step 2: Run `bun test packages/core/tests/pipeline/tts.test.ts packages/core/tests/pipeline/build.test.ts packages/core/tests/store/library-disk.test.ts` and confirm failure.**
- [ ] **Step 3: Implement deterministic cue estimation using the existing measured language rates in `voice.ts`; preserve exact sentence text, monotonic start/end times, total duration, and slide timing.** Keep the function pure and free of filesystem imports in renderer-reachable modules.
- [ ] **Step 4: Update `buildNode` to call the narrator only when `generateAudio !== false`; otherwise return the estimated deck. Update cache key identity to include the audio mode.**
- [ ] **Step 5: Make disk installation conditional on `audioPath`; persist the deck with no audio path and keep the existing relative-path behavior for audio decks.**
- [ ] **Step 6: Run the focused tests and inspect serialized deck fixtures for both modes.**
- [ ] **Step 7: Commit:** `feat: support decks without generated audio`.

### Task 3: Carry the audio snapshot through generation and resume

**Files:**
- Modify: `packages/core/src/store/library.ts`
- Modify: `packages/core/src/books/builder.ts`
- Modify: `packages/core/src/pipeline/scheduler.ts`
- Modify: `apps/desktop/src/main/rpc.ts`
- Modify: `apps/desktop/src/shared/schema.ts`
- Modify: `apps/desktop/src/bridge.ts`
- Test: `packages/core/tests/books/builder.test.ts`
- Test: `packages/core/tests/pipeline/scheduler.test.ts`
- Test: relevant `apps/desktop/tests/main/*.test.ts`

**Interfaces:**
- `BookBuilder.generate` accepts a fourth options object containing `generateAudio: boolean` and an optional `AbortSignal`, or an equivalent additive parameter that preserves existing callers.
- `BookBuilder.resume` reads `LibraryEntry.audioEnabled`, with missing values treated as `true`.
- `LibraryEntry.audioEnabled?: boolean` is persisted for new books.
- `DeckSchedulerOptions.signal` reaches `build(node)` and scheduler retry sleeps observe the signal.

- [ ] **Step 1: Add failing builder tests** proving false skips narrator readiness/synthesis, records `audioEnabled: false`, and resume keeps false even if the current setting would be true; add a scheduler test proving the signal reaches an in-flight build.
- [ ] **Step 2: Run the focused builder and scheduler tests and confirm failure.**
- [ ] **Step 3: Add `audioEnabled` with old-entry compatibility and thread the snapshot into `startBuilding`, `deckKey`, `buildNode`, and the scheduler signal.**
- [ ] **Step 4: Ensure `generate` does not call `narrator.ensureReady()` when audio is disabled, but keeps all model stages and first-deck readiness unchanged.**
- [ ] **Step 5: Make `resume` use the recorded value and pass the same signal-aware build options; keep `remove` and retry semantics intact.**
- [ ] **Step 6: Run focused tests and then `bun test packages/core/tests/books/builder.test.ts packages/core/tests/pipeline/scheduler.test.ts`.**
- [ ] **Step 7: Commit:** `feat: snapshot audio mode for resumable books`.

### Task 4: Add cancellable import RPC and progress watchdog

**Files:**
- Modify: `apps/desktop/src/main/inspect.ts`
- Modify: `apps/desktop/src/main/rpc.ts`
- Modify: `apps/desktop/src/shared/schema.ts`
- Modify: `apps/desktop/src/bridge.ts`
- Modify: `apps/desktop/src/AddBook.tsx`
- Modify: `packages/core/src/parse/index.ts` and only the parser boundaries needed to check the signal cooperatively
- Test: the closest existing handler test under `apps/desktop/tests/main/`, adding `apps/desktop/tests/main/import-cancellation.test.ts` if no handler test covers `createHandlers`
- Test: a new focused `apps/desktop/tests/add-book.test.tsx` mirroring the existing modal test setup
- Test: parser tests only where cancellation checks are added

**Interfaces:**
- Adds `cancelGenerateBook: { params: void; response: boolean }` to the RPC schema.
- Adds `cancelGenerateBook(): Promise<boolean>` to the renderer bridge.
- `generateBook` owns one active import controller and passes its signal to `readBook` and `books.generate`; cancellation returns a `cancelled` error only after preserving persisted work.

- [ ] **Step 1: Add failing RPC/UI tests** for cancellation aborting the active run, rejecting a second/empty cancellation, and showing the button only after five minutes without a changed progress snapshot.
- [ ] **Step 2: Run the focused desktop tests and confirm failure.**
- [ ] **Step 3: Add the active import controller in `createHandlers`; clear it in `finally`, expose the cancellation RPC, and map `JobAbortedError`/abort errors to the existing `cancelled` error without deleting library data.**
- [ ] **Step 4: Thread `AbortSignal` through `readBook` and cooperative parser boundaries; ensure map/model/deck/TTS signals already supported by core receive the same signal.**
- [ ] **Step 5: Add `cancelGenerateBook` to the bridge and make `AddBook` track a stable progress signature plus `lastChangedAt`; poll remains the recovery path for dropped push messages.**
- [ ] **Step 6: Render a localized cancel button after `5 * 60_000` ms of no progress change; clicking disables it, calls the RPC, and closes the progress modal after the request settles without showing a failure.**
- [ ] **Step 7: Run focused desktop tests and verify cancellation leaves cache/entry files untouched in a temporary data directory.**
- [ ] **Step 8: Commit:** `feat: cancel stalled book imports`.

### Task 5: Select explicit no-audio playback and verify the desktop surface

**Files:**
- Modify: `packages/ui/src/panes/DeckPane.tsx`
- Modify: `apps/desktop/src/App.tsx` only if the bundle must pass an explicit audio-availability flag
- Test: `packages/ui/tests/panes/DeckPane.test.tsx` or the closest existing pane test
- Test: `apps/desktop/tests/book-details.test.tsx` only if the shell bundle path changes

**Interfaces:**
- Produces the same observable behavior for `NodeDeck.audioPath === undefined` as for an audio load error: system speech when available, visual-only otherwise.

- [ ] **Step 1: Add a failing component test** rendering a no-audio deck and asserting it enters the speech/visual fallback without waiting for an `<audio>` error event.
- [ ] **Step 2: Run the focused UI test and confirm failure.**
- [ ] **Step 3: Add the explicit no-audio branch while retaining the existing error fallback, cleanup, captions, seeking, rate, auto-next, and resume behavior.**
- [ ] **Step 4: Run the focused UI test and `cd apps/desktop && bun run build`.**
- [ ] **Step 5: Use `cairn-desktop-verify`: launch `bun run start` with a temporary `CAIRN_DATA_DIR`, disable MP3 generation, import a small test book, confirm no MP3 is written and system speech/visual fallback plays; then verify a stalled/cancelled import remains resumable.**
- [ ] **Step 6: Commit:** `fix: play no-audio decks with system speech`.

### Task 6: Full regression verification

**Files:**
- Modify: only files required by failing checks; do not include unrelated dirty files.

- [ ] **Step 1: Run `bun test`.**
- [ ] **Step 2: Run `bun run typecheck` and confirm all four projects are checked.**
- [ ] **Step 3: Run `cd apps/desktop && bun run build`.**
- [ ] **Step 4: Review `git diff`, `git status`, and staged paths; ensure no generated book, audio, cache, or unrelated existing change is staged.**
- [ ] **Step 5: If a regression is found, add the smallest regression test and fix; otherwise report the exact checks and remaining desktop-verification limitations.**

## Self-review

- Spec coverage: the plan includes the persisted setting, local estimated timing, optional audio persistence, cache isolation, signal propagation, five-minute watchdog, cancellation RPC, resumable partial data, system speech fallback, localization, tests, and desktop verification.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation step is required; focused test locations use existing repository search commands where filenames may vary.
- Type consistency: `generateAudio` is the settings name, `audioEnabled` is the persisted book snapshot, and `NodeDeck.audioPath` is the optional persisted audio marker throughout the tasks.
