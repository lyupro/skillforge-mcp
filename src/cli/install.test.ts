import { describe, it, expect, vi } from 'vitest';
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
