/**
 * Action handlers for the `version-policy` subcommand.
 *
 * Each handler takes a `ConfigStore`, the post-action args, and stdout/stderr
 * sinks; it returns a process exit code. Split out of `version-policy.ts` so
 * the entry module stays under the 400-line file-size gate.
 *
 * Handlers follow the same load → mutate → save pattern as the other groups:
 * the policy map persists at the top-level `config.versionPolicy`. No new
 * config-store accessors are introduced.
 */

import type { ConfigStore } from '../config/config-store.js';
import { formatVersionPolicyTable } from './version-policy-format.js';
import {
  ACCEPTED_POLICY_FORMS,
  REINDEX_HINT,
  isValidPolicyValue,
  normalizeValues,
} from './version-policy-shared.js';

export async function handleList(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  let asJson = false;
  for (const arg of rest) {
    if (arg === '--json') {
      asJson = true;
      continue;
    }
    stderr(`skillforge version-policy list: unknown flag: ${arg}\n`);
    return 2;
  }
  const config = await store.load();
  const versionPolicy = config.versionPolicy;
  if (asJson) {
    stdout(`${JSON.stringify({ versionPolicy }, null, 2)}\n`);
  } else {
    stdout(formatVersionPolicyTable(versionPolicy));
  }
  return 0;
}

export async function handleSet(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const bundle = rest[0];
  const value = rest[1];
  if (bundle === undefined || bundle.startsWith('--') || value === undefined) {
    stderr(`skillforge version-policy set: usage: set <bundle> <latest|major.minor.patch>\n`);
    return 2;
  }
  if (rest.length > 2) {
    stderr(`skillforge version-policy set: too many arguments\n`);
    return 2;
  }
  if (!isValidPolicyValue(value)) {
    stderr(`skillforge version-policy set: invalid value "${value}" — ${ACCEPTED_POLICY_FORMS}\n`);
    return 2;
  }
  const config = await store.load();
  config.versionPolicy[bundle] = value;
  await store.save(config);
  stdout(`Set version policy: ${bundle} -> ${value}\n`);
  stdout(REINDEX_HINT);
  return 0;
}

export async function handleRemove(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const bundles = normalizeValues(rest);
  if (bundles.length === 0) {
    stderr(`skillforge version-policy remove: missing <bundle>\n`);
    return 2;
  }
  const config = await store.load();
  const removed: string[] = [];
  const notFound: string[] = [];
  for (const bundle of bundles) {
    if (Object.prototype.hasOwnProperty.call(config.versionPolicy, bundle)) {
      delete config.versionPolicy[bundle];
      removed.push(bundle);
    } else {
      notFound.push(bundle);
    }
  }
  if (removed.length > 0) {
    await store.save(config);
  }
  stdout(`Removed ${removed.length} policy(ies), ${notFound.length} not found.\n`);
  if (removed.length > 0) stdout(REINDEX_HINT);
  // Exit 1 only when nothing matched despite a non-empty request.
  return removed.length === 0 ? 1 : 0;
}

export async function handleClear(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const confirmed = rest.includes('--yes');
  for (const arg of rest) {
    if (arg !== '--yes') {
      stderr(`skillforge version-policy clear: unknown flag: ${arg}\n`);
      return 2;
    }
  }
  const config = await store.load();
  const count = Object.keys(config.versionPolicy).length;
  if (!confirmed) {
    stdout(
      `Would clear ${count} version policy(ies).\n` +
        `Re-run with --yes to apply. No changes were made.\n`,
    );
    return 0;
  }
  if (count > 0) {
    config.versionPolicy = {};
    await store.save(config);
  }
  stdout(`Cleared ${count} version policy(ies).\n`);
  if (count > 0) stdout(REINDEX_HINT);
  return 0;
}
