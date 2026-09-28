import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { slidesDocument } from '@cairn/core/export/slides-html';
import type { NodeDeck, Path } from '@cairn/core/types';
import { SettingsProvider, SlideView } from '@cairn/ui';

/**
 * The player's own renderer, captured as static markup. The CSS is read from
 * the already-loaded document so the export matches what the reader saw.
 */
export async function renderSlidesHtml(path: Path, decks: ReadonlyMap<string, NodeDeck>): Promise<string | undefined> {
  const stations = path.nodes.flatMap((node) => {
    const deck = decks.get(node.id);
    if (deck === undefined) return [];
    const slideMarkup = deck.slides.map((slide) =>
      renderToStaticMarkup(
        // SlideView's chrome and quote layouts read the reader's locale
        // through useT; outside the app tree they need their own provider.
        <SettingsProvider>
          <SlideView slide={slide} />
        </SettingsProvider> satisfies ReactElement,
      ),
    );
    const narrationText = deck.narration.map((cue) => cue.text).join(' ');
    return [{ id: node.id, title: node.title, durationMs: deck.durationMs, slideMarkup, narrationText }];
  });
  if (stations.length === 0) return undefined;

  const styleCss = ['tokens', 'slide', 'diagram']
    .flatMap((name) => {
      const sheet = document.querySelector(`style[data-vite-dev-id$="${name}.css"], style[data-vite-dev-id$="/${name}.css"]`);
      return sheet?.textContent ? [sheet.textContent] : [];
    })
    .join('\n');
  return slidesDocument({
    title: path.title,
    exportDate: new Date().toISOString().slice(0, 10),
    stations,
    styleCss,
  });
}
