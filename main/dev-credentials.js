// Development-only credential preset.
//
// Re-typing a Jira URL, email and API token into the wizard on every launch makes
// testing the connection tedious, so an untracked `.joggl-dev.json` next to the
// project can seed them.
//
// Two rules, both enforced below rather than by convention:
//   - it is ignored entirely in a packaged build, so a shipped installer can
//     never pick up a file a colleague happens to have lying around;
//   - the token is read from the file and immediately re-stored through
//     safeStorage, exactly like one typed into the wizard. The plaintext copy
//     only ever exists in the developer's own working directory.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { saveToken } from './credentials.js';
import * as log from './log.js';
import { saveSettings } from './settings.js';

export const DEV_CREDENTIALS_FILE = '.joggl-dev.json';

/**
 * @param {{isPackaged: boolean, projectRoot: string}} options
 * @returns {Promise<boolean>} whether a preset was applied
 */
export async function applyDevCredentials({ isPackaged, projectRoot }) {
  if (isPackaged) return false;

  const file = process.env.JOGGL_DEV_CREDENTIALS
    ? path.resolve(process.env.JOGGL_DEV_CREDENTIALS)
    : path.join(projectRoot, DEV_CREDENTIALS_FILE);

  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    log.warn(`Could not read ${file}:`, err.message);
    return false;
  }

  let preset;
  try {
    preset = JSON.parse(raw);
  } catch (err) {
    log.error(`${file} is not valid JSON — ignoring it. ${err.message}`);
    return false;
  }

  const missing = ['baseUrl', 'email', 'apiToken'].filter((k) => !preset[k]);
  if (missing.length) {
    log.error(`${file} is missing ${missing.join(', ')} — ignoring it.`);
    return false;
  }

  await saveSettings({
    baseUrl: preset.baseUrl,
    email: preset.email,
    ...(Array.isArray(preset.taskSources) ? { taskSources: preset.taskSources } : {}),
  });
  await saveToken(preset.apiToken);

  log.info(
    `Dev credentials applied from ${path.basename(file)}: ${preset.baseUrl} as ${preset.email}`,
  );
  return true;
}
