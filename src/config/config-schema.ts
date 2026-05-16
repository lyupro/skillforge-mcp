// Why: camelCase keys match TS identifiers 1:1 — no key transforms needed between code and JSON.
import { z } from 'zod';

const folderEntrySchema = z.object({
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
});

const securitySchema = z.object({
  autoAudit: z.boolean().default(true),
  auditPatterns: z
    .array(z.string())
    .default(['shell=True', 'eval\\(', 'exec\\(', 'base64\\.b64decode']),
  allowScripts: z.boolean().default(false),
  sandboxScripts: z.boolean().default(true),
  sandboxRestrictedPaths: z.array(z.string()).default(['~/.ssh', '~/.aws', '~/.gnupg']),
});

const cacheSchema = z.object({
  metadataTtlMs: z.number().nonnegative().default(300_000),
  contentTtlMs: z.number().nonnegative().default(300_000),
  maxSizeMb: z.number().nonnegative().default(50),
});

const watcherSchema = z.object({
  enabled: z.boolean().default(true),
  debounceMs: z.number().nonnegative().default(500),
});

const loggingSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  file: z.string().nullable().default(null),
});

const invocationSchema = z.object({
  defaultTimeoutMs: z.number().nonnegative().default(30_000),
  cacheTtlMs: z.number().nonnegative().default(60_000),
  cacheMaxEntries: z.number().nonnegative().default(128),
});

export const configSchema = z.object({
  version: z.literal('1.0').default('1.0'),
  folders: z.array(folderEntrySchema).default([]),
  blacklist: z.array(z.string()).default([]),
  security: securitySchema.default({}),
  cache: cacheSchema.default({}),
  watcher: watcherSchema.default({}),
  logging: loggingSchema.default({}),
  invocation: invocationSchema.default({}),
});

export type PersistedConfig = z.infer<typeof configSchema>;
export type FolderEntry = z.infer<typeof folderEntrySchema>;

export function defaultConfig(): PersistedConfig {
  return configSchema.parse({});
}
