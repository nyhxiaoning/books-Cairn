# Shelf Single-Line Responsive Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make shelf categories and book titles/metadata remain single-line and responsive without changing existing shelf behavior.

**Architecture:** Keep the current `Home` component and shelf DOM structure. Use CSS-only layout constraints for the category strip and shelf row, and add the book title as the existing native tooltip source in `Home.tsx`; no new state, data, or dependencies.

**Tech Stack:** React, TypeScript, CSS, Bun test, Vite desktop WebView build.

## Global Constraints

- Do not change search, filtering, opening, renaming, menu, export, delete, or persistence behavior.
- Category labels and book title/metadata remain single-line.
- Category overflow scrolls horizontally instead of wrapping or shrinking labels.
- Cover and actions menu retain fixed usable widths; only the text column shrinks.
- Do not change `tokens.css`, colours, or introduce dependencies.
- Follow the repository's strict TypeScript, immutable-data, and surgical-change rules.

## Files and Responsibilities

- Modify `packages/ui/src/app.css`: constrain the category strip and shelf row text layout; remove the title hover overflow animation rule.
- Modify `apps/desktop/src/Home.tsx`: expose the full book title through the native `title` attribute without changing rendered text or interaction.
- Verify with `apps/desktop/tests/catalog-view.test.tsx`, the existing typechecks, and `cd apps/desktop && bun run build`.

### Task 1: Add the non-wrapping shelf layout

**Files:**
- Modify: `packages/ui/src/app.css:203-243`
- Test: `apps/desktop/tests/catalog-view.test.tsx` (existing behavior regression coverage)

**Interfaces:**
- Consumes: existing `.shelf-categories`, `.shelf-category`, `.shelf-row`, `.shelf-item`, `.shelf-text`, `.shelf-name`, `.shelf-meta`, and `.shelf-cover` classes.
- Produces: a CSS layout where category buttons stay in one horizontally scrollable row and shelf text truncates within the flexible content column.

- [ ] **Step 1: Update category strip sizing rules**

In `.shelf-categories`, keep `display: flex`, change wrapping to `flex-wrap: nowrap`, add horizontal overflow scrolling, and suppress the visual scrollbar. Keep the existing gap. In `.shelf-category`, add `flex: 0 0 auto` and `white-space: nowrap` so each label keeps its intrinsic width and remains one line.

- [ ] **Step 2: Update shelf row flex constraints**

Keep `.shelf-row` as the outer flex container. Ensure `.shelf-row .shelf-item` can shrink but does not allow its inner content to establish an unshrinkable minimum. Ensure `.shelf-row .shelf-text` has `min-width: 0; flex: 1 1 auto;` and `.shelf-cover` remains `flex: 0 0 auto`. Keep the actions area out of the shrinking text column.

- [ ] **Step 3: Keep title and metadata contained**

Retain the existing single-line ellipsis rule for `.shelf-name` and `.shelf-meta`, and remove the `.shelf-row .shelf-name:hover` expansion animation plus its nearby keyframe if it is used only by that rule. Do not alter the visible title text or metadata composition.

- [ ] **Step 4: Run the focused regression tests**

Run:

```bash
bun test apps/desktop/tests/catalog-view.test.tsx
```

Expected: PASS for category filtering, shelf row opening, and isolated keyboard-accessible actions menu behavior.

- [ ] **Step 5: Commit the CSS change**

```bash
git add packages/ui/src/app.css apps/desktop/tests/catalog-view.test.tsx
git commit -m "fix: keep shelf labels on one line"
```

Do not modify the test file unless a regression assertion is required; if it remains unchanged, stage only `packages/ui/src/app.css`.

### Task 2: Add a native tooltip for truncated book titles

**Files:**
- Modify: `apps/desktop/src/Home.tsx:230-250`
- Test: `apps/desktop/tests/catalog-view.test.tsx` (existing rendered shelf coverage)

**Interfaces:**
- Consumes: `LibraryEntry.title` already passed to `ShelfText`.
- Produces: `.shelf-name` with the same visible text and a native `title` attribute containing the complete title.

- [ ] **Step 1: Add the title attribute**

Change only the title span in `ShelfText` from:

```tsx
<span className="shelf-name">{b.title}</span>
```

to:

```tsx
<span className="shelf-name" title={b.title}>{b.title}</span>
```

Do not add a new tooltip component or alter the accessible name.

- [ ] **Step 2: Run the focused regression tests**

Run:

```bash
bun test apps/desktop/tests/catalog-view.test.tsx
```

Expected: PASS with the same filtering, opening, and menu behavior.

- [ ] **Step 3: Commit the title fallback**

```bash
git add apps/desktop/src/Home.tsx
git commit -m "fix: expose full shelf title on hover"
```

### Task 3: Run repository verification and inspect responsive rendering

**Files:**
- No intended source changes.

- [ ] **Step 1: Run all tests**

Run:

```bash
bun test
```

Expected: PASS with no failures.

- [ ] **Step 2: Run all four typechecks**

Run:

```bash
bun run typecheck
```

Expected: all four projects are checked successfully: `packages/core`, `packages/ui`, `apps/desktop/tsconfig.json`, and `apps/desktop/tsconfig.main.json`.

- [ ] **Step 3: Build the desktop WebView**

Run:

```bash
cd apps/desktop && bun run build
```

Expected: the Vite WebView bundle completes successfully.

- [ ] **Step 4: Inspect the rendered shelf**

Run:

```bash
cd apps/desktop && bun run dev
```

Inspect a wide window and a narrow window containing long Chinese and English category labels, long book titles, a cover, and the actions menu. Confirm categories stay on one row and scroll horizontally, book title and metadata each stay on one line with ellipsis, the actions menu remains visible/clickable, and no text overlaps adjacent content.

- [ ] **Step 5: Check the final diff**

Run:

```bash
git diff --check HEAD~2..HEAD
git status --short
```

Expected: no whitespace errors; only the intended shelf files and commits are present, with no generated books, audio, or cache files staged.

