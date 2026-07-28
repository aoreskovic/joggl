// Quarter-hour snapping. Snapping the drag *offset* instead of the resulting
// clock time is the bug this replaces: an entry that started at 09:07 would then
// only ever land on :07, :22, :37, and its shortest reachable length depended on
// the minute the timer happened to be stopped.

import assert from 'node:assert/strict';
import test from 'node:test';

import { QUARTER, snapToQuarter } from '../renderer/js/util.js';

const DAY = '2026-07-28';
const at = (h, m = 0, s = 0) => new Date(2026, 6, 28, h, m, s, 0).getTime();
const hhmm = (ts) => {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

test('a quarter hour is left where it is', () => {
  for (const m of [0, 15, 30, 45]) {
    assert.equal(snapToQuarter(at(9, m), DAY), at(9, m));
  }
});

test('rounds to the nearer quarter', () => {
  assert.equal(hhmm(snapToQuarter(at(9, 7), DAY)), '09:00');
  assert.equal(hhmm(snapToQuarter(at(9, 8), DAY)), '09:15');
  assert.equal(hhmm(snapToQuarter(at(9, 22), DAY)), '09:15');
  assert.equal(hhmm(snapToQuarter(at(9, 23), DAY)), '09:30');
  assert.equal(hhmm(snapToQuarter(at(9, 53), DAY)), '10:00');
});

test('seconds do not survive the snap', () => {
  assert.equal(snapToQuarter(at(9, 14, 59), DAY), at(9, 15));
  assert.equal(new Date(snapToQuarter(at(9, 7, 30), DAY)).getSeconds(), 0);
});

test('lands on the clock grid regardless of where the drag started', () => {
  // The old behaviour: 09:07 + 20 minutes of drag snapped to a 15-minute offset
  // and produced 09:22. It must produce 09:30.
  const dragged = snapToQuarter(at(9, 7) + 20 * 60_000, DAY);
  assert.equal(hhmm(dragged), '09:30');

  // And every reachable position is a quarter hour, whatever the start minute.
  for (const startMinute of [3, 7, 11, 22, 47, 58]) {
    for (const dragMinutes of [-40, -13, 0, 6, 19, 74]) {
      const result = snapToQuarter(at(9, startMinute) + dragMinutes * 60_000, DAY);
      assert.equal(new Date(result).getMinutes() % 15, 0);
      assert.equal(new Date(result).getSeconds(), 0);
    }
  }
});

test('an entry can be resized down to exactly one quarter', () => {
  // A 47-minute entry from 09:07. Dragging the bottom handle back far enough
  // must be able to reach 15 minutes, not stop at 20.
  const start = snapToQuarter(at(9, 7), DAY); // 09:00
  const shortest = snapToQuarter(at(9, 54) - 40 * 60_000, DAY); // 09:14 → 09:15
  assert.equal(shortest - start, QUARTER);
});

test('works either side of midnight without drifting off the grid', () => {
  assert.equal(hhmm(snapToQuarter(at(0, 4), DAY)), '00:00');
  assert.equal(hhmm(snapToQuarter(at(23, 38), DAY)), '23:45');
  assert.equal(hhmm(snapToQuarter(at(23, 52), DAY)), '23:45');
  // Past the halfway point it rolls over into the next day's midnight.
  const rolled = snapToQuarter(at(23, 53), DAY);
  assert.equal(hhmm(rolled), '00:00');
  assert.equal(new Date(rolled).getDate(), 29);
});
