// The IO wrapper around the pure crossDayMove — writing both day logs and telling
// the user if one of the writes fails.
//
// Pulled out of timeline-drag.js and drag-drop.js on purpose: a block dragged off
// the day view and an entry-list row dragged the same way are the same gesture
// reached two ways, and duplicating the commit in both files is exactly how they
// would end up disagreeing about what a failed write does.

import { canCrossDays, crossDayMove } from './cross-day.js';
import { renderAll } from './render.js';
import { entriesFor, persistDayNow, setEntriesFor } from './state.js';
import { toastErr } from './toast.js';
import { startOfDayMs } from './util.js';

/**
 * Move `entry` from `fromDay` to `toDay`, landing at `startTs` — already on the
 * target day and already snapped, exactly what the gesture decided.
 *
 * The target day is written first, then the source. If the second write throws,
 * the entry is left on **both** days on disk: visible, and correctable by hand.
 * Writing source-then-target would risk the opposite — gone from the day it left,
 * never saved to the one it joined, discoverable only by opening both days. A
 * duplicate is recoverable; a loss is not, and that asymmetry is this project's
 * standing bias.
 *
 * A failed write is reported and then let go, the same treatment `day-writes.js`
 * gives a failed background save — see `reportDayWriteFailure` in state.js for why
 * a save that throws must not stop anything else. This one differs only in that it
 * is a foreground gesture the user just made, not a debounced background one, so it
 * also earns a toast rather than only the log file.
 *
 * `renderAll()` always runs, whatever the outcome: memory was already updated
 * before either write was attempted, and the screen has to end up showing what
 * memory holds.
 */
export async function commitCrossDayMove(entry, fromDay, toDay, startTs) {
  // A backstop, not a live path today: `locked()` in timeline-drag.js and
  // `payloadFromEntryList` in drag-drop.js both refuse a Jira-side row before the
  // gesture even starts, so an external entry never reaches here.
  if (!canCrossDays(entry)) return;

  const { from, to } = crossDayMove({
    entry,
    fromEntries: entriesFor(fromDay),
    toEntries: entriesFor(toDay),
    toDayStartMs: startOfDayMs(toDay),
    startTs,
  });

  setEntriesFor(fromDay, from);
  setEntriesFor(toDay, to);

  try {
    await persistDayNow(toDay);
    await persistDayNow(fromDay);
  } catch (err) {
    toastErr(`Could not save the move to ${toDay} — ${err.message}`);
  }

  renderAll();
}
