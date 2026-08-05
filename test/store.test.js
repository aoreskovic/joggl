// Day log persist / reload round trip. A day that does not come back exactly as
// it went in is lost time, and there is no second copy anywhere.

import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getDay, getDays, getRunningTimer, MAX_RANGE_DAYS, saveDay, saveRunningTimer } from '../main/days.js';
import { del, get, initStore, set } from '../main/store.js';

const T = (h, m = 0) => new Date(2026, 6, 28, h, m, 0, 0).getTime();

async function withStore(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'joggl-test-'));
  try {
    const dataDir = await initStore(dir);
    await run({ dir, dataDir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const sampleEntries = [
  {
    id: 'a1',
    issueKey: 'PROJ-123',
    issueId: '10042',
    title: 'Meetings',
    startTs: T(9),
    endTs: T(10, 30),
    status: 'synced',
    worklogId: '90210',
    comment: 'reviewed the power section with Marko',
    errorMsg: null,
  },
  {
    id: 'a2',
    issueKey: null,
    issueId: null,
    title: 'Lunch',
    startTs: T(12),
    endTs: T(12, 45),
    status: 'local',
    worklogId: null,
    comment: null,
    errorMsg: null,
  },
  {
    id: 'a3',
    issueKey: 'PROJ-9',
    issueId: '10099',
    title: 'Broken sync',
    startTs: T(14),
    endTs: T(15),
    status: 'error',
    worklogId: null,
    comment: 'first line\nsecond line',
    errorMsg: 'HTTP 401',
  },
];

test('a day survives a save and reload byte for byte', async () => {
  await withStore(async () => {
    await saveDay('2026-07-28', sampleEntries);
    const reloaded = await getDay('2026-07-28');

    assert.equal(reloaded.date, '2026-07-28');
    assert.deepEqual(reloaded.entries, sampleEntries);
  });
});

test('an unknown day reads back empty rather than throwing', async () => {
  await withStore(async () => {
    assert.deepEqual(await getDay('2019-01-01'), { date: '2019-01-01', entries: [] });
  });
});

test('each day is its own file, so history never lives in one key', async () => {
  await withStore(async ({ dataDir }) => {
    await saveDay('2026-07-27', [sampleEntries[0]]);
    await saveDay('2026-07-28', sampleEntries);

    const files = (await readdir(dataDir)).sort();
    assert.deepEqual(files, ['day-2026-07-27.json', 'day-2026-07-28.json']);

    assert.equal((await getDay('2026-07-27')).entries.length, 1);
    assert.equal((await getDay('2026-07-28')).entries.length, 3);
  });
});

test('a rewrite replaces the day rather than appending to it', async () => {
  await withStore(async () => {
    await saveDay('2026-07-28', sampleEntries);
    await saveDay('2026-07-28', [sampleEntries[0]]);
    assert.deepEqual((await getDay('2026-07-28')).entries, [sampleEntries[0]]);
  });
});

test('rapid consecutive saves all land, last one winning', async () => {
  await withStore(async ({ dataDir }) => {
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        saveDay('2026-07-28', [{ ...sampleEntries[0], id: `id-${n}`, title: `v${n}` }]),
      ),
    );

    const reloaded = await getDay('2026-07-28');
    assert.equal(reloaded.entries.length, 1);
    assert.match(reloaded.entries[0].title, /^v[1-5]$/);

    // No temp files left behind by the atomic write.
    const files = await readdir(dataDir);
    assert.deepEqual(files, ['day-2026-07-28.json']);
  });
});

test('a running entry round-trips with endTs still null', async () => {
  await withStore(async () => {
    await saveDay('2026-07-28', [
      { ...sampleEntries[0], id: 'live', endTs: null, status: 'pending', worklogId: null },
    ]);
    const [entry] = (await getDay('2026-07-28')).entries;
    assert.equal(entry.endTs, null);
    assert.equal(entry.status, 'pending');
  });
});

test('a Work Description round-trips, newlines and all', async () => {
  await withStore(async () => {
    await saveDay('2026-07-28', sampleEntries);
    const { entries } = await getDay('2026-07-28');
    assert.equal(entries[0].comment, 'reviewed the power section with Marko');
    assert.equal(entries[2].comment, 'first line\nsecond line');
    assert.equal(entries[1].comment, null, 'no description stays null, not ""');
  });
});

test('an entry saved before comments existed reads back with a null one', async () => {
  await withStore(async () => {
    // Day logs written by an earlier build have no `comment` key at all. Reading
    // one must not produce `undefined`, which would serialise away on the next save.
    const { comment, ...withoutComment } = sampleEntries[0];
    await saveDay('2026-07-28', [withoutComment]);
    const [entry] = (await getDay('2026-07-28')).entries;
    assert.equal(entry.comment, null);
    assert.ok('comment' in entry);
  });
});

test('an unknown status falls back to pending instead of poisoning the day', async () => {
  await withStore(async () => {
    await saveDay('2026-07-28', [{ ...sampleEntries[0], status: 'weird', worklogId: null }]);
    assert.equal((await getDay('2026-07-28')).entries[0].status, 'pending');
  });
});

test('an entry with no usable start is dropped, the rest of the day survives', async () => {
  await withStore(async () => {
    await saveDay('2026-07-28', [sampleEntries[0], { id: 'junk', startTs: 'nonsense' }]);
    const { entries } = await getDay('2026-07-28');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, 'a1');
  });
});

