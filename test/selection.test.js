import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pruned, selectOnly, toggled } from '../renderer/js/selection-model.js';

const ids = (set) => [...set].sort();

test('a plain click replaces whatever was selected', () => {
  assert.deepEqual(ids(selectOnly('a')), ['a']);
  // Not an addition to the last one — the whole point of the plain click.
  assert.deepEqual(ids(selectOnly('b')), ['b']);
});

test('nothing selected is an empty set, never null', () => {
  assert.deepEqual(ids(selectOnly(null)), []);
  assert.deepEqual(ids(selectOnly(undefined)), []);
});

test('Ctrl+click adds one, and Ctrl+click again takes it back out', () => {
  const one = toggled(new Set(['a']), 'b');
  assert.deepEqual(ids(one), ['a', 'b']);
  assert.deepEqual(ids(toggled(one, 'a')), ['b']);
  assert.deepEqual(ids(toggled(toggled(one, 'a'), 'b')), []);
});

test('toggling returns a new set rather than mutating the one it was given', () => {
  const before = new Set(['a']);
  const after = toggled(before, 'b');
  assert.deepEqual(ids(before), ['a'], 'the original is untouched');
  assert.deepEqual(ids(after), ['a', 'b']);
});

/**
 * An entry being deleted has to leave the selection, or Ctrl+C and Delete would go
 * on acting on something that is not there. Answered by filtering against what the
 * app actually holds, rather than by bookkeeping at every delete site — one rule,
 * and no path can forget to run it.
 */
test('an id that no longer stands for anything is dropped', () => {
  const present = new Set(['a', 'c']);
  assert.deepEqual(ids(pruned(new Set(['a', 'b', 'c']), present)), ['a', 'c']);
  assert.deepEqual(ids(pruned(new Set(), present)), []);
  assert.deepEqual(ids(pruned(new Set(['b']), present)), []);
});
