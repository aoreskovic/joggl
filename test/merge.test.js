// The 30-minute merge boundary. Getting it wrong either fuses entries that should
// stay apart or nags on every restart, and both quietly corrupt the day's shape.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyMerge,
  decideMerge,
  MERGE_GAP_MS,
  mergeableEntries,
  taskKeyOf,
} from '../renderer/js/merge.js';

const T = (h, m = 0) => new Date(2026, 6, 28, h, m, 0, 0).getTime();

function entry(overrides = {}) {
  return {
    id: overrides.id ?? `e-${Math.random()}`,
    issueKey: 'PROJ-1',
    issueId: '10001',
    title: 'Meetings',
    startTs: T(9),
    endTs: T(10),
    status: 'pending',
    worklogId: null,
    errorMsg: null,
    ...overrides,
  };
}

test('task identity is the issue key, falling back to a case-insensitive title', () => {
  assert.equal(taskKeyOf({ issueKey: 'PROJ-1', title: 'x' }), 'issue:PROJ-1');
  assert.equal(taskKeyOf({ issueKey: null, title: '  Lunch ' }), 'local:lunch');
  assert.equal(taskKeyOf({ issueKey: null, title: 'LUNCH' }), 'local:lunch');
});

test('no earlier entry for the task means a plain new entry', () => {
  const entries = [entry({ issueKey: 'OTHER-9' })];
  assert.deepEqual(decideMerge(entries, 'issue:PROJ-1', T(11)), { action: 'new' });
});

// ── The boundary itself ────────────────────────────────────────────────────

test('a gap of exactly 30 minutes merges silently', () => {
  const entries = [entry({ endTs: T(10) })];
  const decision = decideMerge(entries, 'issue:PROJ-1', T(10, 30));
  assert.equal(decision.action, 'merge');
  assert.equal(decision.gapMs, MERGE_GAP_MS);
});

test('one minute under the boundary merges silently', () => {
  const entries = [entry({ endTs: T(10) })];
  assert.equal(decideMerge(entries, 'issue:PROJ-1', T(10, 29)).action, 'merge');
});

test('one minute over the boundary asks', () => {
  const entries = [entry({ endTs: T(10) })];
  const decision = decideMerge(entries, 'issue:PROJ-1', T(10, 31));
  assert.equal(decision.action, 'ask');
  assert.equal(decision.gapMs, MERGE_GAP_MS + 60_000);
});

test('one millisecond over the boundary asks', () => {
  const entries = [entry({ endTs: T(10) })];
  const decision = decideMerge(entries, 'issue:PROJ-1', T(10) + MERGE_GAP_MS + 1);
  assert.equal(decision.action, 'ask');
});

test('a negative gap counts as a resumption, not a prompt', () => {
  const entries = [entry({ endTs: T(10) })];
  assert.equal(decideMerge(entries, 'issue:PROJ-1', T(9, 45)).action, 'merge');
});

test('the gap is measured from the latest end, not the first', () => {
  const entries = [
    entry({ id: 'a', startTs: T(8), endTs: T(8, 30) }),
    entry({ id: 'b', startTs: T(11), endTs: T(11, 30) }),
  ];
  // 11:45 is 15 min after b, but over three hours after a.
  assert.equal(decideMerge(entries, 'issue:PROJ-1', T(11, 45)).action, 'merge');
});

test('the ask carries the totals the prompt needs', () => {
  const entries = [
    entry({ id: 'a', startTs: T(8), endTs: T(9) }),
    entry({ id: 'b', startTs: T(10), endTs: T(10, 30) }),
  ];
  const decision = decideMerge(entries, 'issue:PROJ-1', T(14));
  assert.equal(decision.action, 'ask');
  assert.equal(decision.totalMs, 90 * 60_000);
  assert.equal(decision.earliestTs, T(8));
  assert.equal(decision.latestTs, T(10, 30));
});

// ── What is eligible at all ────────────────────────────────────────────────

test('an entry already in Jira is never merged into', () => {
  const entries = [entry({ status: 'synced', worklogId: '55555', endTs: T(10) })];
  assert.deepEqual(mergeableEntries(entries, 'issue:PROJ-1'), []);
  assert.deepEqual(decideMerge(entries, 'issue:PROJ-1', T(10, 5)), { action: 'new' });
});

test('a failed entry is still mergeable — nothing reached Jira', () => {
  const entries = [entry({ status: 'error', errorMsg: 'HTTP 500', endTs: T(10) })];
  assert.equal(decideMerge(entries, 'issue:PROJ-1', T(10, 5)).action, 'merge');
});

test('a still-running entry is not a merge candidate', () => {
  const entries = [entry({ endTs: null })];
  assert.deepEqual(decideMerge(entries, 'issue:PROJ-1', T(10, 5)), { action: 'new' });
});

// ── Blocks booked ahead ─────────────────────────────────────────────────────
//
// Dropping an issue onto a later hour of the day view is the drag feature's whole
// point, and such a block sits in the same day as the timer that starts hours
// before it. A negative gap normally means "resumption"; here it means the block
// has not happened yet, and merging would book the entire span up to its end.

