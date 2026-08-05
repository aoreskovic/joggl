// The two pure pieces of the range read: which day a worklog belongs to, and the
// JQL that finds the issues carrying them.
//
// Both are worth their own tests for the same reason the worklog formatter is: a
// wrong answer here does not throw, it quietly files time under the wrong day or
// returns the wrong issues, and nothing on screen says so.

import assert from 'node:assert/strict';
import test from 'node:test';

import { localDayKey } from '../main/jira/time.js';
import { buildWorklogRangeJql, JiraError } from '../main/jira/client.js';

/** Local midnight, so these tests say the same thing in every timezone. */
const at = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();

test('a worklog in the middle of the day gets that day', () => {
  assert.equal(localDayKey(at(2026, 8, 5, 13, 30)), '2026-08-05');
});

test('a worklog at 23:45 belongs to the day it started on, not to UTC tomorrow', () => {
  // toISOString().slice(0,10) is what gets this wrong east of Greenwich.
  assert.equal(localDayKey(at(2026, 8, 5, 23, 45)), '2026-08-05');
});

test('a worklog at local midnight belongs to the day beginning', () => {
  assert.equal(localDayKey(at(2026, 8, 5, 0, 0)), '2026-08-05');
});

test('single-digit months and days are padded', () => {
  assert.equal(localDayKey(at(2026, 1, 3, 9, 0)), '2026-01-03');
});

test('a non-timestamp throws rather than producing a plausible-looking key', () => {
  assert.throws(() => localDayKey(undefined), TypeError);
  assert.throws(() => localDayKey(Number.NaN), TypeError);
});

test('a range asks for every day between the two, inclusive', () => {
  assert.equal(
    buildWorklogRangeJql('2026-07-06', '2026-08-05'),
    'worklogAuthor = currentUser() AND worklogDate >= "2026-07-06" AND worklogDate <= "2026-08-05"',
  );
});

test('a single day is a range of one, so the day read and the range read agree', () => {
  assert.equal(
    buildWorklogRangeJql('2026-08-05', '2026-08-05'),
    'worklogAuthor = currentUser() AND worklogDate >= "2026-08-05" AND worklogDate <= "2026-08-05"',
  );
});

test('a malformed date fails loudly rather than building a query that finds nothing', () => {
  assert.throws(() => buildWorklogRangeJql('5 August 2026', '2026-08-05'), JiraError);
  assert.throws(() => buildWorklogRangeJql('2026-08-05', ''), JiraError);
  assert.throws(() => buildWorklogRangeJql('2026-08-05', '2026-8-5'), JiraError);
});

test('a range running backwards is refused', () => {
  assert.throws(() => buildWorklogRangeJql('2026-08-05', '2026-07-06'), JiraError);
});
