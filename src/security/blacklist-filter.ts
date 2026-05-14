import type { PatternScanner } from './pattern-scanner.js';
import type { SkillContent } from '../core/types.js';

export interface BlacklistFilterOptions {
  /** Skill names that are always rejected (case-sensitive exact match). */
  manualBlacklist?: readonly string[];
  /** Pattern scanner used for auto-audit. When null/undefined, auto-audit is off. */
  patternScanner?: PatternScanner | null;
}

export type FilterVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'manual'; pattern?: undefined }
  | { allowed: false; reason: 'audit'; pattern: string };

function normalizeNames(names: readonly string[]): Set<string> {
  return new Set(names.map((s) => s.trim()).filter((s) => s.length > 0));
}

export class BlacklistFilter {
  #blacklist: Set<string>;
  readonly #scanner: PatternScanner | null;

  constructor(opts?: BlacklistFilterOptions) {
    this.#blacklist = normalizeNames(opts?.manualBlacklist ?? []);
    this.#scanner = opts?.patternScanner ?? null;
  }

  /** Replace the manual blacklist atomically. Normalizes input the same way
   *  the constructor does (trim, drop empties, dedupe). */
  setManualBlacklist(names: readonly string[]): void {
    this.#blacklist = normalizeNames(names);
  }

  /** Returns the verdict for a parsed skill.
   *  Manual blacklist checked first (cheap), then pattern audit (only if scanner present). */
  evaluate(content: SkillContent): FilterVerdict {
    if (this.#blacklist.has(content.name)) {
      return { allowed: false, reason: 'manual' };
    }

    if (this.#scanner !== null) {
      const result = this.#scanner.scan(content.body);
      if (!result.safe) {
        return { allowed: false, reason: 'audit', pattern: result.matches[0]!.pattern };
      }
    }

    return { allowed: true };
  }

  /** True if neither layer is armed — useful for short-circuiting callers and tests. */
  isNoop(): boolean {
    return this.#blacklist.size === 0 && this.#scanner === null;
  }
}
