/**
 * Shared helpers for the `formats` subcommand modules.
 *
 * Holds pure parsing/lookup logic split out of `formats.ts` so the entry
 * module stays small and the handler modules can reuse it.
 */

import type { SkillFormat, FormatMatch } from '../config/config-schema.js';

/** Id shape required for a skill-format entry (kebab-case token). */
export const FORMAT_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Whether `id` is a valid kebab-case format id. */
export function isValidFormatId(id: string): boolean {
  return FORMAT_ID_PATTERN.test(id);
}

/** Locate a format descriptor by `id`, or null when absent. */
export function findFormatEntry(
  formats: SkillFormat[],
  id: string,
): SkillFormat | null {
  return formats.find((f) => f.id === id) ?? null;
}

/** Parsed result of the flags accepted by `add`. */
export interface ParsedAddFlags {
  match: FormatMatch;
  nameField?: string;
  deriveNameFromDir: boolean;
  disabled: boolean;
  priority?: number;
}

/**
 * Parse the flags accepted by `formats add`. Exactly one of `--filename`,
 * `--filename-glob`, or `--frontmatter-field` must be supplied — that becomes
 * the `match` rule. Returns null on a malformed or missing match flag.
 */
export function parseAddFlags(args: string[]): ParsedAddFlags | null {
  let match: FormatMatch | undefined;
  let nameField: string | undefined;
  let deriveNameFromDir = false;
  let disabled = false;
  let priority: number | undefined;

  const setMatch = (next: FormatMatch): boolean => {
    if (match !== undefined) return false; // more than one match flag
    match = next;
    return true;
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--filename') {
      const value = args[i + 1];
      if (value === undefined) return null;
      if (!setMatch({ type: 'filename', value })) return null;
      i += 1;
    } else if (arg === '--filename-glob') {
      const value = args[i + 1];
      if (value === undefined) return null;
      if (!setMatch({ type: 'filenameGlob', value })) return null;
      i += 1;
    } else if (arg === '--frontmatter-field') {
      const value = args[i + 1];
      if (value === undefined) return null;
      if (!setMatch({ type: 'frontmatterField', field: value })) return null;
      i += 1;
    } else if (arg === '--name-field') {
      const value = args[i + 1];
      if (value === undefined) return null;
      nameField = value;
      i += 1;
    } else if (arg === '--derive-name-from-dir') {
      deriveNameFromDir = true;
    } else if (arg === '--disabled') {
      disabled = true;
    } else if (arg === '--priority') {
      const value = args[i + 1];
      if (value === undefined) return null;
      const n = Number(value);
      if (!Number.isInteger(n)) return null;
      priority = n;
      i += 1;
    } else {
      return null;
    }
  }

  if (match === undefined) return null;
  return { match, nameField, deriveNameFromDir, disabled, priority };
}

/** Render a `FormatMatch` rule as a compact human-readable string. */
export function describeMatch(match: FormatMatch): string {
  switch (match.type) {
    case 'filename':
      return `filename=${match.value}`;
    case 'filenameGlob':
      return `glob=${match.value}`;
    case 'frontmatterField':
      return `field=${match.field}`;
  }
}
