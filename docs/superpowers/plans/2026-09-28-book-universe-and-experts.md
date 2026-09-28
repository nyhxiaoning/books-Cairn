# Book Universe and Experts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover five to ten evidence-backed related books for a selected book, link imported matches, and let the companion consult only locally mapped related books as grounded experts.

**Architecture:** Add a node-free universe domain and per-book atomic store, then compose a separate main-process discovery service from the existing model and web-search adapters. The UI reads persisted results through RPC; the companion retrieves bounded notes and chapters from linked local books instead of loading an entire multi-book corpus into context.

**Tech Stack:** TypeScript strict, Bun tests, React, Electrobun typed RPC, existing `LlmProvider`, existing Brave/Firecrawl/Tavily adapters, local JSON storage.

**Spec:** `docs/plans/2026-09-28-book-universe-design.md`

## Global Constraints

- Implement `docs/superpowers/plans/2026-09-28-catalog-and-book-details.md` first.
- Universe generation is an explicit user action; it never runs on application launch or book open.
- External requests may contain title, author, and short derived topic phrases only—never chapters, full text, private notes, prompts containing note prose, or conversation history.
- Five to ten verified books is a target; fewer than five is a successful honest result.
- Only related books linked to local mapped content may speak as experts.
- A direct quotation must be found verbatim in a local chapter fetched during that companion turn.
- Universe files contain no absolute paths and do not participate in deck cache keys.
- A failed or partial refresh must leave the last successful universe unchanged.
- Generated refreshes preserve manual candidates, reader-edited roles, and dismissals.
- All reader-visible copy exists in Chinese and English.
- Do not change budgets, `tokens.css`, or current path generation prompts.

---

## File map

- Create `packages/core/src/universe/types.ts`: universe contracts, validation, and evidence states.
- Create `packages/core/src/universe/identity.ts`: ISBN/title/author identity and local matching.
- Create `packages/core/src/universe/profile.ts`: privacy-safe topic profile derivation.
- Create `packages/core/src/universe/discover.ts`: structured provider request and result normalization.
- Create `packages/core/src/store/universe-disk.ts`: atomic per-book persistence.
- Create matching unit tests under `packages/core/tests/universe/` and `packages/core/tests/store/`.
- Create `apps/desktop/src/main/universe/service.ts`: search, fetch, model, install, and refresh lifecycle.
- Modify `apps/desktop/src/main/index.ts`, `rpc.ts`, shared schema, and bridge: injected service and RPC.
- Modify `apps/desktop/src/BookDetails.tsx` and add `UniversePanel.tsx`: build consent, role list, evidence, edit/dismiss/retry.
- Create `apps/desktop/src/main/companion/universe-tools.ts`: bounded expert retrieval.
- Modify companion contracts, citation handling, run loop, and renderer for `expert` evidence.
- Add automatic relinking after generation/deletion without external calls.

### Task 1: Universe domain, validation, and identity

**Files:**
- Create: `packages/core/src/universe/types.ts`
- Create: `packages/core/src/universe/identity.ts`
- Test: `packages/core/tests/universe/types.test.ts`
- Test: `packages/core/tests/universe/identity.test.ts`

**Interfaces:**
- Produces: `UniverseRole`, `UniverseEvidence`, `UniverseSource`, `RelatedBook`, `BookUniverse`, `parseUniverse(value)`, and `mergeUniverse(previous, generated)`.
- Produces: `normalizeIsbn`, `bookIdentity`, and `matchRelatedBook(candidate, entries): { linkedBookId?: string; ambiguous: readonly string[] }`.

- [ ] **Step 1: Write failing validation and merge tests**

```ts
test('refresh preserves manual books, edited roles and dismissed identities', () => {
  const merged = mergeUniverse(previousUniverse(), generatedUniverse());
  expect(merged.books.find((book) => book.origin === 'manual')).toBeDefined();
  expect(merged.books.find((book) => book.id === 'edited')?.role).toBe('oppose');
  expect(merged.books.some((book) => book.id === 'dismissed')).toBe(false);
});

test('a universe with three sourced candidates remains valid', () => {
  expect(parseUniverse(universeWith(3))).toBeDefined();
});
```

