// Finish Day partial failure. If a successful entry loses its worklogId, or a
// failed one keeps a synced status, the next run either double-logs the time or
// drops it — both unrecoverable without going into Jira by hand.

import assert from 'node:assert/strict';
import test from 'node:test';

import { planFinishDay, resetFailedForRetry, runFinishDay } from '../renderer/js/finish-day.js';

const T = (h, m = 0) => new Date(2026, 6, 28, h, m, 0, 0).getTime();

function entry(overrides = {}) {
  return {
    id: 'e1',
    issueKey: 'PROJ-1',
    issueId: '10001',
    title: 'Work',
    startTs: T(9),
    endTs: T(10),
    status: 'pending',
    worklogId: null,
    errorMsg: null,
    ...overrides,
  };
}

const byId = (entries, id) => entries.find((e) => e.id === id);

// ── Planning ───────────────────────────────────────────────────────────────

test('splits a day into submit / local / already-synced / running', () => {
  const plan = planFinishDay([
    entry({ id: 'pending' }),
    entry({ id: 'local', issueKey: null, issueId: null, status: 'pending' }),
    entry({ id: 'synced', status: 'synced', worklogId: '900' }),
    entry({ id: 'running', endTs: null }),
    entry({ id: 'failed', status: 'error', errorMsg: 'HTTP 500' }),
  ]);

  assert.deepEqual(plan.toSubmit.map((e) => e.id).sort(), ['failed', 'pending']);
  assert.deepEqual(plan.toMarkLocal.map((e) => e.id), ['local']);
  assert.deepEqual(plan.alreadySynced.map((e) => e.id), ['synced']);
  assert.deepEqual(plan.running.map((e) => e.id), ['running']);
});

test('a synced entry with a worklogId is left alone', () => {
  const plan = planFinishDay([entry({ id: 'x', status: 'synced', worklogId: '900' })]);
  assert.deepEqual(plan.toSubmit, []);
  assert.deepEqual(plan.alreadySynced.map((e) => e.id), ['x']);
});

test('an entry edited after syncing is queued so its worklog can be rewritten', () => {
  const plan = planFinishDay([entry({ id: 'x', status: 'pending', worklogId: '900' })]);
  assert.deepEqual(plan.toSubmit.map((e) => e.id), ['x']);
  assert.deepEqual(plan.alreadySynced, []);
});

test('submissions are ordered oldest first', () => {
  const plan = planFinishDay([
    entry({ id: 'late', startTs: T(15), endTs: T(16) }),
    entry({ id: 'early', startTs: T(9), endTs: T(10) }),
  ]);
  assert.deepEqual(plan.toSubmit.map((e) => e.id), ['early', 'late']);
});

// ── State transitions ──────────────────────────────────────────────────────

test('a full success marks everything synced and records each worklogId', async () => {
  const entries = [
    entry({ id: 'a', startTs: T(9), endTs: T(10) }),
    entry({ id: 'b', startTs: T(11), endTs: T(12) }),
  ];
  let n = 0;
  const result = await runFinishDay(entries, async () => ({ worklogId: `w${++n}` }));

  assert.equal(result.failed.length, 0);
  assert.equal(result.submitted.length, 2);
  assert.equal(byId(result.entries, 'a').status, 'synced');
  assert.equal(byId(result.entries, 'a').worklogId, 'w1');
  assert.equal(byId(result.entries, 'b').worklogId, 'w2');
});

test('a partial failure keeps successes synced and marks only the failures', async () => {
  const entries = [
    entry({ id: 'a', startTs: T(9), endTs: T(10) }),
    entry({ id: 'b', startTs: T(11), endTs: T(12) }),
    entry({ id: 'c', startTs: T(13), endTs: T(14) }),
  ];

  const result = await runFinishDay(entries, async (e) => {
    if (e.id === 'b') throw new Error('401 from Jira — check your API token in Settings.');
    return { worklogId: `w-${e.id}` };
  });

  assert.deepEqual(result.submitted.map((e) => e.id), ['a', 'c']);
  assert.deepEqual(result.failed.map((e) => e.id), ['b']);

  const a = byId(result.entries, 'a');
  assert.equal(a.status, 'synced');
  assert.equal(a.worklogId, 'w-a');
  assert.equal(a.errorMsg, null);

  const b = byId(result.entries, 'b');
  assert.equal(b.status, 'error');
  assert.equal(b.worklogId, null, 'a failure must stay retryable');
  assert.match(b.errorMsg, /401 from Jira/);

  assert.equal(byId(result.entries, 'c').status, 'synced');
});

test('a failure does not stop the entries after it', async () => {
  const attempted = [];
  const entries = [
    entry({ id: 'a', startTs: T(9), endTs: T(10) }),
    entry({ id: 'b', startTs: T(11), endTs: T(12) }),
    entry({ id: 'c', startTs: T(13), endTs: T(14) }),
  ];

  await runFinishDay(entries, async (e) => {
    attempted.push(e.id);
    if (e.id === 'a') throw new Error('network down');
    return { worklogId: e.id };
  });

  assert.deepEqual(attempted, ['a', 'b', 'c']);
});

