// Duplicating an entry. The rule that matters is that the copy inherits no
// worklog: carrying one across would make the next Finish Day rewrite the
// original's worklog with the copy's times, so the original loses its record and
// the copy never gets one.

import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_DROP_MS, dropEntryFor, duplicateOf, overlappingIds } from '../renderer/js/entry-ops.js';
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

// ── What a drop onto the day view creates ───────────────────────────────────

const DAY_START = T(0);

const dropped = { issueKey: 'PROJ-1', issueId: '10001', title: 'Meetings' };

test('a dropped issue becomes a pending entry of exactly 30 minutes', () => {
  const e = dropEntryFor(dropped, 'e1', T(9, 15), DAY_START);
  assert.equal(e.startTs, T(9, 15));
  assert.equal(e.endTs, T(9, 45));
  assert.equal(e.endTs - e.startTs, DEFAULT_DROP_MS);
  assert.equal(e.status, 'pending');
  assert.equal(e.worklogId, null);
  assert.equal(e.errorMsg, null);
});

test('the dropped entry carries the issue, the title and the given id', () => {
  const e = dropEntryFor(dropped, 'e1', T(9), DAY_START);
  assert.equal(e.id, 'e1');
  assert.equal(e.issueKey, 'PROJ-1');
  assert.equal(e.issueId, '10001');
  assert.equal(e.title, 'Meetings');
});

test('a drop near midnight is pulled back so the block ends on it', () => {
  const e = dropEntryFor(dropped, 'e1', T(23, 45), DAY_START);
  assert.equal(e.endTs, DAY_START + 86_400_000, 'ends exactly at midnight');
  assert.equal(e.startTs, T(23, 30));
  assert.equal(e.endTs - e.startTs, DEFAULT_DROP_MS, 'and keeps its full length');
});

test('a start before the day begins is pulled forward onto it', () => {
  // The overnight rollover in app.js can advance state.selectedDate mid-drag, so
  // dayStartTs becomes the new day while the drag's startTs still points at the
  // old one. The entry has to stay inside the day it is filed under.
  const e = dropEntryFor(dropped, 'e1', T(23, 30), T(24));
  assert.equal(e.startTs, T(24), 'clamped to midnight, the new day’s first minute');
  assert.equal(e.endTs - e.startTs, DEFAULT_DROP_MS, 'and keeps its full length');
});

test('a start later than now is allowed, so leave can be booked ahead', () => {
  // Far enough ahead that it is in the future whatever day the test runs on.
  const farStart = new Date(2099, 0, 1, 0, 0, 0, 0).getTime();
  const e = dropEntryFor(dropped, 'e1', farStart + 9 * 3_600_000, farStart);
  assert.equal(e.status, 'pending', 'nothing is rejected for being in the future');
  assert.equal(e.startTs, farStart + 9 * 3_600_000);
});

test('a dropped entry syncs like any other pending entry', () => {
  const e = dropEntryFor(dropped, 'e1', T(9), DAY_START);
  assert.deepEqual(planFinishDay([e]).toSubmit.map((x) => x.id), ['e1']);
});

test('dropEntryFor does not mutate the issue it was given', () => {
  const issue = { ...dropped };
  dropEntryFor(issue, 'e1', T(9), DAY_START);
  assert.deepEqual(issue, dropped);
});
