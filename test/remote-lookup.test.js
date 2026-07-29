// The debounced "also ask Jira" helper.
//
// The first test is the one that matters. Reporting an empty result synchronously
// when no lookup was warranted put every caller into a render → lookup → render
// loop that blew the stack, which left the quick-entry popup hidden and unfocused
// and made clicking the day view look completely dead.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createRemoteLookup } from '../renderer/js/remote-lookup.js';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const issue = (key) => ({ issueKey: key, title: key, issueId: null });

test('never calls back synchronously, however unpromising the query', () => {
  const calls = [];
  const trigger = createRemoteLookup({
    lookup: async () => [issue('A-1')],
    onResults: (query, issues) => calls.push({ query, issues }),
    delayMs: 5,
  });

  // Each of these is a reason to skip the lookup. None may reach onResults on
  // this turn of the loop — a caller that re-renders from the callback would
  // otherwise re-enter the render that started it.
  trigger('', 0);
  trigger('a', 0);
  trigger('review', 15);
  assert.deepEqual(calls, []);
});

test('a caller that re-renders from the callback does not recurse', async () => {
  // The exact shape of the wiring that broke: the render triggers a lookup, and
  // the lookup's callback renders again. Only a synchronous callback turns that
  // into unbounded recursion.
  let depth = 0;
  let maxDepth = 0;
  let renders = 0;

  const trigger = createRemoteLookup({
    lookup: async () => [issue('A-1')],
    onResults: () => render(),
    delayMs: 5,
  });

  function render() {
    renders++;
    depth++;
    maxDepth = Math.max(maxDepth, depth);
    // Bounded so a regression fails the assertion instead of hanging the suite.
    if (renders < 200) trigger('meeting', 0);
    depth--;
  }

  render();
  await tick(40);

  assert.equal(maxDepth, 1, `render nested ${maxDepth} deep — the callback re-entered it`);
  assert.ok(renders < 200, 'the render/lookup loop ran away');
});

test('reports results once the delay has passed', async () => {
  const calls = [];
  const trigger = createRemoteLookup({
    lookup: async () => [issue('GEN-1'), issue('GEN-2')],
    onResults: (query, issues) => calls.push({ query, keys: issues.map((i) => i.issueKey) }),
    delayMs: 5,
  });

  trigger('meeting', 0);
  await tick(30);
  assert.deepEqual(calls, [{ query: 'meeting', keys: ['GEN-1', 'GEN-2'] }]);
});

test('drops issues the local list already shows', async () => {
  const calls = [];
  const trigger = createRemoteLookup({
    lookup: async () => [issue('GEN-1'), issue('GEN-2')],
    onResults: (_query, issues) => calls.push(issues.map((i) => i.issueKey)),
    knownKeys: () => new Set(['GEN-1']),
    delayMs: 5,
  });

  trigger('meeting', 0);
  await tick(30);
  assert.deepEqual(calls, [['GEN-2']]);
});

test('rapid typing produces one request, for the last query', async () => {
  const asked = [];
  const calls = [];
  const trigger = createRemoteLookup({
    lookup: async (q) => {
      asked.push(q);
      return [issue('GEN-1')];
    },
    onResults: (query) => calls.push(query),
    delayMs: 10,
  });

  trigger('me', 0);
  trigger('mee', 0);
  trigger('meet', 0);
  trigger('meeting', 0);
  await tick(40);

  assert.deepEqual(asked, ['meeting']);
  assert.deepEqual(calls, ['meeting']);
});

test('a late answer for an abandoned query is discarded', async () => {
  const calls = [];
  const trigger = createRemoteLookup({
    lookup: async (q) => {
      // The first query answers slowly, the second quickly — so the stale answer
      // lands last and would otherwise win.
      await tick(q === 'slow' ? 40 : 1);
      return [issue(q)];
    },
    onResults: (query) => calls.push(query),
    delayMs: 1,
  });

  trigger('slow', 0);
  await tick(10);
  trigger('fast', 0);
  await tick(80);

  assert.deepEqual(calls, ['fast']);
});

test('a failure reports an error and no results', async () => {
  const calls = [];
  const errors = [];
  const trigger = createRemoteLookup({
    lookup: async () => {
      throw new Error('401 from Jira');
    },
    onResults: (query) => calls.push(query),
    onError: (message) => errors.push(message),
    delayMs: 5,
  });

  trigger('meeting', 0);
  await tick(30);

  assert.deepEqual(calls, []);
  assert.deepEqual(errors, ['401 from Jira']);
});

test('nothing is asked while Jira is unconfigured', async () => {
  const asked = [];
  const trigger = createRemoteLookup({
    lookup: async (q) => {
      asked.push(q);
      return [];
    },
    onResults: () => {},
    isEnabled: () => false,
    delayMs: 5,
  });

  trigger('meeting', 0);
  await tick(30);
  assert.deepEqual(asked, []);
});
