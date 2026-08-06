import { test } from 'node:test';
import assert from 'node:assert/strict';

import { nextBlockId } from '../renderer/js/block-nav.js';

const HOUR = 3_600_000;
const b = (id, day, hour) => ({ id, day, offsetMs: hour * HOUR });

// Mon holds three, Tue is empty, Wed holds one late, Thu holds one early.
const week = [
  b('mon-9', '2026-08-03', 9),
  b('mon-14', '2026-08-03', 14),
  b('mon-11', '2026-08-03', 11),
  b('wed-16', '2026-08-05', 16),
  b('thu-8', '2026-08-06', 8),
];

test('up and down move within one column, in time order and not DOM order', () => {
  // mon-11 is third in the array and second on the clock.
  assert.equal(nextBlockId(week, 'mon-9', 'ArrowDown'), 'mon-11');
  assert.equal(nextBlockId(week, 'mon-11', 'ArrowDown'), 'mon-14');
  assert.equal(nextBlockId(week, 'mon-14', 'ArrowUp'), 'mon-11');
});

/**
 * Clamped, not wrapped — which is what `wireRovingList` has always done, and the two
 * grids must not answer the same key differently.
 */
test('the ends of a column hold', () => {
  assert.equal(nextBlockId(week, 'mon-14', 'ArrowDown'), 'mon-14');
  assert.equal(nextBlockId(week, 'mon-9', 'ArrowUp'), 'mon-9');
});

test('Home and End go to the ends of the column, not of the week', () => {
  assert.equal(nextBlockId(week, 'mon-11', 'Home'), 'mon-9');
  assert.equal(nextBlockId(week, 'mon-9', 'End'), 'mon-14');
});

/**
 * Sideways lands on the block nearest the same time on the clock — what the eye
 * would call "across from here". Compared as an offset from midnight rather than as
 * a timestamp, so two columns either side of a clock change still line up.
 */
test('left and right cross to the nearest time in the next column that has anything', () => {
  // Tuesday is empty, so Monday 14:00 goes right to Wednesday.
  assert.equal(nextBlockId(week, 'mon-14', 'ArrowRight'), 'wed-16');
  assert.equal(nextBlockId(week, 'wed-16', 'ArrowLeft'), 'mon-14', 'the nearest of Monday’s three');
  assert.equal(nextBlockId(week, 'mon-9', 'ArrowRight'), 'wed-16', 'the only one there');
  assert.equal(nextBlockId(week, 'thu-8', 'ArrowLeft'), 'wed-16');
});

/**
 * Staying put rather than wrapping: a jump from Friday to Monday would read as the
 * week having stepped, which it has not.
 */
test('there is nothing past the ends of the week', () => {
  assert.equal(nextBlockId(week, 'mon-9', 'ArrowLeft'), null);
  assert.equal(nextBlockId(week, 'thu-8', 'ArrowRight'), null);
});

test('one column answers up and down and nothing else — the day view', () => {
  const day = [b('a', '2026-08-03', 9), b('c', '2026-08-03', 15), b('b', '2026-08-03', 12)];
  assert.equal(nextBlockId(day, 'a', 'ArrowDown'), 'b');
  assert.equal(nextBlockId(day, 'b', 'ArrowRight'), null);
  assert.equal(nextBlockId(day, 'b', 'ArrowLeft'), null);
});

test('a key nothing is bound to, and an id nothing holds, both answer null', () => {
  assert.equal(nextBlockId(week, 'mon-9', 'PageDown'), null);
  assert.equal(nextBlockId(week, 'nope', 'ArrowDown'), null);
  assert.equal(nextBlockId([], 'mon-9', 'ArrowDown'), null);
});
