import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeRange,
  grid,
  gridHeightPx,
  offsetPxOf,
  rangeStartMs,
  setGrid,
  tsAtOffsetPx,
} from '../renderer/js/timeline-geometry.js';
import { HOUR, startOfDayMs } from '../renderer/js/util.js';

const DAY = '2026-07-28';
const OTHER = '2026-07-29';

/** A finished entry on `dayKey`, from `fromHour` to `toHour` local time. */
function entry(dayKey, fromHour, toHour) {
  const base = startOfDayMs(dayKey);
  return { id: `${dayKey}-${fromHour}`, startTs: base + fromHour * HOUR, endTs: base + toHour * HOUR };
}

test('computeRange falls back to the working day when nothing is logged', () => {
  assert.deepEqual(computeRange(new Map([[DAY, []]])), { startHour: 7, endHour: 20 });
});

test('computeRange widens the top for an early block', () => {
  const range = computeRange(new Map([[DAY, [entry(DAY, 6.5, 8)]]]));
  assert.equal(range.startHour, 5);
  assert.equal(range.endHour, 20);
});

test('computeRange widens the bottom for a late block', () => {
  const range = computeRange(new Map([[DAY, [entry(DAY, 9, 21)]]]));
  assert.equal(range.startHour, 7);
  assert.equal(range.endHour, 22);
});

test('computeRange clamps to the day', () => {
  const range = computeRange(new Map([[DAY, [entry(DAY, 0, 24)]]]));
  assert.equal(range.startHour, 0);
  assert.equal(range.endHour, 24);
});

test('one early block on one day of a week widens every column', () => {
  const range = computeRange(
    new Map([
      [DAY, [entry(DAY, 9, 10)]],
      [OTHER, [entry(OTHER, 6.5, 7)]],
    ]),
  );
  assert.deepEqual(range, { startHour: 5, endHour: 20 });
});

test('an unfinished entry contributes nothing', () => {
  const open = { id: 'open', startTs: startOfDayMs(DAY) + 3 * HOUR, endTs: null };
  assert.deepEqual(computeRange(new Map([[DAY, [open]]])), { startHour: 7, endHour: 20 });
});

test("today's current hour widens the range only when today is among the days shown", () => {
  const now = startOfDayMs(DAY) + 22 * HOUR;

  const showingToday = computeRange(new Map([[DAY, []]]), { today: DAY, now });
  assert.equal(showingToday.endHour, 24, 'now + 2, clamped to 24');
  assert.equal(showingToday.startHour, 7, 'nowHour - 1 is later than 7, so 7 stands');

  const notShowingToday = computeRange(new Map([[OTHER, []]]), { today: DAY, now });
  assert.deepEqual(notShowingToday, { startHour: 7, endHour: 20 });
});

test('an early hour of the morning pulls the top down to nowHour - 1', () => {
  const now = startOfDayMs(DAY) + 3 * HOUR;
  const range = computeRange(new Map([[DAY, []]]), { today: DAY, now });
  assert.equal(range.startHour, 2);
});

test('a running timer is counted, on today only', () => {
  const now = startOfDayMs(DAY) + 9 * HOUR;
  const timerStartTs = startOfDayMs(DAY) + 4 * HOUR;

  const counted = computeRange(new Map([[DAY, []]]), { today: DAY, timerStartTs, now });
  assert.equal(counted.startHour, 3);

  // The same timer while a different day is on screen touches nothing.
  const ignored = computeRange(new Map([[OTHER, []]]), { today: DAY, timerStartTs, now });
  assert.deepEqual(ignored, { startHour: 7, endHour: 20 });
});

test('setGrid derives the height, and the conversions are inverses', () => {
  setGrid({ startHour: 7, endHour: 20, pxPerMin: 1.5 });
  assert.equal(grid.totalMinutes, 13 * 60);
  assert.equal(gridHeightPx(), 13 * 60 * 1.5);

  assert.equal(rangeStartMs(DAY), startOfDayMs(DAY) + 7 * HOUR);
  assert.equal(offsetPxOf(rangeStartMs(DAY), DAY), 0);
  assert.equal(offsetPxOf(rangeStartMs(DAY) + HOUR, DAY), 90);
  assert.equal(tsAtOffsetPx(90, DAY), rangeStartMs(DAY) + HOUR);
});

test('the conversions are per day, so each column has its own hour 7', () => {
  setGrid({ startHour: 7, endHour: 20, pxPerMin: 1.5 });
  assert.equal(rangeStartMs(OTHER), startOfDayMs(OTHER) + 7 * HOUR);
  assert.equal(offsetPxOf(rangeStartMs(OTHER), OTHER), 0);
});
