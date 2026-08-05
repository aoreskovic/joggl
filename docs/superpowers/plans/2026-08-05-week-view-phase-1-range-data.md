# Week View Phase 1 — Range Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read a whole range of days from Jira and the day store in one pass instead of one day at a time, so *Copy previous day* returns immediately and the week and month views have something to read.

**Architecture:** `fetchDayWorklogs` becomes a thin wrapper over a new `fetchRangeWorklogs`, which runs one JQL for the whole range and one paginated worklog `GET` per distinct issue. Two new IPC channels carry a range across the bridge. In the renderer, day entries move from a single `state.entries` array into `state.days` (a `Map` keyed by day) with `state.entries` redefined as a live view onto the selected day, so the forty-odd existing call sites keep working untouched.

**Tech stack:** Electron 43, ESM throughout except `preload/index.cjs`, `node --test` with `node:assert/strict`, no runtime dependencies. Node 22+.

**Spec:** `docs/superpowers/specs/2026-08-05-week-view-design.md`, Phase 1.

## Global Constraints

- **No new dependencies.** Anything needing `node-gyp` is out; so is a date library. See CLAUDE.md § *Stack*.
- **The renderer never calls Jira.** All traffic goes through IPC to main. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **The preload surface is an explicit allowlist** in `preload/index.cjs`, spelled out rather than derived. Never expose `ipcRenderer`.
- **Day keys are local dates**, `YYYY-MM-DD`, never `toISOString().slice(0,10)`.
- **Timestamps are epoch ms internally.** Convert to wall clock only at render and Jira-serialisation boundaries.
- **`main/jira/fake.js` exports match `client.js` name for name** and return what `client.js` returns *after* parsing. A new export in one means a new export in the other, or `npm run uicheck:fast` breaks.
- **`npm test` must be 0 failures** at the end of every task.
- **`npm run uicheck` and `npm run uicheck:fast` must report the same counts** at the end of the phase. That is the only thing keeping the fake honest.
- **Never run Finish Day / Sync against the live site from a script.**
- **Commits within this phase are ordinary incremental commits on `feature/week-view`.** The version bump to **0.16.0** happens once, in Task 10, so `main` still gets one version per shipped change as CLAUDE.md requires.
- Existing files are heavily commented, explaining *why* rather than *what*. Match that. New modules open with a comment saying what they are for and what mistake they prevent.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `main/jira/paging.js` | One generic: collect every page of an old-style `startAt`/`total` Jira endpoint. No knowledge of worklogs. |
| `renderer/js/day-range.js` | Pure helpers about ranges of days: enumerating them, bucketing what comes back, turning Jira worklogs into external entries, and installing the `state.entries` view. No DOM, no IPC. |
| `test/paging.test.js` | Tests for `main/jira/paging.js`. |
| `test/range-worklogs.test.js` | Tests for `buildWorklogRangeJql` and `localDayKey`. |
| `test/day-range.test.js` | Tests for `renderer/js/day-range.js`. The spec calls this `test/day-store.test.js`; it is named for the module it covers instead. |

**Modified:**

| File | Change |
|---|---|
| `main/jira/time.js` | Add `localDayKey`. |
| `main/jira/client.js:458-503` | `fetchRangeWorklogs` added; `fetchDayWorklogs` becomes a wrapper. |
| `main/jira/fake.js:91-117` | Same two exports, same shapes. |
| `main/days.js` | Add `getDays`. |
| `main/ipc.js:108-112` | Add `day:getRange` and `jira:rangeWorklogs`. |
| `preload/index.cjs:44-51` | Add `jira.rangeWorklogs` and `days.getRange`. |
| `renderer/js/state.js` | `state.days` / `state.external` Maps, `loadDays`, `entriesFor`, `visibleEntriesFor`, `persistDayFor`, `invalidateExternal`. |
| `renderer/js/app.js:225-245` | `refreshExternal` onto the range layer. |
| `renderer/js/copy-day.js:20-71` | Readers over one prefetched window; progress text removed. |
| `CLAUDE.md`, `test-and-issues.md`, `scripts/ui-check.mjs`, `package.json` | Task 10. |

---

## Task 1: `localDayKey` — which local day a worklog belongs to

A worklog started at 23:45 belongs to the day it started on. `Date.prototype.toISOString()` is UTC and would file it under tomorrow for anyone east of Greenwich, which is the bug CLAUDE.md deviation #7 already records for day keys. The range read buckets hundreds of worklogs by day, so this gets its own tested function rather than an inline expression.

**Files:**
- Modify: `main/jira/time.js` (append; it already has a `pad` helper at line 14)
- Test: `test/range-worklogs.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `localDayKey(ts: number) -> string` — `YYYY-MM-DD` in local time. Throws `TypeError` on a non-finite `ts`.

- [ ] **Step 1: Write the failing test**

Create `test/range-worklogs.test.js`:

```js
// The two pure pieces of the range read: which day a worklog belongs to, and the
// JQL that finds the issues carrying them.
//
// Both are worth their own tests for the same reason the worklog formatter is: a
// wrong answer here does not throw, it quietly files time under the wrong day or
// returns the wrong issues, and nothing on screen says so.

import assert from 'node:assert/strict';
import test from 'node:test';

import { localDayKey } from '../main/jira/time.js';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `SyntaxError` or `TypeError` about `localDayKey` not being exported from `../main/jira/time.js`.

- [ ] **Step 3: Write the implementation**

Append to `main/jira/time.js`:

```js
/**
 * The local day a timestamp falls in, as a `YYYY-MM-DD` key.
 *
 * Local, never UTC. `toISOString().slice(0, 10)` hands anyone east of Greenwich
 * tomorrow's key late in the evening, which would file a 23:45 worklog under a day
 * it was not worked on — the same mistake CLAUDE.md records for day keys generally.
 * The range read buckets hundreds of worklogs with this, so it is tested rather than
 * written inline.
 *
 * @param {number} ts epoch ms
 * @returns {string}
 */
export function localDayKey(ts) {
  if (!Number.isFinite(ts)) throw new TypeError(`localDayKey: not a timestamp: ${ts}`);
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 251 existing + 5 new = 256 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add main/jira/time.js test/range-worklogs.test.js
git commit -m "Add localDayKey, so a 23:45 worklog files under the day it started on"
```

