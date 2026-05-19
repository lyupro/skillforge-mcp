/**
 * Action handlers for the `formats` subcommand.
 *
 * Each handler takes a `ConfigStore`, the post-action args, and stdout/stderr
 * sinks; it returns a process exit code. Split out of `formats.ts` so the
 * entry module stays under the 400-line file-size gate.
 *
 * The persisted config carries only operator-supplied format entries —
 * `formats list` resolves the full effective list (built-in defaults merged
 * with operator entries) so users see what the parser actually consults.
 * Edits go through the persisted layer: removing a built-in by id is
 * unsupported (the registry would re-add it on the next load); the
 * recommended way to suppress a built-in is `formats disable`.
 */

import type { ConfigStore } from '../config/config-store.js';
import {
  defaultSkillFormats,
  resolveSkillFormats,
} from '../config/config-schema.js';
import type { SkillFormat } from '../config/config-schema.js';
import { formatFormatsTable } from './formats-format.js';
import {
  findFormatEntry,
  isValidFormatId,
  parseAddFlags,
} from './formats-shared.js';

/** Set of built-in ids — disable/edit instead of remove. */
const BUILTIN_IDS: ReadonlySet<string> = new Set(defaultSkillFormats().map((f) => f.id));

/**
 * Upsert an operator entry into `config.skillFormats` by id. Built-in ids are
 * still allowed as operator entries — they replace the built-in on resolve.
 */
function upsertOperatorFormat(
  operator: SkillFormat[],
  entry: SkillFormat,
): SkillFormat[] {
  const next = operator.filter((f) => f.id !== entry.id);
  next.push(entry);
  return next;
}

/** Set the `enabled` flag of a format by id. Returns null when not present. */
function setEnabledById(
  operator: SkillFormat[],
  effective: SkillFormat[],
  id: string,
  enabled: boolean,
): SkillFormat[] | null {
  const target = effective.find((f) => f.id === id);
  if (target === undefined) return null;
  const next = operator.filter((f) => f.id !== id);
  next.push({ ...target, enabled });
  return next;
}

export async function handleList(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  let asJson = false;
  for (const arg of rest) {
    if (arg === '--json') asJson = true;
    else {
      stderr(`skillforge formats list: unknown flag: ${arg}\n`);
      return 2;
    }
  }
  const config = await store.load();
  const formats = resolveSkillFormats(config);
  if (asJson) {
    stdout(`${JSON.stringify({ formats }, null, 2)}\n`);
  } else {
    stdout(formatFormatsTable(formats));
  }
  return 0;
}

export async function handleAdd(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const id = rest[0];
  if (id === undefined || id.startsWith('--')) {
    stderr(`skillforge formats add: missing <id>\n`);
    return 2;
  }
  if (!isValidFormatId(id)) {
    stderr(
      `skillforge formats add: invalid <id> "${id}" — use kebab-case (e.g. gemini-gem)\n`,
    );
    return 2;
  }
  const flags = parseAddFlags(rest.slice(1));
  if (flags === null) {
    stderr(
      `skillforge formats add: invalid flags — supply exactly one of ` +
        `--filename <name>, --filename-glob <glob>, --frontmatter-field <field>\n`,
    );
    return 2;
  }

  const config = await store.load();
  const existing = findFormatEntry(config.skillFormats, id);
  if (existing !== null) {
    stderr(`skillforge formats add: id already in use: ${id}\n`);
    return 2;
  }
  const entry: SkillFormat = {
    id,
    match: flags.match,
    nameField: flags.nameField ?? 'name',
    deriveNameFromDir: flags.deriveNameFromDir,
    enabled: !flags.disabled,
    priority: flags.priority ?? 100,
  };
  config.skillFormats = upsertOperatorFormat(config.skillFormats, entry);
  await store.save(config);
  stdout(`Registered skill format: ${id}\n`);
  return 0;
}

export async function handleRemove(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  const id = rest[0];
  if (id === undefined || id.startsWith('--')) {
    stderr(`skillforge formats remove: missing <id>\n`);
    return 2;
  }
  const config = await store.load();
  const existing = findFormatEntry(config.skillFormats, id);
  if (existing === null) {
    if (BUILTIN_IDS.has(id)) {
      stderr(
        `skillforge formats remove: "${id}" is a built-in format — ` +
          `use "formats disable ${id}" to suppress it\n`,
      );
      return 1;
    }
    stderr(`skillforge formats remove: no operator-supplied format matches: ${id}\n`);
    return 1;
  }
  config.skillFormats = config.skillFormats.filter((f) => f !== existing);
  await store.save(config);
  stdout(`Removed skill format: ${id}\n`);
  return 0;
}

export async function handleEnable(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  return setEnabled(store, rest, stdout, stderr, true);
}

export async function handleDisable(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
): Promise<number> {
  return setEnabled(store, rest, stdout, stderr, false);
}

async function setEnabled(
  store: ConfigStore,
  rest: string[],
  stdout: (t: string) => void,
  stderr: (t: string) => void,
  enabled: boolean,
): Promise<number> {
  const verb = enabled ? 'enable' : 'disable';
  const id = rest[0];
  if (id === undefined || id.startsWith('--')) {
    stderr(`skillforge formats ${verb}: missing <id>\n`);
    return 2;
  }
  const config = await store.load();
  const effective = resolveSkillFormats(config);
  const next = setEnabledById(config.skillFormats, effective, id, enabled);
  if (next === null) {
    stderr(`skillforge formats ${verb}: no format matches: ${id}\n`);
    return 1;
  }
  config.skillFormats = next;
  await store.save(config);
  stdout(`${enabled ? 'Enabled' : 'Disabled'} skill format: ${id}\n`);
  return 0;
}