test('an entry starting after the timer is not a merge candidate', () => {
  // Booked at 14:00–14:30 this morning; the timer starts at 10:30.
  const entries = [entry({ id: 'ahead', startTs: T(14), endTs: T(14, 30) })];
  assert.deepEqual(mergeableEntries(entries, 'issue:PROJ-1', T(10, 30)), []);
  assert.deepEqual(decideMerge(entries, 'issue:PROJ-1', T(10, 30)), { action: 'new' });
});

test('a block booked ahead survives the stop that would have absorbed it', () => {
  const entries = [entry({ id: 'ahead', startTs: T(14), endTs: T(14, 30) })];
  const timed = entry({ id: 'new', startTs: T(10, 30), endTs: T(11) });

  const result = applyMerge(entries, timed);

  assert.equal(result.length, 2, 'two entries, not one four-hour block');
  const ahead = result.find((e) => e.id === 'ahead');
  assert.equal(ahead.startTs, T(14));
  assert.equal(ahead.endTs, T(14, 30));
  const worked = result.find((e) => e.id === 'new');
  assert.equal(worked.startTs, T(10, 30));
  assert.equal(worked.endTs, T(11));
});

test('an entry that merely ends after the timer starts is still a resumption', () => {
  // Started at 09:00 and still on screen at 10:15 — genuinely overlapping past
  // work, which the negative-gap rule exists for.
  const entries = [entry({ id: 'past', startTs: T(9), endTs: T(10, 30) })];
  assert.equal(decideMerge(entries, 'issue:PROJ-1', T(10, 15)).action, 'merge');

  const result = applyMerge(entries, entry({ id: 'new', startTs: T(10, 15), endTs: T(11) }));
  assert.equal(result.length, 1);
  assert.equal(result[0].startTs, T(9));
  assert.equal(result[0].endTs, T(11));
});

test('a candidate starting exactly at the timer start is still mergeable', () => {
  const entries = [entry({ id: 'same', startTs: T(10), endTs: T(10, 15) })];
  assert.equal(decideMerge(entries, 'issue:PROJ-1', T(10)).action, 'merge');
});

test('the future entry is excluded but an earlier one is still found', () => {
  const entries = [
    entry({ id: 'past', startTs: T(9), endTs: T(10) }),
    entry({ id: 'ahead', startTs: T(14), endTs: T(14, 30) }),
  ];
  // The gap is measured from the past entry's end, not the booked-ahead one's.
  const decision = decideMerge(entries, 'issue:PROJ-1', T(10, 20));
  assert.equal(decision.action, 'merge');
  assert.equal(decision.gapMs, 20 * 60_000);
  assert.deepEqual(decision.candidates.map((e) => e.id), ['past']);
});

// ── Applying the merge ─────────────────────────────────────────────────────

test('merging spans the gap and collapses every candidate into one entry', () => {
  const entries = [
    entry({ id: 'a', startTs: T(8), endTs: T(9) }),
    entry({ id: 'b', startTs: T(10), endTs: T(10, 30) }),
    entry({ id: 'other', issueKey: 'OTHER-9', startTs: T(12), endTs: T(13) }),
  ];
  const fresh = entry({ id: 'new', startTs: T(14), endTs: T(15) });

  const result = applyMerge(entries, fresh);

  assert.equal(result.length, 2, 'the three PROJ-1 entries become one');
  const merged = result.find((e) => e.issueKey === 'PROJ-1');
  assert.equal(merged.startTs, T(8));
  assert.equal(merged.endTs, T(15));
  assert.equal(merged.status, 'pending');
  assert.equal(merged.worklogId, null);
  // Unrelated issues are untouched.
  assert.ok(result.some((e) => e.id === 'other'));
});

test('merging leaves a synced sibling alone', () => {
  const entries = [
    entry({ id: 'done', startTs: T(8), endTs: T(9), status: 'synced', worklogId: '1' }),
    entry({ id: 'open', startTs: T(10), endTs: T(10, 30) }),
  ];
  const result = applyMerge(entries, entry({ id: 'new', startTs: T(11), endTs: T(12) }));

  const synced = result.find((e) => e.id === 'done');
  assert.equal(synced.startTs, T(8));
  assert.equal(synced.endTs, T(9));
  assert.equal(synced.worklogId, '1');

  const merged = result.find((e) => e.id !== 'done');
  assert.equal(merged.startTs, T(10), 'the merge starts after the synced block, not before it');
  assert.equal(merged.endTs, T(12));
});

test('a local entry with no issue key stays local after merging', () => {
  const entries = [entry({ id: 'a', issueKey: null, issueId: null, title: 'Lunch', status: 'local' })];
  const result = applyMerge(
    entries,
    entry({ id: 'new', issueKey: null, issueId: null, title: 'Lunch', startTs: T(12), endTs: T(12, 30) }),
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].status, 'local');
});

test('applyMerge does not mutate its input', () => {
  const original = entry({ id: 'a', startTs: T(8), endTs: T(9) });
  const entries = [original];
  applyMerge(entries, entry({ id: 'new', startTs: T(9, 10), endTs: T(10) }));
  assert.equal(entries.length, 1);
  assert.equal(original.startTs, T(8));
  assert.equal(original.endTs, T(9));
});
