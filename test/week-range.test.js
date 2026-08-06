import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addWeeks, visibleWeekDays, weekDays, weekEnd, weekStart } from '../renderer/js/week-range.js';

test('a week runs Monday to Sunday, whichever day you name', () => {
  // Wed 29 Jul 2026 sits in the week Mon 27 Jul – Sun 2 Aug.
  assert.equal(weekStart('2026-07-29'), '2026-07-27');
  assert.equal(weekEnd('2026-07-29'), '2026-08-02');
  assert.equal(weekStart('2026-07-27'), '2026-07-27', 'a Monday is its own start');
  assert.equal(weekStart('2026-08-02'), '2026-07-27', 'a Sunday belongs to the week before it');
});

test('weekDays gives seven keys, Monday first', () => {
  assert.deepEqual(weekDays('2026-08-02'), [
    '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30',
    '2026-07-31', '2026-08-01', '2026-08-02',
  ]);
});

test('stepping weeks crosses a year boundary without arithmetic of its own', () => {
  assert.equal(addWeeks('2026-12-30', 1), '2027-01-06');
  assert.equal(addWeeks('2027-01-06', -1), '2026-12-30');
  assert.equal(weekStart(addWeeks('2026-12-30', 1)), '2027-01-04');
});

test('five-day mode shows Monday to Friday', () => {
  assert.deepEqual(visibleWeekDays('2026-07-29'), [
    '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31',
  ]);
});

test('seven-day mode shows all seven', () => {
  assert.equal(visibleWeekDays('2026-07-29', { sevenDay: true }).length, 7);
});

/**
 * The one rule this view must never break: time that cannot be seen is time that
 * does not get synced. Five-day mode means "hide the weekend when it is empty".
 */
test('a weekend day holding time is shown even in five-day mode', () => {
  const days = visibleWeekDays('2026-07-29', { hasTime: (key) => key === '2026-08-01' });
  assert.deepEqual(days, [
    '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01',
  ]);
  assert.equal(days.includes('2026-08-02'), false, 'the empty Sunday stays hidden');
});

test('a weekday holding nothing is still shown', () => {
  assert.equal(visibleWeekDays('2026-07-29', { hasTime: () => false }).length, 5);
});
