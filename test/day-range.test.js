// Ranges of days, and what comes back for them.
//
// All pure, and separated from state.js for one reason: state.js reads
// `window.joggl` at module load and cannot be imported under `node --test` at all.
// The arithmetic that decides which days are fetched and which day a worklog lands
// on is worth more than that, so it lives here.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bucketByDay,
  eachDay,
  externalToEntries,
  installDayAccessors,
  missingDays,
  withoutWorklog,
} from '../renderer/js/day-range.js';

test('a range lists every day between the two, inclusive', () => {
  assert.deepEqual(eachDay('2026-08-03', '2026-08-06'), [
    '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06',
  ]);
});

test('a single day is a range of one', () => {
  assert.deepEqual(eachDay('2026-08-05', '2026-08-05'), ['2026-08-05']);
});

test('a range crossing a month end is continuous', () => {
  assert.deepEqual(eachDay('2026-07-30', '2026-08-02'), [
    '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02',
  ]);
});

test('a range running backwards is empty rather than infinite', () => {
  assert.deepEqual(eachDay('2026-08-05', '2026-08-01'), []);
});

test('worklogs are bucketed under the day key they carry', () => {
  const buckets = bucketByDay([
    { worklogId: '1', dayKey: '2026-08-03' },
    { worklogId: '2', dayKey: '2026-08-05' },
    { worklogId: '3', dayKey: '2026-08-03' },
  ]);
  assert.deepEqual([...buckets.keys()].sort(), ['2026-08-03', '2026-08-05']);
  assert.deepEqual(buckets.get('2026-08-03').map((w) => w.worklogId), ['1', '3']);
});

test('bucketing nothing gives an empty map, not undefined', () => {
  assert.equal(bucketByDay([]).size, 0);
  assert.equal(bucketByDay(undefined).size, 0);
});

test('a Jira worklog becomes a read-only entry with a namespaced id', () => {
  // The id is prefixed so it can never collide with a local uuid, and `external`
  // is what every refusal in the app keys off.
  const [entry] = externalToEntries([
    { worklogId: '900', issueKey: 'GEN-1', title: 'Meetings', startTs: 1, endTs: 2, comment: null },
  ]);
  assert.equal(entry.id, 'jira:900');
  assert.equal(entry.external, true);
  assert.equal(entry.status, 'synced');
  assert.equal(entry.errorMsg, null);
  assert.equal(entry.worklogId, '900', 'kept, so a local entry can claim it');
});

test('only the days not already held are fetched again', () => {
  const have = new Map([['2026-08-04', []]]);
  assert.deepEqual(missingDays('2026-08-03', '2026-08-05', have), ['2026-08-03', '2026-08-05']);
});

test('a day held as an empty list counts as held, so an empty day is not refetched forever', () => {
  const have = new Map([['2026-08-03', []], ['2026-08-04', []], ['2026-08-05', []]]);
  assert.deepEqual(missingDays('2026-08-03', '2026-08-05', have), []);
});

test('state.entries reads and writes the selected day', () => {
  const days = new Map();
  const external = new Map();
  const s = { selectedDate: '2026-08-05' };
  installDayAccessors(s, { days, external });

  assert.deepEqual(s.entries, [], 'a day never written reads as empty');

  s.entries = [{ id: 'a' }];
  assert.deepEqual(days.get('2026-08-05').map((e) => e.id), ['a']);

  s.selectedDate = '2026-08-04';
  assert.deepEqual(s.entries, [], 'and the other day is untouched');

  s.selectedDate = '2026-08-05';
  assert.deepEqual(s.entries.map((e) => e.id), ['a']);
});

test('the append idiom used all over the app still works through the accessor', () => {
  const days = new Map();
  const s = { selectedDate: '2026-08-05' };
  installDayAccessors(s, { days, external: new Map() });

  s.entries = [{ id: 'a' }];
  s.entries = [...s.entries, { id: 'b' }];

  assert.deepEqual(s.entries.map((e) => e.id), ['a', 'b']);
});

test('externalEntries is the same view over its own map', () => {
  const external = new Map();
  const s = { selectedDate: '2026-08-05' };
  installDayAccessors(s, { days: new Map(), external });

  s.externalEntries = [{ id: 'jira:1' }];
  assert.deepEqual(external.get('2026-08-05').map((e) => e.id), ['jira:1']);
  s.selectedDate = '2026-08-04';
  assert.deepEqual(s.externalEntries, []);
});

// ── Dropping one Jira-side row, rather than the whole day ──────────────────

test('withoutWorklog removes exactly the row for that worklog', () => {
  const rows = externalToEntries([
    { worklogId: '101', startTs: 1, endTs: 2, dayKey: '2026-07-28' },
    { worklogId: '102', startTs: 3, endTs: 4, dayKey: '2026-07-28' },
  ]);

  const left = withoutWorklog(rows, '102');
  assert.equal(left.length, 1);
  assert.equal(left[0].worklogId, '101');
  assert.notEqual(left, rows, 'a new array, so nothing mutates the cache in place');
});

test('withoutWorklog compares worklog ids as strings', () => {
  const rows = externalToEntries([{ worklogId: '102', startTs: 1, endTs: 2, dayKey: '2026-07-28' }]);
  // Jira answers with a string; a local entry carries whatever the POST came back with.
  assert.deepEqual(withoutWorklog(rows, 102), []);
});

test('withoutWorklog leaves a day it does not hold alone', () => {
  const rows = externalToEntries([{ worklogId: '101', startTs: 1, endTs: 2, dayKey: '2026-07-28' }]);
  assert.equal(withoutWorklog(rows, '999').length, 1);
  assert.deepEqual(withoutWorklog(undefined, '999'), []);
});
