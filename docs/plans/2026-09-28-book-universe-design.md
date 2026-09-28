# Book Universe and Expert System Design

## Summary

Cairn will add an independent relationship layer around each locally owned book. The layer has
two levels:

- a **reference layer** of five to ten externally discovered books, supported by public metadata
  and source links; and
- an **expert layer** containing only books the reader has imported and Cairn has processed.

The reference layer may recommend and explain relationships. Only the expert layer may attribute
arguments to a book, compare positions, or quote it. This distinction keeps the feature useful
without pretending that a title, search snippet, or publisher description is the book itself.

The feature is additive. Opening a shelf item still opens its existing path, and path generation,
playback, narration, companion history, budgets, and cache keys do not change.

## Goals

1. Let readers organize the shelf with automatic classifications, editable categories, and tags.
2. Let readers search the shelf by title, author, category, and tag.
3. Give every book a details surface without inserting a mandatory screen before playback.
4. Discover a trustworthy set of five to ten books related by intellectual role rather than mere
   similarity.
5. Upgrade a candidate into an expert automatically when the reader imports and processes the
   matching book.
6. Answer cross-book questions from local chapter notes and, for direct quotations, local chapter
   text, with per-book evidence.
7. Keep full text and private notes local.

## Non-goals

- Downloading, purchasing, or removing DRM from books.
- Treating search snippets, reviews, or publisher copy as if Cairn had read the book.
- Building an unbounded global knowledge graph.
- Precomputing comparisons between every pair of books.
- Changing path generation or player behavior.
- Adding cloud sync, accounts, telemetry, or mobile support.

## Product model

### Catalog organization

Classification is hybrid:

- Cairn proposes one primary category and a small set of topic tags from the book's existing
  metadata and chapter notes.
- The reader may rename, replace, or remove the proposed category and tags.
- Once the reader edits a field, automatic refreshes do not overwrite that field.
- `Uncategorized` is a derived view, not a category that must be stored on every legacy entry.

Shelf search is local and covers normalized title, author, category, and tags. The first version
does not need a database or vector index; the expected shelf fits an in-memory normalized string
filter.

### Relationship roles

Candidates are organized by why they matter to the current book:

- `foundation`: a source, precursor, or framework the current book builds on;
- `support`: reaches a compatible conclusion or strengthens the argument;
- `oppose`: directly challenges an assumption or conclusion;
- `verify`: supplies empirical, historical, or methodological evidence;
- `apply`: turns the ideas into practice in another domain; and
- `extend`: adds an important perspective the current book leaves out.

A candidate may have one primary role. The rationale records the shared issue and the specific
agreement or disagreement; it must not claim knowledge beyond the recorded public sources.

### Evidence levels

Every related book exposes one of these states:

1. `candidate`: title and authorship have been identified.
2. `sourced`: one or more public pages support the metadata and relationship rationale.
3. `imported`: the reader owns a local copy and it matches a shelf entry.
4. `mapped`: Cairn has chapter notes and can consult the book as an expert.
5. `finished`: the local reading record says the reader completed its path.

Only `mapped` and `finished` books participate in expert answers. `imported` books that are still
building show as preparing. `candidate` and `sourced` books remain recommendations.

## User experience

### Shelf

The shelf gains:

- a search field;
- category filters for All, Uncategorized, and user-visible categories;
- tag chips on book rows; and
- a `...` menu on every row.

The menu contains Book details, Build or refresh book universe, Edit category and tags, and the
existing destructive delete action. Delete keeps its current two-step confirmation.

Clicking the body of a book row continues to open the player immediately.

### Book details

Book details opens as a large overlay or drawer above the shelf or player, not as a fourth player
pane. It has four sections:

1. **Overview**: cover, author, category, tags, path progress, and current metadata.
2. **Book universe**: the current book and its related candidates, grouped by relationship role,
   with a list view as the primary accessible representation.
3. **Expert discussion**: imported mapped books and cross-book question starters.
4. **Evidence and status**: source links, last verification time, match state, and generation
   errors.

The existing in-player book menu receives Book details and Book universe actions. No playback
control or pane behavior changes.

### Building a universe

Universe generation begins only after an explicit reader action. Before the first request, the UI
states that Cairn will send the title, author, and short topic phrases to the selected search
provider; it will not send chapters, full text, or private notes.

The operation:

1. derives a compact profile from existing `ChapterNote` data;
2. performs several bounded searches spanning foundation, support, opposition, verification, and
   application;
3. fetches the most promising public pages before relying on detailed claims;
4. normalizes and deduplicates book identities;
5. asks the model for a structured, source-bounded relationship set;
6. links results to current shelf entries; and
7. atomically replaces the generated portion of the previous universe while retaining manual
   edits.

