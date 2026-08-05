// A Jira that is always up, always the same, and never on the network.
//
// Used only by `npm run uicheck:fast`. `main/ipc.js` picks this module instead of
// `client.js`, which is the seam CLAUDE.md promised when it said every network call
// lives in one place — "one place to mock".
//
// **The exports match client.js name for name, and return what client.js returns
// *after* parsing.** That is the whole discipline. Nothing here reimplements
// `search/jql` paging, the ADF round trip or the Lucene escaping, because putting a
// second copy of those behind the same names is how a fake starts lying: the checks
// would go green against a parser that no longer matches the real one. Those live in
// `main/jira/*.js` and are covered by `npm test`, which is where they belong.
//
// The live run stays the default and stays the one that must pass before a commit.
// This one exists so the suite can be run after every edit rather than twice a day.

import { localDayKey } from './time.js';

/** Deterministic issues, spread over two projects so key filtering has something to bite on. */
const ISSUES = [
  issue('GEN-1', '10001', 'Meeting - Protostar', 'In Progress', 'GEN'),
  issue('GEN-147', '10002', 'Joggl - internal tool', 'In Progress', 'GEN'),
  issue('GEN-149', '10003', 'Internal tool exploration', 'To Do', 'GEN'),
  issue('EHW-70', '10004', 'Axiom Water Bottle Mechanical Design', 'In Progress', 'EHW'),
  issue('EHW-72', '10005', 'Main PCB review', 'To Do', 'EHW'),
  issue('EHW-26', '10006', 'Altium Hardware procedure review', 'To Do', 'EHW'),
  issue('SG-24', '10007', 'Create hardware requirements', 'In Progress', 'SG'),
  issue('SG-55', '10008', 'Investigate Space Power Conference', 'To Do', 'SG'),
  issue('SG-56', '10009', 'Bremen Demo - HW', 'To Do', 'SG'),
  issue('SG-57', '10010', 'DPU new split concept research', 'To Do', 'SG'),
];

/**
 * Findable, but in no task source — which is the whole reason the search box asks
 * Jira directly once the local matches thin out. Without a couple of these, the
 * "Elsewhere in Jira" separator can never appear and the check that asserts it
 * would be measuring nothing.
 */
const ELSEWHERE = [
  issue('ARC-9', '10101', 'Meeting notes archive', 'Done', 'ARC'),
  issue('ARC-12', '10102', 'Old meeting room booking', 'Done', 'ARC'),
];

function issue(issueKey, issueId, title, status, projectKey) {
  return { issueKey, issueId, title, status, issueType: 'Task', projectKey };
}

export class JiraError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JiraError';
  }
}

export function normaliseBaseUrl(raw) {
  return String(raw ?? '').trim().replace(/\/+$/, '');
}

export async function testConnection() {
  return { accountId: 'fake-account', displayName: 'Fake User', emailAddress: 'fake@example.com' };
}

export async function searchIssues(_creds, jql) {
  if (!String(jql ?? '').trim()) {
    throw new JiraError('Empty JQL query — check the task sources in Settings.');
  }
  // Enough shape to tell the configured sources apart: the second default source is
  // worklog authorship, and a task list where both sources return the same rows
  // would hide a bug in how they are merged.
  if (/worklogAuthor/i.test(jql)) return ISSUES.slice(0, 4);
  return ISSUES;
}

export async function lookupIssues(_creds, query) {
  const term = String(query ?? '').trim().toLowerCase();
  if (!term) return [];
  const all = [...ISSUES, ...ELSEWHERE];
  // An exact key first, the way the real one puts its definitive GET at the front.
  const exact = all.filter((i) => i.issueKey.toLowerCase() === term);
  const byTitle = all.filter((i) => i.title.toLowerCase().includes(term) && !exact.includes(i));
  return [...exact, ...byTitle].slice(0, 8);
}

/**
 * Two worklogs, at 09:30 and 13:00, and **only on today**.
 *
 * Both halves are deliberate. Rows on today mean the checks that need a Jira-side
 * row always run, where against a live site whether they run at all depends on what
 * happened to be booked that week. No rows on any other day means `findEmptyDay`
 * succeeds on the first step back, where against a live site it can walk for a
 * fortnight — and the empty-state checks skip rather than run if it fails.
 *
 * The range read answers from the same two, filtered, so a range covering today and
 * a day read of today return the same rows. A fake where they differed would make
 * the fast run and the live run disagree, which is the one thing it must not do.
 */
export async function fetchRangeWorklogs(_creds, { rangeStartTs, rangeEndTs } = {}) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const dayStartTs = midnight.getTime();
  if (dayStartTs < rangeStartTs || dayStartTs >= rangeEndTs) return [];

  const at = (h, m) => dayStartTs + (h * 60 + m) * 60_000;
  const dayKey = localDayKey(dayStartTs);
  return [
    {
      worklogId: 'fake-1',
      issueKey: 'GEN-1',
      issueId: '10001',
      title: 'Meeting - Protostar',
      startTs: at(9, 30),
      endTs: at(10, 0),
      comment: 'Daily',
      dayKey,
    },
    {
      worklogId: 'fake-2',
      issueKey: 'EHW-70',
      issueId: '10004',
      title: 'Axiom Water Bottle Mechanical Design',
      startTs: at(13, 0),
      endTs: at(14, 0),
      comment: null,
      dayKey,
    },
  ];
}

// No script presses Sync — that rule is unchanged and is not enforced here. These
// exist so the channel is registered and a stray call fails loudly rather than
// silently reporting success.
const refuse = (what) => () => {
  throw new JiraError(`${what} is not available under --uicheck-fast.`);
};

export const submitWorklog = refuse('Creating a worklog');
export const updateWorklog = refuse('Rewriting a worklog');
export const deleteWorklog = refuse('Deleting a worklog');
