interface StationInput {
  readonly id: string;
  readonly title: string;
  readonly durationMs: number;
  /** Ready-to-emit slide markup, already produced by the trusted renderer. */
  readonly slideMarkup: readonly string[];
  readonly narrationText: string;
}

const escapeText = (value: string): string => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const minutes = (ms: number): string => `${Math.max(1, Math.round(ms / 60_000))} min`;

/**
 * One self-contained HTML file: the exporter's structure only — the slide
 * markup inside it comes from the app's own renderer, so the visual identity
 * is decided there, not here.
 */
export function slidesDocument(input: {
  readonly title: string;
  readonly author?: string;
  readonly exportDate: string;
  readonly stations: readonly StationInput[];
  readonly styleCss: string;
}): string | undefined {
  if (input.stations.length === 0) return undefined;
  const total = input.stations.reduce((sum, station) => sum + station.durationMs, 0);
  const sections = input.stations.map((station) => [
    `<section class="station" id="${escapeText(station.id)}">`,
    `<h2>${escapeText(station.title)}</h2>`,
    `<p class="meta">${minutes(station.durationMs)}</p>`,
    ...station.slideMarkup,
    `<details><summary>Narration</summary><p>${escapeText(station.narrationText)}</p></details>`,
    '</section>',
  ].join('\n')).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeText(input.title)}</title>
<style>
${input.styleCss}
.export-body { max-width: 960px; margin: 0 auto; padding: 24px; font-family: inherit; }
.station { margin: 32px 0; }
.station .meta { color: #777; }
@media print {
  .station { page-break-after: always; }
  details { display: none; }
}
</style>
</head>
<body class="export-body">
<header>
<h1>${escapeText(input.title)}</h1>
<p>${input.author === undefined ? '' : escapeText(input.author) + ' · '}${escapeText(input.exportDate)} · ${minutes(total)}</p>
</header>
${sections}
</body>
</html>`;
}
