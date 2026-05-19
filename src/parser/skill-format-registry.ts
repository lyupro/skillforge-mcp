/**
 * Skill format registry.
 *
 * The declarative core of skill recognition. SkillForge no longer hardcodes
 * "what counts as a skill file" — instead it reads a config-driven list of
 * format descriptors (the four built-ins merged with operator entries). Every
 * caller — candidate recognition, name resolution, dialect detection —
 * consults this registry, so supporting a new LLM's layout is a config edit,
 * not a code change.
 *
 * `matchFile` returns the single winning descriptor for a file: when a file
 * matches more than one enabled format, the highest `priority` wins; ties are
 * broken by registry order (built-ins before operator entries).
 */

import type { SkillFormat, FormatMatch, PersistedConfig } from '../config/config-schema.js';
import { resolveSkillFormats } from '../config/config-schema.js';

/**
 * Translate a filename glob (`*`, `?`) into a RegExp anchored to the whole
 * basename. Only the two wildcards the descriptors use are supported — every
 * other character is treated literally. `.` is escaped so `*.md` does not
 * match `mainXmd`.
 */
function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (const ch of glob) {
    if (ch === '*') {
      pattern += '.*';
    } else if (ch === '?') {
      pattern += '.';
    } else {
      pattern += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${pattern}$`, 'i');
}

/** Whether a frontmatter field holds a non-empty string. */
function hasNonEmptyField(
  frontmatter: Record<string, unknown> | undefined,
  field: string,
): boolean {
  const value = frontmatter?.[field];
  return typeof value === 'string' && value.trim().length > 0;
}

/** Whether a single descriptor's `match` rule accepts this file. */
function matchesRule(
  match: FormatMatch,
  fileName: string,
  frontmatter: Record<string, unknown> | undefined,
): boolean {
  switch (match.type) {
    case 'filename':
      return fileName === match.value;
    case 'filenameGlob':
      return globToRegExp(match.value).test(fileName);
    case 'frontmatterField':
      return hasNonEmptyField(frontmatter, match.field);
  }
}

export class SkillFormatRegistry {
  readonly #formats: SkillFormat[];

  /**
   * Build a registry from a pre-resolved list of format descriptors. Use
   * `SkillFormatRegistry.fromConfig` to build from a persisted config — that
   * applies the built-in defaults + operator merge.
   */
  constructor(formats: SkillFormat[]) {
    this.#formats = formats;
  }

  /** Build a registry from a persisted config (defaults merged with operator entries). */
  static fromConfig(config: PersistedConfig): SkillFormatRegistry {
    return new SkillFormatRegistry(resolveSkillFormats(config));
  }

  /** All registered format descriptors, in registry order. */
  list(): readonly SkillFormat[] {
    return this.#formats;
  }

  /** Look up a single format by `id`, or null when absent. */
  get(id: string): SkillFormat | null {
    return this.#formats.find((f) => f.id === id) ?? null;
  }

  /**
   * Every enabled format whose `match` rule accepts this file, in registry
   * order. Mostly useful for diagnostics — `matchFile` returns just the
   * winner.
   */
  matchAll(
    fileName: string,
    frontmatter?: Record<string, unknown>,
  ): SkillFormat[] {
    return this.#formats.filter(
      (f) => f.enabled && matchesRule(f.match, fileName, frontmatter),
    );
  }

  /**
   * The winning format descriptor for a file, or null when no enabled format
   * matches. A file that matches several formats resolves to the highest
   * `priority`; ties keep the earlier-declared descriptor (built-ins win over
   * operator entries). The losing matches are returned via `matchAll` for a
   * caller that wants to log them.
   */
  matchFile(
    fileName: string,
    frontmatter?: Record<string, unknown>,
  ): SkillFormat | null {
    const matches = this.matchAll(fileName, frontmatter);
    if (matches.length === 0) return null;
    let winner = matches[0]!;
    for (let i = 1; i < matches.length; i += 1) {
      const candidate = matches[i]!;
      if (candidate.priority > winner.priority) winner = candidate;
    }
    return winner;
  }

  /** Whether a file is a skill candidate — matches at least one enabled format. */
  isCandidate(
    fileName: string,
    frontmatter?: Record<string, unknown>,
  ): boolean {
    return this.matchFile(fileName, frontmatter) !== null;
  }
}
