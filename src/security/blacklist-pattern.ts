/**
 * Blacklist pattern compiler & matcher.
 *
 * The manual blacklist historically matched only exact skill names. This module
 * extends it to three pattern kinds, auto-classified by syntax:
 *
 *   - `exact`      — no `/`, no `*`/`?` (e.g. `research-orchestrator`). Fast-path
 *                    `Set.has` lookup against the skill NAME. Regression-critical.
 *   - `name-glob`  — has `*`/`?`, no `/` (e.g. `wiki-*`, `cs-?`). Glob over the
 *                    skill NAME.
 *   - `path-glob`  — has `/` (e.g. `**\/agenthub\/**`). Glob over the skill SOURCE
 *                    PATH relative to its registered root folder, forward-slashed.
 *
 * Self-contained glob→RegExp compiler (NO external dependency). Mirrors the
 * style of `globToRegExp` in `../parser/skill-format-registry.ts`, extended for
 * `**` (cross-separator) and path semantics. Case-sensitive throughout.
 */

export type BlacklistPatternKind = 'exact' | 'name-glob' | 'path-glob';

/** A glob pattern paired with the RegExp it compiled to (pattern kept for traceability). */
interface CompiledGlob {
  pattern: string;
  re: RegExp;
}

export interface CompiledBlacklist {
  /** Exact skill names — checked first via cheap `Set.has`. */
  exact: Set<string>;
  /** Globs matched against the skill name. */
  nameGlobs: CompiledGlob[];
  /** Globs matched against the forward-slashed path relative to the root folder. */
  pathGlobs: CompiledGlob[];
}

/**
 * Classify a raw pattern by syntax: any `/` → `path-glob`; else any `*`/`?` →
 * `name-glob`; else `exact`.
 */
export function classifyPattern(raw: string): BlacklistPatternKind {
  if (raw.includes('/')) return 'path-glob';
  if (raw.includes('*') || raw.includes('?')) return 'name-glob';
  return 'exact';
}

/**
 * Translate a glob into an anchored RegExp.
 *
 * Wildcards:
 *   - `**` → `.*`            (matches across path separators — any chars incl `/`)
 *   - `*`  → `[^/]*` (path)  /  `.*` (name)   — any chars; for paths it stops at `/`
 *   - `?`  → `[^/]` (path)   /  `.`  (name)   — single char
 *
 * Every other character is escaped so regex metacharacters are treated
 * literally. `pathMode` toggles the segment-bounded semantics for single `*`/`?`.
 */
function globToRegExp(glob: string, pathMode: boolean): RegExp {
  const single = pathMode ? '[^/]*' : '.*';
  const oneChar = pathMode ? '[^/]' : '.';
  let pattern = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]!;
    if (ch === '*') {
      // Coalesce a `**` run into a single cross-separator wildcard.
      if (glob[i + 1] === '*') {
        i += 1;
        // Swallow any further `*` so `***` behaves like `**`.
        while (glob[i + 1] === '*') i += 1;
        // A `**/` segment matches zero-or-more leading path segments, so
        // `**/agenthub/**` matches both `agenthub/...` (no prefix) and
        // `a/agenthub/...`. Consume the trailing `/` and make it optional.
        if (pathMode && glob[i + 1] === '/') {
          pattern += '(?:.*/)?';
          i += 1;
        } else {
          pattern += '.*';
        }
      } else {
        pattern += single;
      }
    } else if (ch === '?') {
      pattern += oneChar;
    } else {
      pattern += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * Compile a list of raw patterns: trim, drop empties, dedupe, classify each,
 * and compile globs to anchored RegExp. Exact names land in the fast-path Set.
 */
export function compileBlacklist(patterns: readonly string[]): CompiledBlacklist {
  const seen = new Set<string>();
  const exact = new Set<string>();
  const nameGlobs: CompiledGlob[] = [];
  const pathGlobs: CompiledGlob[] = [];

  for (const raw of patterns) {
    const pattern = raw.trim();
    if (pattern.length === 0) continue;
    if (seen.has(pattern)) continue;
    seen.add(pattern);

    switch (classifyPattern(pattern)) {
      case 'exact':
        exact.add(pattern);
        break;
      case 'name-glob':
        nameGlobs.push({ pattern, re: globToRegExp(pattern, false) });
        break;
      case 'path-glob':
        pathGlobs.push({ pattern, re: globToRegExp(pattern, true) });
        break;
    }
  }

  return { exact, nameGlobs, pathGlobs };
}

/**
 * Match a skill against a compiled blacklist. Returns the matched pattern string
 * (for traceability) or null. Exact names are checked first (cheap), then
 * name-globs, then path-globs — exact always wins.
 */
export function matchBlacklist(
  compiled: CompiledBlacklist,
  name: string,
  relPath: string,
): string | null {
  if (compiled.exact.has(name)) return name;
  for (const g of compiled.nameGlobs) {
    if (g.re.test(name)) return g.pattern;
  }
  for (const g of compiled.pathGlobs) {
    if (g.re.test(relPath)) return g.pattern;
  }
  return null;
}
