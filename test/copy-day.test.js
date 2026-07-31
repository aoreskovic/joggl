// Finding the day to copy.
//
// Every interesting case here is one a user meets once and remembers: a Monday
// reaching back over the weekend, the first morning after a fortnight off, a fresh
// install with no history at all. None of them are reachable by hand without
// waiting a fortnight, so the search takes its readers as arguments and all of it
// is checked here instead.

import assert from 'node:assert/strict';
import test from 'node:test';

import { findLastDayWithEntries, MAX_LOOKBACK_DAYS } from '../renderer/js/day-search.js';

const entry = (id = 'e1') => ({
  id,
  issueKey: 'PROJ-1',
  issueId: '10001',
  title: 'Work',
  startTs: 1,
  endTs: 2,
  status: 'pending',
  worklogId: null,
  comment: null,
  errorMsg: null,
});

/** Readers over a plain map of day key → entries. Records what was asked for. */
function readers({ local = {}, jira = {} } = {}) {
  const asked = { local: [], jira: [] };
  return {
    asked,
    readLocal: async (key) => {
      asked.local.push(key);
      return local[key] ?? [];
    },
    readJira: async (key) => {
      asked.jira.push(key);
      return jira[key] ?? [];
    },
  };
}

const find = (from, r, extra = {}) =>
  findLastDayWithEntries({ from, readLocal: r.readLocal, readJira: r.readJira, ...extra });

test('yesterday wins when yesterday has something', async () => {
  const r = readers({ local: { '2026-07-29': [entry()] } });
  const found = await find('2026-07-30', r);
  assert.equal(found.dayKey, '2026-07-29');
  assert.equal(found.entries.length, 1);
  assert.deepEqual(r.asked.local, ['2026-07-29'], 'it stops at the first hit');
});

test('the day it starts from is never itself the answer', async () => {
  // Copying a day onto itself would double it.
  const r = readers({ local: { '2026-07-30': [entry()], '2026-07-24': [entry('older')] } });
  const found = await find('2026-07-30', r);
  assert.equal(found.dayKey, '2026-07-24');
});

test('a Monday reaches back over the weekend to Friday', async () => {
  // 2026-08-03 is a Monday; 2026-07-31 the Friday before it.
  const r = readers({ local: { '2026-07-31': [entry()] } });
  const found = await find('2026-08-03', r);
  assert.equal(found.dayKey, '2026-07-31');
  assert.deepEqual(
    r.asked.local,
    ['2026-08-02', '2026-08-01', '2026-07-31'],
    'Sunday and Saturday are looked at and found empty — nothing is assumed about which days are worked',
  );
});

test('a fortnight off reaches the last day worked before it', async () => {
  const r = readers({ local: { '2026-07-16': [entry()] } });
  const found = await find('2026-07-30', r);
  assert.equal(found.dayKey, '2026-07-16');
  assert.equal(r.asked.local.length, 14);
});

test('a day worked entirely in the Jira web UI still counts', async () => {
  // No local entries at all on that day — the whole reason the search asks Jira.
  const r = readers({ jira: { '2026-07-28': [{ ...entry('w'), worklogId: '900' }] } });
  const found = await find('2026-07-30', r);
  assert.equal(found.dayKey, '2026-07-28');
  assert.equal(found.entries.length, 1);
});

test('a synced entry and the Jira worklog it made are copied once, not twice', async () => {
  const synced = { ...entry('mine'), status: 'synced', worklogId: '900' };
  const r = readers({
    local: { '2026-07-29': [synced] },
    jira: { '2026-07-29': [{ ...entry('jira:900'), worklogId: '900', external: true }] },
  });
  const found = await find('2026-07-30', r);
  assert.deepEqual(found.entries.map((e) => e.id), ['mine']);
});

test('a Jira worklog no local entry claims is copied alongside the local ones', async () => {
  const r = readers({
    local: { '2026-07-29': [entry('mine')] },
    jira: { '2026-07-29': [{ ...entry('extra'), worklogId: '901', external: true }] },
  });
  const found = await find('2026-07-30', r);
  assert.deepEqual(found.entries.map((e) => e.id).sort(), ['extra', 'mine']);
});

test('it looks exactly thirty days back, and finds a hit on the last of them', async () => {
  assert.equal(MAX_LOOKBACK_DAYS, 30);
  const r = readers({ local: { '2026-06-30': [entry()] } }); // 30 days before 2026-07-30
  const found = await find('2026-07-30', r);
  assert.equal(found.dayKey, '2026-06-30');
  assert.equal(r.asked.local.length, 30);
});

test('entries one day past the edge are not found, and the answer is null not a throw', async () => {
  const r = readers({ local: { '2026-06-29': [entry()] } }); // 31 days back
  assert.equal(await find('2026-07-30', r), null);
  assert.equal(r.asked.local.length, 30, 'and it stops looking rather than running on');
});

test('a first run with no history anywhere answers null', async () => {
  const r = readers();
  assert.equal(await find('2026-07-30', r), null);
});

test('a reader that answers nothing at all is treated as an empty day', async () => {
  // Jira is skipped entirely when no token is configured, and that reader answers
  // undefined rather than a list.
  const found = await findLastDayWithEntries({
    from: '2026-07-30',
    readLocal: async (key) => (key === '2026-07-29' ? [entry()] : undefined),
    readJira: async () => undefined,
  });
  assert.equal(found.dayKey, '2026-07-29');
});

test('progress is reported as it goes, so a long search can say how far it is', async () => {
  const seen = [];
  const r = readers({ local: { '2026-07-27': [entry()] } });
  await find('2026-07-30', r, { onProgress: (back) => seen.push(back) });
  assert.deepEqual(seen, [1, 2, 3]);
});

test('the cap is adjustable, so a caller can bound a search more tightly', async () => {
  const r = readers({ local: { '2026-07-25': [entry()] } });
  assert.equal(await find('2026-07-30', r, { maxBack: 3 }), null);
  assert.equal((await find('2026-07-30', r, { maxBack: 5 })).dayKey, '2026-07-25');
});
