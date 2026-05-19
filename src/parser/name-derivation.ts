/**
 * Skill-name derivation.
 *
 * When a canonical file (`SKILL.md` / `AGENTS.md`, or any format with
 * `deriveNameFromDir: true`) carries no `name:` in its frontmatter, the skill
 * name is derived from the parent directory — `migration-architect/SKILL.md`
 * becomes `migration-architect`. Derivation is a first-class format feature,
 * gated by the matched descriptor, not an ad-hoc fallback.
 */

import { basename, dirname } from 'node:path';

/**
 * Kebab-normalize a raw directory name into a skill name: lowercase, runs of
 * non-alphanumeric characters collapsed to a single `-`, leading/trailing `-`
 * trimmed. `Migration Architect` → `migration-architect`, `My_Skill.v2` →
 * `my-skill-v2`.
 */
export function kebabNormalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Derive a skill name from the directory containing a skill file. Returns the
 * kebab-normalized parent directory name, or null when that yields an empty
 * string (e.g. a directory named only with separators).
 */
export function deriveNameFromPath(absoluteFilePath: string): string | null {
  const parentDir = basename(dirname(absoluteFilePath));
  const normalized = kebabNormalize(parentDir);
  return normalized.length > 0 ? normalized : null;
}
