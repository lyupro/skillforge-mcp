#!/usr/bin/env node
/**
 * SkillForge `tools` subcommand.
 *
 * Prints the 5 MCP tools the stdio server exposes to an LLM client —
 * name, description, parameters, and a short example invocation.
 *
 * Descriptions are NOT hand-written here: they are sourced at runtime
 * from `manifest.json#tools[]` (the authoritative surface). The static
 * PARAM table below carries only parameter metadata + examples; a test
 * (`tools.test.ts`) asserts every entry's `name` lines up with the
 * manifest so the two cannot drift.
 *
 * Usage:
 *   skillforge-mcp tools          Human-readable reference
 *   skillforge-mcp tools --json   Machine-readable JSON ({ tools: [...] })
 */

/** A single tool parameter, as declared by its Zod input schema. */
export interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  note: string;
}

/** Static reference for one MCP tool (params + example, no description). */
interface ToolRef {
  name: string;
  params: ToolParam[];
  example: string;
}

/**
 * Parameter metadata for the 5 MCP tools. Sourced from the Zod input
 * schemas in `src/tools/*.ts`. Descriptions are intentionally absent —
 * they come from the manifest at runtime.
 */
const TOOL_REFS: ToolRef[] = [
  {
    name: 'skills__list',
    params: [
      { name: 'folder', type: 'string', required: false, note: 'Restrict to one configured folder.' },
      { name: 'search', type: 'string', required: false, note: 'Case-insensitive substring over name + description.' },
      {
        name: 'source',
        type: "'claude' | 'codex' | 'persona' | 'custom'",
        required: false,
        note: 'Filter by skill format.',
      },
    ],
    example: '{ "search": "review" }',
  },
  {
    name: 'skills__get',
    params: [{ name: 'name', type: 'string', required: true, note: 'Exact skill name to retrieve.' }],
    example: '{ "name": "code-review" }',
  },
  {
    name: 'skills__invoke',
    params: [
      { name: 'name', type: 'string', required: true, note: 'Exact skill name to invoke.' },
      { name: 'input', type: 'string', required: false, note: 'Optional input forwarded to the skill (default "").' },
    ],
    example: '{ "name": "code-review", "input": "diff against main" }',
  },
  {
    name: 'skills__configure',
    params: [
      {
        name: 'action',
        type: "'add_folder' | 'remove_folder' | 'list_folders' | 'set_blacklist' | 'get_blacklist' | 'reset'",
        required: true,
        note: 'Which configuration action to run.',
      },
      { name: 'folder', type: 'string', required: false, note: 'Folder path — required by add_folder / remove_folder.' },
      {
        name: 'alias',
        type: 'string',
        required: false,
        note: 'Optional kebab-case alias for the folder — used by add_folder.',
      },
      {
        name: 'blacklist',
        type: 'string[]',
        required: false,
        note: 'Blacklist patterns — required by set_blacklist.',
      },
    ],
    example: '{ "action": "add_folder", "folder": "/abs/path/to/skills" }',
  },
  {
    name: 'skills__reload',
    params: [
      {
        name: 'folder',
        type: 'string',
        required: false,
        note: 'Validate this folder is configured before the full rescan.',
      },
    ],
    example: '{}',
  },
];

/** Resolve manifest.json relative to this module (dist/cli/tools.js → ../../manifest.json). */
async function readManifestTools(): Promise<Map<string, string>> {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const manifestPath = resolve(here, '..', '..', 'manifest.json');
  const raw = await readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw) as { tools?: unknown };
  if (!Array.isArray(parsed.tools)) {
    throw new Error('manifest.json missing "tools" array');
  }
  const map = new Map<string, string>();
  for (const entry of parsed.tools) {
    const t = entry as { name?: unknown; description?: unknown };
    if (typeof t.name !== 'string' || typeof t.description !== 'string') {
      throw new Error('manifest.json tools[] entry missing string name/description');
    }
    map.set(t.name, t.description);
  }
  return map;
}

/** A fully-resolved tool record (description merged in from the manifest). */
export interface ResolvedTool extends ToolRef {
  description: string;
}

/** Merge the static param refs with manifest descriptions; throws if a tool is missing. */
export async function resolveTools(): Promise<ResolvedTool[]> {
  const descriptions = await readManifestTools();
  return TOOL_REFS.map((ref) => {
    const description = descriptions.get(ref.name);
    if (description === undefined) {
      throw new Error(`manifest.json has no tools[] entry for "${ref.name}"`);
    }
    return { ...ref, description };
  });
}

function formatHuman(tools: ResolvedTool[]): string {
  const lines: string[] = ['SkillForge MCP — tools exposed to the LLM client.', ''];
  for (const tool of tools) {
    lines.push(tool.name);
    lines.push(`  ${tool.description}`);
    lines.push('  Parameters:');
    if (tool.params.length === 0) {
      lines.push('    (none)');
    } else {
      for (const p of tool.params) {
        const flag = p.required ? 'required' : 'optional';
        lines.push(`    ${p.name} (${p.type}, ${flag}) — ${p.note}`);
      }
    }
    lines.push(`  Example: ${tool.example}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export interface ToolsDeps {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

/**
 * `tools` subcommand entry. Returns an exit code:
 *   - 0 on success
 *   - 2 on an unknown flag
 *   - 1 on an unexpected failure
 */
export async function main(rawArgv: string[], deps: ToolsDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text));

  let asJson = false;
  for (const arg of rawArgv) {
    if (arg === '--json') {
      asJson = true;
    } else {
      stderr(`skillforge-mcp tools: unknown flag: ${arg}\n`);
      return 2;
    }
  }

  try {
    const tools = await resolveTools();
    if (asJson) {
      stdout(`${JSON.stringify({ tools }, null, 2)}\n`);
    } else {
      stdout(formatHuman(tools));
    }
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr(`skillforge-mcp tools: ${msg}\n`);
    return 1;
  }
}
