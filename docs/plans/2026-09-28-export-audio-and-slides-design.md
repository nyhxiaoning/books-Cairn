# Export Audio and Slides Design

## Summary

Two additive export actions per book, available from the book details header and the per-book
`...` shelf menu:

1. **Export whole-book audio** — concatenate every installed station's MP3 in path order into
   `<书名>-<date>.mp3`, losslessly (`-c copy`).
2. **Export slides as HTML** — render the book's complete slide data through the existing React
   slide renderers into one self-contained `.html` file, visually identical to the player.

Nothing in the generation pipeline, playback, or storage changes. Exports are read-only over
existing artifacts.

## Audio export

- Source: `books/<id>/audio/<nodeId>.mp3` in `path.json` order, skipping stations whose deck is
  missing; the result always reflects playable content.
- Tool: `ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp3` (verified on real library audio:
  12 minutes concatenated in 0.4 s, no re-encode).
- ffmpeg is resolved at export time; when missing the UI shows an actionable error naming
  `brew install ffmpeg` (no silent fallback, no bundled binary).
- Destination: `$CAIRN_DATA_DIR/exports/<bookId>/<slug>-<date>.mp3`, then the folder is revealed
  in Finder via the existing reveal mechanism. Electrobun has no save dialog, so the exports
  folder is the honest location; the reveal makes it feel like a completed save.
- The concat list file is a temp file inside the book's cache (gitignored, cleaned after use).
- Filename sanitization: book title slugified (existing `bookSlug`), date `YYYY-MM-DD`.

## Slides HTML export

- One RPC returns the export payload: title, author, voice/locale, stations in path order, each
  with slides (with `atMs`) and narration cues. This is plain data the webview already renders.
- The renderer serializes each slide through `SlideView` to static HTML with the app's existing
  tokens inlined as a `<style>` block (same fonts/colors/sizes as the player — no new design).
- Output structure: a cover header (title, author, export date, total duration), then one
  section per station (station title, duration, slides laid out at a fixed 16:9 stage size),
  print CSS so "Save as PDF" from a browser produces clean pages (one slide per page).
- Optional per station: narration text below the slides, folded by default (`<details>`).
- File written by the main process to the same `exports/` folder and revealed, same as audio.
- No images are generated (house rule); icons come from the existing local glyph set, inlined as
  SVG paths in the HTML.

## RPC surface

- `exportAudio({ bookId }): { path: string; missing: string[] }` — missing lists skipped stations.
- `exportSlides({ bookId }): { path: string; missing: string[] }`.
- Both long-running (ANSWER_LIMIT), both return typed errors:
  `export_failed`, `ffmpeg_missing`, `no_audio` (zero installed decks), `book_not_listed`.

## Error handling

- Partial book: export succeeds with what is installed; the result names skipped stations.
- Zero playable stations: `no_audio` error, no file written.
- ffmpeg spawn failure or non-zero exit: `export_failed` with stderr tail.
- Exports never block or mutate playback; the loopback server and caches are untouched.

## Testing

- Core: slug/date filename builder; station ordering and missing-station filtering; concat list
  format (absolute paths quoted); HTML document assembly (deterministic asserts: cover title,
  one section per station, print CSS marker).
- Main: fake ffmpeg binary (a script that copies inputs) proves spawn/args/temp handling; missing
  ffmpeg surfaces `ffmpeg_missing`.
- Existing suites stay green; the webview import-graph test keeps the renderer-only export
  assembly out of the main process.