---

## Task 2: `collectPaged` — following `startAt` to the end

`/rest/api/3/issue/{key}/worklog` is the old-style `startAt` / `maxResults` / `total` endpoint. `fetchDayWorklogs` asks for 200 and ignores `startAt` — open issue #5 in CLAUDE.md. Over one day that is harmless; over thirty days on a shared issue holding 660 worklogs it silently returns a truncated day, and a truncated read looks exactly like a quiet day.

The loop is extracted so it can be tested without a network: `client.js` supplies a `fetchPage` that does the HTTP, the test supplies one that does not.

**Files:**
- Create: `main/jira/paging.js`
- Test: `test/paging.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `collectPaged(fetchPage, { pageLimit?: number }) -> Promise<any[]>` where `fetchPage(startAt: number) -> Promise<{ items: any[], total: number|null }>`. Default `pageLimit` is `20`, exported as `DEFAULT_PAGE_LIMIT`.

- [ ] **Step 1: Write the failing test**

Create `test/paging.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../main/jira/paging.js`.

- [ ] **Step 3: Write the implementation**

Create `main/jira/paging.js`:

```js
// Reading every page of an old-style Jira endpoint.
//
// `search/jql` pages with `nextPageToken` and is handled in client.js. The worklog
// endpoint is the older kind — `startAt`, `maxResults`, `total` — and asking for one
// page of 200 and stopping, which is what fetchDayWorklogs used to do, silently
// truncates any issue with more worklogs than that. One shared issue on this site
// holds 660, so a thirty-day read of it would have lost two thirds of the day.
//
// Its own module, taking the page fetcher as an argument, because every interesting
// case needs hundreds of worklogs to reach and none of them can be tested through a
// real request.

/** Enough for 2000 worklogs on one issue. Past that, something is wrong upstream. */
export const DEFAULT_PAGE_LIMIT = 20;

/**
 * Every item across every page.
 *
 * Stops on whichever comes first: the reported `total` reached, a short or empty
 * page, or `pageLimit` pages. The short-page test is not belt and braces — not every
 * Jira response carries a usable `total`, and a loop trusting it alone spins forever
 * when it is absent.
 *
 * @param {(startAt: number) => Promise<{items: any[], total: number|null}|null>} fetchPage
 * @param {{pageLimit?: number}} [opts]
 * @returns {Promise<any[]>}
 */
