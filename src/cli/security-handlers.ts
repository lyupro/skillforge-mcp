/**
 * Action handlers for the `security` subcommand `audit-*` areas.
 *
 * Each handler takes a `ConfigStore`, the post-action args, and stdout/stderr
 * sinks; it returns a process exit code. Split out of `security.ts` so the
 * entry module stays under the 400-line file-size gate. The blacklist area
 * lives in `security-blacklist-handlers.ts` to keep both files well under gate.
 *
 * Handlers follow the same load → mutate → save pattern as `folders-handlers`:
 * `config.security.auditExceptions` / `auditTarget` / `auditPatterns` persist
 * under `config.security`. No new config-store accessors are introduced.
 */

import type { ConfigStore } from '../config/config-store.js';
import { formatAuditTarget, formatStringListTable } from './security-format.js';
import {
  REINDEX_HINT,
  applyAdd,
  applyRemove,
  extractJsonFlag,
  normalizeValues,
} from './security-shared.js';

const AUDIT_TARGETS = ['scripts', 'all'] as const;

// ── audit-exceptions ────────────────────────────────────────────────────────

export async function handleAuditExceptionsList(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const { asJson, rest: extra } = extractJsonFlag(rest);
  if (extra.length > 0) {
    stderr(`skillforge security audit-exceptions list: unknown flag: ${extra[0]}\n`);
    return 2;
  }
  const config = await store.load();
  const items = config.security.auditExceptions;
  if (asJson) {
    stdout(`${JSON.stringify({ auditExceptions: items }, null, 2)}\n`);
  } else {
    stdout(formatStringListTable('audit-exceptions', items));
  }
  return 0;
}

export async function handleAuditExceptionsAdd(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const values = normalizeValues(rest);
  if (values.length === 0) {
    stderr(`skillforge security audit-exceptions add: missing <name>\n`);
    return 2;
  }
  const config = await store.load();
  const { added, skipped } = applyAdd(config.security.auditExceptions, values);
  if (added.length > 0) {
    await store.save(config);
  }
  stdout(`Added ${added.length} exception(s), skipped ${skipped.length} already present.\n`);
  if (added.length > 0) stdout(REINDEX_HINT);
  return 0;
}

export async function handleAuditExceptionsRemove(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const values = normalizeValues(rest);
  if (values.length === 0) {
    stderr(`skillforge security audit-exceptions remove: missing <name>\n`);
    return 2;
  }
  const config = await store.load();
  const { removed, notFound, next } = applyRemove(config.security.auditExceptions, values);
  if (removed.length > 0) {
    config.security.auditExceptions = next;
    await store.save(config);
  }
  stdout(`Removed ${removed.length} exception(s), ${notFound.length} not found.\n`);
  if (removed.length > 0) stdout(REINDEX_HINT);
  // Exit 1 only when nothing matched despite a non-empty request.
  return removed.length === 0 ? 1 : 0;
}

export async function handleAuditExceptionsClear(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const confirmed = rest.includes('--yes');
  for (const arg of rest) {
    if (arg !== '--yes') {
      stderr(`skillforge security audit-exceptions clear: unknown flag: ${arg}\n`);
      return 2;
    }
  }
  const config = await store.load();
  const count = config.security.auditExceptions.length;
  if (!confirmed) {
    stdout(
      `Would clear ${count} audit exception(s).\n` +
        `Re-run with --yes to apply. No changes were made.\n`,
    );
    return 0;
  }
  if (count > 0) {
    config.security.auditExceptions = [];
    await store.save(config);
  }
  stdout(`Cleared ${count} audit exception(s).\n`);
  if (count > 0) stdout(REINDEX_HINT);
  return 0;
}

// ── audit-target ──────────────────────────────────────────────────────────

export async function handleAuditTarget(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const value = rest[0];
  if (value === undefined) {
    const config = await store.load();
    stdout(formatAuditTarget(config.security.auditTarget));
    return 0;
  }
  if (value.startsWith('--') || rest.length > 1) {
    stderr(`skillforge security audit-target: usage: audit-target [scripts|all]\n`);
    return 2;
  }
  if (!(AUDIT_TARGETS as readonly string[]).includes(value)) {
    stderr(
      `skillforge security audit-target: invalid value "${value}" — use scripts or all\n`,
    );
    return 2;
  }
  const config = await store.load();
  const changed = config.security.auditTarget !== value;
  if (changed) {
    config.security.auditTarget = value as (typeof AUDIT_TARGETS)[number];
    await store.save(config);
  }
  stdout(formatAuditTarget(value));
  if (changed) stdout(REINDEX_HINT);
  return 0;
}

// ── audit-patterns (read-only) ──────────────────────────────────────────────

export async function handleAuditPatternsList(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const { asJson, rest: extra } = extractJsonFlag(rest);
  if (extra.length > 0) {
    stderr(`skillforge security audit-patterns list: unknown flag: ${extra[0]}\n`);
    return 2;
  }
  const config = await store.load();
  const items = config.security.auditPatterns;
  if (asJson) {
    stdout(`${JSON.stringify({ auditPatterns: items }, null, 2)}\n`);
  } else {
    stdout(formatStringListTable('audit-patterns', items));
  }
  return 0;
}
