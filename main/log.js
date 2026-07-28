// File logging, so a problem on someone else's machine can be diagnosed from a
// file they can send rather than from a screenshot of a stack trace.
//
// In development the log sits next to the project (git-ignored) so it is easy to
// tail; in a packaged build it goes to userData, which is writable and per-user.
// Nothing here ever reaches the renderer.

import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;

let stream = null;
let logPath = null;

export function getLogPath() {
  return logPath;
}

/**
 * @param {{dir: string}} options directory the log file lives in
 */
export async function initLogger({ dir }) {
  await mkdir(dir, { recursive: true });
  logPath = path.join(dir, 'joggl.log');

  // One rotation is enough: the previous run's log is the one worth keeping.
  try {
    const { size } = await stat(logPath);
    if (size > MAX_BYTES) {
      await unlink(`${logPath}.1`).catch(() => {});
      await rename(logPath, `${logPath}.1`);
    }
  } catch {
    /* no log yet */
  }

  stream = createWriteStream(logPath, { flags: 'a' });
  stream.on('error', (err) => {
    stream = null;
    console.error('Logging to file failed, continuing without it:', err.message);
  });

  return logPath;
}

// Credentials must never reach the log, however they got into an error message.
const REDACTIONS = [
  [/\bBasic\s+[A-Za-z0-9+/=]+/gi, 'Basic [redacted]'],
  [/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]'],
  [/("?(?:api[_-]?token|token|password|apiToken)"?\s*[:=]\s*")([^"]+)(")/gi, '$1[redacted]$3'],
  [/\bATATT[A-Za-z0-9._-]+/g, '[redacted-atlassian-token]'],
];

export function redact(text) {
  let out = String(text);
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

function format(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function log(level, ...parts) {
  const line = `${new Date().toISOString()} [${level}] ${redact(parts.map(format).join(' '))}`;
  // Still goes to the console, so `npm start` and --enable-logging keep working.
  (level === 'error' ? console.error : console.log)(line);
  stream?.write(line + '\n');
}

export const info = (...parts) => log('info', ...parts);
export const warn = (...parts) => log('warn', ...parts);
export const error = (...parts) => log('error', ...parts);

/** @returns {Promise<void>} resolves once everything buffered has reached disk. */
export function closeLogger() {
  const closing = stream;
  stream = null;
  if (!closing) return Promise.resolve();
  return new Promise((resolve) => closing.end(resolve));
}
