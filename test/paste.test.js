import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clipboardFrom, daysBetween, dragCopyPlacement, pastePlan } from '../renderer/js/clipboard.js';
import { startOfDayMs } from '../renderer/js/util.js';

const at = (dayKey, hh, mm = 0) => startOfDayMs(dayKey) + hh * 3_600_000 + mm * 60_000;

function item(id, dayKey, hh, overrides = {}) {
  return {
    dayKey,
    entry: {
      id,
      issueKey: 'GEN-1',
      issueId: '10042',
      title: 'Standup',
      startTs: at(dayKey, hh),
      endTs: at(dayKey, hh + 1),
      status: 'synced',
      worklogId: '60504',
      comment: 'what I did',
      errorMsg: null,
      ...overrides,
    },
  };
}

// A counter, so the ids in the assertions are predictable.
const ids = () => {
  let n = 0;
  return () => `copy-${++n}`;
};

test('whole days apart, rounded — one of the days between can be 25 hours long', () => {
  assert.equal(daysBetween('2026-08-03', '2026-08-06'), 3);
  assert.equal(daysBetween('2026-08-06', '2026-08-03'), -3);
  assert.equal(daysBetween('2026-08-03', '2026-08-03'), 0);
  // Across the autumn clock change, which makes 25 October 25 hours long here.
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
});

test('the clipboard remembers the earliest day it holds', () => {
  const clip = clipboardFrom([item('b', '2026-08-05', 9), item('a', '2026-08-03', 14)]);
  assert.equal(clip.anchorDay, '2026-08-03');
  assert.equal(clip.items.length, 2);
});

test('a running timer has no end to copy, and an empty clipboard is null not a husk', () => {
  assert.equal(clipboardFrom([item('r', '2026-08-03', 9, { endTs: null })]), null);
  assert.equal(clipboardFrom([]), null);
  assert.equal(clipboardFrom(null), null);
  assert.deepEqual(pastePlan(null, '2026-08-10'), []);
});

test('one day’s blocks pasted onto another arrive at the same times', () => {
  const clip = clipboardFrom([item('a', '2026-08-03', 9), item('b', '2026-08-03', 14)]);
  const plan = pastePlan(clip, '2026-08-10', ids());

  assert.equal(plan.length, 1);
  assert.equal(plan[0].dayKey, '2026-08-10');
  assert.deepEqual(
    plan[0].entries.map((e) => e.startTs - startOfDayMs('2026-08-10')),
    [9 * 3_600_000, 14 * 3_600_000],
  );
});

/**
 * The one rule: the earliest day is anchored onto the target and every offset is
 * kept, in days as well as on the clock.
 */
test('Tuesday and Thursday pasted onto Wednesday arrive on Wednesday and Friday', () => {
  const clip = clipboardFrom([item('tue', '2026-08-04', 9), item('thu', '2026-08-06', 11)]);
  const plan = pastePlan(clip, '2026-08-05', ids());
  assert.deepEqual(plan.map((p) => p.dayKey), ['2026-08-05', '2026-08-07']);
});

test('a whole week pasted onto a Monday reproduces the week', () => {
  const clip = clipboardFrom([
    item('mon', '2026-08-03', 9),
    item('wed', '2026-08-05', 9),
    item('fri', '2026-08-07', 9),
  ]);
  const plan = pastePlan(clip, '2026-08-10', ids());
  assert.deepEqual(plan.map((p) => p.dayKey), ['2026-08-10', '2026-08-12', '2026-08-14']);
});

/**
 * No target ever lands before the day pasted onto — a day-key comparison holds the
 * same order as calendar order, since YYYY-MM-DD sorts lexicographically exactly like
 * it sorts chronologically. This is the property `pasteClipboard` in copy-day.js
 * leans on to know a target beyond the first can only ever be a day *forward* of one
 * already on screen, never one already loaded for some other reason — which is what
 * makes "load it before merging" the whole fix rather than a partial one.
 */
test('no target lands earlier than the day pasted onto', () => {
  const clip = clipboardFrom([
    item('mon', '2026-08-03', 9),
    item('wed', '2026-08-05', 9),
    item('fri', '2026-08-07', 9),
  ]);
  const plan = pastePlan(clip, '2026-08-10', ids());
  assert.ok(plan.every((p) => p.dayKey >= '2026-08-10'));

  // Pasting a day onto itself is the degenerate case: the earliest (and only) item
  // anchors with a zero offset, so the single target is exactly the day pasted onto,
  // never earlier.
  const single = clipboardFrom([item('a', '2026-08-03', 9)]);
  assert.deepEqual(pastePlan(single, '2026-08-03', ids()).map((p) => p.dayKey), ['2026-08-03']);
});

/**
 * duplicateOf's promise, reached through copiedToDay: carrying the original's
 * worklogId across would make the next Sync rewrite that one worklog with the copy's
 * times, overwriting the original's record and never giving the copy one of its own.
 */
