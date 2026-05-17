#!/usr/bin/env node
/**
 * SkillForge MCP CLI dispatcher.
 *
 * Single entry point for the `skillforge-mcp` and `skillforge` bins. Routes
 * by the first positional argument so a single binary can act as both the
 * MCP stdio server and the install CLI.
 *
 *   skillforge-mcp install [flags]     Wire SkillForge into host configs
 *   skillforge-mcp uninstall [flags]   Reverse a previous install
 *   skillforge-mcp serve               Run the MCP stdio server (default)
 *   skillforge-mcp [no args]           Same as `serve`
 *   skillforge-mcp --help              Print combined usage
 *   skillforge-mcp --version           Print package version
 *
 * Why dispatcher exists:
 *   `npx @scope/foo <subcommand>` matches a single bin by the package's
 *   unscoped basename (`foo`). The earlier release shipped two separate
 *   bins (`skillforge-mcp` → server, `skillforge` → install CLI). The
 *   README-recommended `npx @lyupro/skillforge-mcp install --all` therefore
 *   resolved to the server bin, which silently waited on stdin while users
 *   thought the installer had hung. This dispatcher collapses both bins
 *   into one and routes by argv, so the documented quick-start works
 *   without an `--package=` override.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { main as installMain } from './install.js';
import { main as toolsMain } from './tools.js';
import { main as foldersMain } from './folders.js';
import { main as skillsMain } from './skills.js';

const USAGE = `skillforge-mcp — universal Skills MCP server + install CLI.

Usage:
  skillforge-mcp <command> [flags]

Commands:
  serve        Run the stdio MCP server. Default when no command is given.
                 Example: skillforge-mcp serve
  install      Wire SkillForge into Claude Code / Codex CLI / Cursor.
               Defaults to the host's global config; pass --scope project to
               edit a repo-local config rooted at the current directory.
               Run "skillforge-mcp install --help" for installer flags.
                 Example: skillforge-mcp install --all
                 Example: skillforge-mcp install --all --scope project
  uninstall    Reverse a previous install. Forwards to "install --uninstall".
               Accepts the same --scope global|project flag.
                 Example: skillforge-mcp uninstall --all
  tools        List the 5 MCP tools the server exposes (params + examples).
               Pass --json for machine-readable output.
                 Example: skillforge-mcp tools --json
  folders      Manage skill folders from the terminal (list/add/remove/reset).
               Run "skillforge-mcp folders" for sub-action usage.
                 Example: skillforge-mcp folders add ~/.lyupro/skills
  skills       View and reload skills from the terminal (list/get/reload).
               The CLI reads disk, not a live server session.
               Run "skillforge-mcp skills" for sub-action usage.
                 Example: skillforge-mcp skills list
                 Example: skillforge-mcp skills get code-review
                 Example: skillforge-mcp skills reload

Options:
  --help, -h   Show this message.
  --version, -v  Print the package version.
                 Example: skillforge-mcp --version

Quick start:
  npx -y @lyupro/skillforge-mcp install --all
  npx -y @lyupro/skillforge-mcp install --all --dry-run
`;

export async function readPackageVersion(): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/cli/dispatcher.js → package.json is two levels up.
  const pkgPath = resolve(here, '..', '..', 'package.json');
  const raw = await readFile(pkgPath, 'utf8');
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== 'string') {
    throw new Error('package.json missing string "version" field');
  }
  return parsed.version;
}

/**
 * True when this module file is the process entry point — robust to symlinked
 * bins. `npm install -g` installs the bin as a symlink (e.g.
 * `/usr/bin/skillforge-mcp` → `dist/cli/dispatcher.js`), so `process.argv[1]`
 * holds the symlink path while `import.meta.url` resolves to the real file.
 * A direct string compare of the two never matches under a global install,
 * which left the CLI a silent no-op on every Linux/macOS install. Both sides
 * are passed through `realpath` so the symlinked and direct-invocation cases
 * both resolve to the same canonical path.
 */
export function isMainModule(
  entryArg: string | undefined,
  moduleUrl: string,
): boolean {
  if (entryArg === undefined) return false;
  const modulePath = fileURLToPath(moduleUrl);
  if (entryArg === modulePath) return true;
  try {
    return realpathSync(entryArg) === realpathSync(modulePath);
  } catch {
    return false;
  }
}

export interface ServeDeps {
  start: () => Promise<void>;
}

async function defaultStartServe(): Promise<void> {
  const { buildDeps, buildServer } = await import('../server.js');
  const { startRuntime, registerShutdown } = await import('../runtime.js');
  const { StdioServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/stdio.js'
  );
  const deps = await buildDeps();
  const server = buildServer(deps);
  await server.connect(new StdioServerTransport());
  await startRuntime(deps);
  registerShutdown(deps);
}

/**
 * Dispatcher entry. Returns:
 *   - exit code (number) for install/uninstall/help/version/unknown — caller
 *     should `process.exit(code)`.
 *   - null for serve — caller must NOT call process.exit; the server keeps
 *     the event loop alive via stdio transport + signal handlers.
 */
export async function main(
  rawArgv: string[],
  overrides: { startServe?: () => Promise<void> } = {},
): Promise<number | null> {
  const first = rawArgv[0];

  if (first === '--help' || first === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (first === '--version' || first === '-v') {
    const version = await readPackageVersion();
    process.stdout.write(`${version}\n`);
    return 0;
  }
  if (first === 'install') {
    return installMain(rawArgv.slice(1));
  }
  if (first === 'uninstall') {
    return installMain(['--uninstall', ...rawArgv.slice(1)]);
  }
  if (first === 'tools') {
    return toolsMain(rawArgv.slice(1));
  }
  if (first === 'folders') {
    return foldersMain(rawArgv.slice(1));
  }
  if (first === 'skills') {
    return skillsMain(rawArgv.slice(1));
  }
  if (first === 'serve' || first === undefined) {
    const start = overrides.startServe ?? defaultStartServe;
    await start();
    return null;
  }

  process.stderr.write(
    `skillforge-mcp: unknown command: ${first}\n\n${USAGE}`,
  );
  return 2;
}

if (isMainModule(process.argv[1], import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      if (code !== null) process.exit(code);
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[skillforge-mcp] fatal: ${msg}`);
      process.exit(1);
    });
}
