// Which blocks a band drawn on the grid catches.
//
// Pure — no DOM — so the rule can be tested against a fixed set of boxes. The caller
// reads the boxes with getBoundingClientRect and does the drawing.

/**
 * Below this the gesture was a click, and a click on empty grid already means
 * something: it opens the quick-entry popup. Six, matching drag-drop.js, because a
 * hand that slips a few pixels while pressing must not swallow that.
 */
export const BAND_THRESHOLD_PX = 6;

/** The box between two points, whichever corner the drag began at. */
export function normalisedRect(a, b) {
  return {
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    top: Math.min(a.y, b.y),
    bottom: Math.max(a.y, b.y),
  };
}

/**
 * The ids of the boxes the band fully contains.
 *
 * **Enclosure, not intersection.** A block spans the whole width of its column, so a
 * band drawn down a column crosses every block it passes; catching what it merely
 * touched would mean a short drag selected the day. Requiring containment makes the
 * band say what it looks like it says.
 */
export function enclosedIds(rect, boxes) {
  return (boxes ?? [])
    .filter(
      (b) =>
        b.left >= rect.left && b.right <= rect.right &&
        b.top >= rect.top && b.bottom <= rect.bottom,
    )
    .map((b) => b.id);
}

/**
 * Whether a press here may start a band.
 *
 * A press on a block is already a move gesture and the two would fight over the same
 * mousedown; a press on a resize handle is a resize; a column head is a day selector
 * that happens to sit over its own column once scrolled. So: inside a grid, and on
 * none of those.
 *
 * Takes anything with `closest`, the same shape `editorForTarget` takes, so it can be
 * tested with an object instead of a DOM.
 */
export function canStartBand(target) {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.closest('.sched-entry-block, .sched-handle, .week-colhead, .sched-quick-entry')) {
    return false;
  }
  return Boolean(target.closest('#schedule-grid, #week-scroll'));
}
