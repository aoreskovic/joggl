// Following an old-style startAt/total Jira endpoint to the end.
//
// Every case here is one that needs a shared issue with hundreds of worklogs on it
// to reach by hand, which is exactly why the loop takes its page fetcher as an
// argument and is checked here instead.

import assert from 'node:assert/strict';
import test from 'node:test';

import { collectPaged, DEFAULT_PAGE_LIMIT } from '../main/jira/paging.js';

/** A fetcher over a fixed list, recording the offsets it was asked for. */
function pager(total, { pageSize = 100, reportTotal = total } = {}) {
  const asked = [];
  const all = Array.from({ length: total }, (_, i) => ({ id: String(i) }));
  return {
    asked,
    fetchPage: async (startAt) => {
      asked.push(startAt);
      return { items: all.slice(startAt, startAt + pageSize), total: reportTotal };
    },
  };
}

test('a single page is returned without asking for a second', async () => {
  const p = pager(40);
  assert.equal((await collectPaged(p.fetchPage)).length, 40);
  assert.deepEqual(p.asked, [0], 'it stops as soon as it has them all');
});

test('an issue with 660 worklogs is read whole, not truncated at the first page', async () => {
  // The case open issue #5 was about: one shared issue on this site holds 660.
  const p = pager(660);
  const items = await collectPaged(p.fetchPage);
  assert.equal(items.length, 660);
  assert.deepEqual(p.asked, [0, 100, 200, 300, 400, 500, 600]);
});

test('an exactly-full last page does not cause one more empty request', async () => {
  const p = pager(200);
  assert.equal((await collectPaged(p.fetchPage)).length, 200);
  assert.deepEqual(p.asked, [0, 100], 'total is reached, so there is nothing to ask for');
});

test('no items at all is an empty list, not a throw', async () => {
  const p = pager(0);
  assert.deepEqual(await collectPaged(p.fetchPage), []);
});

test('a page limit stops a pathological issue hanging the app', async () => {
  assert.equal(DEFAULT_PAGE_LIMIT, 20);
  const p = pager(10_000);
  const items = await collectPaged(p.fetchPage, { pageLimit: 3 });
  assert.equal(items.length, 300);
  assert.equal(p.asked.length, 3);
});

test('a missing total stops on the first short page rather than looping forever', async () => {
  // Not every Jira response carries one, and trusting `total` alone would spin.
  const asked = [];
  const items = await collectPaged(async (startAt) => {
    asked.push(startAt);
    return { items: startAt < 100 ? Array.from({ length: 100 }, () => ({})) : [], total: null };
  });
  assert.equal(items.length, 100);
  assert.deepEqual(asked, [0, 100]);
});

test('a page that answers nothing at all is treated as the end', async () => {
  assert.deepEqual(await collectPaged(async () => null), []);
});
