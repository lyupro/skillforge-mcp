// Why: camelCase keys match TS identifiers 1:1 — no key transforms needed between code and JSON.
import { z } from 'zod';

const folderEntrySchema = z
  .object({
    path: z.string().min(1),
    priority: z.number().int().default(100),
    enabled: z.boolean().default(true),
    tags: z.array(z.string()).default([]),
    // Optional kebab-case handle to address the folder from the CLI. Optional
    // so configs written before this field still validate.
    alias: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .optional(),
  })
  .passthrough();

const securitySchema = z
  .object({
    autoAudit: z.boolean().default(true),
    auditPatterns: z
      .array(z.string())
      .default(['shell=True', 'eval\\(', 'exec\\(', 'base64\\.b64decode']),
    // What the auto-audit scans inside a SKILL.md. `scripts` (default) extracts
    // only fenced executable code blocks (python/sh/js/…) — prose that merely
    // *mentions* a pattern (a security skill documenting `exec(` in a table) is
    // not a runnable vector, especially with allowScripts:false, so scanning it
    // is a false positive. `all` restores whole-body scanning for the paranoid.
    auditTarget: z.enum(['scripts', 'all']).default('scripts'),
    // Skill names exempt from the auto-audit (case-sensitive exact match). Lets a
    // legitimately pattern-heavy skill (security auditors, lint rule packs) load
    // even when its scripts contain the very anti-patterns it teaches. Manual
    // blacklist still applies. Mirrors the `--allow-audit` reindex flag.
    auditExceptions: z.array(z.string()).default([]),
    allowScripts: z.boolean().default(false),
    sandboxScripts: z.boolean().default(true),
    sandboxRestrictedPaths: z.array(z.string()).default(['~/.ssh', '~/.aws', '~/.gnupg']),
  })
  .passthrough();

const cacheSchema = z
  .object({
    metadataTtlMs: z.number().nonnegative().default(300_000),
    contentTtlMs: z.number().nonnegative().default(300_000),
    maxSizeMb: z.number().nonnegative().default(50),
    // Persistent on-disk registry index — survives between CLI processes.
    indexEnabled: z.boolean().default(true),
    // Absolute path to the index file. Optional — when absent the path is
    // computed as <configDir>/cache/registry-index.json.
    indexPath: z.string().optional(),
  })
  .passthrough();

const watcherSchema = z
  .object({
    enabled: z.boolean().default(true),
    debounceMs: z.number().nonnegative().default(500),
  })
  .passthrough();

const loggingSchema = z
  .object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    file: z.string().nullable().default(null),
  })
  .passthrough();

const invocationSchema = z
  .object({
    defaultTimeoutMs: z.number().nonnegative().default(30_000),
    cacheTtlMs: z.number().nonnegative().default(60_000),
    cacheMaxEntries: z.number().nonnegative().default(128),
  })
  .passthrough();

// Recognition rule for a skill format — a discriminated union so a malformed
// entry fails fast with a precise message. `filename` matches an exact name,
// `filenameGlob` a shell-style glob, `frontmatterField` the presence of a
// non-empty frontmatter field.
const formatMatchSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('filename'), value: z.string().min(1) }),
  z.object({ type: z.literal('filenameGlob'), value: z.string().min(1) }),
  z.object({ type: z.literal('frontmatterField'), field: z.string().min(1) }),
]);

// One declarative skill-format descriptor. The registry is the merge of these
// seed defaults with operator-supplied entries — adding support for a new
// LLM's layout is a config edit, not a code change.
const skillFormatSchema = z
  .object({
    id: z.string().min(1),
    match: formatMatchSchema,
    nameField: z.string().min(1).default('name'),
    deriveNameFromDir: z.boolean().default(false),
    enabled: z.boolean().default(true),
    priority: z.number().int().default(100),
  })
  .passthrough();

// Built-in formats. The operator config is merged OVER these (by `id`), so an
// operator can add, disable, or edit a built-in without code. `deriveNameFromDir`
// is true for the canonical `SKILL.md` / `AGENTS.md` layouts so a file with no
// `name:` is still addressable by its parent directory name.
function defaultSkillFormats(): SkillFormat[] {
  return [
    {
      id: 'claude',
      match: { type: 'filename', value: 'SKILL.md' },
      nameField: 'name',
      deriveNameFromDir: true,
      enabled: true,
      priority: 100,
    },
    {
      id: 'codex',
      match: { type: 'filename', value: 'AGENTS.md' },
      nameField: 'name',
      deriveNameFromDir: true,
      enabled: true,
      priority: 100,
    },
    {
      id: 'persona',
      match: { type: 'frontmatterField', field: 'persona' },
      nameField: 'name',
      deriveNameFromDir: false,
      enabled: true,
      priority: 90,
    },
    {
      id: 'custom',
      match: { type: 'filenameGlob', value: '*.md' },
      nameField: 'name',
      deriveNameFromDir: false,
      enabled: true,
      priority: 10,
    },
  ];
}

/**
 * Merge operator-supplied formats over the built-in defaults, keyed by `id`.
 * An operator entry with a known id replaces that built-in; an unknown id is
 * appended. Order: built-ins (in declared order) first, then new operator
 * entries in the order given.
 */
function mergeSkillFormats(operator: SkillFormat[]): SkillFormat[] {
  const merged = new Map<string, SkillFormat>();
  for (const builtin of defaultSkillFormats()) merged.set(builtin.id, builtin);
  for (const entry of operator) merged.set(entry.id, entry);
  return [...merged.values()];
}

export const configSchema = z
  .object({
    version: z.literal('1.0').default('1.0'),
    folders: z.array(folderEntrySchema).default([]),
    blacklist: z.array(z.string()).default([]),
    security: securitySchema.default({}),
    cache: cacheSchema.default({}),
    watcher: watcherSchema.default({}),
    logging: loggingSchema.default({}),
    invocation: invocationSchema.default({}),
    // Operator-supplied format descriptors, merged over the built-in defaults
    // by `id`. Defaults to an empty array — the resolved registry then equals
    // the four built-ins. Use `resolveSkillFormats()` to get the merged list.
    skillFormats: z.array(skillFormatSchema).default([]),
  })
  .passthrough();

export type PersistedConfig = z.infer<typeof configSchema>;
export type FolderEntry = z.infer<typeof folderEntrySchema>;
export type SkillFormat = z.infer<typeof skillFormatSchema>;
export type FormatMatch = z.infer<typeof formatMatchSchema>;

export function defaultConfig(): PersistedConfig {
  return configSchema.parse({});
}

/**
 * Resolve the effective skill-format registry for a config: the built-in
 * defaults merged with any operator entries in `config.skillFormats`. This is
 * the single source of truth `SkillFormatRegistry` loads from.
 */
export function resolveSkillFormats(config: PersistedConfig): SkillFormat[] {
  return mergeSkillFormats(config.skillFormats);
}

/** The built-in seed formats, exported for tests and tooling. */
export { defaultSkillFormats };
