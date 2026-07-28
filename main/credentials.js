// The Jira API token. Encrypted with Electron's safeStorage (DPAPI on Windows)
// and written as the raw cipher buffer — never plaintext, never in the JSON
// store, never sent to the renderer.

import { app, safeStorage } from 'electron';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';

let tokenFile = null;

export function initCredentials() {
  tokenFile = path.join(app.getPath('userData'), 'credentials.bin');
}

/**
 * safeStorage is only usable after app.whenReady(), and on a Linux desktop with
 * no keyring it can be unavailable outright. Fail loudly rather than falling
 * back to plaintext.
 */
export function assertEncryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'This system has no OS credential store available, so Joggl cannot store your ' +
        'Jira API token securely. On Windows this usually means the app is running ' +
        'under an account without a user profile. Joggl will not fall back to storing ' +
        'the token in plain text.',
    );
  }
}

export function isEncryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export async function saveToken(token) {
  assertEncryptionAvailable();
  const trimmed = String(token ?? '').trim();
  if (!trimmed) throw new Error('Refusing to store an empty Jira API token.');
  await mkdir(path.dirname(tokenFile), { recursive: true });
  await writeFile(tokenFile, safeStorage.encryptString(trimmed), { mode: 0o600 });
}

/** @returns {Promise<string|null>} the plaintext token, or null when none is stored. */
export async function loadToken() {
  let cipher;
  try {
    cipher = await readFile(tokenFile);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  assertEncryptionAvailable();
  try {
    return safeStorage.decryptString(cipher);
  } catch (cause) {
    throw new Error(
      'Your stored Jira API token could not be decrypted. This happens when the app ' +
        'data is copied to a different Windows account or machine. Re-enter the token ' +
        'in Settings.',
      { cause },
    );
  }
}

export async function hasToken() {
  try {
    return (await readFile(tokenFile)).length > 0;
  } catch {
    return false;
  }
}

export async function clearToken() {
  await unlink(tokenFile).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });
}