test('copies arrive unsynced, carrying no worklog, keeping the description', () => {
  const clip = clipboardFrom([item('a', '2026-08-03', 9)]);
  const [copy] = pastePlan(clip, '2026-08-10', ids())[0].entries;

  assert.equal(copy.worklogId, null);
  assert.equal(copy.status, 'pending');
  assert.equal(copy.id, 'copy-1', 'a new id, not the original’s');
  assert.equal(copy.comment, 'what I did');
  assert.equal(copy.errorMsg, null);
});

test('a copy of a Jira-side row becomes an ordinary entry of Joggl’s own', () => {
  const clip = clipboardFrom([item('j', '2026-08-03', 9, { id: 'jira:900', external: true })]);
  const [copy] = pastePlan(clip, '2026-08-10', ids())[0].entries;
  assert.equal(copy.external, undefined);
  assert.equal(copy.status, 'pending');
});

test('an entry with no issue key arrives local, and never syncs', () => {
  const clip = clipboardFrom([item('l', '2026-08-03', 9, { issueKey: null, issueId: null, worklogId: null, status: 'local' })]);
  const [copy] = pastePlan(clip, '2026-08-10', ids())[0].entries;
  assert.equal(copy.status, 'local');
});

/**
 * Measured as an offset from local midnight, never as a fixed number of
 * milliseconds: a copy across a clock change must not quietly claim the work
 * happened an hour earlier. Asserted as an offset so it holds in any timezone,
 * including one with no clock change at all.
 */
test('a paste across a clock change keeps the time on the clock', () => {
  const clip = clipboardFrom([item('a', '2026-10-24', 9)]);
  const [copy] = pastePlan(clip, '2026-10-25', ids())[0].entries;
  assert.equal(copy.startTs - startOfDayMs('2026-10-25'), 9 * 3_600_000);
  assert.equal(copy.endTs - copy.startTs, 3_600_000, 'still an hour long');
});

// ── Ctrl+drag: the same rule, driven by the block under the cursor ──────────

const offsetsIn = (placed) =>
  placed.map((p) => ({ day: p.toDay, h: (p.startTs - startOfDayMs(p.toDay)) / 3_600_000 }));

test('the whole selection follows the dragged block, keeping its shape', () => {
  const items = [item('tue', '2026-08-04', 9), item('thu', '2026-08-06', 11)];
  // The Tuesday block dragged onto Wednesday, two hours later on the clock.
  const placed = dragCopyPlacement(items, '2026-08-04', '2026-08-05', 2 * 3_600_000);

  assert.deepEqual(offsetsIn(placed), [
    { day: '2026-08-05', h: 11 },
    { day: '2026-08-07', h: 13 },
  ]);
});

test('dragging the later block of a pair anchors on that one', () => {
  const items = [item('tue', '2026-08-04', 9), item('thu', '2026-08-06', 11)];
  // The Thursday block is the one under the cursor, dragged back onto Wednesday.
  const placed = dragCopyPlacement(items, '2026-08-06', '2026-08-05', 0);

  assert.deepEqual(offsetsIn(placed), [
    { day: '2026-08-03', h: 9 },
    { day: '2026-08-05', h: 11 },
  ]);
});

test('a drag that never left its day still copies where it was dropped', () => {
  const placed = dragCopyPlacement([item('a', '2026-08-04', 9)], '2026-08-04', '2026-08-04', 90 * 60_000);
  assert.deepEqual(offsetsIn(placed), [{ day: '2026-08-04', h: 10.5 }]);
});

test('a copy is held inside the day it lands on, at both ends', () => {
  const late = dragCopyPlacement([item('a', '2026-08-04', 22)], '2026-08-04', '2026-08-04', 5 * 3_600_000);
  // 22:00–23:00 pushed five hours past midnight comes to rest against it.
  assert.deepEqual(offsetsIn(late), [{ day: '2026-08-04', h: 23 }]);

  const early = dragCopyPlacement([item('a', '2026-08-04', 1)], '2026-08-04', '2026-08-04', -5 * 3_600_000);
  assert.deepEqual(offsetsIn(early), [{ day: '2026-08-04', h: 0 }]);
});

test('a drag across a clock change keeps every block at the hour it says', () => {
  const items = [item('sat', '2026-10-24', 9), item('sun', '2026-10-25', 9)];
  const placed = dragCopyPlacement(items, '2026-10-24', '2026-10-31', 0);
  assert.deepEqual(offsetsIn(placed), [
    { day: '2026-10-31', h: 9 },
    { day: '2026-11-01', h: 9 },
  ]);
});

test('nothing selected places nothing', () => {
  assert.deepEqual(dragCopyPlacement([], '2026-08-04', '2026-08-05', 0), []);
  assert.deepEqual(dragCopyPlacement(null, '2026-08-04', '2026-08-05', 0), []);
});
