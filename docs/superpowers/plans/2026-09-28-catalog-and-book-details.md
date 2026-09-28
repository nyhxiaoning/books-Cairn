# Catalog and Book Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable book classification, local shelf search/filtering, per-book more actions, and a details surface while preserving the current click-to-player flow.

**Architecture:** Store reader-owned organization in a root `catalog.json`, separate from the frequently rewritten library index. Keep normalization and filtering in node-free core modules, filesystem writes in a process-scoped catalog store, and expose narrow typed RPC methods to the React webview.

**Tech Stack:** TypeScript strict, Bun tests, React, Electrobun typed RPC, atomic JSON files.

**Spec:** `docs/plans/2026-09-28-book-universe-design.md`

## Global Constraints

- Existing books with no `catalog.json` must render as uncategorized without migration.
- Clicking the main body of a shelf row must continue to open the player immediately.
- User-visible copy must exist in Chinese and English; English defines the dictionary type.
- The renderer may not import `node:*` or any main-process module.
- Reader edits must never be overwritten by a later automatic classification.
- Do not change `tokens.css`; reuse current design tokens and re-check `docs/DESIGN.md` before CSS work.
- Use immutable readonly domain types, no `any`, and no non-null assertions on external data.
- Every task ends in a focused conventional commit.

---

## File map

- Create `packages/core/src/catalog/types.ts`: node-free catalog contracts and validators.
- Create `packages/core/src/catalog/search.ts`: normalization, filter options, and shelf matching.
- Create `packages/core/src/store/catalog-disk.ts`: atomic catalog persistence.
- Create `packages/core/tests/catalog/types.test.ts` and `search.test.ts`: pure behavior coverage.
- Create `packages/core/tests/store/catalog-disk.test.ts`: legacy, atomic-update, and manual-precedence coverage.
- Modify `apps/desktop/src/main/index.ts` and `rpc.ts`: construct and inject one catalog store and add handlers.
- Create `packages/core/src/catalog/classify.ts`: explicit model-backed category and tag suggestion.
- Modify `apps/desktop/src/shared/schema.ts` and `bridge.ts`: typed catalog RPC boundary.
- Create `apps/desktop/src/BookDetails.tsx` and `CategoryEditor.tsx`: overview/details and edit surfaces.
- Modify `apps/desktop/src/Home.tsx` and `App.tsx`: search/filter state, more menu, and modal routing.
- Modify `packages/ui/src/panes/BookMenu.tsx` and `StagePane.tsx`: in-player details action.
- Modify `packages/ui/src/i18n/messages/en.ts`, `zh.ts`, `index.ts`, and `app.css`: copy and styling.
- Add focused renderer tests under `apps/desktop/tests/` and dictionary coverage through the existing UI test.

### Task 1: Catalog contracts and merge rules

**Files:**
- Create: `packages/core/src/catalog/types.ts`
- Test: `packages/core/tests/catalog/types.test.ts`

**Interfaces:**
- Produces: `CatalogRecord`, `CatalogFile`, `CatalogPatch`, `emptyCatalog()`, `parseCatalog(value)`, and `applyCatalogPatch(file, bookId, patch, now)`.
- Rule: an automatic patch may update only a field whose stored source is not `manual`.

- [ ] **Step 1: Write failing tests for legacy parsing and manual precedence**

```ts
import { expect, test } from 'bun:test';
import { applyCatalogPatch, emptyCatalog, parseCatalog } from '../../src/catalog/types';

test('missing or malformed catalog data becomes an empty versioned file', () => {
  expect(parseCatalog(undefined)).toEqual({ version: 1, records: {} });
  expect(parseCatalog({ records: [] })).toEqual({ version: 1, records: {} });
});

test('automatic refresh does not replace reader-owned category or tags', () => {
  const manual = applyCatalogPatch(emptyCatalog(), 'book-a', {
    category: 'My category', tags: ['mine'], source: 'manual',
  }, '2026-09-28T00:00:00.000Z');
  const refreshed = applyCatalogPatch(manual, 'book-a', {
    category: 'Psychology', tags: ['bias'], source: 'automatic',
  }, '2026-09-29T00:00:00.000Z');
  expect(refreshed.records['book-a']).toMatchObject({
    category: 'My category', tags: ['mine'],
    categorySource: 'manual', tagsSource: 'manual',
  });
});
```

- [ ] **Step 2: Run the focused test and verify the module is missing**

