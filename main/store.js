// Atomic JSON store over app.getPath('userData').
//
// One file per key. Keys are named as in the domain model — `day:2026-07-28`,
// `pins`, `settings`, `ui` — and mapped to `<userData>/data/<key with : as ->.json`.
//
// Deliberately not electron-store: the needs here are get/set/delete by key, and
// a per-key file means a crash mid-write can never take more than one day's log
// with it. Writes are temp-file + fsync + rename, which is the non-negotiable part.

import { randomBytes } from 'node:crypto';
import { open, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

const KEY_RE = /^[a-z][a-z0-9]*(:[a-z0-9-]+)?$/;

let dataDir = null;

/**
 * Point the store at a directory and make sure it exists.
 * Called from main with `app.getPath('userData')` once the app is ready;
 * tests call it with a temp directory. No electron import, so it runs under
 * plain node.
 */
export async function initStore(userDataPath) {
  dataDir = path.join(userDataPath, 'data');
  await mkdir(dataDir, { recursive: true });
  return dataDir;
}

function fileFor(key) {
  if (!dataDir) throw new Error('Store used before initStore()');
  if (typeof key !== 'string' || !KEY_RE.test(key)) {
    throw new Error(`Invalid store key: ${JSON.stringify(key)}`);
  }
  return path.join(dataDir, key.replace(':', '-') + '.json');
}

// Serialise writes per key so two rapid saves cannot interleave their renames.
const writeChains = new Map();

function chain(key, task) {
  const prev = writeChains.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  // Keep the chain alive but never leak a rejected promise into the next link.
  writeChains.set(
    key,
    next.catch(() => {}),
  );
  return next;
}

/** Returns the parsed value, or `fallback` when the key has never been written. */
export async function get(key, fallback = null) {
  const file = fileFor(key);
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    // A truncated file means a write was interrupted before the rename landed,
    // which should be impossible — but losing the day silently is worse than
    // saying so. Keep the corpse for inspection and start clean.
    await rename(file, file + '.corrupt-' + Date.now()).catch(() => {});
    return fallback;
  }
}

export function set(key, value) {
  const file = fileFor(key);
  const json = JSON.stringify(value, null, 2);

  return chain(key, async () => {
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    const fh = await open(tmp, 'w');
    try {
      await fh.writeFile(json, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, file);
    return value;
  });
}

export function del(key) {
  const file = fileFor(key);
  return chain(key, async () => {
    await unlink(file).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
  });
}
