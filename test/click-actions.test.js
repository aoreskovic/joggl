// Which editor a double click opens.
//
// The stubs answer `closest` for whole selector strings rather than re-implementing
// CSS matching, and the selectors are imported rather than retyped — a test that
// carried its own copy of them would keep passing after the markup moved on.

import assert from 'node:assert/strict';
import test from 'node:test';

import { editorForTarget, ENTRY, KEEPS_ITS_OWN, TASK_NAME } from '../renderer/js/click-actions.js';

/** @param {string[]} hits selectors this element sits inside */
const target = (...hits) => ({ closest: (selector) => (hits.includes(selector) ? {} : null) });

test('the task name and its key open Edit task', () => {
  assert.equal(editorForTarget(target(ENTRY, TASK_NAME)), 'task');
});

test('anywhere else on a row opens the work description', () => {
  assert.equal(editorForTarget(target(ENTRY)), 'comment');
});

test('a day-view block is all label, so it opens the work description', () => {
  // The block carries no separate title region, so there is no "anywhere else" on
  // it — the rule resolves the same way whichever part was hit.
  assert.equal(editorForTarget(target(ENTRY)), 'comment');
});

test('the time fields and the row buttons keep their own double click', () => {
  // Double-clicking a time field selects its text, and a button is just pressed
  // twice. Opening a dialog over either would take the gesture away.
  assert.equal(editorForTarget(target(ENTRY, KEEPS_ITS_OWN)), null);
  assert.equal(editorForTarget(target(ENTRY, TASK_NAME, KEEPS_ITS_OWN)), null, 'skip wins');
});

test('a double click outside any entry does nothing', () => {
  assert.equal(editorForTarget(target()), null);
  assert.equal(editorForTarget(target(TASK_NAME)), null, 'a stray match is not an entry');
});

test('a missing or foreign target is not an error', () => {
  assert.equal(editorForTarget(null), null);
  assert.equal(editorForTarget(undefined), null);
  assert.equal(editorForTarget({}), null, 'anything without closest, e.g. the document');
});
