// The two display settings: which days are shaded as non-working, and how a
// pinned issue is labelled.

import assert from 'node:assert/strict';
import test from 'node:test';

import { isWeekend, pinLabelParts } from '../renderer/js/util.js';

// ── Weekends ────────────────────────────────────────────────────────────────

test('Saturday and Sunday are weekends', () => {
  assert.equal(isWeekend('2026-08-01'), true, 'Saturday');
  assert.equal(isWeekend('2026-08-02'), true, 'Sunday');
});

test('Monday to Friday are not', () => {
  for (const key of ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31']) {
    assert.equal(isWeekend(key), false, key);
  }
});

test('read from the local date, not from UTC', () => {
  // The day key is a local calendar date, so a Sunday stays a Sunday whatever the
  // offset — the trap that once handed anyone east of Greenwich tomorrow's key.
  assert.equal(isWeekend('2026-08-02'), true);
  assert.equal(isWeekend('2026-08-03'), false, 'the Monday after');
});

test('works across a month and a year boundary', () => {
  assert.equal(isWeekend('2026-01-31'), true, 'Saturday');
  assert.equal(isWeekend('2027-01-02'), true, 'Saturday');
  assert.equal(isWeekend('2027-01-01'), false, 'Friday');
});

// ── Pin labels ──────────────────────────────────────────────────────────────

const pin = { issueKey: 'GEN-1', title: 'Meeting - Protostar' };

test('the default shows both, because neither part identifies a pin alone', () => {
  // Titles repeat on a real instance — a `Meetings` issue per project — so a
  // title alone does not say which issue this is, and a key alone does not say
  // what it is.
  assert.deepEqual(pinLabelParts(pin), { key: 'GEN-1', title: 'Meeting - Protostar' });
  assert.deepEqual(pinLabelParts(pin, 'keyname'), { key: 'GEN-1', title: 'Meeting - Protostar' });
});

test('title only, and key only', () => {
  assert.deepEqual(pinLabelParts(pin, 'name'), { key: null, title: 'Meeting - Protostar' });
  assert.deepEqual(pinLabelParts(pin, 'key'), { key: 'GEN-1', title: null });
});

test('an unknown mode falls back to showing both rather than nothing', () => {
  assert.deepEqual(pinLabelParts(pin, 'nonsense'), { key: 'GEN-1', title: 'Meeting - Protostar' });
});

test('a pin with no stored title still says something', () => {
  // Pins created before the title was stored, or an issue whose summary came back
  // empty. A blank chip would be unclickable in practice.
  assert.deepEqual(pinLabelParts({ issueKey: 'GEN-1', title: '' }, 'name'), {
    key: null,
    title: 'GEN-1',
  });
  assert.deepEqual(pinLabelParts({ issueKey: 'GEN-1', title: '' }, 'keyname'), {
    key: 'GEN-1',
    title: null,
  });
});
