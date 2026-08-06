// The selection, as arithmetic over a set of entry ids.
//
// Pure — no DOM, no state — so what a click, a Ctrl+click and a delete do to the
// selection can be tested without a browser. `selection.js` holds the set and paints
// the classes; this decides what the set becomes.

/** A plain click: this one, and nothing else. */
export function selectOnly(id) {
  return id === null || id === undefined ? new Set() : new Set([id]);
}

/** Ctrl+click: in if it was out, out if it was in. A new set, never a mutation. */
export function toggled(ids, id) {
  const next = new Set(ids);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * The selection with anything that no longer stands for an entry taken out.
 *
 * Applied on every read rather than at each site that deletes something. There are
 * six of those and counting — the single delete, the batch, Clear day, Clear week, a
 * merge, a sync that turns an entry into another — and one of them forgetting to
 * prune would leave Ctrl+C copying a ghost.
 */
export function pruned(ids, present) {
  return new Set([...ids].filter((id) => present.has(id)));
}
