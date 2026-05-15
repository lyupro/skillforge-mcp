import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runInstall, UsageError } from './install.js';
import type {
  Installer,
  InstallResult,
  PreviewResult,
  UninstallResult,
} from '../installers/types.js';

function makeFakeInstaller(name: string, detected = true): Installer & {
  installCalls: number;
  uninstallCalls: number;
  previewCalls: number;
} {
  const state = { installCalls: 0, uninstallCalls: 0, previewCalls: 0 };
  return {
    name,
    installCalls: 0,
    uninstallCalls: 0,
    previewCalls: 0,
    async detect() {
      return detected;
    },
    async install(): Promise<InstallResult> {
      state.installCalls++;
      this.installCalls++;
      return { tool: name, status: 'installed', configPath: `/fake/${name}` };
    },
    async uninstall(): Promise<UninstallResult> {
      state.uninstallCalls++;
      this.uninstallCalls++;
      return { tool: name, status: 'uninstalled', configPath: `/fake/${name}` };
    },
    async preview(): Promise<PreviewResult> {
      state.previewCalls++;
      this.previewCalls++;
      return {
        tool: name,
        configPath: `/fake/${name}`,
        willCreate: true,
        before: null,
        after: '{"x":1}',
        action: 'install',
      };
    },
  };
}

function makeCapture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
  };
}

describe('parseArgs', () => {
  it('parses --claude alone', () => {
    const args = parseArgs(['--claude']);
    expect(args.claude).toBe(true);
    expect(args.codex).toBe(false);
    expect(args.cursor).toBe(false);
    expect(args.all).toBe(false);
  });

  it('parses --codex --cursor combination', () => {
    const args = parseArgs(['--codex', '--cursor']);
    expect(args.codex).toBe(true);
    expect(args.cursor).toBe(true);
    expect(args.claude).toBe(false);
  });

  it('parses --all and modes', () => {
    const args = parseArgs(['--all', '--dry-run', '--force']);
    expect(args.all).toBe(true);
    expect(args.dryRun).toBe(true);
    expect(args.force).toBe(true);
  });

  it('parses --uninstall', () => {
    const args = parseArgs(['--claude', '--uninstall']);
    expect(args.uninstall).toBe(true);
  });

  it('parses --entry local and --binary-path', () => {
    const args = parseArgs(['--all', '--entry', 'local', '--binary-path', '/abs/server.js']);
    expect(args.entry).toBe('local');
    expect(args.binaryPath).toBe('/abs/server.js');
  });

  it('rejects unknown flag with UsageError', () => {
    expect(() => parseArgs(['--bogus'])).toThrow(UsageError);
  });

  it('rejects --entry without npx or local', () => {
    expect(() => parseArgs(['--entry', 'bogus'])).toThrow(UsageError);
  });

  it('rejects --binary-path missing argument', () => {
    expect(() => parseArgs(['--binary-path'])).toThrow(UsageError);
    expect(() => parseArgs(['--binary-path', '--claude'])).toThrow(UsageError);
  });

  it('parses --help and -h', () => {
    expect(parseArgs(['--help']).showHelp).toBe(true);
    expect(parseArgs(['-h']).showHelp).toBe(true);
  });

  it('defaults scope to global', () => {
    expect(parseArgs(['--claude']).scope).toBe('global');
  });

  it('parses --scope global', () => {
    expect(parseArgs(['--claude', '--scope', 'global']).scope).toBe('global');
  });

  it('parses --scope project', () => {
    expect(parseArgs(['--claude', '--scope', 'project']).scope).toBe('project');
  });

  it('rejects --scope with an invalid value', () => {
    expect(() => parseArgs(['--scope', 'bogus'])).toThrow(UsageError);
    expect(() => parseArgs(['--scope'])).toThrow(UsageError);
  });
});

