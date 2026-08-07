import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planDeletion } from '../renderer/js/entry-ops.js';

const item = (id, dayKey, overrides = {}) => ({
  dayKey,
  entry: { id, issueKey: 'GEN-1', title: 'Standup', worklogId: null, ...overrides },
});

test('a plan separates what can go, what is in Jira, and what is not ours', () => {
  const plan = planDeletion([
    item('a', '2026-08-03'),
    item('b', '2026-08-03', { worklogId: '60504' }),
    item('jira:900', '2026-08-04', { external: true, worklogId: '900' }),
  ]);

  assert.deepEqual(plan.removable.map((i) => i.entry.id), ['a', 'b']);
  assert.deepEqual(plan.synced.map((i) => i.entry.id), ['b']);
  assert.deepEqual(plan.external.map((i) => i.entry.id), ['jira:900']);
});

/**
 * A Jira-side row is never removed, so a day that holds only those is not a day this
 * touches at all — writing it would rewrite a day log for no reason.
 */
test('the days are only the ones something is actually coming off', () => {
  const plan = planDeletion([
    item('a', '2026-08-05'),
    item('b', '2026-08-03'),
    item('jira:900', '2026-08-07', { external: true }),
  ]);
  assert.deepEqual(plan.days, ['2026-08-03', '2026-08-05'], 'in order, and no Jira-only day');
});

test('the ids coming off a given day, and no other day’s', () => {
  const plan = planDeletion([
    item('a', '2026-08-03'),
    item('b', '2026-08-03'),
    item('c', '2026-08-05'),
  ]);
  assert.deepEqual([...plan.idsFor('2026-08-03')].sort(), ['a', 'b']);
  assert.deepEqual([...plan.idsFor('2026-08-05')], ['c']);
  assert.deepEqual([...plan.idsFor('2026-08-09')], []);
});

test('a selection of nothing but Jira rows removes nothing', () => {
  const plan = planDeletion([item('jira:900', '2026-08-04', { external: true })]);
  assert.equal(plan.removable.length, 0);
  assert.deepEqual(plan.days, []);
});

test('an empty selection is a plan, not a crash', () => {
  const plan = planDeletion([]);
  assert.deepEqual(plan.removable, []);
  assert.deepEqual(plan.days, []);
  assert.deepEqual(planDeletion(null).removable, []);
});
