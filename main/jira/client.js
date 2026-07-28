// The one and only place Joggl talks to Jira. Main process, Node's global fetch.
// One place to mock, one place to debug.

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

/**
 * POST /rest/api/3/issue/{issueIdOrKey}/worklog
 *
 * No `comment` is sent: in API v3 it must be an Atlassian Document Format
 * object, not a string, and Joggl has no use for worklog comments yet.
 *
 * @returns {Promise<{worklogId: string, timeSpentSeconds: number}>}
 */
export async function submitWorklog(creds, { issueIdOrKey, startTs, endTs }) {
  if (!issueIdOrKey) throw new JiraError('Cannot submit a worklog without an issue key.');
  const durationMs = endTs - startTs;
  if (!(durationMs > 0)) {
    throw new JiraError(`Entry has no positive duration (${durationMs} ms) — fix it before syncing.`);
  }

  const data = await request(
    creds,
    'POST',
    `${API}/issue/${encodeURIComponent(issueIdOrKey)}/worklog`,
    {
      body: {
        started: formatWorklogStarted(startTs),
        timeSpentSeconds: worklogSeconds(durationMs),
      },
      context: `worklog on ${issueIdOrKey}`,
    },
  );

  if (!data?.id) {
    throw new JiraError(
      `Jira accepted the worklog on ${issueIdOrKey} but returned no worklog id — ` +
        'check the issue in Jira before retrying, to avoid logging the time twice.',
    );
  }
  return { worklogId: String(data.id), timeSpentSeconds: data.timeSpentSeconds ?? null };
}