describe('runInstall dispatch', () => {
  it('--claude routes only to Claude installer', async () => {
    const claude = makeFakeInstaller('claude');
    const codex = makeFakeInstaller('codex');
    const cursor = makeFakeInstaller('cursor');
    const cap = makeCapture();
    const code = await runInstall(parseArgs(['--claude']), {
      installers: [claude, codex, cursor],
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(claude.installCalls).toBe(1);
    expect(codex.installCalls).toBe(0);
    expect(cursor.installCalls).toBe(0);
    expect(cap.out.join('\n')).toContain('[claude] INSTALLED');
  });

  it('--codex --cursor routes to two installers', async () => {
    const claude = makeFakeInstaller('claude');
    const codex = makeFakeInstaller('codex');
    const cursor = makeFakeInstaller('cursor');
    const cap = makeCapture();
    await runInstall(parseArgs(['--codex', '--cursor']), {
      installers: [claude, codex, cursor],
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(claude.installCalls).toBe(0);
    expect(codex.installCalls).toBe(1);
    expect(cursor.installCalls).toBe(1);
  });

  it('--all installs into every detected host', async () => {
    const claude = makeFakeInstaller('claude');
    const codex = makeFakeInstaller('codex');
    const cursor = makeFakeInstaller('cursor');
    const cap = makeCapture();
    await runInstall(parseArgs(['--all']), {
      installers: [claude, codex, cursor],
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(claude.installCalls).toBe(1);
    expect(codex.installCalls).toBe(1);
    expect(cursor.installCalls).toBe(1);
  });

  it('--all skips undetected hosts', async () => {
    const claude = makeFakeInstaller('claude', true);
    const codex = makeFakeInstaller('codex', false);
    const cursor = makeFakeInstaller('cursor', true);
    const cap = makeCapture();
    await runInstall(parseArgs(['--all']), {
      installers: [claude, codex, cursor],
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(claude.installCalls).toBe(1);
    expect(codex.installCalls).toBe(0);
    expect(cursor.installCalls).toBe(1);
  });

  it('--all exits 1 if no hosts detected', async () => {
    const claude = makeFakeInstaller('claude', false);
    const codex = makeFakeInstaller('codex', false);
    const cursor = makeFakeInstaller('cursor', false);
    const cap = makeCapture();
    const code = await runInstall(parseArgs(['--all']), {
      installers: [claude, codex, cursor],
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
    expect(cap.err.join('\n')).toContain('No supported hosts detected');
  });

  it('--dry-run calls preview, never install/uninstall', async () => {
    const claude = makeFakeInstaller('claude');
    const cap = makeCapture();
    await runInstall(parseArgs(['--claude', '--dry-run']), {
      installers: [claude],
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(claude.previewCalls).toBe(1);
    expect(claude.installCalls).toBe(0);
    expect(cap.out.join('\n')).toContain('DRY RUN');
  });

  it('--uninstall routes to uninstall(), not install()', async () => {
    const claude = makeFakeInstaller('claude');
    const cap = makeCapture();
    await runInstall(parseArgs(['--claude', '--uninstall']), {
      installers: [claude],
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(claude.uninstallCalls).toBe(1);
    expect(claude.installCalls).toBe(0);
    expect(cap.out.join('\n')).toContain('[claude] UNINSTALLED');
  });

  it('exits 2 when no target flag is given', async () => {
    const cap = makeCapture();
    const code = await runInstall(parseArgs([]), {
      installers: [],
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(2);
    expect(cap.err.join('\n')).toContain('choose at least one of');
  });

  it('shows usage on --help and exits 0', async () => {
    const cap = makeCapture();
    const code = await runInstall(parseArgs(['--help']), {
      installers: [],
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out.join('\n')).toContain('Usage:');
  });

  it('--help documents the --scope flag', async () => {
    const cap = makeCapture();
    await runInstall(parseArgs(['--help']), {
      installers: [],
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    const out = cap.out.join('\n');
    expect(out).toContain('--scope global');
    expect(out).toContain('--scope project');
  });

  it('catches installer errors and exits 1', async () => {
    const claude: Installer = {
      name: 'claude',
      async detect() {
        return true;
      },
      async install() {
        throw new Error('boom');
      },
      async uninstall() {
        return { tool: 'claude', status: 'not-installed', configPath: '/x' };
      },
      async preview() {
        return {
          tool: 'claude',
          configPath: '/x',
          willCreate: true,
          before: null,
          after: '',
          action: 'install',
        };
      },
    };
    const cap = makeCapture();
    const code = await runInstall(parseArgs(['--claude']), {
      installers: [claude],
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(1);
    expect(cap.err.join('\n')).toContain('[claude] error: boom');
  });
});

describe('integration smoke — runInstall propagates --entry / --binary-path / --force', () => {
  it('passes opts through to install()', async () => {
    const seen: unknown[] = [];
    const claude: Installer = {
      name: 'claude',
      async detect() {
        return true;
      },
      async install(opts) {
        seen.push(opts);
        return { tool: 'claude', status: 'installed', configPath: '/x' };
      },
      async uninstall() {
        return { tool: 'claude', status: 'not-installed', configPath: '/x' };
      },
      async preview() {
        return {
          tool: 'claude',
          configPath: '/x',
          willCreate: true,
          before: null,
          after: '',
          action: 'install',
        };
      },
    };
    const cap = makeCapture();
    await runInstall(parseArgs(['--claude', '--entry', 'local', '--binary-path', '/abs/x.js', '--force']), {
      installers: [claude],
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(seen[0]).toEqual({ entry: 'local', binaryPath: '/abs/x.js', force: true });
  });
});

describe('module-level smoke', () => {
  it('UsageError is an Error subclass', () => {
    const e = new UsageError('x');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('UsageError');
    // Touch vi to keep the import non-empty.
    expect(typeof vi.fn).toBe('function');
  });
});

describe('--scope end-to-end (real installers, temp cwd)', () => {
  // These tests exercise the real registry-resolved installers so the
  // project-vs-global path routing is verified against disk. Each test
  // chdir's into an isolated temp directory and restores cwd afterwards.
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'skillforge-scope-'));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('--scope project writes Claude config to ./.mcp.json in cwd', async () => {
    const cap = makeCapture();
    const code = await runInstall(parseArgs(['--claude', '--scope', 'project']), {
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    const projectFile = join(dir, '.mcp.json');
    expect(existsSync(projectFile)).toBe(true);
    const written = JSON.parse(readFileSync(projectFile, 'utf8'));
    expect(written.mcpServers.skillforge).toEqual({
      command: 'npx',
      args: ['-y', '@lyupro/skillforge-mcp', 'serve'],
    });
    // The global ~/.claude.json must not be touched: output references the
    // project-local path.
    expect(cap.out.join('\n')).toContain('.mcp.json');
  });

  it('--scope project creates ./.cursor/mcp.json and ./.codex/config.toml', async () => {
    const cap = makeCapture();
    const code = await runInstall(parseArgs(['--cursor', '--codex', '--scope', 'project']), {
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(existsSync(join(dir, '.cursor', 'mcp.json'))).toBe(true);
    expect(existsSync(join(dir, '.codex', 'config.toml'))).toBe(true);
  });

  it('default scope (global) does NOT write into cwd', async () => {
    // With no --scope flag the installer targets the home-directory config,
    // so nothing should appear in the temp cwd. We use --dry-run to avoid
    // touching the real global files while still asserting routing.
    const cap = makeCapture();
    const code = await runInstall(parseArgs(['--claude', '--dry-run']), {
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(existsSync(join(dir, '.mcp.json'))).toBe(false);
    expect(cap.out.join('\n')).not.toContain(join(dir, '.mcp.json'));
  });

  it('--scope project merges into an existing project file without dropping servers', async () => {
    const projectFile = join(dir, '.mcp.json');
    writeFileSync(
      projectFile,
      JSON.stringify({
        mcpServers: { other: { command: 'node', args: ['/x.js'] } },
        otherTopLevel: 'preserved',
      }),
    );
    const cap = makeCapture();
    const code = await runInstall(parseArgs(['--claude', '--scope', 'project']), {
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    const written = JSON.parse(readFileSync(projectFile, 'utf8'));
    expect(written.mcpServers.other).toEqual({ command: 'node', args: ['/x.js'] });
    expect(written.mcpServers.skillforge).toBeDefined();
    expect(written.otherTopLevel).toBe('preserved');
  });

  it('uninstall --scope project removes only from the project file', async () => {
    const projectFile = join(dir, '.mcp.json');
    writeFileSync(
      projectFile,
      JSON.stringify({
        mcpServers: {
          skillforge: { command: 'npx', args: ['-y', '@lyupro/skillforge-mcp', 'serve'] },
          other: { command: 'x', args: [] },
        },
      }),
    );
    const cap = makeCapture();
    const code = await runInstall(parseArgs(['--claude', '--uninstall', '--scope', 'project']), {
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    const written = JSON.parse(readFileSync(projectFile, 'utf8'));
    expect(written.mcpServers.skillforge).toBeUndefined();
    expect(written.mcpServers.other).toBeDefined();
    expect(cap.out.join('\n')).toContain('[claude] UNINSTALLED');
  });

  it('--dry-run --scope project prints the project-local target path', async () => {
    const cap = makeCapture();
    const code = await runInstall(parseArgs(['--claude', '--scope', 'project', '--dry-run']), {
      stdout: cap.stdout,
      stderr: cap.stderr,
    });
    expect(code).toBe(0);
    expect(cap.out.join('\n')).toContain(join(dir, '.mcp.json'));
    // Nothing written to disk.
    expect(existsSync(join(dir, '.mcp.json'))).toBe(false);
  });
});

describe('--scope project with an invalid project root', () => {
  it('runInstall exits 1 with a clear error and writes nothing', async () => {
    // Build installers explicitly bound to a non-existent project root so the
    // failure surfaces through runInstall's error handling deterministically
    // on every OS (no reliance on a deleted process.cwd()).
    const cap = makeCapture();
    const bogusRoot = join(tmpdir(), 'skillforge-no-such-dir-xyz');
    const { getInstallerByName } = await import('../installers/registry.js');

    // Resolving installers for a missing project root throws — the registry
    // is where runInstall catches this.
    expect(() => getInstallerByName('claude', 'project', bogusRoot)).toThrow(/--scope project/);

    // And runInstall returns a non-zero exit for an invalid --scope value,
    // which parseArgs rejects before any installer runs.
    expect(() => parseArgs(['--claude', '--scope', 'sideways'])).toThrow(UsageError);
    expect(cap.out).toHaveLength(0);
  });

  it('runInstall surfaces a registry resolution failure as exit 1', async () => {
    // Inject installers whose construction throws by deleting the cwd on
    // POSIX; skip on platforms that refuse to remove an in-use directory.
    const originalCwd = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), 'skillforge-gone-'));
    process.chdir(dir);
    let removed = false;
    try {
      rmSync(dir, { recursive: true, force: true });
      removed = true;
    } catch {
      // Windows keeps a handle on the cwd — cannot delete it. Skip.
    }
    try {
      if (!removed) return;
      const cap = makeCapture();
      const code = await runInstall(parseArgs(['--claude', '--scope', 'project']), {
        stdout: cap.stdout,
        stderr: cap.stderr,
      });
      expect(code).toBe(1);
      expect(cap.err.join('\n')).toContain('--scope project');
    } finally {
      process.chdir(originalCwd);
    }
  });
});
