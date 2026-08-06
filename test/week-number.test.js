import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isoWeek, weekLabel } from '../renderer/js/week-range.js';

/**
 * The four boundaries the design doc names. Every one of them is a week whose ISO
 * week-year is not the calendar year of the days in it, which is exactly the case
 * that looks like a bug to anyone who has not read ISO 8601.
 */
test('the boundary weeks from the design doc', () => {
  assert.deepEqual(isoWeek('2025-12-29'), { week: 1, weekYear: 2026 });
  assert.deepEqual(isoWeek('2026-01-04'), { week: 1, weekYear: 2026 });
  assert.deepEqual(isoWeek('2026-07-27'), { week: 31, weekYear: 2026 });
  assert.deepEqual(isoWeek('2026-08-02'), { week: 31, weekYear: 2026 }, 'the Sunday is the same week');
  assert.deepEqual(isoWeek('2026-12-28'), { week: 53, weekYear: 2026 });
  assert.deepEqual(isoWeek('2027-01-03'), { week: 53, weekYear: 2026 });
  assert.deepEqual(isoWeek('2027-01-04'), { week: 1, weekYear: 2027 });
});

/**
 * 1 January on each of the seven weekdays. On a Friday, Saturday or Sunday it
 * belongs to the last week of the outgoing year, which is the half of the rule
 * nobody expects.
 */
test('1 January lands in week 1 only when it falls Monday to Thursday', () => {
  assert.deepEqual(isoWeek('2024-01-01'), { week: 1, weekYear: 2024 }, 'Monday');
  assert.deepEqual(isoWeek('2019-01-01'), { week: 1, weekYear: 2019 }, 'Tuesday');
  assert.deepEqual(isoWeek('2025-01-01'), { week: 1, weekYear: 2025 }, 'Wednesday');
  assert.deepEqual(isoWeek('2026-01-01'), { week: 1, weekYear: 2026 }, 'Thursday');
  assert.deepEqual(isoWeek('2027-01-01'), { week: 53, weekYear: 2026 }, 'Friday');
  assert.deepEqual(isoWeek('2022-01-01'), { week: 52, weekYear: 2021 }, 'Saturday');
  assert.deepEqual(isoWeek('2023-01-01'), { week: 52, weekYear: 2022 }, 'Sunday');
});

test('a year has 53 weeks when it starts on a Thursday, and 52 otherwise', () => {
  // 2026 starts on a Thursday, so it has 53.
  assert.equal(isoWeek('2026-12-28').week, 53);
  // 2027 starts on a Friday, so its first three days belong to 2026 and it has 52.
  assert.equal(isoWeek('2027-12-27').week, 52);
  assert.deepEqual(isoWeek('2028-01-03'), { week: 1, weekYear: 2028 });
});

test("the label carries the year only when the week-year is not the Monday's", () => {
  assert.equal(weekLabel('2026-07-29'), '27 Jul – 2 Aug · week 31');
  // Monday 29 Dec 2025 is in week 1 of 2026 — say so, or it reads as this year's.
  assert.equal(weekLabel('2025-12-31'), '29 Dec – 4 Jan · week 1 of 2026');
  // Monday 28 Dec 2026 is in week 53 of 2026, which *is* the Monday's year.
  assert.equal(weekLabel('2026-12-30'), '28 Dec – 3 Jan · week 53');
});
