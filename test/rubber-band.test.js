import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canStartBand, enclosedIds, normalisedRect } from '../renderer/js/rubber-band.js';

const box = (id, top, bottom, left = 10, right = 90) => ({ id, top, bottom, left, right });

/** A stand-in for an element, with just the `closest` the predicate asks for. */
const target = (...selectors) => ({
  closest: (query) => (selectors.some((s) => query.includes(s)) ? {} : null),
});

test('a box drawn in any direction is the same box', () => {
  const downRight = normalisedRect({ x: 10, y: 20 }, { x: 100, y: 200 });
  const upLeft = normalisedRect({ x: 100, y: 200 }, { x: 10, y: 20 });
  assert.deepEqual(downRight, { left: 10, right: 100, top: 20, bottom: 200 });
  assert.deepEqual(upLeft, downRight, 'dragging up and left draws the same rectangle');
});

/**
 * Enclosure, not intersection. A band drawn down a column of full-width blocks
 * crosses every one of them; catching what it merely touched would select the lot.
 */
test('a block is caught only when the box contains all of it', () => {
  const boxes = [box('inside', 30, 60), box('crossed', 90, 300), box('elsewhere', 400, 450)];
  const rect = normalisedRect({ x: 0, y: 10 }, { x: 100, y: 200 });
  assert.deepEqual(enclosedIds(rect, boxes), ['inside']);
});

test('a block wider than the band is not caught, however tall the band is', () => {
  const boxes = [box('wide', 30, 60, 0, 500)];
  const rect = normalisedRect({ x: 0, y: 0 }, { x: 100, y: 900 });
  assert.deepEqual(enclosedIds(rect, boxes), []);
});

test('a band touching nothing catches nothing, and never throws on an empty grid', () => {
  const rect = normalisedRect({ x: 0, y: 0 }, { x: 5, y: 5 });
  assert.deepEqual(enclosedIds(rect, [box('a', 30, 60)]), []);
  assert.deepEqual(enclosedIds(rect, []), []);
  assert.deepEqual(enclosedIds(rect, null), []);
});

/**
 * A press on a block is already a move gesture, and the two would fight over the
 * same mousedown. The band starts on empty grid only.
 */
test('the band refuses to start anywhere a press already means something', () => {
  assert.equal(canStartBand(target('#schedule-grid')), true);
  assert.equal(canStartBand(target('#week-scroll')), true);
  assert.equal(canStartBand(target('#schedule-grid', '.sched-entry-block')), false);
  assert.equal(canStartBand(target('#week-scroll', '.sched-handle')), false);
  assert.equal(canStartBand(target('#week-scroll', '.week-colhead')), false);
  assert.equal(canStartBand(target('.sched-quick-entry')), false);
  assert.equal(canStartBand(target('#task-list')), false, 'not a grid at all');
  assert.equal(canStartBand(null), false);
});
