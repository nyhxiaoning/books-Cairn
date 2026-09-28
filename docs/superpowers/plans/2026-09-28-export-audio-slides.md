# Export Audio and Slides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a book's complete narration as one merged MP3 and its complete slides as one self-contained HTML file, from the book details header and the per-book shelf menu.

**Architecture:** Pure node-free helpers in `packages/core/export` (ordering, filenames, concat list, HTML document assembly). Main-process handlers spawn `ffmpeg` for audio and write files into `$CAIRN_DATA_DIR/exports/<bookId>/`, then reveal the folder. The webview serializes slides through the existing `SlideView` into static HTML (it already has the renderers and tokens) and hands the document to the main process to write.

**Tech Stack:** TypeScript strict, Bun tests, React SSR string rendering, Electrobun typed RPC, `Bun.spawn` for ffmpeg.

**Spec:** `docs/plans/2026-09-28-export-audio-and-slides-design.md`

## Global Constraints

- Lossless audio: `ffmpeg -f concat -safe 0 -i <list> -c copy <out>`; never re-encode.
- No new npm dependencies; slides render with the existing `SlideView` and tokens.
- No generated images; icons inline as SVG from the existing glyph set.
- Exports write only under `exports/<bookId>/`; playback, caches, and paths are untouched.
- Missing ffmpeg must surface `ffmpeg_missing` with an actionable message; no silent fallback.
- A book with zero installed decks refuses with `no_audio` / `no_slides` respectively.
- Partial books export what is installed and name skipped stations in the result.
- All reader-visible copy in Chinese and English; no `tokens.css` changes.
- Every task ends in a focused conventional commit.

---

## File map

- Create `packages/core/src/export/audio-plan.ts`: station ordering, missing filtering, concat list text, output filename.
- Create `packages/core/src/export/slides-html.ts`: HTML document skeleton, cover header, per-station sections, print CSS marker.
- Create matching tests `packages/core/tests/export/audio-plan.test.ts`, `slides-html.test.ts`.
- Create `apps/desktop/src/main/export/service.ts`: exports folder management, ffmpeg spawn, temp concat list, write-and-reveal, error mapping.
- Test `apps/desktop/tests/main/export/service.test.ts` with a fake ffmpeg script.
- Modify `apps/desktop/src/shared/schema.ts`, `bridge.ts`, `main/rpc.ts`: `exportAudio`, `exportSlides` (slides payload passed from the webview), `openPath` reveal of the exports folder.
- Create `apps/desktop/src/export/slide-html.ts` (webview): renders `NodeDeck[]` slides via `SlideView` to a full HTML string.
- Modify `apps/desktop/src/BookDetails.tsx` and `BookActions.tsx`: 导出音频 / 导出幻灯片 actions with busy and error states.
- Modify `packages/ui/src/i18n/messages/en.ts`, `zh.ts`.

### Task 1: Audio export planning (core)

**Files:**
- Create: `packages/core/src/export/audio-plan.ts`
- Test: `packages/core/tests/export/audio-plan.test.ts`

**Interfaces:**
- Produces: `audioPlan(path: Path, installed: ReadonlySet<string>, outName: string): { order: readonly string[]; missing: readonly string[]; listText: string }`.
- Produces: `exportFileName(title: string, date: string, ext: 'mp3' | 'html'): string` using `bookSlug` + `YYYY-MM-DD`.

- [ ] **Step 1: Write failing tests** — order follows `path.nodes`; missing stations are excluded and reported; empty installed set yields empty order; list lines are `file '<abs path>'` quoted; filename `slug-2026-09-28.mp3`.
- [ ] **Step 2: Run** `bun test packages/core/tests/export/audio-plan.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** the two pure functions.
- [ ] **Step 4: Run** the focused test — expect PASS.
- [ ] **Step 5: Commit** `feat: plan whole-book audio export`.

### Task 2: Slides HTML document assembly (core)

**Files:**
- Create: `packages/core/src/export/slides-html.ts`
- Test: `packages/core/tests/export/slides-html.test.ts`

**Interfaces:**
- Produces: `slidesDocument(input: { title; author?; exportDate; stations: readonly { id; title; durationMs; slideMarkup: readonly string[]; narrationText: string }[]; styleCss: string }): string`.

- [ ] **Step 1: Write failing tests** — document contains escaped cover title, one `<section class="station">` per station, narration inside `<details>`, print CSS marker `@media print`, zero-stations input is refused (returns undefined).
- [ ] **Step 2: Run** the focused test — expect FAIL.
- [ ] **Step 3: Implement** deterministic assembly (no dates inside except the passed export date).
- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** `feat: assemble slides export document`.

### Task 3: Export service and RPC (main)

**Files:**
- Create: `apps/desktop/src/main/export/service.ts`
- Test: `apps/desktop/tests/main/export/service.test.ts`
- Modify: `apps/desktop/src/shared/schema.ts`, `apps/desktop/src/bridge.ts`, `apps/desktop/src/main/rpc.ts`, `apps/desktop/src/main/index.ts`

**Interfaces:**
- `createExportService({ library, dataDir, ffmpegPath?, now?, reveal? })` producing
  `exportAudio(bookId): Promise<{ path; missing }>` and `writeExport(bookId, fileName, contents): Promise<{ path }>`.
- RPC: `exportAudio({ bookId })` (main does everything), `exportSlides({ bookId, html })` (webview supplies the document from Task 4), both with `ANSWER_LIMIT`.
- Errors: `ffmpeg_missing`, `no_audio`, `export_failed`; temp concat list under the book cache, removed after spawn.

- [ ] **Step 1: Write failing service tests** — fake ffmpeg script (copies first input) proves spawn args and list file; missing binary yields `ffmpeg_missing`; zero decks yields `no_audio`; output lands under `exports/<bookId>/`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the service with `Bun.spawn`, then wire schema/bridge/rpc/composition.
- [ ] **Step 4: Run** service tests + webview import test — expect PASS.
- [ ] **Step 5: Commit** `feat: export merged book audio`.

### Task 4: Slide HTML rendering (webview) and export actions

**Files:**
- Create: `apps/desktop/src/export/slide-html.ts`
- Test: `apps/desktop/tests/export/slide-html.test.tsx`
- Modify: `apps/desktop/src/BookDetails.tsx`, `apps/desktop/src/BookActions.tsx`, `packages/ui/src/i18n/messages/en.ts`, `packages/ui/src/i18n/messages/zh.ts`

**Interfaces:**
- `renderSlidesHtml(bundle): Promise<string>` — renders each deck's slides via `SlideView` with `renderToStaticMarkup`, collects the tokens CSS from the existing stylesheet, and calls the core assembler.
- Buttons: 导出音频 / 导出幻灯片 in details header and `...` menu; busy state during export; success reveals folder; failure shows `errorText`.

- [ ] **Step 1: Write failing webview test** — a two-station bundle produces HTML containing both station titles and the cover title; import graph stays clean.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** rendering + actions + bilingual copy.
- [ ] **Step 4: Run** focused suites + imports test + all four typechecks + desktop build.
- [ ] **Step 5: Commit** `feat: export slides as self-contained html`.
