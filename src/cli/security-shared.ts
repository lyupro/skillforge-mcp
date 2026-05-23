/**
 * Shared helpers for the `security` subcommand modules.
 *
 * Holds pure parsing/normalization logic split out of `security.ts` so the
 * entry module stays small and the handler modules can reuse it. Used by the
 * audit-exceptions and blacklist multi-value list operations.
 */

/** The one-line hint printed after any mutation, telling the operator to reindex. */
export const REINDEX_HINT = 'Run "skillforge skills reindex" to apply.\n';

/**
 * Normalize a raw multi-value argument list: trim each token, drop empties,
 * and dedupe while preserving first-seen order. Shared so `add`/`remove`
 * across both areas treat user input identically.
 */
export function normalizeValues(args: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of args) {
    const value = raw.trim();
    if (value.length === 0) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Detection result of the `--json` flag, with the flag stripped from the rest. */
export interface JsonFlagResult {
  asJson: boolean;
  /** Args with `--json` removed (other tokens preserved in order). */
  rest: string[];
}

/** Detect and strip a `--json` flag from an arg list. */
export function extractJsonFlag(args: readonly string[]): JsonFlagResult {
  let asJson = false;
  const rest: string[] = [];
  for (const arg of args) {
    if (arg === '--json') {
      asJson = true;
      continue;
    }
    rest.push(arg);
  }
  return { asJson, rest };
}

/** Result of adding values to a string list: which were added vs already present. */
export interface ApplyAddResult {
  added: string[];
  skipped: string[];
}

/**
 * Add `values` to `list` in place, skipping any already present. Returns which
 * were newly added and which were skipped (idempotent). `values` is assumed
 * already normalized by `normalizeValues`.
 */
export function applyAdd(list: string[], values: readonly string[]): ApplyAddResult {
  const present = new Set(list);
  const added: string[] = [];
  const skipped: string[] = [];
  for (const value of values) {
    if (present.has(value)) {
      skipped.push(value);
      continue;
    }
    present.add(value);
    list.push(value);
    added.push(value);
  }
  return { added, skipped };
}

/** Result of removing values from a string list: which matched vs were absent. */
export interface ApplyRemoveResult {
  removed: string[];
  notFound: string[];
  /** The list with the matched values removed. */
  next: string[];
}

/**
 * Compute the list with `values` removed. Returns which values matched and
 * which were absent. Does not mutate the input. `values` is assumed already
 * normalized by `normalizeValues`.
 */
export function applyRemove(list: readonly string[], values: readonly string[]): ApplyRemoveResult {
  const toRemove = new Set(values);
  const present = new Set(list);
  const removed: string[] = [];
  const notFound: string[] = [];
  for (const value of values) {
    if (present.has(value)) removed.push(value);
    else notFound.push(value);
  }
  const next = list.filter((v) => !toRemove.has(v));
  return { removed, notFound, next };
}