test('a truncated file is set aside and the day reads back empty, not corrupt', async () => {
  await withStore(async ({ dataDir }) => {
    await saveDay('2026-07-28', sampleEntries);
    await writeFile(path.join(dataDir, 'day-2026-07-28.json'), '{"date":"2026-07-2', 'utf8');

    assert.deepEqual(await getDay('2026-07-28'), { date: '2026-07-28', entries: [] });

    const files = await readdir(dataDir);
    assert.ok(
      files.some((f) => f.includes('.corrupt-')),
      'the unreadable file is kept for inspection',
    );
  });
});

test('the running timer persists and clears independently of the day log', async () => {
  await withStore(async () => {
    const timer = {
      entryId: 't1',
      issueKey: 'PROJ-1',
      title: 'Work',
      startTs: T(9),
      // The bound decideMerge fixed at start time — must survive a restart or an
      // edited start (see app.js) could let stop absorb a block booked ahead that
      // the original bound excluded.
      mergeNotAfterTs: T(11),
      mergeChoice: null,
    };
    await saveRunningTimer(timer);
    assert.deepEqual(await getRunningTimer(), timer);

    await saveRunningTimer(null);
    assert.equal(await getRunningTimer(), null);
  });
});

test('the written file is readable JSON with the date alongside the entries', async () => {
  await withStore(async ({ dataDir }) => {
    await saveDay('2026-07-28', sampleEntries);
    const raw = JSON.parse(await readFile(path.join(dataDir, 'day-2026-07-28.json'), 'utf8'));
    assert.equal(raw.date, '2026-07-28');
    assert.equal(raw.entries.length, 3);
  });
});

test('a malformed date key is refused rather than writing a stray file', async () => {
  await withStore(async () => {
    await assert.rejects(() => saveDay('28-07-2026', []), /YYYY-MM-DD/);
    await assert.rejects(() => getDay('../escape'), /YYYY-MM-DD/);
  });
});

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

test('generic keys round-trip and delete', async () => {
  await withStore(async () => {
    assert.equal(await get('pins', null), null);
    await set('pins', [{ issueKey: 'PROJ-1', title: 'Meetings' }]);
    assert.deepEqual(await get('pins'), [{ issueKey: 'PROJ-1', title: 'Meetings' }]);
    await del('pins');
    assert.equal(await get('pins', null), null);
  });
});
