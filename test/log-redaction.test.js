// The log file exists to be sent to someone else. A Jira API token leaking into
// it turns a debugging aid into a credential disclosure.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeLogger, getLogPath, info, initLogger, redact } from '../main/log.js';

test('strips a Basic auth header', () => {
  assert.equal(
    redact('Authorization: Basic dXNlckBjby5jb206QVRBVFQzeEZmR0Ywc2VjcmV0'),
    'Authorization: Basic [redacted]',
  );
});

test('strips a Bearer token', () => {
  assert.equal(redact('sent Bearer abc.def-ghi_123 upstream'), 'sent Bearer [redacted] upstream');
});

test('strips an Atlassian token wherever it appears', () => {
  const out = redact('failed with ATATT3xFfGF0abcDEF-123_xyz while posting');
  assert.ok(!out.includes('ATATT3xFfGF0'));
  assert.match(out, /\[redacted-atlassian-token\]/);
});

test('strips token fields out of serialised JSON', () => {
  const out = redact('{"email":"you@co.com","apiToken":"s3cr3t-value","baseUrl":"https://x"}');
  assert.ok(!out.includes('s3cr3t-value'));
  assert.ok(out.includes('you@co.com'), 'non-secret context is kept');
  assert.ok(out.includes('https://x'));
});

test('leaves ordinary messages alone', () => {
  const message = '401 from Jira — your email or API token is wrong or expired.';
  assert.equal(redact(message), message);
});

test('redaction is applied on the way to the file, not just on demand', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'joggl-log-'));
  try {
    await initLogger({ dir });
    info('POST failed', { apiToken: 'ATATT3xFfGF0-do-not-leak', baseUrl: 'https://x.atlassian.net' });
    await closeLogger();

    const written = await readFile(getLogPath(), 'utf8');
    assert.ok(!written.includes('ATATT3xFfGF0-do-not-leak'));
    assert.ok(written.includes('https://x.atlassian.net'));
    assert.match(written, /\[info\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
