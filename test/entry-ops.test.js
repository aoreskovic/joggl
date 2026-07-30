// Duplicating an entry. The rule that matters is that the copy inherits no
// worklog: carrying one across would make the next Finish Day rewrite the
// original's worklog with the copy's times, so the original loses its record and
// the copy never gets one.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canRetarget,
  clampDropStart,
  DEFAULT_DROP_MS,
  dropEntryFor,
  duplicateOf,
  movedEntry,
  overlappingIds,
  retargetEntry,
  sameComment,
  sameTimes,
} from '../renderer/js/entry-ops.js';
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

// ── Moving an entry by dragging its row onto the day view ───────────────────

test('a moved entry keeps its length and its identity', () => {
  const original = entry({ startTs: T(9), endTs: T(10, 30) });
  const moved = movedEntry(original, T(14), DAY_START);

  assert.equal(moved.startTs, T(14));
  assert.equal(moved.endTs, T(15, 30), 'ninety minutes, wherever it lands');
  assert.equal(moved.id, original.id);
  assert.equal(moved.issueKey, 'PROJ-1');
});

test('a move leaves the sync state alone — that is markDirty’s call', () => {
  const synced = entry({ status: 'synced', worklogId: '60504' });
  const moved = movedEntry(synced, T(14), DAY_START);

  assert.equal(moved.status, 'synced');
  assert.equal(moved.worklogId, '60504', 'losing this would post a duplicate worklog');
});

test('a move near midnight is pulled back rather than shortened', () => {
  const original = entry({ startTs: T(9), endTs: T(11) }); // two hours
  const moved = movedEntry(original, T(23, 30), DAY_START);

  assert.equal(moved.endTs, DAY_START + 86_400_000, 'ends exactly at midnight');
  assert.equal(moved.endTs - moved.startTs, 2 * 3_600_000, 'and is still two hours');
});

test('a move before the day starts is pulled forward onto it', () => {
  const moved = movedEntry(entry({ startTs: T(9), endTs: T(10) }), T(-2), DAY_START);
  assert.equal(moved.startTs, DAY_START);
  assert.equal(moved.endTs - moved.startTs, 3_600_000);
});

test('movedEntry does not mutate the entry it was given', () => {
  const original = entry({ startTs: T(9), endTs: T(10) });
  movedEntry(original, T(14), DAY_START);
  assert.equal(original.startTs, T(9));
  assert.equal(original.endTs, T(10));
});

// ── Booking the same block against a different issue ────────────────────────

const target = { issueKey: 'OTHER-9', issueId: '20002', title: 'Something else' };

test('the time is carried across untouched — that is the whole operation', () => {
  const original = entry({ startTs: T(9, 15), endTs: T(10, 45) });
  const moved = retargetEntry(original, target);

  assert.equal(moved.startTs, T(9, 15));
  assert.equal(moved.endTs, T(10, 45));
  assert.equal(moved.id, original.id, 'it is the same entry, not a new one');
});

test('the issue, its id and the title all follow', () => {
  const moved = retargetEntry(entry(), target);
  assert.equal(moved.issueKey, 'OTHER-9');
  assert.equal(moved.issueId, '20002');
  assert.equal(moved.title, 'Something else');
});

test('a repointed entry needs sending, and a previous failure is cleared', () => {
  const moved = retargetEntry(entry({ status: 'error', errorMsg: 'HTTP 500' }), target);
  assert.equal(moved.status, 'pending');
  assert.equal(moved.errorMsg, null);
  assert.deepEqual(planFinishDay([moved]).toSubmit.map((e) => e.id), ['original']);
});

test('retargetEntry does not mutate the entry it was given', () => {
  const original = entry();
  retargetEntry(original, target);
  assert.equal(original.issueKey, 'PROJ-1');
  assert.equal(original.title, 'Meetings');
});

test('an entry already in Jira may not be repointed', () => {
  // A worklogId is only valid on the issue it was created against. Repointing
  // would make Finish Day either PUT that id onto an issue that has never heard
  // of it, or post a second worklog and orphan the first.
  assert.deepEqual(canRetarget(entry({ status: 'synced', worklogId: '60504' })), {
    ok: false,
    reason: 'synced',
  });
  // Even back in pending after an edit — the id is what matters, not the status.
  assert.equal(canRetarget(entry({ status: 'pending', worklogId: '60504' })).ok, false);
});

test('a Jira-side worklog may not be repointed either', () => {
  assert.deepEqual(canRetarget({ ...entry(), external: true }), { ok: false, reason: 'external' });
});

test('an ordinary pending or failed entry may be repointed', () => {
  assert.deepEqual(canRetarget(entry()), { ok: true });
  assert.deepEqual(canRetarget(entry({ status: 'error', errorMsg: 'HTTP 500' })), { ok: true });
  assert.deepEqual(canRetarget(entry({ issueKey: null, status: 'local' })), { ok: true });
});

// ── The Work Description travels with the work ──────────────────────────────

test('a duplicate keeps the description — it is the same work', () => {
  const copy = duplicateOf(entry({ comment: 'paired with Marko' }), 'copy');
  assert.equal(copy.comment, 'paired with Marko');
  assert.equal(copy.worklogId, null, 'but still not the worklog');
});

test('a duplicate of an entry without one gets null, not undefined', () => {
  // undefined would serialise away and read back as a missing key.
  const { comment, ...bare } = entry();
  assert.equal(duplicateOf(bare, 'copy').comment, null);
});

test('moving and repointing carry the description across', () => {
  const original = entry({ comment: 'reviewed the schematic' });
  assert.equal(movedEntry(original, T(14), DAY_START).comment, 'reviewed the schematic');
  assert.equal(retargetEntry(original, target).comment, 'reviewed the schematic');
});

test('a block dropped from the task list starts with nothing said about it', () => {
  assert.equal(dropEntryFor(dropped, 'e1', T(9), DAY_START).comment, null);
});

test('an unchanged description is not an edit', () => {
  // Opening the dialog and closing it must not offer a re-sync, for the same
  // reason clicking a block must not.
  const e = entry({ comment: 'as before' });
  assert.equal(sameComment(e, { comment: 'as before' }), true);
  assert.equal(sameComment(entry({ comment: null }), { comment: '' }), true, 'empty is absent');
  assert.equal(sameComment(entry({ comment: null }), {}), true);
});

test('a changed description is an edit, even though no time moved', () => {
  const e = entry({ comment: 'as before' });
  assert.equal(sameComment(e, { comment: 'something else' }), false);
  assert.equal(sameComment(e, { comment: null }), false, 'clearing it counts');
  // And the times guard cannot see it, which is why the two are separate.
  assert.equal(sameTimes(e, { startTs: e.startTs, endTs: e.endTs }), true);
});

test('creating and moving clamp by the same rule', () => {
  // One helper, so a drop from the task list and a drop of an existing row can
  // never disagree about what happens at the end of the day.
  const created = dropEntryFor(dropped, 'e1', T(23, 50), DAY_START);
  const moved = movedEntry(entry({ startTs: T(9), endTs: T(9, 30) }), T(23, 50), DAY_START);
  assert.equal(created.startTs, moved.startTs);

  assert.equal(clampDropStart(T(23, 50), DAY_START, DEFAULT_DROP_MS), T(23, 30));
  assert.equal(clampDropStart(T(10), DAY_START, DEFAULT_DROP_MS), T(10), 'mid-day is untouched');
});
