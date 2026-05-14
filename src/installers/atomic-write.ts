/**
 * Atomic JSON / TOML helpers with .backup snapshots.
 *
 * Read helpers return null on missing file, throw on corrupt content.
 * Write helpers go via <path>.tmp + fs.rename and snapshot the previous
 * content into <path>.backup before overwriting. On rename failure the
 * backup is restored.
 */

import { readFile, writeFile, rename, mkdir, access, copyFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import toml from '@iarna/toml';

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonSafe(path: string): Promise<unknown | null> {
  if (!(await fileExists(path))) return null;
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`atomic-write: failed to read "${path}": ${String(err)}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`atomic-write: invalid JSON in "${path}": ${String(err)}`);
  }
}

export async function readTomlSafe(path: string): Promise<Record<string, unknown> | null> {
  if (!(await fileExists(path))) return null;
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`atomic-write: failed to read "${path}": ${String(err)}`);
  }
  try {
    return toml.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`atomic-write: invalid TOML in "${path}": ${String(err)}`);
  }
}

async function backupAndRename(target: string, tmpPath: string): Promise<void> {
  const backupPath = `${target}.backup`;
  const had = await fileExists(target);
  if (had) {
    await copyFile(target, backupPath);
  }
  try {
    await rename(tmpPath, target);
  } catch (err) {
    // Best-effort restore from backup on rename failure.
    if (had) {
      try {
        await copyFile(backupPath, target);
      } catch {
        // Restore failed — leave both .backup and original in place for operator recovery.
      }
    }
    // Clean up the .tmp if it survives.
    try {
      await unlink(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  const contents = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(tmpPath, contents, 'utf8');
  await backupAndRename(path, tmpPath);
}

export async function writeTomlAtomic(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp`;
  const contents = toml.stringify(data as toml.JsonMap);
  await writeFile(tmpPath, contents, 'utf8');
  await backupAndRename(path, tmpPath);
}
