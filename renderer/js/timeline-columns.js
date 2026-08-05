// Which day a point on the timeline belongs to, and where a block sits inside it.
//
// A column owns nothing but its day and its box; the hour range and the zoom are
// shared, and live in timeline-geometry.js. With one column this is exactly the day
// view: `columnAt` answers the selected day for every point inside the grid, which
// is what `gridTimeAt` used to answer unconditionally.

import { grid, gridHeightPx, offsetPxOf, tsAtOffsetPx } from './timeline-geometry.js';
import { snapToQuarter } from './util.js';

/**
 * The hour gutter's width, and it is pinned: the labels are capped at 12px so they
 * cannot outgrow it, and the CSS carries the same 40 as `left: 40px`.
 */
export const GUTTER_PX = 40;

/** dateKey -> the element that day's blocks are positioned inside. */
const columns = new Map();

export function setColumns(pairs) {
  columns.clear();
  for (const [dateKey, el] of pairs) if (el) columns.set(dateKey, el);
}

export function columnFor(dayKey) {
  return columns.get(dayKey) ?? null;
}

/**
 * The day and snapped timestamp a cursor position points at, or null when it falls
 * outside every column.
 *
 * getBoundingClientRect is viewport-relative and already accounts for the panel's
 * scroll position. Adding scrollTop on top of it — as the plugin did — counted the
 * scroll twice, so once the view had auto-scrolled to now, a click at 16:00 landed
 * somewhere around 21:00. That is why this arithmetic exists exactly once.
 *
 * The bound is the full rect, horizontal included. When only `onGridClick` called
 * this, X was already constrained by event dispatch — the listener is on the grid,
 * so nothing outside it ever arrived. The issue drag calls it from document-level
 * handlers where nothing constrains X, and with only the vertical test a press on a
 * task row, a few pixels sideways, and a release still over the task list booked a
 * 30-minute entry at whatever time that row's Y happened to map to. With several
 * columns the horizontal test stops being a bound and starts being the answer to
 * *which day*, which is the whole reason this function replaced `gridTimeAt`.
 */
export function columnAt(clientX, clientY) {
  for (const [dateKey, el] of columns) {
    const rect = el.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right) continue;

    const y = clientY - rect.top;
    if (y < 0 || y > gridHeightPx()) continue;

    // Snapped against this column's own midnight, never the selected day's: the two
    // are the same day today, and will not be once a week is on screen.
    return { dateKey, ts: snapToQuarter(tsAtOffsetPx(y, dateKey), dateKey) };
  }
  return null;
}

/**
 * Position a block inside its column.
 *
 * `slot` comes from `computeColumns` — the overlap solver — and is per day, so a
 * block never narrows more than its own day's neighbours require.
 */
export function placeBlock(el, startTs, endTs, dayKey, slot, minHeightPx = 6) {
  const durMin = Math.max(1, (endTs - startTs) / 60_000);
  el.style.top = `${offsetPxOf(startTs, dayKey)}px`;
  el.style.minHeight = `${Math.max(minHeightPx, durMin * grid.pxPerMin)}px`;

  if (slot.totalCols === 1) {
    el.style.left = `${GUTTER_PX}px`;
    el.style.right = '4px';
    el.style.width = '';
  } else {
    const span = `(100% - ${GUTTER_PX + 4}px)`;
    el.style.left = `calc(${GUTTER_PX}px + ${slot.col / slot.totalCols} * ${span})`;
    el.style.width = `calc(${1 / slot.totalCols} * ${span} - 1px)`;
    el.style.right = 'auto';
  }
}
