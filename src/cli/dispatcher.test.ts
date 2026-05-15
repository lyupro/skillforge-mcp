import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main, readPackageVersion } from './dispatcher.js';

describe('dispatcher.main', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let writes: string[] = [];
  let errors: string[] = [];

  beforeEach(() => {
    writes = [];
    errors = [];
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      }) as typeof process.stdout.write);
    stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(((chunk: string | Uint8Array): boolean => {
        errors.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      }) as typeof process.stderr.write);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe('--help / -h', () => {
    it('prints USAGE to stdout and returns 0', async () => {
      const code = await main(['--help']);
      expect(code).toBe(0);
      expect(writes.join('')).toContain('skillforge-mcp');
      expect(writes.join('')).toContain('install');
      expect(writes.join('')).toContain('serve');
    });

    it('-h short flag also prints USAGE', async () => {
      const code = await main(['-h']);
      expect(code).toBe(0);
      expect(writes.join('')).toContain('Commands:');
    });

    it('lists every command with a usage example', async () => {
      const code = await main(['--help']);
      expect(code).toBe(0);
      const out = writes.join('');
      for (const cmd of ['serve', 'install', 'uninstall', 'tools', '--version']) {
        expect(out).toContain(cmd);
      }
      expect(out).toContain('Example:');
    });

    it('documents the install --scope flag', async () => {
      const code = await main(['--help']);
      expect(code).toBe(0);
      expect(writes.join('')).toContain('--scope project');
    });
  });

  describe('--version / -v', () => {
    it('prints package version', async () => {
      const code = await main(['--version']);
      expect(code).toBe(0);
      const version = await readPackageVersion();
      expect(writes.join('')).toContain(version);
    });

    it('-v short flag also prints version', async () => {
      const code = await main(['-v']);
      expect(code).toBe(0);
      expect(writes.join('').trim()).toMatch(/^\d+\.\d+\.\d+/);
    });
  });

  describe('serve subcommand', () => {
    it('returns null when explicitly invoked', async () => {
      const startServe = vi.fn().mockResolvedValue(undefined);
      const result = await main(['serve'], { startServe });
      expect(result).toBeNull();
      expect(startServe).toHaveBeenCalledOnce();
    });

    it('returns null when no command given (default)', async () => {
      const startServe = vi.fn().mockResolvedValue(undefined);
      const result = await main([], { startServe });
      expect(result).toBeNull();
      expect(startServe).toHaveBeenCalledOnce();
    });
  });

  describe('install / uninstall subcommands', () => {
    it('install with no flags returns usage error 2', async () => {
      const code = await main(['install']);
      expect(code).toBe(2);
    });

    it('install --help returns 0', async () => {
      const code = await main(['install', '--help']);
      expect(code).toBe(0);
    });

    it('uninstall with no flags returns usage error 2', async () => {
      const code = await main(['uninstall']);
      expect(code).toBe(2);
    });
  });

  describe('tools subcommand', () => {
    it('routes to the tools handler and returns its exit code', async () => {
      const code = await main(['tools']);
      expect(code).toBe(0);
      expect(writes.join('')).toContain('skills__list');
    });

    it('forwards flags to the tools handler', async () => {
      const code = await main(['tools', '--json']);
      expect(code).toBe(0);
      const parsed = JSON.parse(writes.join('')) as { tools: unknown[] };
      expect(parsed.tools).toHaveLength(5);
    });
  });

  describe('folders subcommand', () => {
    it('routes to the folders handler and returns its exit code', async () => {
      const code = await main(['folders']);
      expect(code).toBe(2);
      expect(errors.join('')).toContain('skillforge folders');
    });
  });

  describe('unknown command', () => {
    it('returns exit code 2 and writes error', async () => {
      const code = await main(['weeble']);
      expect(code).toBe(2);
      const errOutput = errors.join('');
      expect(errOutput).toContain('unknown command: weeble');
      expect(errOutput).toContain('Usage:');
    });
  });
});

describe('readPackageVersion', () => {
  it('reads version string from package.json', async () => {
    const version = await readPackageVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
