import { test } from 'node:test';
import assert from 'node:assert/strict';

import { locateEntry } from '../renderer/js/day-range.js';

const entry = (id) => ({ id, issueKey: 'GEN-1', title: 'Standup', startTs: 0, endTs: 1 });

test('an entry is found on the day it is filed under, not the day on screen', () => {
  const days = new Map([
    ['2026-08-03', [entry('a'), entry('b')]],
    ['2026-08-06', [entry('c')]],
  ]);
  assert.equal(locateEntry('c', days, new Map()).dayKey, '2026-08-06');
  assert.equal(locateEntry('a', days, new Map()).dayKey, '2026-08-03');
  assert.equal(locateEntry('a', days, new Map()).entry.id, 'a');
});

test('a Jira-side row is found too, so the refusals that name it still fire', () => {
  const external = new Map([['2026-08-04', [{ ...entry('jira:900'), external: true }]]]);
  const found = locateEntry('jira:900', new Map(), external);
  assert.equal(found.dayKey, '2026-08-04');
  assert.equal(found.entry.external, true);
});

/**
 * Local first, always. A synced local entry and the Jira worklog it created are the
 * same half hour seen twice, and it is the local one that may be edited.
 */
test('a local entry wins over a Jira-side row of the same id', () => {
  const days = new Map([['2026-08-03', [entry('same')]]]);
  const external = new Map([['2026-08-05', [{ ...entry('same'), external: true }]]]);
  assert.equal(locateEntry('same', days, external).dayKey, '2026-08-03');
});

test('an id nothing holds answers null rather than throwing', () => {
  assert.equal(locateEntry('nope', new Map([['2026-08-03', [entry('a')]]]), new Map()), null);
  assert.equal(locateEntry(null, new Map(), new Map()), null);
  assert.equal(locateEntry('a', new Map([['2026-08-03', undefined]]), new Map()), null);
});
