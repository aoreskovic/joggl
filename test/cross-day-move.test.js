import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canCrossDays, crossDayMove } from '../renderer/js/cross-day.js';
import { startOfDayMs } from '../renderer/js/util.js';

const at = (dayKey, hh, mm = 0) => startOfDayMs(dayKey) + hh * 3_600_000 + mm * 60_000;

function entry(overrides = {}) {
  return {
    id: 'e1',
    issueKey: 'GEN-1',
    issueId: null,
    title: 'Standup',
    startTs: at('2026-07-28', 9),
    endTs: at('2026-07-28', 10),
    status: 'pending',
    worklogId: null,
    comment: null,
    errorMsg: null,
    ...overrides,
  };
}

test('an entry leaves one day log and joins the other', () => {
  const moving = entry();
  const other = entry({ id: 'e2' });
  const { from, to, moved } = crossDayMove({
    entry: moving,
    fromEntries: [moving, other],
    toEntries: [],
    toDayStartMs: startOfDayMs('2026-07-30'),
    startTs: at('2026-07-30', 9),
  });

  assert.deepEqual(from.map((e) => e.id), ['e2'], 'gone from the day it left');
  assert.deepEqual(to.map((e) => e.id), ['e1'], 'and only on the one it joined');
  assert.equal(moved.startTs, at('2026-07-30', 9));
  assert.equal(moved.endTs, at('2026-07-30', 10), 'the same length');
});

test('a synced entry keeps its worklogId and goes back to pending', () => {
  const moving = entry({ status: 'synced', worklogId: '60504' });
  const { moved } = crossDayMove({
    entry: moving,
    fromEntries: [moving],
    toEntries: [],
    toDayStartMs: startOfDayMs('2026-07-30'),
    startTs: at('2026-07-30', 9),
  });

  // The issue has not changed — only when the work started — so the id stays valid
  // and the next Sync rewrites that worklog with PUT rather than posting a second.
  assert.equal(moved.worklogId, '60504');
  assert.equal(moved.status, 'pending');
  assert.equal(moved.errorMsg, null);
});

test('an entry with no issue key lands local, not pending', () => {
  const moving = entry({ issueKey: null, status: 'local' });
  const { moved } = crossDayMove({
    entry: moving,
    fromEntries: [moving],
    toEntries: [],
    toDayStartMs: startOfDayMs('2026-07-30'),
    startTs: at('2026-07-30', 9),
  });
  assert.equal(moved.status, 'local');
});

test('a Jira-side row is not Joggl’s to move', () => {
  assert.equal(canCrossDays(entry({ external: true })), false);
  assert.equal(canCrossDays(entry()), true);
});

/**
 * The autumn clock change makes one day 25 hours long. Measured as an offset from
 * the *target* day's own midnight, an entry keeps the time it says on the clock; as
 * a fixed number of milliseconds it would quietly claim the work happened an hour
 * earlier. Asserted as an offset so this holds in any timezone, including one with
 * no clock change at all.
 */
test('the time on the clock survives a move across a clock change', () => {
  const moving = entry({
    startTs: at('2026-10-24', 9),
    endTs: at('2026-10-24', 10, 30),
  });
  const toDayStartMs = startOfDayMs('2026-10-25');
  const { moved } = crossDayMove({
    entry: moving,
    fromEntries: [moving],
    toEntries: [],
    toDayStartMs,
    startTs: toDayStartMs + 9 * 3_600_000,
  });

  assert.equal(moved.startTs - toDayStartMs, 9 * 3_600_000, '09:00 on the day it landed');
  assert.equal(moved.endTs - moved.startTs, 90 * 60_000, 'still an hour and a half');
});

test('an entry dropped past the end of the target day is pulled back, not shortened', () => {
  const moving = entry({
    startTs: at('2026-07-28', 23),
    endTs: at('2026-07-28', 23, 45),
  });
  const toDayStartMs = startOfDayMs('2026-07-30');
  const { moved } = crossDayMove({
    entry: moving,
    fromEntries: [moving],
    toEntries: [],
    toDayStartMs,
    startTs: toDayStartMs + 86_400_000 - 15 * 60_000,
  });
  assert.equal(moved.endTs - moved.startTs, 45 * 60_000, 'the length is untouched');
  assert.equal(moved.endTs, toDayStartMs + 86_400_000, 'and it ends on midnight');
});
