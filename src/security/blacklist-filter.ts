import { relative } from 'node:path';
import type { PatternScanner } from './pattern-scanner.js';
import { auditScopeText } from './audit-scope.js';
import {
  compileBlacklist,
  matchBlacklist,
  type CompiledBlacklist,
} from './blacklist-pattern.js';
import type { SkillContent } from '../core/types.js';

export interface BlacklistFilterOptions {
  /** Patterns that are always rejected (case-sensitive). Each entry is
   *  auto-classified: plain name → exact match; `*`/`?` without `/` → glob over
   *  the skill name; any `/` → glob over the source path relative to the
   *  registered root folder. */
  manualBlacklist?: readonly string[];
  /** Pattern scanner used for auto-audit. When null/undefined, auto-audit is off. */
  patternScanner?: PatternScanner | null;
  /** Skill names exempt from the auto-audit (case-sensitive exact match). The
   *  manual blacklist still applies. */
  auditExceptions?: readonly string[];
  /** What the auto-audit scans: `scripts` (fenced executable code only, default)
   *  or `all` (whole body). */
  auditTarget?: 'scripts' | 'all';
}

export type FilterVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'manual'; pattern: string }
  | { allowed: false; reason: 'audit'; pattern: string };

function normalizeNames(names: readonly string[]): Set<string> {
  return new Set(names.map((s) => s.trim()).filter((s) => s.length > 0));
}

/** Path of a skill relative to its registered root folder, forward-slashed and
 *  portable. Defaults guard against missing fixture fields (empty → ''). */
function relPathOf(content: SkillContent): string {
  const folder = content.folder ?? '';
  const sourcePath = content.sourcePath ?? '';
  if (folder.length === 0 || sourcePath.length === 0) {
    return sourcePath.replace(/\\/g, '/');
  }
  return relative(folder, sourcePath).replace(/\\/g, '/');
}

export class BlacklistFilter {
  #blacklist: CompiledBlacklist;
  readonly #scanner: PatternScanner | null;
  readonly #auditExceptions: Set<string>;
  readonly #auditTarget: 'scripts' | 'all';

  constructor(opts?: BlacklistFilterOptions) {
    this.#blacklist = compileBlacklist(opts?.manualBlacklist ?? []);
    this.#scanner = opts?.patternScanner ?? null;
    this.#auditExceptions = normalizeNames(opts?.auditExceptions ?? []);
    this.#auditTarget = opts?.auditTarget ?? 'scripts';
  }

  /** Replace the manual blacklist atomically. Recompiles input the same way
   *  the constructor does (trim, drop empties, dedupe, classify). */
  setManualBlacklist(names: readonly string[]): void {
    this.#blacklist = compileBlacklist(names);
  }

  /** Returns the verdict for a parsed skill.
   *  Manual blacklist checked first (cheap), then pattern audit (only if scanner present). */
  evaluate(content: SkillContent): FilterVerdict {
    const relPath = relPathOf(content);
    const matched = matchBlacklist(this.#blacklist, content.name, relPath);
    if (matched !== null) {
      return { allowed: false, reason: 'manual', pattern: matched };
    }

    if (this.#scanner !== null && !this.#auditExceptions.has(content.name)) {
      const target = auditScopeText(content.body, this.#auditTarget);
      const result = this.#scanner.scan(target);
      if (!result.safe) {
        return { allowed: false, reason: 'audit', pattern: result.matches[0]!.pattern };
      }
    }

    return { allowed: true };
  }

  /** True if neither layer is armed — useful for short-circuiting callers and tests. */
  isNoop(): boolean {
    const bl = this.#blacklist;
    const blacklistEmpty =
      bl.exact.size === 0 && bl.nameGlobs.length === 0 && bl.pathGlobs.length === 0;
    return blacklistEmpty && this.#scanner === null;
  }
}