Run: `bun test packages/core/tests/catalog/types.test.ts`

Expected: FAIL because `src/catalog/types.ts` does not exist.

- [ ] **Step 3: Implement strict parsing and immutable patching**

```ts
export type CatalogSource = 'automatic' | 'manual';

export interface CatalogRecord {
  readonly bookId: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly categorySource: CatalogSource;
  readonly tagsSource: CatalogSource;
  readonly updatedAt: string;
}

export interface CatalogFile {
  readonly version: 1;
  readonly records: Readonly<Record<string, CatalogRecord>>;
}

export interface CatalogPatch {
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly source: CatalogSource;
}

export const emptyCatalog = (): CatalogFile => ({ version: 1, records: {} });
```

Normalize category whitespace, trim and case-insensitively deduplicate tags, cap category and tag
text at 80 characters, and cap tags at 12. Reject unsafe book IDs with `isBookId`. `parseCatalog`
must discard malformed records individually instead of making the whole file unreadable.

- [ ] **Step 4: Run the focused tests**

Run: `bun test packages/core/tests/catalog/types.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the catalog contracts**

```bash
git add packages/core/src/catalog/types.ts packages/core/tests/catalog/types.test.ts
git commit -m "feat: define editable book catalog metadata"
```

### Task 2: Local catalog search

**Files:**
- Create: `packages/core/src/catalog/search.ts`
- Test: `packages/core/tests/catalog/search.test.ts`

**Interfaces:**
- Consumes: `LibraryEntry`, `CatalogFile`.
- Produces: `catalogCategories(books, catalog): readonly string[]` and `filterCatalog(books, catalog, query, category): readonly LibraryEntry[]`.
- Category sentinel values: `'all'` and `'uncategorized'`; stored category names never use either value.

- [ ] **Step 1: Write failing tests for title, author, category, tag, and Unicode matching**

```ts
test('searches title, author, category and tags without changing shelf order', () => {
  const books = [entry('a', 'Thinking, Fast and Slow', 'Daniel Kahneman'), entry('b', '乡土中国', '费孝通')];
  const catalog = file({
    a: record('a', 'Psychology', ['bias', 'decision']),
    b: record('b', '社会学', ['乡村', '信任']),
  });
  expect(filterCatalog(books, catalog, 'BIAS', 'all').map((book) => book.id)).toEqual(['a']);
  expect(filterCatalog(books, catalog, '费孝通', '社会学').map((book) => book.id)).toEqual(['b']);
});
```

Also cover decomposed Unicode, repeated whitespace, empty query, and uncategorized legacy books.

- [ ] **Step 2: Run the test and verify failure**

Run: `bun test packages/core/tests/catalog/search.test.ts`

Expected: FAIL because the search module is missing.

- [ ] **Step 3: Implement node-free normalization and filtering**

```ts
const normalized = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

export function filterCatalog(
  books: readonly LibraryEntry[], catalog: CatalogFile,
  query: string, category: 'all' | 'uncategorized' | string,
): readonly LibraryEntry[] {
  const needle = normalized(query);
  return books.filter((book) => {
    const record = catalog.records[book.id];
    const inCategory = category === 'all'
      || (category === 'uncategorized' ? !record?.category : record?.category === category);
    const haystack = normalized([book.title, book.author ?? '', record?.category ?? '', ...(record?.tags ?? [])].join(' '));
    return inCategory && (!needle || haystack.includes(needle));
  });
}
```

- [ ] **Step 4: Run both catalog test files**

Run: `bun test packages/core/tests/catalog`

Expected: PASS.

- [ ] **Step 5: Commit local search**

```bash
git add packages/core/src/catalog/search.ts packages/core/tests/catalog/search.test.ts
git commit -m "feat: search and filter the local book catalog"
```

### Task 3: Atomic catalog persistence

**Files:**
- Create: `packages/core/src/store/catalog-disk.ts`
- Test: `packages/core/tests/store/catalog-disk.test.ts`

**Interfaces:**
- Produces: `CatalogStore` with `read(): Promise<CatalogFile>`, `patch(bookId, patch): Promise<CatalogFile>`, and `remove(bookId): Promise<void>`.
- Produces: `openCatalog(root: string, now?: () => string): CatalogStore`.
- Persists: `$CAIRN_DATA_DIR/catalog.json` through temp-file rename.

- [ ] **Step 1: Write failing storage tests**

Use `mkdtemp` to prove that a missing file reads empty, two concurrent patches keep both records,
an automatic patch respects manual fields, and `remove` deletes only the requested record.

```ts
const store = openCatalog(root, () => '2026-09-28T00:00:00.000Z');
await Promise.all([
  store.patch('book-a', { category: 'A', source: 'manual' }),
  store.patch('book-b', { tags: ['B'], source: 'manual' }),
]);
expect(Object.keys((await store.read()).records).sort()).toEqual(['book-a', 'book-b']);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `bun test packages/core/tests/store/catalog-disk.test.ts`