test('a 2xx with no worklog id is treated as a failure, not a silent success', async () => {
  const result = await runFinishDay([entry({ id: 'a' })], async () => ({}));
  assert.deepEqual(result.submitted, []);
  assert.equal(byId(result.entries, 'a').status, 'error');
  assert.equal(byId(result.entries, 'a').worklogId, null);
});

test('entries without an issue key become local and never reach the submit function', async () => {
  const seen = [];
  const entries = [
    entry({ id: 'jira' }),
    entry({ id: 'lunch', issueKey: null, issueId: null, title: 'Lunch' }),
  ];

  const result = await runFinishDay(entries, async (e) => {
    seen.push(e.id);
    return { worklogId: 'w1' };
  });

  assert.deepEqual(seen, ['jira']);
  assert.equal(byId(result.entries, 'lunch').status, 'local');
  assert.equal(byId(result.entries, 'lunch').worklogId, null);
  assert.deepEqual(result.markedLocal.map((e) => e.id), ['lunch']);
});

test('an already-synced entry is never posted again', async () => {
  const seen = [];
  const entries = [entry({ id: 'done', status: 'synced', worklogId: '900' })];

  const result = await runFinishDay(entries, async (e) => {
    seen.push(e.id);
    return { worklogId: 'DUPLICATE' };
  });

  assert.deepEqual(seen, []);
  assert.equal(byId(result.entries, 'done').worklogId, '900');
});

test('a re-sync after a partial failure only retries what failed', async () => {
  const first = await runFinishDay(
    [
      entry({ id: 'a', startTs: T(9), endTs: T(10) }),
      entry({ id: 'b', startTs: T(11), endTs: T(12) }),
    ],
    async (e) => {
      if (e.id === 'b') throw new Error('HTTP 500');
      return { worklogId: 'w-a' };
    },
  );

  const retried = resetFailedForRetry(first.entries);
  assert.equal(byId(retried, 'b').status, 'pending');
  assert.equal(byId(retried, 'b').errorMsg, null);
  assert.equal(byId(retried, 'a').status, 'synced');

  const seen = [];
  const second = await runFinishDay(retried, async (e) => {
    seen.push(e.id);
    return { worklogId: 'w-b' };
  });

  assert.deepEqual(seen, ['b'], 'the already-synced entry is not posted a second time');
  assert.equal(byId(second.entries, 'b').status, 'synced');
  assert.equal(byId(second.entries, 'b').worklogId, 'w-b');
  assert.equal(byId(second.entries, 'a').worklogId, 'w-a');
});

// ── Editing something already synced ───────────────────────────────────────

test('an edited synced entry keeps its worklog id through a successful rewrite', async () => {
  const seen = [];
  const result = await runFinishDay(
    [entry({ id: 'a', status: 'pending', worklogId: '900', startTs: T(9), endTs: T(11) })],
    async (e) => {
      seen.push({ id: e.id, worklogId: e.worklogId, endTs: e.endTs });
      return { worklogId: e.worklogId };
    },
  );

  // The submit callback is handed the existing id, which is what tells the caller
  // to rewrite rather than post a second worklog.
  assert.deepEqual(seen, [{ id: 'a', worklogId: '900', endTs: T(11) }]);
  assert.equal(byId(result.entries, 'a').status, 'synced');
  assert.equal(byId(result.entries, 'a').worklogId, '900');
});

test('a failed rewrite keeps the worklog id so the retry rewrites too', async () => {
  const first = await runFinishDay(
    [entry({ id: 'a', status: 'pending', worklogId: '900' })],
    async () => {
      throw new Error('HTTP 500');
    },
  );

  const failed = byId(first.entries, 'a');
  assert.equal(failed.status, 'error');
  assert.equal(failed.worklogId, '900', 'losing this would post a duplicate on retry');

  const retried = resetFailedForRetry(first.entries);
  assert.equal(byId(retried, 'a').status, 'pending');
  assert.equal(byId(retried, 'a').worklogId, '900');

  const seen = [];
  await runFinishDay(retried, async (e) => {
    seen.push(e.worklogId);
    return { worklogId: e.worklogId };
  });
  assert.deepEqual(seen, ['900']);
});

test('a failed create still has no worklog id, so the retry posts', async () => {
  const first = await runFinishDay([entry({ id: 'a' })], async () => {
    throw new Error('network down');
  });
  assert.equal(byId(first.entries, 'a').worklogId, null);

  const seen = [];
  await runFinishDay(resetFailedForRetry(first.entries), async (e) => {
    seen.push(e.worklogId);
    return { worklogId: 'new-1' };
  });
  assert.deepEqual(seen, [null]);
});

test('runFinishDay does not mutate the entries it was given', async () => {
  const original = entry({ id: 'a' });
  await runFinishDay([original], async () => ({ worklogId: 'w1' }));
  assert.equal(original.status, 'pending');
  assert.equal(original.worklogId, null);
});

test('a running entry is left untouched', async () => {
  const result = await runFinishDay([entry({ id: 'live', endTs: null })], async () => {
    throw new Error('should not be called');
  });
  assert.equal(byId(result.entries, 'live').status, 'pending');
  assert.equal(byId(result.entries, 'live').endTs, null);
});
