/**
 * Shared helpers for the `version-policy` subcommand modules.
 *
 * Holds the policy-value validation + multi-arg normalization split out of
 * `version-policy.ts` so the entry module stays small and the handlers can
 * reuse it. The reindex hint is shared with the other CLI groups via
 * `security-shared.ts` to avoid duplicating the string.
 */

export { REINDEX_HINT } from './security-shared.js';

/** Strict `major.minor.patch` (all numeric, no `v` prefix, no pre-release). */
const STRICT_SEMVER = /^\d+\.\d+\.\d+$/;

/** The accepted-forms message reused by `set` validation errors. */
export const ACCEPTED_POLICY_FORMS =
  'value must be "latest" or a strict major.minor.patch (e.g. 2.4.4)';

/**
 * Whether a policy value is accepted: the literal `latest` (highest semver
 * wins) or a strict `major.minor.patch` pin. Rejects loose forms like `2.4`,
 * `v2.4.4`, or `latest-ish`.
 */
export function isValidPolicyValue(value: string): boolean {
  return value === 'latest' || STRICT_SEMVER.test(value);
}

/**
 * Normalize a raw multi-value argument list: trim each token, drop empties,
 * and dedupe while preserving first-seen order. Mirrors `security-shared`'s
 * `normalizeValues` so `remove` treats user input identically across groups.
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
