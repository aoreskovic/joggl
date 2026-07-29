// Touching an entry without changing it must not mark it as needing a re-sync.
//
// Three paths ran the whole commit — a click on a day-view block runs mousedown,
// no movement, mouseup; focusing a time field and clicking away re-parses the
// value it already held; a drag dropped back where it started resolves the same
// start. Each of them flipped a `synced` entry to `pending`, so Finish Day
// offered to rewrite a worklog that was already correct.

import assert from 'node:assert/strict';
import test from 'node:test';

import { movedEntry, sameTimes } from '../renderer/js/entry-ops.js';
import { planFinishDay } from '../renderer/js/finish-day.js';

const T = (h, m = 0) => new Date(2026, 6, 29, h, m, 0, 0).getTime();
const DAY_START = T(0);

function synced(overrides = {}) {
  return {
    id: 'e1',
    issueKey: 'GEN-56',
    issueId: '10001',
    title: 'General',
    startTs: T(9),
    endTs: T(10),
    status: 'synced',
    worklogId: '60711',
    errorMsg: null,
    ...overrides,
  };
}

test('the same times compare equal', () => {
  assert.equal(sameTimes(synced(), { startTs: T(9), endTs: T(10) }), true);
});

test('a different start or end does not', () => {
  assert.equal(sameTimes(synced(), { startTs: T(9, 15), endTs: T(10) }), false);
  assert.equal(sameTimes(synced(), { startTs: T(9), endTs: T(10, 30) }), false);
});

test('a running entry compares equal to itself, and unequal to a finished one', () => {
  const running = synced({ endTs: null });
  assert.equal(sameTimes(running, { startTs: T(9), endTs: null }), true);
  assert.equal(sameTimes(running, { startTs: T(9), endTs: T(10) }), false);
});

test('a missing end and an absent one are the same thing', () => {
  // The day log stores null; a freshly built object may simply omit it.
  assert.equal(sameTimes({ startTs: T(9), endTs: null }, { startTs: T(9) }), true);
});

test('a click on a block resolves to no change, so nothing is re-sent', () => {
  const entry = synced();
  const before = { startTs: entry.startTs, endTs: entry.endTs };

  // A press and release with no movement leaves the entry exactly as it was.
  assert.equal(sameTimes(entry, before), true);

  // Which is what keeps it out of the Finish Day queue.
  assert.deepEqual(planFinishDay([entry]).toSubmit, []);
  assert.deepEqual(planFinishDay([entry]).alreadySynced.map((e) => e.id), ['e1']);
});

test('a drop back onto its own start is not a move', () => {
  const entry = synced();
  const dropped = movedEntry(entry, entry.startTs, DAY_START);
  assert.equal(sameTimes(dropped, entry), true);
});

test('a drop one quarter along is a move', () => {
  const entry = synced();
  const dropped = movedEntry(entry, T(9, 15), DAY_START);
  assert.equal(sameTimes(dropped, entry), false);
  assert.equal(dropped.endTs - dropped.startTs, entry.endTs - entry.startTs, 'and keeps its length');
});
