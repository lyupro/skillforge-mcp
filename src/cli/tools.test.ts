import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { main, resolveTools } from './tools.js';

const TOOL_NAMES = [
  'skills__list',
  'skills__get',
  'skills__invoke',
  'skills__configure',
  'skills__reload',
];

async function readManifestTools(): Promise<Map<string, string>> {
  const here = dirname(fileURLToPath(import.meta.url));
  const manifestPath = resolve(here, '..', '..', 'manifest.json');
  const raw = await readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw) as { tools: Array<{ name: string; description: string }> };
  return new Map(parsed.tools.map((t) => [t.name, t.description]));
}

describe('tools.main — human-readable output', () => {
  it('contains all 5 tool names and returns 0', async () => {
    let out = '';
    const code = await main([], { stdout: (t) => (out += t) });
    expect(code).toBe(0);
    for (const name of TOOL_NAMES) {
      expect(out).toContain(name);
    }
  });

  it('contains each tool description from the manifest', async () => {
    let out = '';
    await main([], { stdout: (t) => (out += t) });
    const manifest = await readManifestTools();
    for (const name of TOOL_NAMES) {
      expect(out).toContain(manifest.get(name)!);
    }
  });

  it('lists parameters with required/optional markers', async () => {
    let out = '';
    await main([], { stdout: (t) => (out += t) });
    expect(out).toContain('Parameters:');
    expect(out).toContain('required');
    expect(out).toContain('optional');
    expect(out).toContain('Example:');
  });
});

describe('tools.main — --json output', () => {
  it('emits valid JSON with 5 entries and returns 0', async () => {
    let out = '';
    const code = await main(['--json'], { stdout: (t) => (out += t) });
    expect(code).toBe(0);
    const parsed = JSON.parse(out) as {
      tools: Array<{ name: string; description: string; params: unknown[]; example: string }>;
    };
    expect(parsed.tools).toHaveLength(5);
    expect(parsed.tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    for (const tool of parsed.tools) {
      expect(typeof tool.description).toBe('string');
      expect(Array.isArray(tool.params)).toBe(true);
      expect(typeof tool.example).toBe('string');
    }
  });

  it('JSON descriptions match manifest.json#tools[]', async () => {
    let out = '';
    await main(['--json'], { stdout: (t) => (out += t) });
    const parsed = JSON.parse(out) as {
      tools: Array<{ name: string; description: string }>;
    };
    const manifest = await readManifestTools();
    for (const tool of parsed.tools) {
      expect(tool.description).toBe(manifest.get(tool.name));
    }
  });
});

describe('tools.main — flag handling', () => {
  it('rejects an unknown flag with exit code 2', async () => {
    let err = '';
    const code = await main(['--bogus'], { stderr: (t) => (err += t) });
    expect(code).toBe(2);
    expect(err).toContain('unknown flag');
  });
});

describe('resolveTools — drift guard', () => {
  it('every tool description equals the manifest entry', async () => {
    const tools = await resolveTools();
    const manifest = await readManifestTools();
    expect(tools).toHaveLength(5);
    for (const tool of tools) {
      expect(tool.description).toBe(manifest.get(tool.name));
    }
  });
});