export async function collectPaged(fetchPage, { pageLimit = DEFAULT_PAGE_LIMIT } = {}) {
  const all = [];

  for (let page = 0; page < pageLimit; page++) {
    const data = await fetchPage(all.length);
    const items = data?.items ?? [];
    if (items.length === 0) break;

    all.push(...items);

    const total = Number(data?.total);
    if (Number.isFinite(total) && all.length >= total) break;
  }

  return all;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 263 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add main/jira/paging.js test/paging.test.js
git commit -m "Follow startAt to the end, so a busy issue is not read truncated"
```

---

## Task 3: `buildWorklogRangeJql` — one query for the whole range

Today's read builds `worklogDate = "2026-08-05"` per day. A range needs `>=` and `<=`, and the dates come from the caller rather than from a user, so they are asserted rather than escaped — a malformed key must fail loudly here instead of producing a query that returns plausible garbage.

**Files:**
- Modify: `main/jira/client.js` (add near `fetchDayWorklogs`, around line 444)
- Test: `test/range-worklogs.test.js` (extend Task 1's file)

**Interfaces:**
- Consumes: nothing.
- Produces: `buildWorklogRangeJql(from: string, to: string) -> string`. Throws `JiraError` if either is not `YYYY-MM-DD` or if `to < from`.

- [ ] **Step 1: Write the failing test**

Append to `test/range-worklogs.test.js`, and extend the import at the top to
`import { buildWorklogRangeJql, JiraError } from '../main/jira/client.js';`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `buildWorklogRangeJql is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `main/jira/client.js`, immediately above `fetchDayWorklogs`:

```js
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The JQL that finds every issue this account logged time against between two days.
 *
 * One query for the whole range rather than one per day: reading a month used to
 * cost thirty of these plus their per-issue follow-ups, which is what made *Copy
 * previous day* crawl.
 *
 * The dates come from Joggl, never from a user, so a malformed one is a bug and is
 * thrown rather than escaped. Failing loudly matters more than it looks: a bad date
 * here does not error at Jira, it returns a plausible empty result, and an empty
 * result reads as "no time logged" rather than as "the query was wrong".
 */
export function buildWorklogRangeJql(from, to) {
  if (!DAY_KEY.test(String(from)) || !DAY_KEY.test(String(to))) {
    throw new JiraError(`Worklog range needs YYYY-MM-DD dates — got "${from}" to "${to}".`);
  }
  if (to < from) {
    throw new JiraError(`Worklog range runs backwards: "${from}" to "${to}".`);
  }
  return (
    `worklogAuthor = currentUser() AND worklogDate >= "${from}" AND worklogDate <= "${to}"`
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 267 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add main/jira/client.js test/range-worklogs.test.js
git commit -m "Build one worklog query for a whole range of days"
```

---

## Task 4: `fetchRangeWorklogs`, and `fetchDayWorklogs` as a wrapper

Wires Tasks 1–3 into the actual read. Not unit-testable — it does HTTP — so it is verified by `npm run uicheck`, which is why the pure pieces were pulled out first.

**Files:**
- Modify: `main/jira/client.js:458-503` (replace `fetchDayWorklogs` wholesale)
- Modify: `main/jira/fake.js:91-117`

**Interfaces:**
- Consumes: `localDayKey` (Task 1), `collectPaged` (Task 2), `buildWorklogRangeJql` (Task 3).
- Produces:
  - `fetchRangeWorklogs(creds, { from, to, rangeStartTs, rangeEndTs }) -> Promise<Worklog[]>` where each `Worklog` is `{ worklogId, issueKey, issueId, title, startTs, endTs, comment, dayKey }`, sorted by `startTs`.
  - `fetchDayWorklogs(creds, { date, dayStartTs, dayEndTs }) -> Promise<Worklog[]>` — unchanged signature, unchanged shape apart from the added `dayKey` field, which existing callers ignore.

- [ ] **Step 1: Replace `fetchDayWorklogs` in `main/jira/client.js`**

Replace lines 444–503 (the doc comment and the whole function) with:

```js
/**
 * Every worklog the current user has between two local days, wherever it was
 * entered — including straight into the Jira web UI, which Joggl knows nothing about
 * but which still counts towards the day.
 *
 * Two steps, because Jira has no "my worklogs between X and Y" endpoint:
 *   1. one JQL narrows the whole instance down to the issues carrying such a worklog
 *      anywhere in the range;
 *   2. each of those issues is asked for its worklogs, bounded server-side by
 *      startedAfter/startedBefore — a shared issue can hold hundreds of other
 *      people's entries and pulling them all back to find one is wasteful — and
 *      paged to the end, because bounding still leaves more than one page of your
 *      own on a busy issue over a month.
 *
 * One JQL for thirty days rather than thirty of them is the whole point: *Copy
 * previous day* used to walk back a day at a time and could spend a minute on a
 * fortnight off.
 *
 * @param {{from: string, to: string, rangeStartTs: number, rangeEndTs: number}} range
 * @returns {Promise<object[]>} one entry per worklog, filtered to this account, each
 *   carrying the local `dayKey` it belongs to, sorted by start
 */
export async function fetchRangeWorklogs(creds, { from, to, rangeStartTs, rangeEndTs }) {
  const me = await testConnection(creds);
  if (!me.accountId) {
    throw new JiraError('Jira did not return an account id, so worklogs cannot be matched to you.');
  }

  const issues = await searchIssues(creds, buildWorklogRangeJql(from, to), { maxResults: 100 });

  const found = [];
  for (const issue of issues) {
    const worklogs = await collectPaged(async (startAt) => {
      const query = new URLSearchParams({
        startedAfter: String(rangeStartTs),
        startedBefore: String(rangeEndTs),
        startAt: String(startAt),
        maxResults: '100',
      });
      const data = await request(
        creds,
        'GET',
        `${API}/issue/${encodeURIComponent(issue.issueKey)}/worklog?${query}`,
        { context: `worklogs on ${issue.issueKey}` },
      );
      return { items: data?.worklogs ?? [], total: data?.total ?? null };
    });

    for (const worklog of worklogs) {
      if (worklog.author?.accountId !== me.accountId) continue;
      const startTs = Date.parse(worklog.started);
      // The server-side bound is inclusive at both ends and the JQL matches whole
      // days, so the range is re-checked here rather than trusted.
      if (!Number.isFinite(startTs) || startTs < rangeStartTs || startTs >= rangeEndTs) continue;

      found.push({
        worklogId: String(worklog.id),
        issueKey: issue.issueKey,
        issueId: issue.issueId,
        title: issue.title,
        startTs,
        endTs: startTs + (worklog.timeSpentSeconds ?? 0) * 1000,
        // Flattened, so a description written in the Jira UI is visible here too.
        comment: adfToText(worklog.comment),
        dayKey: localDayKey(startTs),
      });
    }
  }

  return found.sort((a, b) => a.startTs - b.startTs);
}

/**
 * One day's worklogs — a range of one.
 *
 * Kept as its own export because the day view has no business knowing about ranges,
 * and sharing the implementation is what stops the two views coming to disagree
 * about what a day holds.
 */
export async function fetchDayWorklogs(creds, { date, dayStartTs, dayEndTs }) {
  return fetchRangeWorklogs(creds, {
    from: date,
    to: date,
    rangeStartTs: dayStartTs,
    rangeEndTs: dayEndTs,
  });
}
```

- [ ] **Step 2: Update the imports at the top of `main/jira/client.js`**

Line 4–5 become:

```js
import { adfToText, emptyAdfComment, toAdfComment } from './adf.js';
import { collectPaged } from './paging.js';
import { formatWorklogStarted, localDayKey, worklogSeconds } from './time.js';
```

- [ ] **Step 3: Give the fake the same two exports**

Replace `fetchDayWorklogs` in `main/jira/fake.js:91-117` with:

```js
/**
 * Two worklogs, at 09:30 and 13:00, and **only on today**.
 *
 * Both halves are deliberate. Rows on today mean the checks that need a Jira-side
 * row always run, where against a live site whether they run at all depends on what
 * happened to be booked that week. No rows on any other day means `findEmptyDay`
 * succeeds on the first step back, where against a live site it can walk for a
 * fortnight — and the empty-state checks skip rather than run if it fails.
 *
 * The range read answers from the same two, filtered, so a range covering today and
 * a day read of today return the same rows. A fake where they differed would make
 * the fast run and the live run disagree, which is the one thing it must not do.
 */
export async function fetchRangeWorklogs(_creds, { rangeStartTs, rangeEndTs } = {}) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const dayStartTs = midnight.getTime();
  if (dayStartTs < rangeStartTs || dayStartTs >= rangeEndTs) return [];

  const at = (h, m) => dayStartTs + (h * 60 + m) * 60_000;
  const dayKey = localDayKey(dayStartTs);
  return [
    {
      worklogId: 'fake-1',
      issueKey: 'GEN-1',
      issueId: '10001',
      title: 'Meeting - Protostar',
      startTs: at(9, 30),
      endTs: at(10, 0),
      comment: 'Daily',
      dayKey,
    },
    {
      worklogId: 'fake-2',
      issueKey: 'EHW-70',
      issueId: '10004',
      title: 'Axiom Water Bottle Mechanical Design',
      startTs: at(13, 0),
      endTs: at(14, 0),
      comment: null,
      dayKey,
    },
  ];
}

export async function fetchDayWorklogs(creds, { date, dayStartTs, dayEndTs } = {}) {
  return fetchRangeWorklogs(creds, {
    from: date,
    to: date,
    rangeStartTs: dayStartTs,
    rangeEndTs: dayEndTs,
  });
}
```

Add `import { localDayKey } from './time.js';` at the top of `main/jira/fake.js`. Importing the real helper rather than copying it is the same discipline the file's header comment already states: the fake supplies fixtures, never a second implementation.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS — 267 passing, 0 failing. Nothing new here is unit-tested; this step is confirming nothing was broken.

- [ ] **Step 5: Run the fast UI check**

Run: `npm run uicheck:fast`
Expected: all 82 green. This is the real verification of Task 4 — the day view still shows its two Jira-side rows, now read through the range path.

If the run wedges, check for a stray Electron process holding the single-instance lock before concluding anything (CLAUDE.md § *Driving the UI*).

- [ ] **Step 6: Commit**

```bash
git add main/jira/client.js main/jira/fake.js
git commit -m "Read a range of days' worklogs in one pass, day view included"
```

---

## Task 5: A range across the bridge

Two new channels and a bounded multi-day day-log read.

**Files:**
- Modify: `main/days.js` (append after `saveDay`, line 53)
- Modify: `main/ipc.js` (add to the `handlers` table)
- Modify: `preload/index.cjs`

**Interfaces:**
- Consumes: `fetchRangeWorklogs` (Task 4).
- Produces:
  - `days.getDays(from, to) -> Promise<{[dayKey: string]: {date, entries}}>`
  - `window.joggl.days.getRange(from, to)` — same shape.
  - `window.joggl.jira.rangeWorklogs(from, to, rangeStartTs, rangeEndTs)` — `Worklog[]`.

- [ ] **Step 1: Write the failing test**

Append to `test/store.test.js`. It already exercises `main/days.js` against a throwaway
store via the `withStore` helper at line 15 and the `sampleEntries` fixture at line 25 —
use both rather than introducing a second arrangement.

Extend the existing import on line 10 to include `getDays` and `MAX_RANGE_DAYS`:

```js
import { getDay, getDays, getRunningTimer, MAX_RANGE_DAYS, saveDay, saveRunningTimer } from '../main/days.js';
```

Then append these tests:

```js
test('a range answers with every day in it, including the ones never written', async () => {
  await withStore(async () => {
    await saveDay('2026-08-03', [sampleEntries[0]]);
    await saveDay('2026-08-05', sampleEntries);

    const range = await getDays('2026-08-03', '2026-08-05');

    assert.deepEqual(Object.keys(range), ['2026-08-03', '2026-08-04', '2026-08-05']);
    assert.equal(range['2026-08-03'].entries.length, 1);
    assert.equal(range['2026-08-05'].entries.length, 3);
    // An absent day is an empty day, not a missing key — a caller should never have
    // to tell "not written yet" from "nothing on it".
    assert.deepEqual(range['2026-08-04'], { date: '2026-08-04', entries: [] });
  });
});

test('a single-day range is exactly the answer getDay gives', async () => {
  await withStore(async () => {
    await saveDay('2026-08-05', sampleEntries);
    const range = await getDays('2026-08-05', '2026-08-05');
    assert.deepEqual(range['2026-08-05'], await getDay('2026-08-05'));
  });
});

test('a range longer than the cap is refused rather than quietly truncated', async () => {
  await withStore(async () => {
    assert.equal(MAX_RANGE_DAYS, 62);
    await assert.rejects(() => getDays('2026-01-01', '2026-12-31'), /62/);
  });
});

test('a range running backwards is refused rather than answering nothing', async () => {
  await withStore(async () => {
    await assert.rejects(() => getDays('2026-08-05', '2026-08-01'), /backwards/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `days.getDays is not a function`.

- [ ] **Step 3: Add `getDays` to `main/days.js`**

Append after `saveDay`:

```js
/**
 * How many days one call may ask for.
 *
 * A month view asks for six weeks (42) and *Copy previous day* for 30, so 62 leaves
 * room without letting a caller ask for a year and get a payload nobody wants across
 * the bridge.
 */
export const MAX_RANGE_DAYS = 62;

/**
 * Every day between two keys, inclusive. Days never written answer with an empty
 * entry list rather than being absent, so a caller never has to tell "not written
 * yet" from "nothing on it".
 *
 * @returns {Promise<Record<string, {date: string, entries: object[]}>>}
 */
export async function getDays(from, to) {
  assertDate(from);
  assertDate(to);
  if (to < from) throw new Error(`Day range runs backwards: ${from} to ${to}`);

  const out = {};
  const cursor = new Date(`${from}T00:00:00`);
  const last = new Date(`${to}T00:00:00`);

  for (let i = 0; cursor <= last; i++) {
    if (i >= MAX_RANGE_DAYS) {
      throw new Error(`Day range ${from} to ${to} is longer than ${MAX_RANGE_DAYS} days.`);
    }
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    out[key] = await getDay(key);
    cursor.setDate(cursor.getDate() + 1);
  }

  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 271 passing, 0 failing.

- [ ] **Step 5: Register the two channels**

In `main/ipc.js`, add to the `handlers` object beside the existing worklog and day entries:

```js
  // A whole range in one pass, for the week and month views and for finding the
  // last day worth copying. One JQL rather than one per day.
  'jira:rangeWorklogs': async ({ from, to, rangeStartTs, rangeEndTs } = {}) =>
    jira.fetchRangeWorklogs(await resolveCreds(), { from, to, rangeStartTs, rangeEndTs }),
```

and:

```js
  'day:getRange': ({ from, to } = {}) => days.getDays(from, to),
```

- [ ] **Step 6: Add both to the preload allowlist**

In `preload/index.cjs`, inside `jira:`:

```js
    rangeWorklogs: (from, to, rangeStartTs, rangeEndTs) =>
      call('jira:rangeWorklogs', { from, to, rangeStartTs, rangeEndTs }),
```

and inside `days:`:

```js
    getRange: (from, to) => call('day:getRange', { from, to }),
```

- [ ] **Step 7: Verify the app still starts and the channels resolve**

Run: `npm run uicheck:fast`
Expected: all 82 green. A channel registered in `main/ipc.js` but missing from the preload allowlist would not fail here — nothing calls it yet — so re-read both edits and confirm the four names match exactly: `jira:rangeWorklogs`, `day:getRange`, `rangeWorklogs`, `getRange`.

- [ ] **Step 8: Commit**

```bash
git add main/days.js main/ipc.js preload/index.cjs test/store.test.js
git commit -m "Carry a range of days across the IPC bridge"
```

---

## Task 6: The pure day-range helpers

Four small pure functions the renderer needs, in one module, so they can be tested without a DOM or a `window.joggl`.

**Files:**
- Create: `renderer/js/day-range.js`
- Test: `test/day-range.test.js` (create)

**Interfaces:**
- Consumes: `addDays` from `renderer/js/util.js`.
- Produces:
  - `eachDay(from: string, to: string) -> string[]` — inclusive.
  - `bucketByDay(items: {dayKey: string}[]) -> Map<string, object[]>`
  - `externalToEntries(worklogs: object[]) -> object[]` — adds `id`, `status`, `errorMsg`, `external`.
  - `missingDays(from: string, to: string, have: Map<string, unknown>) -> string[]`
  - `installDayAccessors(target: object, { days: Map, external: Map }) -> void`

- [ ] **Step 1: Write the failing test**

Create `test/day-range.test.js`:

```js
// Ranges of days, and what comes back for them.
//
// All pure, and separated from state.js for one reason: state.js reads
// `window.joggl` at module load and cannot be imported under `node --test` at all.
// The arithmetic that decides which days are fetched and which day a worklog lands
// on is worth more than that, so it lives here.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bucketByDay,
  eachDay,
  externalToEntries,
  installDayAccessors,
  missingDays,
} from '../renderer/js/day-range.js';

test('a range lists every day between the two, inclusive', () => {
  assert.deepEqual(eachDay('2026-08-03', '2026-08-06'), [
    '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06',
  ]);
});

test('a single day is a range of one', () => {
  assert.deepEqual(eachDay('2026-08-05', '2026-08-05'), ['2026-08-05']);
});

test('a range crossing a month end is continuous', () => {
  assert.deepEqual(eachDay('2026-07-30', '2026-08-02'), [
    '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02',
  ]);
});

test('a range running backwards is empty rather than infinite', () => {
  assert.deepEqual(eachDay('2026-08-05', '2026-08-01'), []);
});

test('worklogs are bucketed under the day key they carry', () => {
  const buckets = bucketByDay([
    { worklogId: '1', dayKey: '2026-08-03' },
    { worklogId: '2', dayKey: '2026-08-05' },
    { worklogId: '3', dayKey: '2026-08-03' },
  ]);
  assert.deepEqual([...buckets.keys()].sort(), ['2026-08-03', '2026-08-05']);
  assert.deepEqual(buckets.get('2026-08-03').map((w) => w.worklogId), ['1', '3']);
});

test('bucketing nothing gives an empty map, not undefined', () => {
  assert.equal(bucketByDay([]).size, 0);
  assert.equal(bucketByDay(undefined).size, 0);
});

test('a Jira worklog becomes a read-only entry with a namespaced id', () => {
  // The id is prefixed so it can never collide with a local uuid, and `external`
  // is what every refusal in the app keys off.
  const [entry] = externalToEntries([
    { worklogId: '900', issueKey: 'GEN-1', title: 'Meetings', startTs: 1, endTs: 2, comment: null },
  ]);
  assert.equal(entry.id, 'jira:900');
  assert.equal(entry.external, true);
  assert.equal(entry.status, 'synced');
  assert.equal(entry.errorMsg, null);
  assert.equal(entry.worklogId, '900', 'kept, so a local entry can claim it');
});

test('only the days not already held are fetched again', () => {
  const have = new Map([['2026-08-04', []]]);
  assert.deepEqual(missingDays('2026-08-03', '2026-08-05', have), ['2026-08-03', '2026-08-05']);
});

test('a day held as an empty list counts as held, so an empty day is not refetched forever', () => {
  const have = new Map([['2026-08-03', []], ['2026-08-04', []], ['2026-08-05', []]]);
  assert.deepEqual(missingDays('2026-08-03', '2026-08-05', have), []);
});

test('state.entries reads and writes the selected day', () => {
  const days = new Map();
  const external = new Map();
  const s = { selectedDate: '2026-08-05' };
  installDayAccessors(s, { days, external });

  assert.deepEqual(s.entries, [], 'a day never written reads as empty');

  s.entries = [{ id: 'a' }];
  assert.deepEqual(days.get('2026-08-05').map((e) => e.id), ['a']);

  s.selectedDate = '2026-08-04';
  assert.deepEqual(s.entries, [], 'and the other day is untouched');

  s.selectedDate = '2026-08-05';
  assert.deepEqual(s.entries.map((e) => e.id), ['a']);
});

test('the append idiom used all over the app still works through the accessor', () => {
  const days = new Map();
  const s = { selectedDate: '2026-08-05' };
  installDayAccessors(s, { days, external: new Map() });

  s.entries = [{ id: 'a' }];
  s.entries = [...s.entries, { id: 'b' }];

  assert.deepEqual(s.entries.map((e) => e.id), ['a', 'b']);
});

test('externalEntries is the same view over its own map', () => {
  const external = new Map();
  const s = { selectedDate: '2026-08-05' };
  installDayAccessors(s, { days: new Map(), external });

  s.externalEntries = [{ id: 'jira:1' }];
  assert.deepEqual(external.get('2026-08-05').map((e) => e.id), ['jira:1']);
  s.selectedDate = '2026-08-04';
  assert.deepEqual(s.externalEntries, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot find module `../renderer/js/day-range.js`.

- [ ] **Step 3: Write the implementation**

Create `renderer/js/day-range.js`:

```js
// Ranges of days, and what comes back for them.
//
// Pure — no DOM, no IPC — and deliberately not part of state.js, which reads
// `window.joggl` at module load and so cannot be imported under `node --test` at
// all. The arithmetic deciding which days get fetched, and which day a worklog
// lands on, is worth testing; the IPC calls around it are covered by the UI check.

import { addDays } from './util.js';

/** Every day key from `from` to `to`, inclusive. Backwards gives nothing. */
export function eachDay(from, to) {
  const keys = [];
  for (let key = from; key <= to; key = addDays(key, 1)) keys.push(key);
  return keys;
}

/** Anything carrying a `dayKey`, grouped by it. */
export function bucketByDay(items) {
  const buckets = new Map();
  for (const item of items ?? []) {
    const list = buckets.get(item.dayKey);
    if (list) list.push(item);
    else buckets.set(item.dayKey, [item]);
  }
  return buckets;
}

/**
 * Jira's worklogs as the read-only entries the day view renders.
 *
 * The id is namespaced so it can never collide with a local uuid, and `worklogId` is
 * kept because `copyableEntries` uses it to drop a row a local synced entry already
 * stands for. `external: true` is what every refusal in the app keys off.
 */
export function externalToEntries(worklogs) {
  return (worklogs ?? []).map((w) => ({
    ...w,
    id: `jira:${w.worklogId}`,
    status: 'synced',
    errorMsg: null,
    external: true,
  }));
}

/**
 * The days in a range not already held.
 *
 * A day held as an empty list counts as held — otherwise an empty day would be
 * refetched on every render, which over a week is seven wasted requests a repaint.
 */
export function missingDays(from, to, have) {
  return eachDay(from, to).filter((key) => !have.has(key));
}

/**
 * Make `target.entries` and `target.externalEntries` live views onto the selected
 * day of two Maps.
 *
 * `state.entries` is read in about forty places across eleven modules. Rewriting all
 * of them to take a day argument would be a large change for no user-visible gain,
 * and every one of those call sites means "the day on screen" — so the storage moves
 * and the name stays. The property is deliberately not writable-as-a-whole: assigning
 * `state.entries = [...]` files the array under the selected day, which is what every
 * existing caller already means by it.
 *
 * Reading a day never written answers `[]` rather than `undefined`, so no caller has
 * to tell "not loaded" from "nothing on it" — the same promise `days.getDays` makes
 * in main.
 */
export function installDayAccessors(target, { days, external }) {
  Object.defineProperty(target, 'entries', {
    get: () => days.get(target.selectedDate) ?? [],
    set: (value) => days.set(target.selectedDate, value ?? []),
  });
  Object.defineProperty(target, 'externalEntries', {
    get: () => external.get(target.selectedDate) ?? [],
    set: (value) => external.set(target.selectedDate, value ?? []),
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 283 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add renderer/js/day-range.js test/day-range.test.js
git commit -m "Add the pure day-range helpers the multi-day state needs"
```

---

## Task 7: Multi-day state

`state.entries` stops being an array and becomes a view onto `state.days`. Nothing else in the renderer changes in this task — that is the point of the accessor.

**Files:**
- Modify: `renderer/js/state.js:9-41` (the `state` object), `:59-84` (day log), `:157-197` (external)

**Interfaces:**
- Consumes: `installDayAccessors`, `bucketByDay`, `externalToEntries`, `missingDays` (Task 6); `days.getRange`, `jira.rangeWorklogs` (Task 5).
- Produces:
  - `state.days: Map<string, object[]>`, `state.external: Map<string, object[]>`
  - `entriesFor(dayKey) -> object[]`, `visibleEntriesFor(dayKey) -> object[]`
  - `loadDays(from, to) -> Promise<void>` — fills `state.days` for the range and `state.external` for the days not already held
  - `persistDayFor(dayKey) -> Promise<void>`
  - `invalidateExternal(...dayKeys) -> void`
  - Existing exports keep their signatures: `loadDay`, `persistDayNow`, `persistDay`, `readDay`, `writeDay`, `visibleEntries`, `loadExternalWorklogs`.

- [ ] **Step 1: Replace the two entry fields on the `state` object**

In `renderer/js/state.js`, delete the `entries` and `externalEntries` properties from the object literal (lines 11–19, keeping their comments nearby) and add in their place:

```js
  /**
   * Every day loaded, keyed by day key. `state.entries` below is a live view onto
   * whichever one `selectedDate` names, so day-view code goes on saying
   * `state.entries` and cannot reach another day by accident.
   */
  days: new Map(),
  /**
   * Worklogs this account has in Jira that Joggl did not create — time booked
   * straight into the Jira web UI. Read-only, **never persisted**, merged in only at
   * render time so they cannot contaminate a day log. A session cache: keyed by day
   * and dropped when that day is written to.
   */
  external: new Map(),
```

Then, immediately after the `state` object literal, add:

```js
installDayAccessors(state, { days: state.days, external: state.external });
```

and add to the imports at the top:

```js
import {
  bucketByDay,
  eachDay,
  externalToEntries,
  installDayAccessors,
  missingDays,
} from './day-range.js';
```

- [ ] **Step 2: Add the range readers, below `writeDay`**

```js
/** One day's entries, whether or not it is the day on screen. */
export function entriesFor(dayKey) {
  return state.days.get(dayKey) ?? [];
}

/** One day as it should be shown: local entries plus unclaimed Jira-side worklogs. */
export function visibleEntriesFor(dayKey) {
  return copyableEntries(state.days.get(dayKey) ?? [], state.external.get(dayKey) ?? []);
}

export async function persistDayFor(dayKey) {
  await api.days.save(dayKey, entriesFor(dayKey));
}

/**
 * Forget the cached Jira-side rows for some days, so the next `loadDays` reads them
 * again. Called after anything that changes what Jira holds for a day.
 */
export function invalidateExternal(...dayKeys) {
  for (const key of dayKeys) state.external.delete(key);
}

/**
 * Load a range of days: the day logs always, and the Jira-side worklogs for whichever
 * of them are not already cached.
 *
 * The Jira read is one request for the whole range. Reading it a day at a time is
 * what made *Copy previous day* crawl, and it is the thing this whole phase exists
 * to stop.
 */
export async function loadDays(from, to) {
  const logs = await api.days.getRange(from, to);
  for (const key of eachDay(from, to)) state.days.set(key, logs[key]?.entries ?? []);

  if (!state.settings.baseUrl || !state.settings.tokenConfigured) return;

  const wanted = missingDays(from, to, state.external);
  if (wanted.length === 0) return;

  // One request covering the gaps, rather than one per gap. Asking for the whole
  // span even when the middle is cached is cheaper than several narrow reads: the
  // cost is one JQL either way.
  const first = wanted[0];
  const last = wanted[wanted.length - 1];
  const worklogs = await api.jira.rangeWorklogs(
    first,
    last,
    startOfDayMs(first),
    startOfDayMs(last) + DAY,
  );

  const buckets = bucketByDay(worklogs);
  for (const key of eachDay(first, last)) {
    state.external.set(key, externalToEntries(buckets.get(key) ?? []));
  }
}
```

- [ ] **Step 3: Point `loadDay` and `loadExternalWorklogs` at the new layer**

Replace `loadDay` (lines 59–68) with:

```js
export async function loadDay(date) {
  const day = await api.days.get(date);
  state.selectedDate = date;
  state.days.set(date, day.entries);
  // Deliberately *not* cleared any more. The rows belong to the day, not to the
  // screen, and they are held per day now — so stepping back to a day just visited
  // shows its Jira-side rows at once instead of blanking and refetching.
  return state.entries;
}
```

Replace the body of `loadExternalWorklogs` (lines 157–189) with a call through the range path, keeping its exported name, its guard clauses and its state flags — `state.externalState` and `state.externalError` stay exactly as they are, because `entries.js` renders from them:

```js
export async function loadExternalWorklogs(date = state.selectedDate) {
  if (!state.settings.baseUrl || !state.settings.tokenConfigured) {
    state.externalEntries = [];
    state.externalState = 'idle';
    return [];
  }

  const dayStartTs = startOfDayMs(date);
  state.externalState = 'loading';
  state.externalError = null;

  try {
    const worklogs = await api.jira.rangeWorklogs(date, date, dayStartTs, dayStartTs + DAY);
    // A day change mid-request must not drop yesterday's answer onto today — but the
    // answer is filed under the day it was asked for, so it is kept rather than
    // discarded, and only the status flags are left alone.
    state.external.set(date, externalToEntries(worklogs));
    if (date !== state.selectedDate) return [];
    state.externalState = 'loaded';
    return state.externalEntries;
  } catch (err) {
    state.external.set(date, []);
    if (date !== state.selectedDate) return [];
    state.externalState = 'error';
    state.externalError = err.message;
    throw err;
  }
}
```

- [ ] **Step 4: Invalidate the cache wherever a day is written**

In `persistDayNow`, after the save:

```js
export async function persistDayNow() {
  await api.days.save(state.selectedDate, state.entries);
}
```

becomes

```js
export async function persistDayNow() {
  await api.days.save(state.selectedDate, state.entries);
  // Nothing local changes what Jira holds, so the cached rows stay true. This is
  // here as the single place to add that invalidation when Sync gains a range.
}
```

and in `writeDay`:

```js
export async function writeDay(date, entries) {
  const saved = await api.days.save(date, entries);
  state.days.set(date, saved.entries);
  return saved;
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS — 283 passing, 0 failing. No test imports `state.js`; this confirms nothing pure was broken.

- [ ] **Step 6: Run the fast UI check — this is the real gate**

Run: `npm run uicheck:fast`
Expected: all 82 green.

This is the task most likely to break something, and the failure will look like "nothing was created" or a day showing the wrong rows. If a check fails, the first thing to check is that every `state.entries = …` assignment in the codebase still happens while `state.selectedDate` names the intended day — the accessor files under whatever `selectedDate` says at the moment of assignment. Grep for it:

```bash
git grep -n "state.entries = "
```

- [ ] **Step 7: Commit**

```bash
git add renderer/js/state.js
git commit -m "Hold every loaded day, with state.entries a view onto the one on screen"
```

---

## Task 8: Copy previous day on a prefetched window

`renderer/js/day-search.js` and `test/copy-day.test.js` are **not touched**. Only what sits behind the reader arguments changes.

**Files:**
- Modify: `renderer/js/copy-day.js:20-71`
- Do not modify: `renderer/js/day-search.js`, `test/copy-day.test.js`

**Interfaces:**
- Consumes: `loadDays`, `entriesFor`, `state.external` (Task 7); `MAX_LOOKBACK_DAYS` (existing).
- Produces: nothing new — `copyPreviousDay()` keeps its signature.

- [ ] **Step 1: Replace `jiraReader` and the top of `copyPreviousDay`**

Replace lines 20–27 (`jiraReader`) and the body of `copyPreviousDay` down to the `findLastDayWithEntries` call with:

```js
/**
 * Pull the whole lookback window in one go, then answer from it.
 *
 * The search itself is unchanged — it still walks back a day at a time and still
 * stops at the first day with anything on it. What changed is what a step costs:
 * each one used to be a JQL plus a worklog read per issue it found, so a fortnight
 * off meant fourteen sequential round trips and a visible wait. One range read
 * covers all thirty days for the price of one, and the walk becomes arithmetic.
 */
async function prefetchedReaders(from) {
  const oldest = addDays(from, -MAX_LOOKBACK_DAYS);
  const newest = addDays(from, -1);
  await loadDays(oldest, newest);
  return {
    readLocal: async (key) => entriesFor(key),
    readJira: async (key) => state.external.get(key) ?? [],
  };
}
```

and in `copyPreviousDay`:

```js
  try {
    const { readLocal, readJira } = await prefetchedReaders(target);
    const found = await findLastDayWithEntries({ from: target, readLocal, readJira });
```

The `onProgress` argument goes: with the window already in hand the search returns without waiting, so there is nothing to report. Remove the `onProgress` callback and the `Looking… ${back}d` button text with it, and in the `finally` block keep only `button.textContent = 'Copy previous day'`.

- [ ] **Step 2: Give the button a plain busy state instead**

Where the progress text used to be set, before the fetch:

```js
    if (button) {
      button.textContent = 'Looking…';
      button.disabled = true;
    }
```

and in the `finally`, alongside restoring the label:

```js
    if (button) button.disabled = false;
```

- [ ] **Step 3: Fix the imports at the top of `renderer/js/copy-day.js`**

`readDay` is no longer used. The import block becomes:

```js
import { findLastDayWithEntries, MAX_LOOKBACK_DAYS } from './day-search.js';
import { copiedToDay } from './entry-ops.js';
import { askModal } from './modal.js';
import { renderAll } from './render.js';
import { entriesFor, loadDays, persistDayNow, state } from './state.js';
import { toast, toastOk } from './toast.js';
import { addDays, esc, formatDateLabel, msToDur } from './util.js';
```

`DAY` and `startOfDayMs` go with `jiraReader`.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS — 283 passing, 0 failing. **`test/copy-day.test.js` must pass unchanged.** If it does not, the change went further than it should have — the search's contract has not moved.

- [ ] **Step 5: Run both UI checks**

Run: `npm run uicheck:fast`
Then: `npm run uicheck`

Expected: all 82 green in both, and **the same counts**. The live run is the one that shows the speed-up; note the wall-clock time it reports for later comparison.

- [ ] **Step 6: Commit**

```bash
git add renderer/js/copy-day.js
git commit -m "Find the day to copy from one prefetched window, not thirty reads"
```

---

## Task 9: Let the test hook wait for a range read

`window.__jogglTest.whenIdle()` settles on `externalPending`, which only ever holds the single-day read. A week-view check that begins a gesture before the range read lands has its rows replaced under it — trap 5 in `scripts/ui-check.mjs`, the one that produced eight failures in one run and a different six in the next.

**Files:**
- Modify: `renderer/js/app.js:228-245`

**Interfaces:**
- Consumes: `loadDays` (Task 7).
- Produces: `refreshRange(from, to) -> Promise<void>`, tracked by the same `externalPending` the day read uses.

- [ ] **Step 1: Generalise `refreshExternal`**

Replace lines 228–245 with:

```js
/**
 * The Jira read that is in flight, or null.
 *
 * Held rather than dropped so something can wait for it. Nothing in the app needs
 * that — every caller here is fire-and-forget — but the UI check does, and the
 * alternative is what it used to do: sleep for a second and a half and hope.
 *
 * One field for both the day read and the range read, because `whenIdle()` means
 * "the Jira read in flight", and a check waiting on the wrong one of two fields is
 * worse than no hook at all.
 */
let externalPending = null;

function track(promise) {
  externalPending = promise
    .then(() => renderAll())
    .catch(() => renderAll())
    .finally(() => {
      externalPending = null;
    });
  return externalPending;
}

function refreshExternal(date = state.selectedDate) {
  return track(loadExternalWorklogs(date));
}

/** Load a span of days and their Jira-side rows. For the week and month views. */
function refreshRange(from, to) {
  return track(loadDays(from, to));
}
```

- [ ] **Step 2: Leave `refreshRange` unwired**

`app.js` is the entry module and exports nothing; leave `refreshRange` unexported and add the comment above it that Phase 3's week view is its first caller. Nothing calls it in this phase, and wiring it to a view that does not exist yet would be untestable code.

Add `loadDays` to the `state.js` import list at the top of `app.js`.

Node will not warn about an unused function, so confirm by eye that `refreshExternal` still has exactly its two existing callers — `selectDate` (line ~225) and the Finish Day handler (line ~310) — and that both still work through `track`.

- [ ] **Step 3: Run the tests and both UI checks**

Run: `npm test` — 283 passing.
Run: `npm run uicheck:fast` — 82 green.

- [ ] **Step 4: Commit**

```bash
git add renderer/js/app.js
git commit -m "Let whenIdle settle on a range read as well as a day read"
```

---

## Task 10: Version, documentation, and the checks that prove it

**Files:**
- Modify: `package.json` (via `npm run bump`)
- Modify: `CLAUDE.md`
- Modify: `test-and-issues.md`
- Modify: `scripts/ui-check.mjs`

- [ ] **Step 1: Add the UI checks for what this phase changed**

In `scripts/ui-check.mjs`, add to the *Copying a day, and clearing one* group:

- **Copy previous day answers without a per-day wait.** Click **Copy previous day** on a day with an empty one before it, assert the confirm dialog appears, and assert the button never showed a `Looking… Nd` label — the progress text is gone because there is no longer anything to report. Cancel the dialog.
- **A day's Jira-side rows survive stepping away and back.** Note the count of `.entry-card.external` on today, step back a day, step forward, and assert the count is the same **without** waiting on `whenIdle()` — they are cached per day now rather than cleared on the way out.

Both must pass under `uicheck` and `uicheck:fast` and be counted in both.

- [ ] **Step 2: Run everything**

```bash
npm test
npm run uicheck:fast
npm run uicheck
```

Expected: `npm test` 283 passing, 0 failing. Both UI checks 84 green, **reporting the same counts**. Record the wall-clock time each reports.

- [ ] **Step 3: Bump the version**

```bash
npm run bump
```

Expected: `package.json` at `0.16.0`.

- [ ] **Step 4: Update `CLAUDE.md`**

1. In *Next, roughly in order*, delete item 5 (*Pagination for busy issues*) — this phase closed it — and add a line to item 1 (*Week view*) recording that the range data layer landed in 0.16.0.
2. In the *Working* table, update the **Jira client** row to mention the range read and worklog paging, and the **Tests** row to `283 passing, npm test; 84 UI checks`.
3. Add a numbered entry to *Deviations from this document, and why*:

   > **8. A day's entries live in a Map, and `state.entries` is a view onto it.**
   > Week view needs several days at once, and `state.entries` is read in about forty
   > places that all mean "the day on screen". Rewriting them to take a day argument
   > would be a large change for no user-visible gain, so the storage moved to
   > `state.days` and the name stayed — `installDayAccessors` in `day-range.js`
   > defines it as a live getter/setter over the selected day. Jira-side rows are
   > cached the same way, per day, so stepping back to a day just visited no longer
   > blanks and refetches it.

- [ ] **Step 5: Update `test-and-issues.md`**

1. The opening paragraph: `251 unit tests` → `283 unit tests`, and add the new subjects to the list — following a paginated Jira endpoint to the end, which local day a worklog belongs to, and the day-range arithmetic behind the multi-day state.
2. *Running it*: `npm test` line → `283 tests`.
3. *Last full pass*: today's date, `all 84 green`, and the two wall-clock times from Step 2.
4. *Copying a day, and clearing one*: add the two rows from Step 1 in the same "Do this / Correct result" shape as its neighbours.
5. *Open issues*: nothing new unless the work turned something up. If it did, record it there.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json CLAUDE.md test-and-issues.md scripts/ui-check.mjs
git commit -m "Read a month of Jira worklogs in one pass (0.16.0)"
```

- [ ] **Step 7: Confirm the phase is whole**

```bash
git log --oneline main..HEAD
npm test
```

Expected: ten commits on `feature/week-view`, `npm test` green. Phase 1 is done; Phase 2 gets its own plan.

---

## What this phase deliberately does not do

- **No view changes.** The week tab stays disabled. Everything visible behaves exactly as it did at 0.15.0, apart from *Copy previous day* being fast and no longer showing a countdown.
- **No timeline refactor.** The `view` singleton at `timeline.js:38` is untouched; that is Phase 2.
- **No sync-driven cache invalidation.** `invalidateExternal` exists and is unused: nothing in this phase changes what Jira holds. Phase 3's week Sync is its first caller, and `persistDayNow` carries a comment marking where it goes.