Validation must enforce version `1`, the six role values, bounded strings, HTTP(S) source URLs,
unique stable identities, and at most ten generated candidates. Invalid candidates are discarded
individually; an invalid root returns `undefined`.

- [ ] **Step 2: Write failing identity tests**

Cover ISBN-10/ISBN-13 punctuation removal, exact ISBN precedence, NFKC title punctuation removal,
case-insensitive author matching, no-author uncertainty, and two editions producing an ambiguous
result rather than an arbitrary link.

- [ ] **Step 3: Run the tests and verify missing modules**

Run: `bun test packages/core/tests/universe/types.test.ts packages/core/tests/universe/identity.test.ts`

Expected: FAIL because the universe modules do not exist.

- [ ] **Step 4: Implement readonly types, bounded parsing, merge, and identity matching**

```ts
export type UniverseRole = 'foundation' | 'support' | 'oppose' | 'verify' | 'apply' | 'extend';
export type UniverseEvidence = 'candidate' | 'sourced' | 'imported' | 'mapped' | 'finished';

export interface RelatedBook {
  readonly id: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly isbn?: string;
  readonly role: UniverseRole;
  readonly sharedTopics: readonly string[];
  readonly rationale: string;
  readonly sources: readonly UniverseSource[];
  readonly evidence: UniverseEvidence;
  readonly linkedBookId?: string;
  readonly origin: 'generated' | 'manual';
  readonly roleEdited?: boolean;
}
```

Store dismissed generated identities in `BookUniverse.dismissed`; `mergeUniverse` filters those
before applying new generated results.

- [ ] **Step 5: Run the focused tests**

Run: `bun test packages/core/tests/universe`

Expected: PASS.

- [ ] **Step 6: Commit the universe domain**

```bash
git add packages/core/src/universe packages/core/tests/universe
git commit -m "feat: define grounded book universe relationships"
```

### Task 2: Privacy-safe book profile and structured discovery

**Files:**
- Create: `packages/core/src/universe/profile.ts`
- Create: `packages/core/src/universe/discover.ts`
- Test: `packages/core/tests/universe/profile.test.ts`
- Test: `packages/core/tests/universe/discover.test.ts`

**Interfaces:**
- Produces: `BookProfile { title, author?, category, topics }` with at most eight topics of 60 characters each.
- Produces: `deriveBookProfile(entry, catalogRecord, notes): BookProfile`.
- Produces: `discoverRelations(profile, evidencePages, provider, signal?): Promise<readonly RelatedBook[]>`.
- Discovery receives public evidence text prepared by the main process; it never receives `ChapterNote[]`.

- [ ] **Step 1: Write a privacy-boundary test**

Use notes containing a unique secret sentence. Assert that `deriveBookProfile` returns bounded topic
labels and that the serialized profile does not include any note gist, key point, quote, or the
secret sentence.

```ts
const profile = deriveBookProfile(entry, catalog, [noteWith('PRIVATE SENTENCE')]);
expect(JSON.stringify(profile)).not.toContain('PRIVATE SENTENCE');
expect(profile.topics.length).toBeLessThanOrEqual(8);
```

The deterministic first version may draw topics from catalog tags, category, chapter titles, and
frequent non-stopword title terms; it must not ask a model to summarize note prose for the web.

- [ ] **Step 2: Write structured discovery tests**

Use a fake `LlmProvider` returning duplicates, unsupported roles, source URLs absent from supplied
evidence, and twelve candidates. Assert that normalization keeps only supported, source-backed,
deduplicated candidates and caps generated results at ten without padding to five.

- [ ] **Step 3: Run the tests and verify failure**

Run: `bun test packages/core/tests/universe/profile.test.ts packages/core/tests/universe/discover.test.ts`

Expected: FAIL because profile and discovery are missing.

- [ ] **Step 4: Implement the profile and strict schema call**

The model prompt contains only the profile plus bounded public-page titles/URLs/text. Require JSON
Schema fields `title`, `authors`, `isbn`, `role`, `sharedTopics`, `rationale`, and `sourceUrls`.
Use label `universe` and reject any returned source URL not present in the supplied page set.

