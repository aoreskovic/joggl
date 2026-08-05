import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDayWriter } from '../renderer/js/day-writes.js';

/** A controllable clock, so the tests never sleep. */
function fakeTimers() {
  let next = 1;
  const scheduled = new Map();
  return {
    setTimer(fn) {
      const id = next++;
      scheduled.set(id, fn);
      return id;
    },
    clearTimer(id) {
      scheduled.delete(id);
    },
    /** Fire everything still scheduled. */
    async run() {
      const fns = [...scheduled.values()];
      scheduled.clear();
      for (const fn of fns) await fn();
    },
    count() {
      return scheduled.size;
    },
  };
}

function recorder() {
  const saved = [];
  return { saved, save: async (dayKey) => void saved.push(dayKey) };
}

test('a queued write happens when the timer fires, not before', async () => {
  const timers = fakeTimers();
  const { saved, save } = recorder();
  const writer = createDayWriter(save, timers);

  writer.queue('2026-07-28');
  assert.deepEqual(saved, [], 'nothing written yet');
  assert.deepEqual(writer.pending(), ['2026-07-28']);

  await timers.run();
  assert.deepEqual(saved, ['2026-07-28']);
  assert.deepEqual(writer.pending(), []);
});

test('two days queued inside one window both get written', async () => {
  const timers = fakeTimers();
  const { saved, save } = recorder();
  const writer = createDayWriter(save, timers);

  writer.queue('2026-07-28');
  writer.queue('2026-07-29');
  await timers.run();

  assert.deepEqual(saved.sort(), ['2026-07-28', '2026-07-29']);
});

test('the same day queued twice is written once', async () => {
  const timers = fakeTimers();
  const { saved, save } = recorder();
  const writer = createDayWriter(save, timers);

  writer.queue('2026-07-28');
  writer.queue('2026-07-28');
  await timers.run();

  assert.deepEqual(saved, ['2026-07-28']);
});

test('an immediate write clears that day from the queue', async () => {
  const timers = fakeTimers();
  const { saved, save } = recorder();
  const writer = createDayWriter(save, timers);

  writer.queue('2026-07-28');
  await writer.now('2026-07-28');

  assert.deepEqual(saved, ['2026-07-28']);
  assert.deepEqual(writer.pending(), [], 'no second write left owing');

  await timers.run();
  assert.deepEqual(saved, ['2026-07-28'], 'the timer finds nothing to do');
});

test('an immediate write on one day leaves another day still queued', async () => {
  const timers = fakeTimers();
  const { saved, save } = recorder();
  const writer = createDayWriter(save, timers);

  writer.queue('2026-07-28');
  await writer.now('2026-07-29');
  await timers.run();

  assert.deepEqual(saved, ['2026-07-29', '2026-07-28']);
});

test('flush writes everything owing at once', async () => {
  const timers = fakeTimers();
  const { saved, save } = recorder();
  const writer = createDayWriter(save, timers);

  writer.queue('2026-07-28');
  writer.queue('2026-07-29');
  await writer.flush();

  assert.deepEqual(saved.sort(), ['2026-07-28', '2026-07-29']);
  assert.equal(timers.count(), 0, 'flush cancels the pending timer');
});

test('flush with nothing owing writes nothing', async () => {
  const timers = fakeTimers();
  const { saved, save } = recorder();
  const writer = createDayWriter(save, timers);

  await writer.flush();
  assert.deepEqual(saved, []);
});

test('a failing save does not leave the day owing forever', async () => {
  const timers = fakeTimers();
  const attempts = [];
  const writer = createDayWriter(
    async (dayKey) => {
      attempts.push(dayKey);
      throw new Error('disk full');
    },
    timers,
  );

  writer.queue('2026-07-28');
  await assert.rejects(() => writer.flush(), /disk full/);
  assert.deepEqual(attempts, ['2026-07-28']);
  assert.deepEqual(writer.pending(), [], 'taken off the queue, not retried silently');
});

/**
 * A bare `for … await` abandoned everything behind the first rejection — and those
 * days had already been taken off the queue, so a transient failure on the first
 * silently lost the second with nothing said about it.
 */
test('one failing save does not abandon the days behind it', async () => {
  const timers = fakeTimers();
  const attempts = [];
  const writer = createDayWriter(async (dayKey) => {
    attempts.push(dayKey);
    if (dayKey === '2026-07-28') throw new Error('disk full');
  }, timers);

  writer.queue('2026-07-28');
  writer.queue('2026-07-29');

  await assert.rejects(() => writer.flush(), /disk full/, 'the first failure is what the caller sees');
  assert.deepEqual(attempts, ['2026-07-28', '2026-07-29'], 'both were attempted');
});

/**
 * The bug this module exists for. The old debounce closed over nothing: it fired
 * after 500ms and saved "the selected day", so an edit made on Tuesday and a step
 * to Wednesday inside that half second wrote Wednesday's entries under Wednesday's
 * key and lost the Tuesday edit entirely.
 */
test('a write queued for one day is not redirected by what happens next', async () => {
  const timers = fakeTimers();
  const written = [];
  const days = new Map([
    ['2026-07-28', ['tuesday work']],
    ['2026-07-29', ['wednesday work']],
  ]);
  let selected = '2026-07-28';

  const writer = createDayWriter(async (dayKey) => {
    written.push([dayKey, days.get(dayKey)]);
  }, timers);

  writer.queue(selected);
  selected = '2026-07-29'; // the user steps a day before the timer fires
  await timers.run();

  assert.deepEqual(written, [['2026-07-28', ['tuesday work']]]);
});
