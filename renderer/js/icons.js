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
