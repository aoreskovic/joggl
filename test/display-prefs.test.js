// The two display settings: which days are shaded as non-working, and how a
// pinned issue is labelled.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_FONT_SIZE,
  FONT_SIZES,
  isWeekend,
  nearestFontSize,
  pinLabelParts,
} from '../renderer/js/util.js';

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

// ── Day view text size ──────────────────────────────────────────────────────
//
// The range was 8 to 12, which is too small to read on a high-DPI screen even at
// the top of it. It is now 10 to 16, and a size saved under the old range has to
// land somewhere sensible rather than leaving the select blank.

test('the sizes on offer are the ones the settings panel lists', () => {
  assert.deepEqual(FONT_SIZES, [10, 12, 14, 16]);
  assert.equal(DEFAULT_FONT_SIZE, 12);
  assert.ok(FONT_SIZES.includes(DEFAULT_FONT_SIZE), 'the default must be selectable');
});

test('a size saved under the old range snaps to the nearest one still offered', () => {
  assert.equal(nearestFontSize(8), 10);
  assert.equal(nearestFontSize(9), 10);
  assert.equal(nearestFontSize(11), 10, 'a tie goes to the first, which is the smaller');
  assert.equal(nearestFontSize(12), 12);
});

test('a size already on offer is left alone', () => {
  for (const size of FONT_SIZES) assert.equal(nearestFontSize(size), size);
});

test('anything out of range is clamped rather than passed through', () => {
  assert.equal(nearestFontSize(2), 10);
  assert.equal(nearestFontSize(40), 16);
});

test('a missing or unparseable size falls back to the default', () => {
  assert.equal(nearestFontSize(undefined), DEFAULT_FONT_SIZE);
  assert.equal(nearestFontSize(null), DEFAULT_FONT_SIZE, 'Number(null) is 0, not NaN — so this would silently be 10 without the guard');
  assert.equal(nearestFontSize('huge'), DEFAULT_FONT_SIZE);
});
