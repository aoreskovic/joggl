// Which days a week holds, what that week is called, and which of its columns are
// drawn.
//
// Pure — no DOM, no IPC — so the numbering can be tested without a browser. The
// numbering is ISO 8601 rather than a rule of our own, because every colleague's
// calendar and every Jira report says ISO, and agreeing with them is worth more
// than any scheme that would be easier to write.

import { addDays, startOfDay, startOfDayMs } from './util.js';

/** The Monday of the week `key` falls in. Weeks start on Monday, everywhere. */
export function weekStart(key) {
  // getDay() counts from Sunday; shift so Monday is 0, the same shift monthGrid makes.
  const shift = (startOfDay(key).getDay() + 6) % 7;
  return addDays(key, -shift);
}

/** The Sunday of the week `key` falls in. */
export function weekEnd(key) {
  return addDays(weekStart(key), 6);
}

/** The seven day keys of that week, Monday first. */
export function weekDays(key) {
  const monday = weekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** n weeks away. Through addDays, so a clock change cannot shift the date. */
export function addWeeks(key, n) {
  return addDays(key, n * 7);
}

/**
 * ISO 8601 week number, and the week-year it belongs to.
 *
 * Week 1 is the week holding the first Thursday of January — equivalently, the week
 * holding 4 January. So the week-year is not always the calendar year of the day
 * asked about: 29 Dec 2025 is in week 1 of 2026, and 1 Jan 2027 is in week 53 of
 * 2026. All seven days of a week share one week-year, which is why this is answered
 * from the week's Thursday rather than from the day itself.
 */
export function isoWeek(key) {
  const thursday = startOfDay(addDays(weekStart(key), 3));
  const weekYear = thursday.getFullYear();
  // 4 January is always in week 1, by definition, so the Monday of its week is the
  // first Monday of the week-year.
  const firstMonday = startOfDayMs(weekStart(`${weekYear}-01-04`));
  // Rounded, not floored: a clock change makes one of these weeks 25 hours long, and
  // an hour either way must not cost a week.
  const week = Math.round((thursday.getTime() - firstMonday) / (7 * 86_400_000)) + 1;
  return { week, weekYear };
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * How a week is named above its columns: `27 Jul – 2 Aug · week 31`.
 *
 * The year appears only when the ISO week-year differs from the calendar year of the
 * Monday — `week 1 of 2026` for a week beginning 29 December 2025. Saying the year on
 * the other fifty-one weeks would be noise, and not saying it on this one reads as a
 * mistake.
 */
export function weekLabel(key) {
  const from = startOfDay(weekStart(key));
  const to = startOfDay(weekEnd(key));
  const { week, weekYear } = isoWeek(key);
  const span =
    `${from.getDate()} ${MONTHS_SHORT[from.getMonth()]} – ` +
    `${to.getDate()} ${MONTHS_SHORT[to.getMonth()]}`;
  const name = weekYear === from.getFullYear() ? `week ${week}` : `week ${week} of ${weekYear}`;
  return `${span} · ${name}`;
}

/**
 * Which columns the week draws.
 *
 * Monday to Friday by default, all seven when the toggle says so — and a weekend day
 * holding any time at all is drawn either way. Time that cannot be seen is time that
 * does not get synced, and hiding it is the one thing this view must never do. So
 * five-day mode means "hide Saturday and Sunday when they are empty", and a week with
 * Saturday worked renders six columns.
 *
 * `hasTime` is asked rather than assumed so the caller decides what counts — in the
 * app it is `visibleEntriesFor`, which is local entries plus the Jira-side rows.
 */
export function visibleWeekDays(key, { sevenDay = false, hasTime = () => false } = {}) {
  return weekDays(key).filter((day, index) => sevenDay || index < 5 || hasTime(day));
}
