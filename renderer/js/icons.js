// Inline SVG rather than the ▶ / ■ characters the plugin used.
//
// Those glyphs come from whatever font happens to cover them, so they arrive at
// different optical sizes and baselines — the stop square renders noticeably
// heavier and lower than the play triangle. Drawing them puts both on the same
// grid and makes them follow `currentColor`.

const svg = (body) =>
  `<svg class="glyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false">${body}</svg>`;

export const PLAY_ICON = svg('<path d="M3.2 1.6 10 6 3.2 10.4Z" />');
export const STOP_ICON = svg('<rect x="2.6" y="2.6" width="6.8" height="6.8" rx="1.2" />');

// One column, three columns, a month of squares. Filled rather than stroked so
// they work with `.glyph { fill: currentColor }` like the two above.
export const DAY_ICON = svg('<rect x="4.4" y="1.5" width="3.2" height="9" rx="1" />');

export const WEEK_ICON = svg(
  '<rect x="1.2" y="1.5" width="2.4" height="9" rx=".8" />' +
    '<rect x="4.8" y="1.5" width="2.4" height="9" rx=".8" />' +
    '<rect x="8.4" y="1.5" width="2.4" height="9" rx=".8" />',
);

export const MONTH_ICON = svg(
  [0, 1, 2]
    .flatMap((row) => [0, 1, 2].map((col) => ({ row, col })))
    .map(({ row, col }) => `<rect x="${1.2 + col * 3.6}" y="${1.2 + row * 3.6}" width="2.6" height="2.6" rx=".6" />`)
    .join(''),
);

// Sliders rather than a gear: a gear needs an outline to read at 14 px, and an
// outline needs a stroke.
export const SETTINGS_ICON = svg(
  '<rect x="1" y="2.1" width="10" height="1.2" rx=".6" /><circle cx="7.7" cy="2.7" r="1.7" />' +
    '<rect x="1" y="5.4" width="10" height="1.2" rx=".6" /><circle cx="4.1" cy="6" r="1.7" />' +
    '<rect x="1" y="8.7" width="10" height="1.2" rx=".6" /><circle cx="8.4" cy="9.3" r="1.7" />',
);

// Points left. Collapsed, CSS rotates it rather than swapping in a second icon.
export const CHEVRON_ICON = svg('<path d="M7.4 1.6 8.6 2.8 5.4 6l3.2 3.2-1.2 1.2L3 6Z" />');
