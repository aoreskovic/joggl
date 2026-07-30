// Arrow-key navigation over a list.
//
// One helper serves five lists, so the rule that matters is what happens when
// nothing is active: `activate()` must answer null, because in three of those five
// places Enter already means something — start a timer on typed text, commit free
// text, pick a lone match — and pre-selecting the first row would silently change
// all three.
//
// The DOM here is a few stub objects rather than a real one: the helper only ever
// asks a container for rows and toggles a class, and standing up jsdom for that
// would add the dependency CLAUDE.md keeps out.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createRowNav } from '../renderer/js/keynav.js';

function fakeList(count) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: i,
    classes: new Set(),
    scrolled: 0,
    classList: {
      toggle(name, on) {
        if (on) rows[i].classes.add(name);
        else rows[i].classes.delete(name);
      },
    },
    scrollIntoView() {
      rows[i].scrolled++;
    },
  }));
  return {
    rows,
    container: { querySelectorAll: () => rows },
    activeIndex: () => rows.findIndex((r) => r.classes.has('is-keynav-active')),
  };
}

const nav = (list) => createRowNav({ container: () => list.container, rowSelector: '.row' });
const key = (k) => ({ key: k });

test('nothing is active until an arrow key is pressed', () => {
  const list = fakeList(3);
  const n = nav(list);
  assert.equal(n.active(), null);
  assert.equal(n.activate(), null);
  assert.equal(list.activeIndex(), -1);
});

test('ArrowDown enters at the top, ArrowUp enters at the bottom', () => {
  const down = fakeList(3);
  const a = nav(down);
  a.handleKey(key('ArrowDown'));
  assert.equal(down.activeIndex(), 0);

  const up = fakeList(3);
  const b = nav(up);
  b.handleKey(key('ArrowUp'));
  assert.equal(up.activeIndex(), 2, 'Up from nothing lands on the last row, like a menu');
});

test('it walks the list and wraps at both ends', () => {
  const list = fakeList(3);
  const n = nav(list);
  n.handleKey(key('ArrowDown'));
  n.handleKey(key('ArrowDown'));
  assert.equal(list.activeIndex(), 1);
  n.handleKey(key('ArrowDown'));
  assert.equal(list.activeIndex(), 2);
  n.handleKey(key('ArrowDown'));
  assert.equal(list.activeIndex(), 0, 'wraps to the top');
  n.handleKey(key('ArrowUp'));
  assert.equal(list.activeIndex(), 2, 'and back round the other way');
});

test('Home and End jump to the ends', () => {
  const list = fakeList(5);
  const n = nav(list);
  n.handleKey(key('End'));
  assert.equal(list.activeIndex(), 4);
  n.handleKey(key('Home'));
  assert.equal(list.activeIndex(), 0);
});

test('only one row is ever marked', () => {
  const list = fakeList(4);
  const n = nav(list);
  n.handleKey(key('ArrowDown'));
  n.handleKey(key('ArrowDown'));
  assert.equal(list.rows.filter((r) => r.classes.has('is-keynav-active')).length, 1);
});

test('the active row is scrolled into view, so a long list stays usable', () => {
  const list = fakeList(3);
  const n = nav(list);
  n.handleKey(key('End'));
  assert.ok(list.rows[2].scrolled > 0);
});

test('keys it does not own are left alone', () => {
  const n = nav(fakeList(3));
  for (const k of ['Enter', 'Escape', 'Tab', 'a', 'ArrowLeft']) {
    assert.equal(n.handleKey(key(k)), false, k);
  }
});

test('arrow keys it does own report as consumed', () => {
  const n = nav(fakeList(3));
  for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
    assert.equal(n.handleKey(key(k)), true, k);
  }
});

test('an empty list swallows the arrows without activating anything', () => {
  const list = fakeList(0);
  const n = nav(list);
  assert.equal(n.handleKey(key('ArrowDown')), true, 'still consumed, so the caret stays put');
  assert.equal(n.activate(), null);
});

test('reset clears the selection, because a render replaces the rows', () => {
  const list = fakeList(3);
  const n = nav(list);
  n.handleKey(key('ArrowDown'));
  assert.equal(n.activate(), list.rows[0]);
  n.reset();
  assert.equal(n.activate(), null, 'Enter falls back to what it meant before');
});

test('a shorter list after a render cannot activate a row that is gone', () => {
  // The rows are re-queried every time rather than held, so an index that no
  // longer exists answers null instead of a detached node.
  const list = fakeList(3);
  const n = createRowNav({
    container: () => ({ querySelectorAll: () => list.rows.slice(0, shrinkTo) }),
    rowSelector: '.row',
  });
  let shrinkTo = 3;
  n.handleKey(key('End'));
  assert.equal(n.activate(), list.rows[2]);
  shrinkTo = 1;
  assert.equal(n.activate(), null);
});

test('a missing container is not an error', () => {
  const n = createRowNav({ container: () => null, rowSelector: '.row' });
  assert.deepEqual(n.rows(), []);
  assert.equal(n.activate(), null);
  assert.equal(n.handleKey(key('ArrowDown')), true);
});