Five to ten is a target, not permission to fabricate. If fewer than five candidates can be
verified, Cairn shows the smaller result and explains that it found no more reliable matches.

## Architecture

The feature is separate from the map/classify/reduce/slides/TTS pipeline.

```text
LibraryEntry + ChapterNote[]
          |                     selected search provider
          +-- profile --------> search and bounded page fetch
                                      |
                                      v
                            structured relationship proposal
                                      |
                    normalize, validate, link to local shelf
                                      |
                                      v
                          books/<id>/universe.json
```

The main process owns filesystem, model, and network work. The renderer reaches it through typed
RPC. Pure types, normalization, matching, and validation live in `packages/core` so they can be
tested without a model or network.

Universe generation uses the same resolved model and selected web-search provider as the
companion, but it does not become a pipeline stage and it does not affect generation caches. A
per-book in-memory manager prevents concurrent refreshes; progress and the last complete result
are persisted so failure never replaces a usable universe.

## Storage

Catalog organization is stored in a root `catalog.json` keyed by book ID. Keeping reader-owned
organization separate from `books.json` prevents progress writes from overwriting manual edits
and lets legacy libraries behave as an empty catalog.

```ts
interface CatalogRecord {
  readonly bookId: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly categorySource: 'automatic' | 'manual';
  readonly tagsSource: 'automatic' | 'manual';
  readonly updatedAt: string;
}
```

Each universe lives with its seed book so it remains movable:

```ts
type UniverseRole = 'foundation' | 'support' | 'oppose' | 'verify' | 'apply' | 'extend';
type UniverseEvidence = 'candidate' | 'sourced' | 'imported' | 'mapped' | 'finished';

interface RelatedBook {
  readonly id: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly isbn?: string;
  readonly role: UniverseRole;
  readonly sharedTopics: readonly string[];
  readonly rationale: string;
  readonly sources: readonly { readonly title: string; readonly url: string }[];
  readonly evidence: UniverseEvidence;
  readonly linkedBookId?: string;
  readonly origin: 'generated' | 'manual';
}

interface BookUniverse {
  readonly version: 1;
  readonly bookId: string;
  readonly generatedAt: string;
  readonly profile: { readonly category: string; readonly topics: readonly string[] };
  readonly books: readonly RelatedBook[];
}
```

No persisted field contains an absolute path. ISBN is the preferred identity. When it is absent,
normalized title plus author produces a suggested match; ambiguous matches require reader
confirmation.

## Expert discussion

The current companion receives a `consult_universe` tool. Given a query, it searches only linked,
mapped local books and returns bounded relevant station briefs or chapter notes with book and
chapter identifiers. It does not preload all related books into every turn.

If the response needs a direct quotation, a separate bounded read reads the relevant local
chapter. Quote validation uses the same rule as the current book: attributed text must occur in
the fetched chapter from that turn.

Cross-book answers use this visible structure:

- each selected book's position;
- agreements;
- disagreements;
- evidence or methodological differences;
- the companion's synthesis, explicitly separated from the books' claims; and
- citations that identify the book and chapter or the public metadata page.

A candidate without local mapped content may appear as a recommendation beside an answer but may
not speak as an expert.

## Failure and update behavior

- Search or model failure leaves the last successful universe untouched and exposes Retry.
- A partially generated universe is never installed.
- Refresh replaces generated candidates by stable identity and preserves manual candidates,
  reader-edited roles, and dismissed candidates.
- Deleting a book removes its own universe and turns incoming local links into unlinked
  candidates; it never deletes another book.
- Importing or completing a book recomputes evidence status and suggested links without rerunning
  external search.
- Stale public evidence is labeled with its verification date. It does not affect playback.
- Legacy books with no catalog or universe data render normally.

## Testing and acceptance

The implementation must demonstrate:

1. legacy `books.json` data opens without migration;
2. catalog writes are atomic and manual values survive automatic updates;
3. local search matches title, author, category, and tags in both supported interface languages;
4. candidate normalization and matching handle ISBN, punctuation, case, and ambiguous editions;
5. fewer than five verified candidates is a valid result;
6. invalid model output, unsafe URLs, and network failures do not replace a stored universe;
7. the renderer sends only the explicit build request and never sends chapter text itself;
8. only mapped linked books are returned by expert retrieval;
9. cross-book quotations are verified against the fetched local chapter;
10. deleting or rebuilding a related book updates links without damaging either book's path;
11. `bun test`, all four typechecks, and the desktop Vite build pass; and
12. the existing shelf-to-player click path and all current generation/playback tests remain
    unchanged.

Because the feature touches visual CSS, its implementation must follow `docs/DESIGN.md`; any
color change requires the contrast tables to be re-measured. The preferred implementation adds no
new colors.
