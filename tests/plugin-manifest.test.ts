/**
 * Validates the Claude Code plugin packaging:
 *   - .claude-plugin/plugin.json     (plugin manifest)
 *   - .claude-plugin/marketplace.json (marketplace catalog)
 *
 * Asserts the manifests parse as JSON, carry the required fields, use the
 * public "Lyu Pro" brand, expose only the lyupro.dev@gmail.com contact email,
 * declare the bundled "skillforge" MCP server, and stay version-locked to
 * package.json.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_EMAIL = 'lyupro.dev@gmail.com';

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(ROOT, relPath), 'utf8')) as Record<string, unknown>;
}

/** Recursively collect every value stored under an "email" key. */
function collectEmails(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectEmails);
  }
  if (value && typeof value === 'object') {
    const out: string[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'email' && typeof child === 'string') {
        out.push(child);
      } else {
        out.push(...collectEmails(child));
      }
    }
    return out;
  }
  return [];
}

const pkg = readJson('package.json');
const plugin = readJson('.claude-plugin/plugin.json');
const marketplace = readJson('.claude-plugin/marketplace.json');

describe('.claude-plugin/plugin.json', () => {
  it('has the required identity fields', () => {
    expect(typeof plugin.name).toBe('string');
    expect(plugin.name).toBe('skillforge');
    expect(typeof plugin.description).toBe('string');
    expect(typeof plugin.version).toBe('string');
    expect(plugin.license).toBe('MIT');
    expect(Array.isArray(plugin.keywords)).toBe(true);
  });

  it('uses the public Lyu Pro author identity', () => {
    const author = plugin.author as Record<string, unknown>;
    expect(author).toBeTypeOf('object');
    expect(author.name).toBe('Lyu Pro');
    expect(author.email).toBe(EXPECTED_EMAIL);
    expect(author.url).toBe('https://lyupro.com');
  });

  it('declares the bundled skillforge MCP server with a plugin-relative path', () => {
    const servers = plugin.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers).toBeTypeOf('object');
    const server = servers.skillforge;
    expect(server).toBeTypeOf('object');
    expect(server.command).toBe('node');
    const args = server.args as string[];
    expect(args).toContain('serve');
    expect(args.some((a) => a.includes('${CLAUDE_PLUGIN_ROOT}'))).toBe(true);
    expect(args.some((a) => a.includes('dist/cli/dispatcher.js'))).toBe(true);
  });

  it('is version-locked to package.json', () => {
    expect(plugin.version).toBe(pkg.version);
  });
});

describe('.claude-plugin/marketplace.json', () => {
  it('has the required marketplace fields', () => {
    expect(typeof marketplace.name).toBe('string');
    expect(marketplace.name).toBe('skillforge');
    expect(Array.isArray(marketplace.plugins)).toBe(true);
    expect((marketplace.plugins as unknown[]).length).toBe(1);
  });

  it('uses the public Lyu Pro owner identity', () => {
    const owner = marketplace.owner as Record<string, unknown>;
    expect(owner).toBeTypeOf('object');
    expect(owner.name).toBe('Lyu Pro');
    expect(owner.email).toBe(EXPECTED_EMAIL);
  });

  it('lists the skillforge plugin from the published npm package', () => {
    const entry = (marketplace.plugins as Array<Record<string, unknown>>)[0];
    expect(entry.name).toBe('skillforge');
    const source = entry.source as Record<string, unknown>;
    expect(source.source).toBe('npm');
    expect(source.package).toBe(pkg.name);
    expect(source.package).toBe('@lyupro/skillforge-mcp');
  });

  it('is version-locked to package.json', () => {
    const entry = (marketplace.plugins as Array<Record<string, unknown>>)[0];
    expect(entry.version).toBe(pkg.version);
  });
});

describe('plugin packaging — contact email hygiene', () => {
  it('every email in plugin.json is the public address', () => {
    const emails = collectEmails(plugin);
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) {
      expect(email).toBe(EXPECTED_EMAIL);
    }
  });

  it('every email in marketplace.json is the public address', () => {
    const emails = collectEmails(marketplace);
    expect(emails.length).toBeGreaterThan(0);
    for (const email of emails) {
      expect(email).toBe(EXPECTED_EMAIL);
    }
  });
});
