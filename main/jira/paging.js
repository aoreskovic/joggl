// Reading every page of an old-style Jira endpoint.
//
// `search/jql` pages with `nextPageToken` and is handled in client.js. The worklog
// endpoint is the older kind — `startAt`, `maxResults`, `total` — and asking for one
// page of 200 and stopping, which is what the old day read did, silently truncates
// any issue with more worklogs than that. One shared issue on this site holds 660,
// so a thirty-day read of it would have lost two thirds of the day.
//
// Its own module, taking the page fetcher as an argument, because every interesting
// case needs hundreds of worklogs to reach and none of them can be tested through a
// real request.

/** Enough for 2000 worklogs on one issue. Past that, something is wrong upstream. */
export const DEFAULT_PAGE_LIMIT = 20;

/**
 * Every item across every page.
 *
 * Stops on whichever comes first: the reported `total` reached, a short or empty
 * page, or `pageLimit` pages. The short-page test is not belt and braces — not every
 * Jira response carries a usable `total`, and a loop trusting it alone spins forever
 * when it is absent.
 *
 * @param {(startAt: number) => Promise<{items: any[], total: number|null}|null>} fetchPage
 * @param {{pageLimit?: number}} [opts]
 * @returns {Promise<any[]>}
 */
export async function collectPaged(fetchPage, { pageLimit = DEFAULT_PAGE_LIMIT } = {}) {
  const all = [];

  for (let page = 0; page < pageLimit; page++) {
    const data = await fetchPage(all.length);
    const items = data?.items ?? [];
    if (items.length === 0) break;

    all.push(...items);

    const total = data?.total;
    if (typeof total === 'number' && Number.isFinite(total) && all.length >= total) break;
  }

  return all;
}