- [ ] **Step 5: Run focused tests**

Run: `bun test packages/core/tests/universe`

Expected: PASS.

- [ ] **Step 6: Commit profile and discovery**

```bash
git add packages/core/src/universe/profile.ts packages/core/src/universe/discover.ts packages/core/tests/universe/profile.test.ts packages/core/tests/universe/discover.test.ts
git commit -m "feat: discover related books from bounded public evidence"
```

### Task 3: Atomic per-book universe storage

**Files:**
- Create: `packages/core/src/store/universe-disk.ts`
- Test: `packages/core/tests/store/universe-disk.test.ts`

**Interfaces:**
- Produces `UniverseStore` with `read(bookId)`, `install(bookId, next)`, `patch(bookId, mutation)`, and `remove(bookId)`.
- Produces `openUniverseStore(root: string): UniverseStore`.
- Persists `books/<id>/universe.json` by temp-file rename.

- [ ] **Step 1: Write failing storage tests**

Prove that missing files return `undefined`, invalid IDs are refused, install round-trips, failed
serialization does not remove the prior file, and two patches are serialized. Also assert that the
stored JSON contains no data-directory absolute path.

- [ ] **Step 2: Run the test and verify failure**

Run: `bun test packages/core/tests/store/universe-disk.test.ts`

Expected: FAIL because the store is absent.

- [ ] **Step 3: Implement atomic, serialized storage**

Reuse `bookFile(bookId, 'universe.json')` and the same serialized queue shape as `openLibrary`.
Validate every installed object through `parseUniverse` before writing it.

- [ ] **Step 4: Run storage regression tests**

Run: `bun test packages/core/tests/store/universe-disk.test.ts packages/core/tests/store/library-disk.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit universe persistence**

```bash
git add packages/core/src/store/universe-disk.ts packages/core/tests/store/universe-disk.test.ts
git commit -m "feat: persist per-book universes atomically"
```

### Task 4: Main-process discovery service

**Files:**
- Create: `apps/desktop/src/main/universe/service.ts`
- Test: `apps/desktop/tests/main/universe/service.test.ts`
- Modify: `apps/desktop/src/main/index.ts`

**Interfaces:**
- Produces `UniverseService` with `get(bookId)`, `build(bookId, signal?)`, `patch(bookId, change)`, and `relink()`.
- `createUniverseService` dependencies: `library`, `catalog`, `store`, `providerFor`, `readSettings`, `webSearch`, `fetchWeb`, `readReadingRecord`, and `now`.
- Concurrent `build` calls for the same book share one promise; builds for different books may run independently.

- [ ] **Step 1: Write failing orchestration tests with fakes**

Assert that build:

- loads library metadata, catalog, and notes locally;
- sends only profile search queries to the search adapter;
- performs role-spanning searches;
- fetches candidate pages before detailed relationship generation;
- installs once, only after all validation succeeds;
- retains the prior universe after search, fetch, or model failure; and
- returns three books successfully when only three verify.

Capture every query and provider request and assert that a unique note sentence never appears.

- [ ] **Step 2: Run the focused service test and verify failure**

Run: `bun test apps/desktop/tests/main/universe/service.test.ts`

Expected: FAIL because the service is absent.

- [ ] **Step 3: Implement bounded search and fetch orchestration**

Create up to six queries, one per relationship role, capped at 200 characters. Deduplicate result
URLs, fetch at most twelve public pages through the existing SSRF-protected `fetchWeb`, and bound
public evidence passed to `discoverRelations`. Resolve the selected search provider and effective
key through current settings; resolve `providerFor(bookId)` only after at least one public page is
available.

- [ ] **Step 4: Implement evidence and local link enrichment**

After discovery, run `matchRelatedBook` against `library.list()`. Set `mapped` only when
`library.loadNotes(linkedBookId)` succeeds and has at least one note; set `finished` only when
`isFinished` confirms the reading record. Ambiguous matches remain unlinked.

- [ ] **Step 5: Construct the store and service once in `main/index.ts`**

Pass the service into RPC dependencies in the next task. Do not create module-level setters or a
second `Library` instance.

- [ ] **Step 6: Run focused tests**

Run: `bun test apps/desktop/tests/main/universe/service.test.ts apps/desktop/tests/main/companion/web-tools.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the discovery service**

