#!/usr/bin/env node
/**
 * SkillForge install CLI (v1.1).
 *
 * Wires SkillForge MCP into Claude Code, Codex CLI, and Cursor by editing
 * each host's config file. Manual argv parsing — no `commander` dep.
 *
 * Usage:
 *   skillforge install --claude
 *   skillforge install --codex --cursor
 *   skillforge install --all
 *   skillforge install --all --dry-run
 *   skillforge install --claude --uninstall
 *   skillforge install --all --entry local --binary-path /abs/path/to/server.js
 *   skillforge install --claude --force
 */

import { getAllInstallers, getInstallerByName } from '../installers/registry.js';
import type {
  Installer,
  InstallOptions,
  InstallResult,
  PreviewResult,
  UninstallResult,
} from '../installers/types.js';

export interface ParsedArgs {
  claude: boolean;
  codex: boolean;
  cursor: boolean;
  all: boolean;
  dryRun: boolean;
  uninstall: boolean;
  force: boolean;
  entry: 'npx' | 'local';
  binaryPath?: string;
  showHelp: boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

const USAGE = `skillforge install — wire SkillForge MCP into Claude Code / Codex CLI / Cursor.

Usage:
  skillforge install [flags]

Targets (at least one required, unless --help):
  --claude            Edit ~/.claude.json
  --codex             Edit ~/.codex/config.toml
  --cursor            Edit Cursor's settings.json (OS-specific path)
  --all               Auto-detect installed hosts and install into each

Modes:
  --dry-run           Print intended edits, do not touch disk
  --uninstall         Reverse a previous install
  --force             Overwrite an existing SkillForge entry

Entry shape:
  --entry npx         (default) command=npx args=['-y','@lyupro/skillforge-mcp']
  --entry local       command=node args=[<binary-path>]
  --binary-path PATH  Override the local-entry binary path (defaults to dist/server.js)

  --help, -h          Show this message
`;

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    claude: false,
    codex: false,
    cursor: false,
    all: false,
    dryRun: false,
    uninstall: false,
    force: false,
    entry: 'npx',
    showHelp: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--claude':
        out.claude = true;
        break;
      case '--codex':
        out.codex = true;
        break;
      case '--cursor':
        out.cursor = true;
        break;
      case '--all':
        out.all = true;
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      case '--uninstall':
        out.uninstall = true;
        break;
      case '--force':
        out.force = true;
        break;
      case '--help':
      case '-h':
        out.showHelp = true;
        break;
      case '--entry': {
        const next = argv[++i];
        if (next !== 'npx' && next !== 'local') {
          throw new UsageError(`--entry must be 'npx' or 'local' (got: ${String(next)})`);
        }
        out.entry = next;
        break;
      }
      case '--binary-path': {
        const next = argv[++i];
        if (next === undefined || next.startsWith('--')) {
          throw new UsageError(`--binary-path requires a path argument`);
        }
        out.binaryPath = next;
        break;
      }
      default:
        throw new UsageError(`Unknown flag: ${arg}`);
    }
  }

  return out;
}

export interface RunDeps {
  installers?: Installer[];
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

function chooseInstallers(args: ParsedArgs, all: Installer[]): Installer[] {
  if (args.all) return all;
  const picked: Installer[] = [];
  if (args.claude) picked.push(all.find((i) => i.name === 'claude') ?? getInstallerByName('claude'));
  if (args.codex) picked.push(all.find((i) => i.name === 'codex') ?? getInstallerByName('codex'));
  if (args.cursor) picked.push(all.find((i) => i.name === 'cursor') ?? getInstallerByName('cursor'));
  return picked;
}

function formatInstall(r: InstallResult): string {
  const tag = r.status.toUpperCase();
  const msg = r.message !== undefined ? ` (${r.message})` : '';
  return `[${r.tool}] ${tag} ${r.configPath}${msg}`;
}

function formatUninstall(r: UninstallResult): string {
  const tag = r.status.toUpperCase();
  const msg = r.message !== undefined ? ` (${r.message})` : '';
  return `[${r.tool}] ${tag} ${r.configPath}${msg}`;
}

function formatPreview(r: PreviewResult): string {
  const lines = [
    `--- DRY RUN [${r.tool}] action=${r.action} configPath=${r.configPath} willCreate=${r.willCreate}`,
    `--- before:`,
    r.before ?? '(file does not exist)',
    `--- after:`,
    r.after,
  ];
  return lines.join('\n');
}

export async function runInstall(args: ParsedArgs, deps: RunDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((line: string) => console.log(line));
  const stderr = deps.stderr ?? ((line: string) => console.error(line));

  if (args.showHelp) {
    stdout(USAGE);
    return 0;
  }
  if (!args.all && !args.claude && !args.codex && !args.cursor) {
    stderr(USAGE);
    stderr('\nError: choose at least one of --claude / --codex / --cursor / --all');
    return 2;
  }

  const allInstallers = deps.installers ?? getAllInstallers();
  let installers = chooseInstallers(args, allInstallers);

  if (args.all) {
    const detected: Installer[] = [];
    for (const inst of installers) {
      if (await inst.detect()) detected.push(inst);
    }
    if (detected.length === 0) {
      stderr('No supported hosts detected (claude / codex / cursor). Pass --claude / --codex / --cursor explicitly to force.');
      return 1;
    }
    installers = detected;
  }

  const opts: InstallOptions = {
    entry: args.entry,
    binaryPath: args.binaryPath,
    force: args.force,
  };

  let exit = 0;
  for (const inst of installers) {
    try {
      if (args.dryRun) {
        const preview = await inst.preview({ ...opts, action: args.uninstall ? 'uninstall' : 'install' });
        stdout(formatPreview(preview));
      } else if (args.uninstall) {
        const result = await inst.uninstall();
        stdout(formatUninstall(result));
      } else {
        const result = await inst.install(opts);
        stdout(formatInstall(result));
        if (result.status === 'already-installed') exit = exit === 0 ? 0 : exit;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stderr(`[${inst.name}] error: ${msg}`);
      exit = 1;
    }
  }
  return exit;
}

export async function main(rawArgv: string[]): Promise<number> {
  try {
    const args = parseArgs(rawArgv);
    return await runInstall(args);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(USAGE);
      console.error(`\nError: ${err.message}`);
      return 2;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`skillforge install: fatal: ${msg}`);
    return 1;
  }
}

import { fileURLToPath } from 'node:url';
const isDirectRun =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  // First positional arg may be the subcommand "install" — strip it if present
  // so users can invoke as `skillforge install --claude` or `skillforge-install --claude`.
  const argv = process.argv.slice(2);
  const stripped = argv[0] === 'install' ? argv.slice(1) : argv;
  main(stripped).then((code) => process.exit(code));
}
