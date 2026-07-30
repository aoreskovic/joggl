// The calendar behind "Jump to a date".
//
// Only the arithmetic is here — the grid layout, the month step and the label. The
// dialog around it is checked by `npm run uicheck`; these are the parts that would
// silently show the wrong month, which is worse than a dialog that looks odd
// because the day it lands on is the day time gets booked against.

import assert from 'node:assert/strict';
import test from 'node:test';

import { addMonths, monthGrid, monthLabel, WEEKDAY_INITIALS } from '../renderer/js/util.js';

const keys = (grid) => grid.flat().map((d) => d.key);

test('the grid always holds six weeks, so stepping months cannot resize it', () => {
  for (const key of ['2026-02-01', '2026-07-30', '2026-08-31', '2024-02-29']) {
    const grid = monthGrid(key);
    assert.equal(grid.length, 6, key);
    assert.ok(
      grid.every((week) => week.length === 7),
      key,
    );
  }
});

test('it starts on a Monday, matching the dd.mm.yyyy the app writes elsewhere', () => {
  assert.equal(WEEKDAY_INITIALS[0], 'Mo');
  // 1 July 2026 is a Wednesday, so the grid opens on Monday 29 June.
  assert.equal(monthGrid('2026-07-15')[0][0].key, '2026-06-29');
});

test('a month starting on a Monday still leads with the previous month, never a gap', () => {
  // 1 June 2026 is a Monday.
  const first = monthGrid('2026-06-10')[0];
  assert.equal(first[0].key, '2026-06-01');
  assert.equal(first[0].inMonth, true);
});

test('days either side are present but marked out of the month', () => {
  const grid = monthGrid('2026-07-15');
  const june = grid.flat().filter((d) => d.key.startsWith('2026-06'));
  assert.ok(june.length > 0);
  assert.ok(
    june.every((d) => d.inMonth === false),
    'the lead-in is shown greyed, not blanked',
  );
  assert.ok(
    grid.flat().filter((d) => d.key.startsWith('2026-07')).every((d) => d.inMonth === true),
  );
});

test('every day of the month appears exactly once', () => {
  const all = keys(monthGrid('2026-07-15')).filter((k) => k.startsWith('2026-07'));
  assert.equal(all.length, 31);
  assert.equal(new Set(all).size, 31);
});

test('the days run consecutively with no repeat and no skip', () => {
  const all = keys(monthGrid('2026-03-10'));
  assert.equal(all.length, 42);
  for (let i = 1; i < all.length; i++) {
    const gap = (Date.parse(all[i]) - Date.parse(all[i - 1])) / 86400000;
    // Parsed as UTC on both sides, so a DST change cancels out rather than
    // showing up as 0.958 of a day. March is deliberate: the clocks change in it.
    assert.equal(gap, 1, `${all[i - 1]} → ${all[i]}`);
  }
});

test('a month step from the 31st clamps instead of skipping the month', () => {
  // The bug this guards: 31 March less a month is 31 February, which rolls forward
  // to 3 March — back into the month it started from.
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2026-05-31', 1), '2026-06-30');
  assert.equal(addMonths('2024-03-31', -1), '2024-02-29', 'a leap year keeps the 29th');
});

test('a month step crosses the year in both directions', () => {
  assert.equal(addMonths('2026-01-15', -1), '2025-12-15');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
});

test('the month label names the month and the year', () => {
  assert.equal(monthLabel('2026-07-30'), 'July 2026');
  assert.equal(monthLabel('2026-01-01'), 'January 2026');
});