```bash
git add apps/desktop/src/main/universe/service.ts apps/desktop/tests/main/universe/service.test.ts apps/desktop/src/main/index.ts
git commit -m "feat: build book universes from verified web sources"
```

### Task 5: Universe RPC and details UI

**Files:**
- Modify: `apps/desktop/src/shared/schema.ts`
- Modify: `apps/desktop/src/bridge.ts`
- Modify: `apps/desktop/src/main/rpc.ts`
- Create: `apps/desktop/src/UniversePanel.tsx`
- Modify: `apps/desktop/src/BookDetails.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `packages/ui/src/i18n/messages/en.ts`
- Modify: `packages/ui/src/i18n/messages/zh.ts`
- Modify: `packages/ui/src/app.css`
- Test: `apps/desktop/tests/universe-panel.test.tsx`

**Interfaces:**
- RPC: `universeGet({ bookId })`, `universeBuild({ bookId })`, and `universePatch({ bookId, change })`.
- Renderer helpers mirror those names and use a five-minute limit for build, poll limit for reads/patches.
- `UniversePanel` receives state plus callbacks; it never calls RPC directly.

- [ ] **Step 1: Write failing UI tests**

Assert empty state, first-build privacy disclosure, explicit Build button, role grouping, candidate
evidence badge, source link, fewer-than-five honest state, Retry after failure, and no expert action
for an unlinked candidate.

- [ ] **Step 2: Run the test and verify failure**

Run: `bun test apps/desktop/tests/universe-panel.test.tsx`

Expected: FAIL because the panel and RPC helpers are absent.

- [ ] **Step 3: Add typed handlers and bridge methods**

Validate `bookId` in every handler. `universeBuild` awaits the build and returns the installed
universe; build errors cross the existing typed error payload rather than becoming an empty result.

- [ ] **Step 4: Implement details states and manual controls**

Render the accessible list grouped by role first. A compact relationship map may be a progressive
enhancement after the list works. Support role edit, dismissal, and manual candidate creation;
every mutation returns and replaces the full universe state.

- [ ] **Step 5: Add bilingual copy and existing-token styling**

Copy must distinguish Candidate, Public sources, Imported, Ready as expert, Finished, Preparing,
Fewer reliable matches found, and Last verified. External source links use the existing
`LinkProvider` route.

- [ ] **Step 6: Run focused UI and boundary tests**

Run: `bun test apps/desktop/tests/universe-panel.test.tsx packages/ui/tests/i18n/messages.test.ts apps/desktop/tests/webview/imports.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit universe UI and RPC**

```bash
git add apps/desktop/src/shared/schema.ts apps/desktop/src/bridge.ts apps/desktop/src/main/rpc.ts apps/desktop/src/UniversePanel.tsx apps/desktop/src/BookDetails.tsx apps/desktop/src/App.tsx packages/ui/src/i18n/messages/en.ts packages/ui/src/i18n/messages/zh.ts packages/ui/src/app.css apps/desktop/tests/universe-panel.test.tsx
git commit -m "feat: show and manage each book universe"
```

### Task 6: Automatic local relinking

**Files:**
- Modify: `apps/desktop/src/main/universe/service.ts`
- Modify: `apps/desktop/src/main/rpc.ts`
- Test: `apps/desktop/tests/main/universe/relink.test.ts`

**Interfaces:**
- Adds `UniverseService.relink(changedBookId?: string): Promise<void>` with no network or model calls.
- Trigger after a book path is installed/returned from generation and after a book is removed.

- [ ] **Step 1: Write failing relink tests**

Start with candidate A unlinked. Add a matching entry and notes, run `relink('a')`, and assert the
candidate becomes `mapped`. Remove the entry and assert it becomes `sourced` while retaining title,
role, rationale, and sources. Add two ambiguous entries and assert no link is chosen.

