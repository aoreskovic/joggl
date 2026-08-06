// Which block an arrow key lands on.
//
// Pure — no DOM — so the rule can be tested without a grid. The caller reads the
// blocks off the page and turns the answer back into an element.
//
// The blocks arrive in DOM order, which is column by column and, within a column,
// whatever order `visibleEntriesFor` returned — local entries then Jira-side rows.
// Neither is what the eye sees, so both the column grouping and the time order are
// worked out here rather than assumed.

/**
 * @param {{id: string, day: string, offsetMs: number}[]} blocks every block drawn.
 *        `offsetMs` is measured from its own day's midnight, so two columns on
 *        opposite sides of a clock change still line up by what they say on the clock.
 * @param {string} fromId the block the keyboard is on
 * @param {string} key the KeyboardEvent key
 * @returns {string|null} the id to move to, or null when the key means nothing here
 */
export function nextBlockId(blocks, fromId, key) {
  const all = blocks ?? [];
  const from = all.find((b) => b.id === fromId);
  if (!from) return null;

  const inDay = (day) => all.filter((b) => b.day === day).sort((a, b) => a.offsetMs - b.offsetMs);

  if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
    const column = inDay(from.day);
    if (key === 'Home') return column[0].id;
    if (key === 'End') return column[column.length - 1].id;
    const at = column.findIndex((b) => b.id === fromId);
    // Clamped rather than wrapped, because that is what wireRovingList has always
    // done for these two grids and a key must not mean two things.
    const to = Math.min(Math.max(at + (key === 'ArrowDown' ? 1 : -1), 0), column.length - 1);
    return column[to].id;
  }

  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;

  const days = [...new Set(all.map((b) => b.day))].sort();
  const step = key === 'ArrowRight' ? 1 : -1;

  for (let i = days.indexOf(from.day) + step; i >= 0 && i < days.length; i += step) {
    const column = inDay(days[i]);
    // An empty column is stepped over rather than swallowing the keypress: with the
    // weekend hidden and a quiet Tuesday, otherwise the arrow would appear dead.
    if (column.length === 0) continue;
    // The nearest block on the clock — what the eye would call "across from here".
    return column.reduce((best, b) =>
      Math.abs(b.offsetMs - from.offsetMs) < Math.abs(best.offsetMs - from.offsetMs) ? b : best,
    ).id;
  }

  // Nothing that way: stay put. Wrapping Friday round to Monday would read as the
  // week having stepped, which it has not.
  return null;
}
