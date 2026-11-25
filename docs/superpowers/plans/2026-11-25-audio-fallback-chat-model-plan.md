# Audio Fallback and Companion Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow silent visual playback for decks without audio and independently configure the right-side companion model while preserving strict source verification.

**Architecture:** Keep deck rendering in `DeckPane`, but make its playhead source explicit: use the media element when audio loads and a monotonic local clock when it fails. Keep companion provider/model settings in the existing shell settings shape, adding only the missing chat model selection UI and diagnostic error codes.

**Tech Stack:** React, TypeScript, Bun test, Electrobun RPC, pi-ai/pi-agent-core, CSS, i18n dictionaries.

## Global Constraints

- Do not weaken `validateCitations` or `verifyBookQuotes`.
- Do not regenerate books or modify deck data when audio is missing.
- Do not change generation provider/model selection when changing the companion model.
- Do not send new data off the machine.
- Preserve English and Chinese product copy through the existing dictionaries.

## Task 1: Lock down citation diagnostics

**Files:**
- Modify: `apps/desktop/src/main/companion/run.ts`
- Modify: `apps/desktop/src/shared/companion-events.ts` if the error code type needs new values
- Modify: `packages/ui/src/i18n/messages/en.ts` and `packages/ui/src/i18n/messages/zh.ts`
- Test: `apps/desktop/tests/main/companion/run.test.ts`

**Interfaces:**
- Consumes: existing citation marker parsing and quote verification.
- Produces: typed diagnostic companion error codes that still reject invalid citations and render localized explanations.

- [ ] **Step 1: Add failing tests for diagnostic rejection**

Extend the existing companion run tests to assert that a malformed marker/evidence reference and a fabricated book quote still reject, while the thrown error exposes a specific diagnostic code rather than only the generic `bad_citation` code.

- [ ] **Step 2: Run the focused companion tests and confirm failure**

Run:

```bash
bun test apps/desktop/tests/main/companion/run.test.ts
```

Expected: the new diagnostic assertions fail before implementation; existing citation tests continue to pass.

- [ ] **Step 3: Introduce typed internal diagnostic codes**

Split the existing `CompanionRunError` citation path into stable codes for invalid marker/evidence, invalid citation reference, and quote verification failure. Update `citationMarkers`, `validateCitations` integration, and `verifyBookQuotes` only to identify the failing stage; preserve all existing rejection conditions.

- [ ] **Step 4: Add localized user-facing copy**

Map the new codes in both dictionaries to short messages explaining whether the answer could not be linked to a returned source or a quoted passage could not be matched. Keep the messages actionable and do not expose raw model output or source text.

- [ ] **Step 5: Run the focused tests and commit**

Run:

```bash
bun test apps/desktop/tests/main/companion/run.test.ts apps/desktop/tests/companion-state.test.ts
```

Expected: all focused citation and companion-state tests pass.

```bash
git add apps/desktop/src/main/companion/run.ts apps/desktop/src/shared/companion-events.ts packages/ui/src/i18n/messages/en.ts packages/ui/src/i18n/messages/zh.ts apps/desktop/tests/main/companion/run.test.ts
git commit -m "fix: explain companion source verification failures"
```

### Task 2: Add independent companion model selection

**Files:**
- Modify: `packages/ui/src/settings/ModelsPage.tsx`
- Modify: `packages/ui/src/settings/shell.ts` only if the shell view model lacks the selected chat profile/model
- Modify: `packages/ui/src/i18n/messages/en.ts` and `packages/ui/src/i18n/messages/zh.ts`
- Test: `apps/desktop/tests/shared/settings.test.ts` and the relevant settings UI test if present

**Interfaces:**
- Consumes: `ShellSettings.chatProvider`, provider catalog, `shell.prefs.providers`, and `shell.setProvider`.
- Produces: a chat-specific provider/model control that writes only chat settings and leaves `generationProvider` unchanged.

- [ ] **Step 1: Add failing settings assertions**

Add tests showing that changing the companion provider/model persists a separate `chatProvider` and provider profile model, and does not change `generationProvider` or the generation provider profile.

- [ ] **Step 2: Run settings tests and confirm failure**

Run:

```bash
bun test apps/desktop/tests/shared/settings.test.ts
```

Expected: the new assertions fail until the UI/state wiring is complete.

- [ ] **Step 3: Add the chat model input**

Extend `ChatRow` so it selects `inherit` or a provider and then exposes that provider's known model choices or custom model input. Use the existing provider catalog and `shell.setProvider`; do not introduce a second credential store. Keep `inherit` visibly distinct and retain the existing explanatory hint.

- [ ] **Step 4: Add localized labels and hints**

