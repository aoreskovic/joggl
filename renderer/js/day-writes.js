// Debounced writes to the day logs, one queue entry per day.
//
// Pure — no DOM, no IPC — so the bookkeeping can be tested without a browser. The
// save itself is injected; state.js supplies the one that goes over IPC.
//
// The debounce used to close over nothing at all: it fired after 500ms and saved
// "the selected day". Type into a time field and step to the next day inside that
// half second and the edit was written under the *new* day's key, against the new
// day's entries — the edit lost, and a day that had not been touched rewritten with
// what it already held. A queue of day keys cannot make that mistake: what is owed
// is decided when the edit happens, not when the timer fires.

/**
 * @param {(dayKey: string) => Promise<void>} save
 * @param {{wait?: number, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout}} [opts]
 */
export function createDayWriter(
  save,
  { wait = 500, setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  const owing = new Set();
  let handle = null;

  async function flush() {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
    const days = [...owing];
    // Cleared before the writes rather than after: a save that throws must not leave
    // the day owing, or the next flush retries it silently and the caller that was
    // told about the failure has no say in it.
    owing.clear();
    for (const dayKey of days) await save(dayKey);
  }

  return {
    /** Note that this day needs writing soon. */
    queue(dayKey) {
      owing.add(dayKey);
      if (handle !== null) clearTimer(handle);
      // The promise is returned rather than dropped. `setTimeout` ignores it, but a
      // test's fake clock can await it, which is the difference between asserting
      // what was written and asserting what had been written by the first microtask.
      handle = setTimer(() => {
        handle = null;
        return flush().catch((err) => console.error('Failed to save day log:', err));
      }, wait);
    },

    /** Write this day now, and stop owing it. */
    async now(dayKey) {
      owing.delete(dayKey);
      await save(dayKey);
    },

    /** Write everything owing, now. Rejects if a save does. */
    flush,

    /** Which days are owed a write. For tests, and for anything that must not race one. */
    pending() {
      return [...owing];
    },
  };
}
