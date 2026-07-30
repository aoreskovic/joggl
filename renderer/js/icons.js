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

// A bin, and deliberately a solid one.
//
// This was 🗑 — an emoji, so it arrived at whatever size and weight the system font
// felt like, and the ribs it draws down the body collapse into grey mush at 14 px.
// The user's words were that it was unclear what it even was. Drawn instead: a lid,
// a handle and a tapered body, no ribs, at the same optical weight as the play
// triangle it sits beside.
export const DELETE_ICON = svg(
  '<rect x="4.6" y=".9" width="2.8" height="1.3" rx=".5" />' +
    '<rect x="1.5" y="2.6" width="9" height="1.4" rx=".7" />' +
    '<path d="M2.8 4.9h6.4l-.62 5.3a1.1 1.1 0 0 1-1.1.97H4.52a1.1 1.1 0 0 1-1.1-.97Z" />',
);

// An "i" rather than a "?": a question mark small enough to sit inside a 14 px ring
// turns to mush, and an unringed one means hand-rolling a curve that only looks
// right at one size. A ring, a dot and a bar are three primitives and read at any.
export const HELP_ICON = svg(
  '<path fill-rule="evenodd" d="M6 .6a5.4 5.4 0 1 0 0 10.8A5.4 5.4 0 0 0 6 .6Zm0 1.4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" />' +
    '<circle cx="6" cy="3.7" r=".8" />' +
    '<rect x="5.3" y="5.1" width="1.4" height="3.6" rx=".7" />',
);

// Points left. Collapsed, CSS rotates it rather than swapping in a second icon.
export const CHEVRON_ICON = svg('<path d="M7.4 1.6 8.6 2.8 5.4 6l3.2 3.2-1.2 1.2L3 6Z" />');

// A magnifier, to say that the − and + beside it are a zoom and not a stepper.
// Ring drawn as two circles with the inner one punched out by evenodd, since
// everything here is filled rather than stroked.
export const ZOOM_ICON = svg(
  '<path fill-rule="evenodd" d="M5 .8a4.2 4.2 0 1 0 0 8.4A4.2 4.2 0 0 0 5 .8Zm0 1.4a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z" />' +
    '<path d="m8.1 7.1 3.1 3.1-1 1-3.1-3.1Z" />',
);
