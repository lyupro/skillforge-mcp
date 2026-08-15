/**
 * Structural guards for the settings layer.
 *
 * A single resolution path only stays single while people keep adding keys to
 * it. Comments do not enforce that; a failing test does. Two rules are guarded:
 * no module outside this folder may read a named environment key, and a setting
 * that has an environment name may not carry a schema default.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settingsDeclarations } from './settings-declarations.js';
import { defaultConfig } from './config-schema.js';

const here = fileURLToPath(import.meta.url);
const repoRoot = join(here, '..', '..', '..');
const srcRoot = join(repoRoot, 'src');

/**
 * Reading a *named* key is what scatters configuration; passing the env object
 * around is dependency injection and stays legal everywhere.
 */
const NAMED_ENV_READ = /process\.env\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(['"])([^'"]+)\2\s*\])/g;

/**
 * Files allowed to read a named key, with the reason each one is not a setting.
 * A stale entry silently weakens the guard, so their existence is asserted too.
 */
const ALLOWED: ReadonlyArray<{ file: string; keys: readonly string[]; why: string }> = [
  {
    // SKILLFORGE_INPUT is how a skill script receives its input — a calling
    // convention between us and the child process, not something a user tunes.
    file: join('src', 'handlers', 'script-strategy.ts'),
    keys: ['SKILLFORGE_INPUT'],
    why: 'script input contract, not a setting',
  },
  {
    // PATH is the sandbox subprocess environment: we forward the host value so
    // node/python resolve, we never ask the user to configure it.
    file: join('src', 'security', 'sandbox-runner.ts'),
    keys: ['PATH'],
    why: 'sandbox subprocess environment, not a setting',
  },
];

function collectSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectSourceFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    found.push(full);
  }
  return found;
}

function findNamedEnvReads(source: string): Array<{ line: number; key: string }> {
  const hits: Array<{ line: number; key: string }> = [];
  for (const [index, text] of source.split('\n').entries()) {
    for (const match of text.matchAll(NAMED_ENV_READ)) {
      hits.push({ line: index + 1, key: match[1] ?? match[3] ?? '<unknown>' });
    }
  }
  return hits;
}

function readConfigValue(config: unknown, path: readonly string[]): unknown {
  let current = config;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

describe('the named-env detector itself', () => {
  it('flags a key read through dot or bracket access', () => {
    expect(findNamedEnvReads('const a = process.env.SKILLFORGE_FOLDERS;')).toHaveLength(1);
    expect(findNamedEnvReads("const b = process.env['SKILLFORGE_TTL_MS'];")).toHaveLength(1);
    expect(findNamedEnvReads('const c = process.env["DEBUG"];')).toHaveLength(1);
    expect(findNamedEnvReads('const d = process.env . HERMES_HOME;')).toHaveLength(1);
  });

  it('leaves the env object itself alone — passing it down is injection', () => {
    expect(findNamedEnvReads('function f(env: NodeJS.ProcessEnv = process.env) {}')).toEqual([]);
    expect(findNamedEnvReads('loadResolvedConfig(process.env, store);')).toEqual([]);
    expect(findNamedEnvReads('const env = deps.env ?? process.env;')).toEqual([]);
  });

  it('reports the offending key and its line', () => {
    const hits = findNamedEnvReads('const x = 1;\nconst y = process.env.HERMES_HOME;');
    expect(hits).toEqual([{ line: 2, key: 'HERMES_HOME' }]);
  });
});

describe('settings guard — no named env reads outside the settings layer', () => {
  it('every exception points at a file that still exists', () => {
    expect(ALLOWED.length).toBeGreaterThan(0);
    for (const exception of ALLOWED) {
      expect(() => statSync(join(repoRoot, exception.file)), exception.file).not.toThrow();
    }
  });

  it('no module outside src/config reads a named environment key', () => {
    const configDir = `src${sep}config${sep}`;
    const violations: string[] = [];

    for (const file of collectSourceFiles(srcRoot)) {
      const rel = relative(repoRoot, file);
      if (rel.startsWith(configDir)) continue;

      const exception = ALLOWED.find((candidate) => candidate.file === rel);
      for (const hit of findNamedEnvReads(readFileSync(file, 'utf-8'))) {
        if (exception?.keys.includes(hit.key) === true) continue;
        violations.push(`${rel}:${hit.line} reads process.env.${hit.key}`);
      }
    }

    expect(
      violations,
      'Settings must be declared in src/config/settings-declarations.ts and read through ' +
        'resolveSetting, so their source and precedence stay knowable. If this value is not ' +
        'a setting, add it to ALLOWED in this file with the reason.',
    ).toEqual([]);
  });
});

describe('settings guard — no schema default behind an environment name', () => {
  it('a setting with a config key is absent from the schema defaults', () => {
    const defaults = defaultConfig();
    const violations = settingsDeclarations
      .filter((declaration) => declaration.configPath !== undefined)
      .filter(
        (declaration) => readConfigValue(defaults, declaration.configPath as string[]) !== undefined,
      )
      .map((declaration) => `${declaration.settingKey} (${declaration.configPath?.join('.')})`);

    expect(
      violations,
      'A schema default makes the key look present in every config file, so "the user chose ' +
        'this" and "the schema wrote it" become indistinguishable, provenance lies, and the ' +
        "setting's environment name can never win. Make the key optional and keep the default " +
        'in its declaration.',
    ).toEqual([]);
  });
});
