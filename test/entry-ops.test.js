// Duplicating an entry. The rule that matters is that the copy inherits no
// worklog: carrying one across would make the next Finish Day rewrite the
// original's worklog with the copy's times, so the original loses its record and
// the copy never gets one.

import assert from 'node:assert/strict';
import test from 'node:test';

import { duplicateOf, overlappingIds } from '../renderer/js/entry-ops.js';
import { planFinishDay } from '../renderer/js/finish-day.js';

const T = (h, m = 0) => new Date(2026, 6, 28, h, m, 0, 0).getTime();

function entry(overrides = {}) {
  return {
    id: 'original',
    issueKey: 'PROJ-1',
    issueId: '10001',
    title: 'Meetings',
    startTs: T(9),
    endTs: T(10, 30),
    status: 'pending',
    worklogId: null,
    errorMsg: null,
    ...overrides,
  };
}

test('the copy covers exactly the same stretch of time', () => {
  const copy = duplicateOf(entry(), 'copy');
  assert.equal(copy.startTs, T(9));
  assert.equal(copy.endTs, T(10, 30));
  assert.equal(copy.endTs - copy.startTs, 90 * 60_000);
});

test('the copy keeps the issue and the title', () => {
  const copy = duplicateOf(entry(), 'copy');
  assert.equal(copy.issueKey, 'PROJ-1');
  assert.equal(copy.issueId, '10001');
  assert.equal(copy.title, 'Meetings');
});

test('the copy gets the new id, not the original one', () => {
  assert.equal(duplicateOf(entry(), 'copy').id, 'copy');
});

test('duplicating a synced entry does not carry its worklog across', () => {
  const original = entry({ status: 'synced', worklogId: '60504' });
  const copy = duplicateOf(original, 'copy');

  assert.equal(copy.worklogId, null);
  assert.equal(copy.status, 'pending');

  // The consequence that makes this matter: the pair produces one rewrite and
  // one new worklog, not two rewrites of the same one.
  const plan = planFinishDay([original, copy]);
  assert.deepEqual(plan.alreadySynced.map((e) => e.id), ['original']);
  assert.deepEqual(plan.toSubmit.map((e) => e.id), ['copy']);
});

test('duplicating a failed entry clears the error', () => {
  const copy = duplicateOf(entry({ status: 'error', errorMsg: 'HTTP 500' }), 'copy');
  assert.equal(copy.status, 'pending');
  assert.equal(copy.errorMsg, null);
});

test('duplicating a Jira-side worklog produces a normal local entry', () => {
  const external = {
    ...entry({ id: 'jira:900', status: 'synced', worklogId: '900' }),
    external: true,
  };
  const copy = duplicateOf(external, 'copy');

  assert.equal(copy.external, undefined, 'a copy is Joggl’s own entry, not Jira’s record');
  assert.equal(copy.worklogId, null);
  assert.equal(copy.status, 'pending');
  // It is a normal entry now, so Finish Day will give it its own worklog.
  assert.deepEqual(planFinishDay([copy]).toSubmit.map((e) => e.id), ['copy']);
});

test('a copy with no issue key is local, not pending', () => {
  const copy = duplicateOf(entry({ issueKey: null, issueId: null, title: 'Lunch' }), 'copy');
  assert.equal(copy.status, 'local');
  assert.deepEqual(planFinishDay([copy]).toMarkLocal.map((e) => e.id), ['copy']);
});

test('duplicateOf does not mutate the original', () => {
  const original = entry({ status: 'synced', worklogId: '60504' });
  duplicateOf(original, 'copy');
  assert.equal(original.status, 'synced');
  assert.equal(original.worklogId, '60504');
  assert.equal(original.id, 'original');
});

// ── Overlap detection, moved here with the rest of the pure transforms ──────

test('a duplicate always overlaps its original, which is what makes it grabbable', () => {
  const original = entry();
  const copy = duplicateOf(original, 'copy');
  assert.deepEqual([...overlappingIds([original, copy])].sort(), ['copy', 'original']);
});

test('entries that merely touch at the boundary do not overlap', () => {
  const ids = overlappingIds([
    entry({ id: 'a', startTs: T(9), endTs: T(10) }),
    entry({ id: 'b', startTs: T(10), endTs: T(11) }),
  ]);
  assert.equal(ids.size, 0);
});

test('a running entry is not counted as overlapping anything', () => {
  const ids = overlappingIds([
    entry({ id: 'done', startTs: T(9), endTs: T(11) }),
    entry({ id: 'live', startTs: T(10), endTs: null }),
  ]);
  assert.equal(ids.size, 0);
});