Expected: FAIL because `openCatalog` is missing.

- [ ] **Step 3: Implement one serialized writer and atomic replacement**

Follow `openLibrary`'s queue and `writeAtomic` pattern. Reads return `emptyCatalog()` on `ENOENT`
or invalid JSON. Patch and remove run inside the same queue so simultaneous renderer actions cannot
lose updates.

- [ ] **Step 4: Run storage and library tests**

Run: `bun test packages/core/tests/store/catalog-disk.test.ts packages/core/tests/store/library-disk.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit catalog persistence**

```bash
git add packages/core/src/store/catalog-disk.ts packages/core/tests/store/catalog-disk.test.ts
git commit -m "feat: persist book catalog organization"
```

### Task 4: Typed catalog RPC

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/rpc.ts`
- Modify: `apps/desktop/src/shared/schema.ts`
- Modify: `apps/desktop/src/bridge.ts`
- Test: `apps/desktop/tests/main/catalog-handlers.test.ts`

**Interfaces:**
- Consumes: one `CatalogStore` constructed with `openCatalog(DATA_DIR)` in the composition root.
- Produces RPC: `catalogGet(): CatalogFile`, `catalogPatch({ bookId, patch }): CatalogFile`.
- Produces renderer helpers: `getCatalog()` and `patchCatalog(bookId, patch)`.

- [ ] **Step 1: Write a failing handler test with an injected fake store**

Construct `createHandlers` with a fake `catalog` and assert that invalid IDs are rejected before a
write and valid manual patches are returned unchanged. Add `catalog` to `HandlerDeps`; do not import
or construct it inside `rpc.ts`.

- [ ] **Step 2: Run the handler test and verify the missing dependency**

Run: `bun test apps/desktop/tests/main/catalog-handlers.test.ts`

Expected: FAIL because catalog handlers and the dependency do not exist.

- [ ] **Step 3: Add schema, bridge helpers, handlers, and composition**

```ts
// shared/schema.ts
catalogGet: { params: void; response: CatalogFile };
catalogPatch: { params: { bookId: string; patch: CatalogPatch }; response: CatalogFile };

// bridge.ts
export async function getCatalog(): Promise<CatalogFile> {
  if (!inShell) return emptyCatalog();
  return (await connect()).request.catalogGet(undefined, POLL_LIMIT).catch(rethrow);
}
```

Validate `bookId` with `isBookId` in both handlers. Use the existing `POLL_LIMIT`; these are one
small local file read or write. After the existing book removal succeeds, call
`catalog.remove(bookId)`; a catalog cleanup failure is logged but must not resurrect or relist a
book that was already deleted.

- [ ] **Step 4: Run handler, schema, and webview import tests**

Run: `bun test apps/desktop/tests/main/catalog-handlers.test.ts apps/desktop/tests/webview/imports.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the catalog boundary**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/main/rpc.ts apps/desktop/src/shared/schema.ts apps/desktop/src/bridge.ts apps/desktop/tests/main/catalog-handlers.test.ts
git commit -m "feat: expose catalog organization to the desktop"
```

### Task 5: Automatic category and tag suggestion

