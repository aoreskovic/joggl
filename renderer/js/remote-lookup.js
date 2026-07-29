// Debounced "also ask Jira" for the search boxes.
//
// Dependencies are injected so this can be tested without a preload bridge. It
// exists as its own module because getting it wrong took the whole renderer
// down: the previous version reported "no results" *synchronously* when no
// lookup was warranted, and every caller re-rendered from that callback — so a
// render triggered a lookup which called back into the render, until the stack
// gave out.

import { shouldLookupRemote } from './util.js';

/**
 * @param {object} deps
 * @param {(query: string) => Promise<object[]>} deps.lookup
 * @param {(query: string, issues: object[]) => void} deps.onResults
 * @param {() => boolean} [deps.isEnabled] false when Jira is not configured
 * @param {(query: string) => Set<string>} [deps.knownKeys] issue keys already shown locally
 * @param {(message: string) => void} [deps.onError]
 * @param {number} [deps.delayMs]
 * @returns {(query: string, localCount: number) => void}
 */
export function createRemoteLookup({
  lookup,
  onResults,
  isEnabled = () => true,
  knownKeys = () => new Set(),
  onError = () => {},
  delayMs = 300,
}) {
  let timer = null;
  let latest = '';

  return (rawQuery, localCount) => {
    const query = String(rawQuery ?? '').trim();
    latest = query;
    clearTimeout(timer);

    // Nothing to ask for. Deliberately silent rather than reporting an empty
    // result: callers already ignore results whose query is not the one on
    // screen, so there is nothing to tell them — and a synchronous callback here
    // is exactly the re-entrancy that used to blow the stack.
    if (!shouldLookupRemote(query, localCount) || !isEnabled()) return;

    timer = setTimeout(async () => {
      try {
        const issues = await lookup(query);
        // An answer for a query the user has already moved past would repopulate
        // the list under them.
        if (query !== latest) return;
        const known = knownKeys(query);
        onResults(
          query,
          issues.filter((issue) => !known.has(issue.issueKey)),
        );
      } catch (err) {
        if (query !== latest) return;
        onError(err?.message ?? String(err));
      }
    }, delayMs);
  };
}