- [ ] **Step 2: Run the test and verify failure**

Run: `bun test apps/desktop/tests/main/universe/relink.test.ts`

Expected: FAIL because relink is not implemented.

- [ ] **Step 3: Implement local-only relinking and lifecycle hooks**

Iterate existing universes, update only candidates whose identity could match the changed book,
and atomically install changed files. Place hooks in the main-process orchestration after successful
generation and deletion; do not make core `BookBuilder` depend on the universe store. If the
builder currently owns the return boundary, invoke the hook in the RPC handler after
`books.generate` resolves rather than importing the service into `packages/core`.

- [ ] **Step 4: Run builder, delete, and relink tests**

Run: `bun test apps/desktop/tests/main/universe/relink.test.ts packages/core/tests/books/builder.test.ts packages/core/tests/store/library-disk.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit local relinking**

```bash
git add apps/desktop/src/main/universe/service.ts apps/desktop/src/main/rpc.ts apps/desktop/tests/main/universe/relink.test.ts
git commit -m "feat: link imported books into their universes"
```

### Task 7: Bounded expert retrieval and evidence contracts

**Files:**
- Modify: `packages/core/src/companion/types.ts`
- Modify: `packages/core/src/companion/citations.ts`
- Create: `apps/desktop/src/main/companion/universe-tools.ts`
- Test: `apps/desktop/tests/main/companion/universe-tools.test.ts`
- Modify: `packages/ui/src/panes/CompanionPane.tsx`
- Modify: `packages/ui/src/i18n/messages/en.ts`
- Modify: `packages/ui/src/i18n/messages/zh.ts`

**Interfaces:**
- Adds `Source = 'book' | 'web' | 'shelf' | 'expert'`.
- Adds `ExpertRef { bookId, bookTitle, chapter, title }`.
- Produces `consultUniverse(query, currentBookId, deps): Promise<ExpertToolResult>`.
- Produces `readUniverseChapters(bookId, indices, currentBookId, deps)` that first verifies an active mapped link.

- [ ] **Step 1: Write failing expert retrieval tests**

Assert that retrieval searches only linked mapped books, never current/unlinked/preparing books,
ranks bounded chapter notes by query terms, returns at most eight excerpts across at most four
books, and emits `ExpertRef` records. Assert that chapter reading refuses a book outside the active
universe allowlist.

- [ ] **Step 2: Run the test and verify failure**

Run: `bun test apps/desktop/tests/main/companion/universe-tools.test.ts`

Expected: FAIL because expert tools and evidence type are missing.

- [ ] **Step 3: Implement retrieval and allowlisted chapter reads**

Reuse the tokenization approach in `shelf-tools.ts`, but rank `ChapterNote.title`, `gist`, and
`keyPoints`. Return bounded XML with explicit book and chapter attributes. For chapter text, reuse
the bounded escaping logic in `book-tools.ts` after checking the local link.

- [ ] **Step 4: Extend citations and renderer labels**

Parse and validate `expert` refs as their own source. Render book title plus chapter title and let a
click open the linked shelf book at a station whose `sourceChapters` contains the cited chapter.

- [ ] **Step 5: Run citation and tool tests**

Run: `bun test apps/desktop/tests/main/companion/universe-tools.test.ts packages/core/tests/companion/citations.test.ts packages/ui/tests/panes/markdown.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit grounded expert retrieval**

```bash
git add packages/core/src/companion/types.ts packages/core/src/companion/citations.ts apps/desktop/src/main/companion/universe-tools.ts apps/desktop/tests/main/companion/universe-tools.test.ts packages/ui/src/panes/CompanionPane.tsx packages/ui/src/i18n/messages/en.ts packages/ui/src/i18n/messages/zh.ts
git commit -m "feat: retrieve grounded experts from linked books"
```

### Task 8: Companion integration and cross-book quote verification

**Files:**
- Modify: `apps/desktop/src/main/companion/run.ts`
- Modify: `apps/desktop/src/main/companion/book-tools.ts`
- Modify: `apps/desktop/tests/main/companion/run.test.ts`
- Modify: `apps/desktop/tests/main/companion/book-tools.test.ts`