**Files:**
- Create: `packages/core/src/catalog/classify.ts`
- Test: `packages/core/tests/catalog/classify.test.ts`
- Modify: `apps/desktop/src/main/rpc.ts`
- Modify: `apps/desktop/src/shared/schema.ts`
- Modify: `apps/desktop/src/bridge.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Test: `apps/desktop/tests/main/catalog-classifier.test.ts`

**Interfaces:**
- Produces: `suggestCatalog(title, notes, provider, signal?, locale?): Promise<{ category: string; tags: readonly string[] }>`.
- Adds RPC `catalogSuggest({ bookId }): CatalogFile` and renderer helper `suggestCatalogFor(bookId)`.
- Suggestion is explicit and applies an `automatic` patch, so it cannot replace a manual category or tags.

- [ ] **Step 1: Write failing strict-output tests**

Use a fake `LlmProvider` to cover a valid category and tag list, duplicate tags, overlong values,
malformed JSON, and an empty category. The digest may contain chapter title and gist because it is
sent only to the reader's configured generation model, never to the web-search provider.

```ts
const result = await suggestCatalog('Thinking', notes, fakeProvider({
  category: 'Psychology', tags: ['Bias', 'bias', 'Decision making'],
}));
expect(result).toEqual({ category: 'Psychology', tags: ['Bias', 'Decision making'] });
```

- [ ] **Step 2: Run the core test and verify failure**

Run: `bun test packages/core/tests/catalog/classify.test.ts`

Expected: FAIL because `suggestCatalog` does not exist.

- [ ] **Step 3: Implement one structured provider call**

Use a strict JSON Schema with one category and one-to-six tags, label the call `catalog`, and state
the requested output language. Normalize the reply through the same catalog value rules from Task
1; reject an empty normalized category as `LlmError('bad_output')`.

- [ ] **Step 4: Add an injected RPC handler**

Resolve `providerFor(bookId)`, load notes and the library entry, call `suggestCatalog`, then call
`catalog.patch(bookId, { ...suggestion, source: 'automatic' })`. The action occurs only after the
reader presses Suggest; never call it during launch, list, or book open.

- [ ] **Step 5: Test manual precedence at the handler boundary**

Run: `bun test packages/core/tests/catalog/classify.test.ts apps/desktop/tests/main/catalog-classifier.test.ts`

Expected: PASS, including a manual record that remains unchanged after suggestion.

- [ ] **Step 6: Commit automatic suggestions**

```bash
git add packages/core/src/catalog/classify.ts packages/core/tests/catalog/classify.test.ts apps/desktop/src/main/rpc.ts apps/desktop/src/shared/schema.ts apps/desktop/src/bridge.ts apps/desktop/src/main/index.ts apps/desktop/tests/main/catalog-classifier.test.ts
git commit -m "feat: suggest book categories and tags"
```

### Task 6: Shelf search, filters, and per-book more menu

**Files:**
- Modify: `apps/desktop/src/Home.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/BookActions.tsx`
- Modify: `packages/ui/src/i18n/messages/en.ts`
- Modify: `packages/ui/src/i18n/messages/zh.ts`
- Modify: `packages/ui/src/app.css`
- Test: `apps/desktop/tests/catalog-view.test.tsx`

**Interfaces:**
- Consumes: `CatalogFile`, `filterCatalog`, `catalogCategories`.
- Produces Home callbacks: `onDetails(bookId)`, `onEditCatalog(bookId)`, and `onBuildUniverse(bookId)`; the last may open details with an unavailable-state message until the universe plan lands.
- `BookActions` owns accessible menu focus, Escape, click-outside, and delete delegation.

- [ ] **Step 1: Write failing renderer tests**

Render `Home` with two books and catalog records. Assert that typing a tag narrows the shelf, the
Uncategorized filter includes a legacy book, clicking a book body calls `onOpen`, and clicking its
more button does not call `onOpen`.

- [ ] **Step 2: Run the renderer test and verify failure**

Run: `bun test apps/desktop/tests/catalog-view.test.tsx`

Expected: FAIL because the new props and controls are absent.

- [ ] **Step 3: Implement controlled search and category filtering**

Load the catalog once in `App`, update it from `patchCatalog` responses, and pass it to `Home`.
Keep search query and selected category in `Home`; filtering is render-only and does not reorder
the source array.

- [ ] **Step 4: Implement the more menu and bilingual copy**

Add copy for Search books, All, Uncategorized, Book details, Build book universe, Edit category
and tags, and Delete. The menu button needs `aria-haspopup="menu"`, `aria-expanded`, keyboard
navigation, focus return, and `stopPropagation()` so it never opens the player.

- [ ] **Step 5: Style with current tokens and run focused tests**

Run: `bun test apps/desktop/tests/catalog-view.test.tsx packages/ui/tests/i18n/messages.test.ts apps/desktop/tests/webview/imports.test.ts`

Expected: PASS. Manually verify the shelf at narrow width without adding colors.

- [ ] **Step 6: Commit the shelf catalog UI**

```bash
git add apps/desktop/src/Home.tsx apps/desktop/src/App.tsx apps/desktop/src/BookActions.tsx packages/ui/src/i18n/messages/en.ts packages/ui/src/i18n/messages/zh.ts packages/ui/src/app.css apps/desktop/tests/catalog-view.test.tsx
git commit -m "feat: organize and search the book shelf"
```

### Task 7: Category editor and book details overview

**Files:**
- Create: `apps/desktop/src/CategoryEditor.tsx`
- Create: `apps/desktop/src/BookDetails.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `packages/ui/src/i18n/messages/en.ts`
- Modify: `packages/ui/src/i18n/messages/zh.ts`
- Modify: `packages/ui/src/app.css`
- Test: `apps/desktop/tests/book-details.test.tsx`

