/**
 * Action handlers for the `security blacklist` area.
 *
 * Split out of `security-handlers.ts` so each handler file stays well under
 * the 400-line file-size gate. The blacklist persists at the TOP-LEVEL
 * `config.blacklist` (not under `config.security`) — the CLI only groups it
 * under `security` for UX. Same load → mutate → save pattern as the other
 * handlers; pattern KIND is classified via `classifyPattern` for display.
 */

import type { ConfigStore } from '../config/config-store.js';
import { formatBlacklistTable } from './security-format.js';
import {
  REINDEX_HINT,
  applyAdd,
  applyRemove,
  extractJsonFlag,
  normalizeValues,
} from './security-shared.js';

export async function handleBlacklistList(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const { asJson, rest: extra } = extractJsonFlag(rest);
  if (extra.length > 0) {
    stderr(`skillforge security blacklist list: unknown flag: ${extra[0]}\n`);
    return 2;
  }
  const config = await store.load();
  const patterns = config.blacklist;
  if (asJson) {
    stdout(`${JSON.stringify({ blacklist: patterns }, null, 2)}\n`);
  } else {
    stdout(formatBlacklistTable(patterns));
  }
  return 0;
}

export async function handleBlacklistAdd(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const values = normalizeValues(rest);
  if (values.length === 0) {
    stderr(`skillforge security blacklist add: missing <pattern>\n`);
    return 2;
  }
  const config = await store.load();
  const { added, skipped } = applyAdd(config.blacklist, values);
  if (added.length > 0) {
    await store.save(config);
  }
  stdout(`Added ${added.length} pattern(s), skipped ${skipped.length} already present.\n`);
  if (added.length > 0) stdout(REINDEX_HINT);
  return 0;
}

export async function handleBlacklistRemove(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const values = normalizeValues(rest);
  if (values.length === 0) {
    stderr(`skillforge security blacklist remove: missing <pattern>\n`);
    return 2;
  }
  const config = await store.load();
  const { removed, notFound, next } = applyRemove(config.blacklist, values);
  if (removed.length > 0) {
    config.blacklist = next;
    await store.save(config);
  }
  stdout(`Removed ${removed.length} pattern(s), ${notFound.length} not found.\n`);
  if (removed.length > 0) stdout(REINDEX_HINT);
  // Exit 1 only when nothing matched despite a non-empty request.
  return removed.length === 0 ? 1 : 0;
}

export async function handleBlacklistClear(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const confirmed = rest.includes('--yes');
  for (const arg of rest) {
    if (arg !== '--yes') {
      stderr(`skillforge security blacklist clear: unknown flag: ${arg}\n`);
      return 2;
    }
  }
  const config = await store.load();
  const count = config.blacklist.length;
  if (!confirmed) {
    stdout(
      `Would clear ${count} blacklist pattern(s).\n` +
        `Re-run with --yes to apply. No changes were made.\n`,
    );
    return 0;
  }
  if (count > 0) {
    config.blacklist = [];
    await store.save(config);
  }
  stdout(`Cleared ${count} blacklist pattern(s).\n`);
  if (count > 0) stdout(REINDEX_HINT);
  return 0;
}