Add English and Chinese strings for the selected chat provider/model input and the independent-model explanation. Keep the wording clear that this affects only conversations, not book generation.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
bun test apps/desktop/tests/shared/settings.test.ts apps/desktop/tests/settings-panel.test.tsx
```

Expected: settings parsing and panel behavior pass, including generation/chat independence.

```bash
git add packages/ui/src/settings/ModelsPage.tsx packages/ui/src/settings/shell.ts packages/ui/src/i18n/messages/en.ts packages/ui/src/i18n/messages/zh.ts apps/desktop/tests/shared/settings.test.ts apps/desktop/tests/settings-panel.test.tsx
git commit -m "feat: configure the companion model independently"
```

### Task 3: Add local real-time reading when audio is missing

**Files:**
- Modify: `packages/ui/src/panes/DeckPane.tsx`
- Modify: `packages/ui/src/panes/useTransport.ts` if needed to support the visual clock
- Modify: `packages/ui/src/i18n/messages/en.ts` and `packages/ui/src/i18n/messages/zh.ts` for the fallback status
- Test: add or extend a focused deck pane/transport test under `packages/ui/tests/panes/`

**Interfaces:**
- Consumes: `NodeDeck.durationMs`, existing `onProgress`, `onEnded`, transport controls, and deck rendering.
- Produces: a deck that reads its narration through system `SpeechSynthesis` and advances from 0 to `durationMs` without a media file, with the same pause/play/seek/rate/auto-next behavior; visual-only playback remains the last fallback.

- [ ] **Step 1: Add a failing virtual-clock test**

Create a deterministic clock seam for the visual fallback and test that a missing-media deck advances only while playing, respects the selected rate, clamps at the duration, and emits one end transition. The test must also verify seeking changes the visual playhead without requiring a real `<audio>` source.

- [ ] **Step 2: Run the focused player test and confirm failure**

Run:

```bash
bun test packages/ui/tests/panes/DeckPane.test.tsx packages/ui/tests/transport.test.ts
```

Expected: the new missing-audio test fails before the fallback exists.

- [ ] **Step 3: Implement the visual clock and local speech fallback**

Track audio availability from the media element's load/error events. On error, switch to a monotonic `requestAnimationFrame` clock that uses elapsed wall time multiplied by the selected rate, and speak the active narration cue with system `SpeechSynthesis`. Keep the existing media path untouched when audio loads. Clamp the clock to `deck.durationMs`, call `onProgress`, cancel speech on pause/seek/rate/station changes, and route the terminal transition through the existing `onEnded` callback exactly once. If speech synthesis is unavailable, keep the clock and label the mode as visual-only.

- [ ] **Step 4: Wire controls and copy**

Make play/pause, click-to-toggle, keyboard transport, seeking, rate changes, and automatic next station operate against the active clock. Keep volume/mute controls harmless in silent mode. Add a localized non-blocking indication that the deck is playing without narration audio.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
bun test packages/ui/tests/panes/DeckPane.test.tsx packages/ui/tests/transport.test.ts
```

Expected: the visual fallback and existing audio transport tests pass.

```bash
git add packages/ui/src/panes/DeckPane.tsx packages/ui/src/panes/useTransport.ts packages/ui/src/i18n/messages/en.ts packages/ui/src/i18n/messages/zh.ts packages/ui/tests/panes/DeckPane.test.tsx packages/ui/tests/transport.test.ts
git commit -m "fix: play decks without narration audio"
```

### Task 4: Full verification and desktop inspection

**Files:**
- No intended source changes.

- [ ] **Step 1: Run the full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 2: Run all four typechecks**

```bash
bun run typecheck
```

Expected: core, UI, desktop WebView, and desktop main checks all pass.

- [ ] **Step 3: Build the desktop WebView**

```bash
cd apps/desktop && bun run build
```

Expected: production WebView bundle succeeds.

- [ ] **Step 4: Verify the real Electrobun shell**

Use a temporary `CAIRN_DATA_DIR` or a fixture book with an existing deck and deliberately absent audio file. Confirm the slide remains visible, play reads the narration locally when system speech is available, pause/seek/rate work, and the next-station path still fires. Open the right-side companion model control and confirm it does not alter generation settings. Trigger or replay a citation failure and confirm the localized diagnostic message appears.

- [ ] **Step 5: Final diff and instrumentation cleanup**

```bash
rtk rg -n "DEBUG-[A-Za-z0-9_-]+" apps packages || true
git diff --check HEAD~3..HEAD
git status --short
```

Expected: no temporary debug logs, no whitespace errors, and no generated books/audio/cache files staged.

