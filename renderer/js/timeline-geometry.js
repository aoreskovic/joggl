// The timeline's geometry, shared by every column rendered.
//
// Split out of timeline.js's `view` singleton, and DOM-free so the arithmetic can
// be tested without a browser. One grid per render, day view or week: every column
// shares one hour range, or the rows do not line up across the week and the hour
// gutter — drawn once, for all of them — would mean a different time in each column.
//
// The day is a parameter rather than a field. The singleton held one absolute
// `rangeStartMs`, which cannot serve five columns: each day's hour 7 is a different
// instant, and across a clock change two of them are not even a constant apart.

import { HOUR, startOfDayMs } from './util.js';

/** The hour range every column is drawn against, and the zoom it is drawn at. */
export const grid = { startHour: 7, endHour: 20, pxPerMin: 1.5, totalMinutes: 13 * 60 };

export function setGrid({ startHour, endHour, pxPerMin }) {
  grid.startHour = startHour;
  grid.endHour = endHour;
  grid.pxPerMin = pxPerMin;
  grid.totalMinutes = (endHour - startHour) * 60;
}

/** Local midnight on `dayKey`, plus the range's first hour. */
export function rangeStartMs(dayKey) {
  return startOfDayMs(dayKey) + grid.startHour * HOUR;
}

export function offsetPxOf(ts, dayKey) {
  return ((ts - rangeStartMs(dayKey)) / 60_000) * grid.pxPerMin;
}

export function tsAtOffsetPx(px, dayKey) {
  return rangeStartMs(dayKey) + (px / grid.pxPerMin) * 60_000;
}

export function gridHeightPx() {
  return grid.totalMinutes * grid.pxPerMin;
}

/**
 * The hour range covering every day passed.
 *
 * A full working day at minimum, widened to cover everything logged on any of the
 * days, and — when today is among them — widened to the current hour. Lifted
 * verbatim out of `renderTimeline`, with the loop over days as the only addition:
 * with one day it computes exactly what the day view computed before.
 *
 * @param {Map<string, {startTs: number, endTs: number|null}[]>} entriesByDay
 * @param {{today?: string|null, timerStartTs?: number|null, now?: number}} [opts]
 */
export function computeRange(entriesByDay, { today = null, timerStartTs = null, now = Date.now() } = {}) {
  let startHour = 7;
  let endHour = 20;

  if (today !== null && entriesByDay.has(today)) {
    const nowHour = new Date(now).getHours();
    endHour = Math.max(endHour, Math.min(24, nowHour + 2));
    startHour = Math.min(startHour, Math.max(0, nowHour - 1));
  }

  for (const [dayKey, entries] of entriesByDay) {
    const dayStart = startOfDayMs(dayKey);
    // An entry still running has no end, and `Math.min(x, null)` is 0 — which would
    // drag the range back to midnight rather than leave it alone.
    const stamps = (entries ?? [])
      .filter((e) => e.endTs !== null && e.endTs !== undefined)
      .flatMap((e) => [e.startTs, e.endTs]);

    if (timerStartTs !== null && dayKey === today) stamps.push(timerStartTs, now);
    if (stamps.length === 0) continue;

    startHour = Math.min(startHour, Math.max(0, Math.floor((Math.min(...stamps) - dayStart) / HOUR) - 1));
    endHour = Math.max(endHour, Math.min(24, Math.ceil((Math.max(...stamps) - dayStart) / HOUR) + 1));
  }

  return { startHour, endHour };
}