**Interfaces:**
- `CategoryEditor` consumes a record and `onSave({ category, tags, source: 'manual' })`.
- `CategoryEditor` also consumes `onSuggest()` and shows returned automatic values before the reader saves or edits them.
- `BookDetails` consumes `LibraryEntry`, optional `BookMeta`, optional `CatalogRecord`, `onEditCatalog`, and `onClose`.
- `App` owns `{ bookId, section: 'overview' | 'universe' | 'experts' | 'evidence' } | undefined` so the next plan can fill the remaining sections without changing navigation.

- [ ] **Step 1: Write failing details and edit tests**

Assert that the overlay has dialog semantics, initial focus, Escape close, focus return, overview
metadata, and a category save that trims tags and sends a manual patch.

- [ ] **Step 2: Run the test and verify missing components**

Run: `bun test apps/desktop/tests/book-details.test.tsx`

Expected: FAIL because `BookDetails` and `CategoryEditor` do not exist.

- [ ] **Step 3: Implement the overview and editor**

Use a native `<dialog>` if it behaves consistently in the Electrobun webview; otherwise use
`role="dialog" aria-modal="true"` with the existing modal backdrop pattern from Settings. Render
the Universe, Expert discussion, and Evidence tabs as clearly labeled empty states, not fake data.

- [ ] **Step 4: Connect shelf actions and persist edits**

On save, await `patchCatalog`, replace the full local catalog with the returned value, and keep the
details overlay open so the result is visible. Surface failures with `errorText`; never close on a
failed save.

- [ ] **Step 5: Run focused tests**

Run: `bun test apps/desktop/tests/book-details.test.tsx apps/desktop/tests/catalog-view.test.tsx packages/ui/tests/i18n/messages.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit details and editing**

```bash
git add apps/desktop/src/CategoryEditor.tsx apps/desktop/src/BookDetails.tsx apps/desktop/src/App.tsx packages/ui/src/i18n/messages/en.ts packages/ui/src/i18n/messages/zh.ts packages/ui/src/app.css apps/desktop/tests/book-details.test.tsx
git commit -m "feat: add book details and catalog editing"
```

### Task 8: In-player details entry and full verification

**Files:**
- Modify: `packages/ui/src/panes/BookMenu.tsx`
- Modify: `packages/ui/src/panes/StagePane.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `packages/ui/src/i18n/messages/en.ts`
- Modify: `packages/ui/src/i18n/messages/zh.ts`
- Test: `packages/ui/tests/panes/BookMenu.test.tsx`

**Interfaces:**
- Adds optional `onDetails?: () => void` and `onUniverse?: () => void` through `StagePane` to `BookMenu`.
- Both callbacks close the menu before opening the existing details overlay; they do not switch books or interrupt playback.

- [ ] **Step 1: Write failing BookMenu keyboard and action tests**

Assert that Details and Book universe appear only when callbacks are supplied, participate in arrow
navigation order, close the menu, and call the correct callback once.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `bun test packages/ui/tests/panes/BookMenu.test.tsx`

Expected: FAIL because the action props do not exist.

- [ ] **Step 3: Thread the actions through StagePane and App**

Open details with `section: 'overview'` or `section: 'universe'`. Do not reset `currentId`, chat,
resume position, audio state, or pane widths.

- [ ] **Step 4: Run all required checks**

Run:

```bash
bun test
bun run typecheck
cd apps/desktop && bun run build
```

Expected: every test and all four typechecks pass; Vite reports a successful production build.

- [ ] **Step 5: Commit the player entry and verification**

```bash
git add packages/ui/src/panes/BookMenu.tsx packages/ui/src/panes/StagePane.tsx apps/desktop/src/App.tsx packages/ui/src/i18n/messages/en.ts packages/ui/src/i18n/messages/zh.ts packages/ui/tests/panes/BookMenu.test.tsx
git commit -m "feat: open book details from the player"
```
