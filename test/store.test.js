// Day log persist / reload round trip. A day that does not come back exactly as
// it went in is lost time, and there is no second copy anywhere.

import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getDay, getRunningTimer, saveDay, saveRunningTimer } from '../main/days.js';
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
    const timer = { entryId: 't1', issueKey: 'PROJ-1', title: 'Work', startTs: T(9), mergeChoice: null };
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

test('generic keys round-trip and delete', async () => {
  await withStore(async () => {
    assert.equal(await get('pins', null), null);
    await set('pins', [{ issueKey: 'PROJ-1', title: 'Meetings' }]);
    assert.deepEqual(await get('pins'), [{ issueKey: 'PROJ-1', title: 'Meetings' }]);
    await del('pins');
    assert.equal(await get('pins', null), null);
  });
});
