// Gotcha 4: Jira rejects the ISO-8601 form everyone reaches for first. A wrong
// value here fails Finish Day silently, so the exact byte layout is pinned.

import assert from 'node:assert/strict';
import test from 'node:test';

import { formatWorklogStarted, worklogSeconds } from '../main/jira/time.js';

/** A Date stand-in, so the expected output does not depend on the test machine's zone. */
function fakeDate({ y, mo, d, h, mi, s = 0, ms = 0, offsetMinutesAheadOfUtc }) {
  return {
    getFullYear: () => y,
    getMonth: () => mo - 1,
    getDate: () => d,
    getHours: () => h,
    getMinutes: () => mi,
    getSeconds: () => s,
    getMilliseconds: () => ms,
    // Date reports minutes *behind* UTC, so UTC+2 is -120.
    getTimezoneOffset: () => -offsetMinutesAheadOfUtc,
  };
}

test('formats a positive offset without a colon', () => {
  const d = fakeDate({ y: 2026, mo: 7, d: 28, h: 9, mi: 0, offsetMinutesAheadOfUtc: 120 });
  assert.equal(formatWorklogStarted(0, d), '2026-07-28T09:00:00.000+0200');
});

test('formats a negative offset', () => {
  const d = fakeDate({ y: 2026, mo: 1, d: 5, h: 17, mi: 30, s: 9, offsetMinutesAheadOfUtc: -300 });
  assert.equal(formatWorklogStarted(0, d), '2026-01-05T17:30:09.000-0500');
});

test('formats UTC as +0000, never as Z', () => {
  const d = fakeDate({ y: 2026, mo: 12, d: 31, h: 23, mi: 59, s: 59, offsetMinutesAheadOfUtc: 0 });
  const out = formatWorklogStarted(0, d);
  assert.equal(out, '2026-12-31T23:59:59.000+0000');
  assert.ok(!out.endsWith('Z'));
});

test('handles a half-hour offset', () => {
  const d = fakeDate({ y: 2026, mo: 3, d: 1, h: 8, mi: 15, offsetMinutesAheadOfUtc: 330 });
  assert.equal(formatWorklogStarted(0, d), '2026-03-01T08:15:00.000+0530');
});

test('zero-pads every field', () => {
  const d = fakeDate({ y: 2026, mo: 2, d: 3, h: 4, mi: 5, s: 6, ms: 7, offsetMinutesAheadOfUtc: 60 });
  assert.equal(formatWorklogStarted(0, d), '2026-02-03T04:05:06.007+0100');
});

test('the real local-time path produces the shape Jira accepts', () => {
  const out = formatWorklogStarted(Date.UTC(2026, 6, 28, 7, 0, 0));
  assert.match(out, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/);
  assert.ok(!out.includes('Z'), 'must not fall back to toISOString');
  // The offset must have no colon — the single most common way to get a 400.
  assert.ok(!/[+-]\d{2}:\d{2}$/.test(out));
});

test('rejects a non-timestamp rather than emitting NaN into a worklog', () => {
  assert.throws(() => formatWorklogStarted(undefined), TypeError);
  assert.throws(() => formatWorklogStarted(Number.NaN), TypeError);
});

test('worklogSeconds never goes below Jira’s one-minute floor', () => {
  assert.equal(worklogSeconds(0), 60);
  assert.equal(worklogSeconds(1000), 60);
  assert.equal(worklogSeconds(59_000), 60);
  assert.equal(worklogSeconds(60_000), 60);
  assert.equal(worklogSeconds(90_000), 90);
  assert.equal(worklogSeconds(3_600_000), 3600);
});
