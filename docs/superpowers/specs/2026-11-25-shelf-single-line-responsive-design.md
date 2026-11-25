# Shelf Single-Line Responsive Display

## Goal

Keep shelf categories and book information readable on every supported window width without changing shelf behavior. Category labels and book text remain on one line; constrained space is handled without pushing the book menu out of reach or allowing text to overlap adjacent content.

## Scope

This change is limited to the shelf UI in `Home` and its existing styles. Search, category filtering, opening books, renaming, catalog editing, export actions, deletion, and all persisted data remain unchanged. Design tokens and colour values are not changed.

## Layout

The category strip becomes a single non-wrapping horizontal row. Each category button keeps its intrinsic width and label on one line. When the categories exceed the available width, the strip scrolls horizontally while its scrollbar is visually suppressed. Keyboard focus and pointer interaction continue to use the existing buttons.

Each shelf row continues to reserve fixed space for an optional cover and the actions menu. The text column is the only flexible region and may shrink to zero layout width. The book title and metadata each occupy one line and use ellipsis when their content exceeds the available space. The full title is exposed through the native `title` tooltip.

The existing hover animation that expands and scrolls a long title is removed. It can draw outside the text column and compete with the fixed actions area, which conflicts with the single-line containment requirement.

## Responsive Behavior

- Category buttons never wrap internally or onto another category row.
- Category overflow is navigated by horizontal scrolling rather than shrinking labels.
- Covers retain their current dimensions and do not shrink.
- The actions menu retains its current hit area and does not shrink.
- Titles and metadata consume the remaining row width and truncate independently.
- Existing narrow-window rules and user text scaling continue to apply.

## Accessibility

All existing semantic buttons, labels, focus behavior, and keyboard interactions remain intact. The category strip remains scrollable with trackpad or horizontal wheel gestures. A truncated book title remains available as a native tooltip without changing its accessible text.

## Verification

1. Run the existing catalog shelf tests to confirm filtering, row opening, and menu isolation are unchanged.
2. Run the UI and desktop typechecks relevant to the edited files.
3. Build the desktop webview to catch renderer import or bundling regressions.
4. Inspect the shelf in Vite at wide and narrow widths with long Chinese and English category names, long book titles, covers, and increased text scale.
5. Confirm categories remain one row, titles and metadata remain one line, the menu remains visible, and no content overlaps.

