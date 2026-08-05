// Worklog timestamp serialisation.
//
// Jira requires `started` as yyyy-MM-dd'T'HH:mm:ss.SSSZ with a NUMERIC offset
// and NO colon in it:
//
//   2026-07-28T09:00:00.000+0200   accepted
//   2026-07-28T07:00:00.000Z       rejected
//   2026-07-28T09:00:00+02:00      rejected
//
// Date.prototype.toISOString() produces the rejected form, so this lives in its
// own module with its own tests. A wrong value here is the most likely cause of
// a silent Finish Day failure.

const pad = (n, width = 2) => String(n).padStart(width, '0');

/**
 * @param {number} ts epoch ms
 * @param {Date} [d] injectable for tests; defaults to local time for `ts`
 * @returns {string} e.g. "2026-07-28T09:00:00.000+0200"
 */
export function formatWorklogStarted(ts, d = new Date(ts)) {
  if (!Number.isFinite(ts)) throw new TypeError(`formatWorklogStarted: not a timestamp: ${ts}`);

  // getTimezoneOffset() is minutes *behind* UTC, so CEST (UTC+2) reports -120.
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);

  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
  );
}

/**
 * Jira rejects worklogs shorter than a minute, so anything under 60s is
 * rounded up rather than silently dropped.
 * @param {number} ms
 * @returns {number} whole seconds, minimum 60
 */
export function worklogSeconds(ms) {
  return Math.max(60, Math.round(ms / 1000));
}

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
