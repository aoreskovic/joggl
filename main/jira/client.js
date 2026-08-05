// The one and only place Joggl talks to Jira. Main process, Node's global fetch.
// One place to mock, one place to debug.

import { adfToText, emptyAdfComment, toAdfComment } from './adf.js';
import { formatWorklogStarted, worklogSeconds } from './time.js';

const API = '/rest/api/3';

export class JiraError extends Error {
  constructor(message, { status = null, cause = null } = {}) {
    super(message);
    this.name = 'JiraError';
    this.status = status;
    if (cause) this.cause = cause;
  }
}

function authHeader(email, token) {
  return 'Basic ' + Buffer.from(`${email}:${token}`, 'utf8').toString('base64');
}

export function normaliseBaseUrl(raw) {
  const trimmed = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) throw new JiraError('No Jira base URL configured — add it in Settings.');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new JiraError(
      `Jira base URL must start with https:// — got "${trimmed}". Example: https://yourcompany.atlassian.net`,
    );
  }
  return trimmed;
}

// Jira's error bodies vary wildly; dig out something a colleague can act on.
function extractJiraMessage(body) {
  if (!body) return '';
  try {
    const json = JSON.parse(body);
    const parts = [
      ...(Array.isArray(json.errorMessages) ? json.errorMessages : []),
      ...(json.errors && typeof json.errors === 'object' ? Object.values(json.errors) : []),
      json.message,
    ].filter((p) => typeof p === 'string' && p.trim());
    if (parts.length) return parts.join(' ');
  } catch {
    /* not JSON — fall through to the raw text */
  }
  return String(body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function describeFailure(status, body, context) {
  const detail = extractJiraMessage(body);
  const suffix = detail ? ` — ${detail}` : '';
  switch (status) {
    case 400:
      return new JiraError(`Jira rejected the ${context} request (400)${suffix}`, { status });
    case 401:
      return new JiraError(
        '401 from Jira — your email or API token is wrong or expired. Check them in Settings.',
        { status },
      );
    case 403:
      return new JiraError(
        `403 from Jira — the account is authenticated but not allowed to ${context}${suffix}`,
        { status },
      );
    case 404:
      return new JiraError(`404 from Jira — ${context} target not found${suffix}`, { status });
    case 410:
      return new JiraError(
        `410 from Jira — this endpoint has been removed by Atlassian. Joggl needs updating.`,
        { status },
      );
    case 429:
      return new JiraError('429 from Jira — rate limited. Wait a moment and retry.', { status });
    default:
      return new JiraError(`Jira returned HTTP ${status} for ${context}${suffix}`, { status });
  }
}

async function request(creds, method, urlPath, { body = null, context } = {}) {
  const baseUrl = normaliseBaseUrl(creds.baseUrl);
  if (!creds.email) throw new JiraError('No Jira account email configured — add it in Settings.');
  if (!creds.token) throw new JiraError('No Jira API token stored — add one in Settings.');

  const headers = {
    Authorization: authHeader(creds.email, creds.token),
    Accept: 'application/json',
  };
  if (body !== null) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(baseUrl + urlPath, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    throw new JiraError(
      `Could not reach ${baseUrl} — check the base URL and your network connection.`,
      { cause },
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw describeFailure(res.status, text, context);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

/** GET /rest/api/3/myself — the connection test. */
export async function testConnection(creds) {
  const me = await request(creds, 'GET', `${API}/myself`, { context: 'connection test' });
  return {
    accountId: me?.accountId ?? null,
    displayName: me?.displayName ?? me?.emailAddress ?? 'unknown user',
    emailAddress: me?.emailAddress ?? null,
  };
}

/**
 * POST /rest/api/3/search/jql
 *
 * Three things the old /search endpoint did differently and which will silently
 * break this one if forgotten:
 *   - /rest/api/3/search is gone (410), this is its replacement
 *   - `fields` defaults to id only here, so it is always sent explicitly
 *   - paging is nextPageToken, not startAt; there is no reliable total
 */
export async function searchIssues(creds, jql, { maxResults = 100, pageLimit = 10 } = {}) {
  const query = String(jql ?? '').trim();
  if (!query) throw new JiraError('Empty JQL query — check the task sources in Settings.');

  const issues = [];
  let nextPageToken;

  for (let page = 0; page < pageLimit; page++) {
    const body = {
      jql: query,
      fields: ['summary', 'status', 'issuetype', 'project'],
      maxResults,
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const data = await request(creds, 'POST', `${API}/search/jql`, {
      body,
      context: 'issue search',
    });

    for (const issue of data?.issues ?? []) {
      issues.push({
        issueKey: issue.key,
        issueId: issue.id ?? null,
        title: issue.fields?.summary ?? issue.key,
        status: issue.fields?.status?.name ?? null,
        issueType: issue.fields?.issuetype?.name ?? null,
        projectKey: issue.fields?.project?.key ?? null,
      });
    }

    nextPageToken = data?.nextPageToken;
    if (!nextPageToken) break;
  }

  return issues;
}

const EXACT_KEY = /\b([A-Za-z][A-Za-z0-9_]*-\d+)\b/;

function toIssue(raw) {
  return {
    issueKey: raw.key,
    issueId: raw.id ? String(raw.id) : null,
    title: raw.fields?.summary ?? raw.summaryText ?? raw.key,
    status: raw.fields?.status?.name ?? null,
    issueType: raw.fields?.issuetype?.name ?? null,
    projectKey: raw.fields?.project?.key ?? null,
  };
}

/** GET /rest/api/3/issue/{key} — resolves any issue whatever its status. */
async function findIssueByKey(creds, key) {
  try {
    const data = await request(
      creds,
      'GET',
      `${API}/issue/${encodeURIComponent(key)}?fields=summary,status,issuetype,project`,
      { context: `issue ${key}` },
    );
    return data ? toIssue(data) : null;
  } catch (err) {
    // An unknown key is a normal outcome while someone is still typing.
    if (err.status === 404 || err.status === 403) return null;
    throw err;
  }
}

const ONLY_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

// Project keys change about as often as the Jira site does, so one fetch per
// session is plenty. Keyed by base URL so switching sites cannot use stale keys.
let projectCache = { baseUrl: null, keys: [] };

/**
 * Every project key the account can see.
 *
 * Only used to make queries like "meeting gen" work, so a failure here costs the
 * project-scoping and nothing else — the title search still runs.
 */
async function projectKeys(creds) {
  const baseUrl = normaliseBaseUrl(creds.baseUrl);
  if (projectCache.baseUrl === baseUrl) return projectCache.keys;

  const keys = [];
  try {
    for (let startAt = 0; ; ) {
      const data = await request(
        creds,
        'GET',
        `${API}/project/search?maxResults=50&startAt=${startAt}&orderBy=key`,
        { context: 'project list' },
      );
      const page = data?.values ?? [];
      for (const project of page) if (project.key) keys.push(project.key);
      if (data?.isLast !== false || page.length === 0) break;
      startAt += page.length;
    }
  } catch {
    return projectCache.baseUrl === baseUrl ? projectCache.keys : [];
  }

  projectCache = { baseUrl, keys };
  return keys;
}

/**
 * Turn what someone typed into the right-hand side of a JQL `~` match.
 *
 * `~` takes a Lucene query, so every operator character has to go or the whole
 * search fails on a stray bracket. The last word gets a `*` so the results are
 * useful while still being typed — "meet" finds "Meetings".
 */
export function toSummaryTerm(raw) {
  const words = sanitiseWords(raw);
  if (words.length === 0) return null;

  words[words.length - 1] += '*';
  return words.join(' ');
}

function sanitiseWords(raw) {
  return String(raw ?? '')
    .replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Turn a typed query into the JQL that finds it.
 *
 * A word that *is* a project key is treated as a filter rather than as title
 * text, so "meeting gen" and "gen meeting" both mean "issues in GEN whose title
 * mentions meeting" — which is what someone typing a keyword next to part of a
 * key means, and which a plain title search cannot express because the key does
 * not appear in the title at all.
 *
 * Only applied from two words up. Plenty of project keys here are short, common
 * English words — IN, ON, IP, EC, AL — and a single-word query has to keep
 * meaning "search the titles for this".
 *
 * @param {string} query
 * @param {string[]} keys every project key the account can see
 * @returns {string|null} JQL, or null when there is nothing to search for
 */
export function buildLookupJql(query, keys = []) {
  const words = sanitiseWords(query);
  if (words.length === 0) return null;

  const byLower = new Map(keys.map((k) => [k.toLowerCase(), k]));
  let projects = [];
  let text = words;

  if (words.length >= 2) {
    projects = [];
    text = [];
    for (const word of words) {
      const key = byLower.get(word.toLowerCase());
      if (key) projects.push(key);
      else text.push(word);
    }
    // Every word named a project — read that as "show me these projects".
    if (text.length === 0) projects = [...new Set(projects)];
  }

  const clauses = [];
  if (projects.length > 0) {
    clauses.push(`project IN (${[...new Set(projects)].map((k) => `"${k}"`).join(', ')})`);
  }
  if (text.length > 0) {
    const term = [...text];
    term[term.length - 1] += '*';
    clauses.push(`summary ~ "${term.join(' ')}"`);
  }
  if (clauses.length === 0) return null;

  return `${clauses.join(' AND ')} ORDER BY updated DESC`;
}

/**
 * Free-text lookup across the whole instance, not just the configured task
 * sources — for finding an issue that is Done, or assigned to somebody else.
 *
 * Two calls, because neither is sufficient alone:
 *
 *   - `summary ~ "…"` is the actual search. It matches titles, ignores status,
 *     and prefix-matches the last word.
 *   - a direct `GET /issue/{key}` is definitive for a key and nothing else.
 *
 * `/issue/picker`, Jira's own autocomplete, is deliberately **not** used. On the
 * test site it returns only a browsing-history section, which an API-token
 * request has none of: "meeting" finds nothing at all, and "Meeting - Protostar"
 * returns nineteen unrelated issues.
 */
export async function lookupIssues(creds, query, { limit = 8 } = {}) {
  const trimmed = String(query ?? '').trim();
  if (trimmed.length < 2) return [];

  const found = new Map();
  const key = trimmed.match(EXACT_KEY)?.[1];

  if (key) {
    const exact = await findIssueByKey(creds, key.toUpperCase());
    if (exact) found.set(exact.issueKey, exact);
  }

  // A query that is nothing but a key is already answered. Searching titles for
  // its digits would only add noise.
  if (ONLY_KEY.test(trimmed)) return [...found.values()];

  const jql = buildLookupJql(trimmed, await projectKeys(creds));
  if (!jql) return [...found.values()];

  try {
    const issues = await searchIssues(creds, jql, { maxResults: limit, pageLimit: 1 });
    for (const issue of issues) {
      if (found.size >= limit) break;
      if (!found.has(issue.issueKey)) found.set(issue.issueKey, issue);
    }
  } catch (err) {
    // An exact key hit is still worth returning even if the text search fails.
    if (found.size === 0) throw err;
  }

  return [...found.values()].slice(0, limit);
}

/**
 * POST /rest/api/3/issue/{issueIdOrKey}/worklog
 *
 * No `comment` is sent: in API v3 it must be an Atlassian Document Format
 * object, not a string, and Joggl has no use for worklog comments yet.
 *
 * @returns {Promise<{worklogId: string, timeSpentSeconds: number}>}
 */
export async function submitWorklog(creds, { issueIdOrKey, startTs, endTs, comment }) {
  if (!issueIdOrKey) throw new JiraError('Cannot submit a worklog without an issue key.');
  const durationMs = endTs - startTs;
  if (!(durationMs > 0)) {
    throw new JiraError(`Entry has no positive duration (${durationMs} ms) — fix it before syncing.`);
  }

  const body = {
    started: formatWorklogStarted(startTs),
    timeSpentSeconds: worklogSeconds(durationMs),
  };
  // Jira's Work Description. Omitted entirely when there is none: a worklog created
  // with an empty paragraph reads as a blank description rather than no description.
  const adf = toAdfComment(comment);
  if (adf) body.comment = adf;

  const data = await request(
    creds,
    'POST',
    `${API}/issue/${encodeURIComponent(issueIdOrKey)}/worklog`,
    { body, context: `worklog on ${issueIdOrKey}` },
  );

  if (!data?.id) {
    throw new JiraError(
      `Jira accepted the worklog on ${issueIdOrKey} but returned no worklog id — ` +
        'check the issue in Jira before retrying, to avoid logging the time twice.',
    );
  }
  return { worklogId: String(data.id), timeSpentSeconds: data.timeSpentSeconds ?? null };
}

/**
 * PUT /rest/api/3/issue/{issueIdOrKey}/worklog/{id}
 *
 * Editing an entry Joggl already synced rewrites its worklog in place. Posting a
 * second one and hoping nobody notices is how a day ends up double-booked.
 */
export async function updateWorklog(creds, { issueIdOrKey, worklogId, startTs, endTs, comment }) {
  if (!worklogId) throw new JiraError('Cannot update a worklog without its id.');
  const durationMs = endTs - startTs;
  if (!(durationMs > 0)) {
    throw new JiraError(`Entry has no positive duration (${durationMs} ms) — fix it before syncing.`);
  }

  const data = await request(
    creds,
    'PUT',
    `${API}/issue/${encodeURIComponent(issueIdOrKey)}/worklog/${encodeURIComponent(worklogId)}`,
    {
      body: {
        started: formatWorklogStarted(startTs),
        timeSpentSeconds: worklogSeconds(durationMs),
        // Always sent, unlike on create: the entry is the record of what Jira
        // should hold, and omitting the field would leave a description the user
        // has just deleted sitting in Jira with nothing on screen to show for it.
        comment: toAdfComment(comment) ?? emptyAdfComment(),
      },
      context: `worklog ${worklogId} on ${issueIdOrKey}`,
    },
  );

  return { worklogId: String(data?.id ?? worklogId), timeSpentSeconds: data?.timeSpentSeconds ?? null };
}

/** DELETE /rest/api/3/issue/{issueIdOrKey}/worklog/{id} */
export async function deleteWorklog(creds, { issueIdOrKey, worklogId }) {
  if (!worklogId) throw new JiraError('Cannot delete a worklog without its id.');
  await request(
    creds,
    'DELETE',
    `${API}/issue/${encodeURIComponent(issueIdOrKey)}/worklog/${encodeURIComponent(worklogId)}`,
    { context: `worklog ${worklogId} on ${issueIdOrKey}` },
  );
  return { worklogId: String(worklogId) };
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The JQL that finds every issue this account logged time against between two days.
 *
 * One query for the whole range rather than one per day: reading a month used to
 * cost thirty of these plus their per-issue follow-ups, which is what made *Copy
 * previous day* crawl.
 *
 * The dates come from Joggl, never from a user, so a malformed one is a bug and is
 * thrown rather than escaped. Failing loudly matters more than it looks: a bad date
 * here does not error at Jira, it returns a plausible empty result, and an empty
 * result reads as "no time logged" rather than as "the query was wrong".
 */
export function buildWorklogRangeJql(from, to) {
  if (!DAY_KEY.test(String(from)) || !DAY_KEY.test(String(to))) {
    throw new JiraError(`Worklog range needs YYYY-MM-DD dates — got "${from}" to "${to}".`);
  }
  if (to < from) {
    throw new JiraError(`Worklog range runs backwards: "${from}" to "${to}".`);
  }
  return (
    `worklogAuthor = currentUser() AND worklogDate >= "${from}" AND worklogDate <= "${to}"`
  );
}

/**
 * Every worklog the current user has on a given local day, wherever it was
 * entered — including straight into the Jira web UI, which Joggl knows nothing
 * about but which still counts towards the day.
 *
 * Two steps, because Jira has no "my worklogs on date X" endpoint:
 *   1. JQL narrows the whole instance down to the issues carrying such a worklog;
 *   2. each of those issues is asked for its worklogs, bounded server-side by
 *      startedAfter/startedBefore — a shared issue can hold hundreds of other
 *      people's entries and pulling them all back to find one is wasteful.
 *
 * @param {{date: string, dayStartTs: number, dayEndTs: number}} range
 * @returns {Promise<object[]>} one entry per worklog, already filtered to this account
 */
export async function fetchDayWorklogs(creds, { date, dayStartTs, dayEndTs }) {
  const me = await testConnection(creds);
  if (!me.accountId) {
    throw new JiraError('Jira did not return an account id, so worklogs cannot be matched to you.');
  }

  const issues = await searchIssues(
    creds,
    `worklogAuthor = currentUser() AND worklogDate = "${date}"`,
    { maxResults: 100 },
  );

  const found = [];
  for (const issue of issues) {
    const query = new URLSearchParams({
      startedAfter: String(dayStartTs),
      startedBefore: String(dayEndTs),
      maxResults: '200',
    });
    const data = await request(
      creds,
      'GET',
      `${API}/issue/${encodeURIComponent(issue.issueKey)}/worklog?${query}`,
      { context: `worklogs on ${issue.issueKey}` },
    );

    for (const worklog of data?.worklogs ?? []) {
      if (worklog.author?.accountId !== me.accountId) continue;
      const startTs = Date.parse(worklog.started);
      if (!Number.isFinite(startTs) || startTs < dayStartTs || startTs >= dayEndTs) continue;

      found.push({
        worklogId: String(worklog.id),
        issueKey: issue.issueKey,
        issueId: issue.issueId,
        title: issue.title,
        startTs,
        endTs: startTs + (worklog.timeSpentSeconds ?? 0) * 1000,
        // Flattened, so a description written in the Jira UI is visible here too.
        comment: adfToText(worklog.comment),
      });
    }
  }

  return found.sort((a, b) => a.startTs - b.startTs);
}