**Interfaces:**
- Adds tools `consult_universe` and `read_universe_chapter` to `makeTools`.
- The system instruction says candidate books are recommendations only and expert claims require tool evidence.
- Quote verification indexes fetched text by both result ID and book ID so identical chapter numbers in different books cannot cross-validate.

- [ ] **Step 1: Write failing run-loop tests**

Cover a multi-book question that calls `consult_universe`, a direct quote that calls
`read_universe_chapter`, rejection of an attributed quote absent from that linked book's fetched
chapter, and refusal to cite a candidate-only book as an expert.

- [ ] **Step 2: Run companion tests and verify failure**

Run: `bun test apps/desktop/tests/main/companion/run.test.ts apps/desktop/tests/main/companion/book-tools.test.ts`

Expected: FAIL because the tools and book-aware quote verification are absent.

- [ ] **Step 3: Register tools with bounded schemas**

```ts
const expertQuery = Type.Object({ query: Type.String({ minLength: 1, maxLength: 200 }) });
const expertChapters = Type.Object({
  bookId: Type.String({ minLength: 1, maxLength: 160 }),
  indices: Type.Array(Type.Integer({ minimum: 0 }), { minItems: 1, maxItems: 2 }),
});
```

Record both tool results as `expert` evidence. Keep sequential execution and the existing global
tool-call ceiling.

- [ ] **Step 4: Make quote verification book-aware**

Replace the current fetched-chapter map value with `{ bookId, chapters }`. A citation with source
`expert` is valid only when its result belongs to the same `ExpertRef.bookId` and every attributed
quote occurs in that fetched chapter text.

- [ ] **Step 5: Update the instruction and answer format**

Tell the companion to expose each selected book's position, agreements, disagreements, evidence
differences, and a clearly marked synthesis. Preserve the current short-answer default unless the
reader explicitly requests a detailed comparison.

- [ ] **Step 6: Run the full companion suite**

Run: `bun test apps/desktop/tests/main/companion packages/core/tests/companion`

Expected: PASS.

- [ ] **Step 7: Commit companion expert integration**

```bash
git add apps/desktop/src/main/companion/run.ts apps/desktop/src/main/companion/book-tools.ts apps/desktop/tests/main/companion/run.test.ts apps/desktop/tests/main/companion/book-tools.test.ts
git commit -m "feat: compare linked books as grounded experts"
```

### Task 9: Final regression and privacy audit

**Files:**
- Modify only files required by concrete failures found in this task.

**Interfaces:**
- No new interface; this task validates the two implementation plans as one feature.

- [ ] **Step 1: Run targeted privacy and persistence suites**

Run:

```bash
bun test packages/core/tests/universe packages/core/tests/store/catalog-disk.test.ts packages/core/tests/store/universe-disk.test.ts
bun test apps/desktop/tests/main/universe apps/desktop/tests/main/companion
```

Expected: PASS, including the captured-request assertion that note prose never reaches search or
discovery inputs.

- [ ] **Step 2: Run every project check**

Run:

```bash
bun test
bun run typecheck
cd apps/desktop && bun run build
```

Expected: all tests, all four strict typechecks, the webview import graph, and Vite build pass.

- [ ] **Step 3: Exercise the desktop workflow**

Use the tracked `cairn-desktop-verify` skill. Verify: legacy shelf, search/filter, row click to
player, details from shelf and player, first-build disclosure, a three-result honest universe,
source links, failed refresh retaining prior results, import/relink, expert comparison, and quote
citation navigation.

- [ ] **Step 4: Inspect data on disk**

Confirm `catalog.json` and every `universe.json` are valid JSON, contain no absolute paths, contain
no chapter prose or private note text, and survive application restart.

- [ ] **Step 5: Commit only concrete audit fixes, if any**

```bash
git add <files changed to fix a reproduced audit failure>
git commit -m "fix: preserve book universe evidence boundaries"
```

If no audit failure required a change, do not create an empty commit.
