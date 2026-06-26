import { describe, it, expect, vi } from 'vitest';
import { main, type UpdateDeps } from './update.js';

/** Build deps with a fixed current/latest pair and capturing stdout/stderr. */
function harness(
  opts: {
    current?: string;
    latest?: string;
    name?: string;
    fetchLatest?: UpdateDeps['fetchLatest'];
    runUpgrade?: UpdateDeps['runUpgrade'];
  } = {},
) {
  let out = '';
  let err = '';
  const runUpgrade = opts.runUpgrade ?? vi.fn(async () => 0);
  const deps: UpdateDeps = {
    stdout: (t) => (out += t),
    stderr: (t) => (err += t),
    readMeta: async () => ({ name: opts.name ?? '@lyupro/skillforge-mcp', version: opts.current ?? '1.10.0' }),
    fetchLatest: opts.fetchLatest ?? (async () => opts.latest ?? '1.11.0'),
    runUpgrade,
  };
  return { deps, runUpgrade, out: () => out, err: () => err };
}

describe('update.main — check / report', () => {
  it('up to date → ✓ message, exit 0, no install', async () => {
    const h = harness({ current: '1.11.0', latest: '1.11.0' });
    const code = await main([], h.deps);
    expect(code).toBe(0);
    expect(h.out()).toContain('up to date');
    expect(h.out()).toContain('1.11.0');
    expect(h.runUpgrade).not.toHaveBeenCalled();
  });

  it('--check with newer available → reports gap, exit 0, no install', async () => {
    const h = harness({ current: '1.10.0', latest: '1.11.0' });
    const code = await main(['--check'], h.deps);
    expect(code).toBe(0);
    expect(h.out()).toContain('update available: 1.10.0 → 1.11.0');
    expect(h.runUpgrade).not.toHaveBeenCalled();
  });

  it('--check when up to date → up-to-date message, exit 0', async () => {
    const h = harness({ current: '2.0.0', latest: '2.0.0' });
    const code = await main(['--check'], h.deps);
    expect(code).toBe(0);
    expect(h.out()).toContain('up to date');
  });

  it('treats an older registry latest as up to date (no downgrade)', async () => {
    const h = harness({ current: '1.11.0', latest: '1.10.0' });
    const code = await main([], h.deps);
    expect(code).toBe(0);
    expect(h.out()).toContain('up to date');
    expect(h.runUpgrade).not.toHaveBeenCalled();
  });
});

describe('update.main — --json', () => {
  it('emits { current, latest, updateAvailable } and exits 0 without install', async () => {
    const h = harness({ current: '1.10.0', latest: '1.11.0' });
    const code = await main(['--json'], h.deps);
    expect(code).toBe(0);
    const parsed = JSON.parse(h.out()) as { current: string; latest: string; updateAvailable: boolean };
    expect(parsed).toEqual({ current: '1.10.0', latest: '1.11.0', updateAvailable: true });
    expect(h.runUpgrade).not.toHaveBeenCalled();
  });

  it('updateAvailable false when equal', async () => {
    const h = harness({ current: '1.11.0', latest: '1.11.0' });
    await main(['--json'], h.deps);
    const parsed = JSON.parse(h.out()) as { updateAvailable: boolean };
    expect(parsed.updateAvailable).toBe(false);
  });
});

describe('update.main — apply', () => {
  it('runs npm install -g <name>@latest on a newer version', async () => {
    const runUpgrade = vi.fn(async () => 0);
    const h = harness({ current: '1.10.0', latest: '1.11.0', name: '@lyupro/skillforge-mcp', runUpgrade });
    const code = await main([], h.deps);
    expect(code).toBe(0);
    expect(runUpgrade).toHaveBeenCalledWith('npm', ['install', '-g', '@lyupro/skillforge-mcp@latest']);
    expect(h.out()).toContain('updated to 1.11.0');
  });

  it('reads the package name from meta, not a literal', async () => {
    const runUpgrade = vi.fn(async () => 0);
    const h = harness({ current: '1.0.0', latest: '2.0.0', name: '@scope/renamed-pkg', runUpgrade });
    await main([], h.deps);
    expect(runUpgrade).toHaveBeenCalledWith('npm', ['install', '-g', '@scope/renamed-pkg@latest']);
  });

  it('permission/install failure → fail-loud with sudo hint, exit non-zero', async () => {
    const runUpgrade = vi.fn(async () => 243);
    const h = harness({ current: '1.10.0', latest: '1.11.0', runUpgrade });
    const code = await main([], h.deps);
    expect(code).toBe(243);
    expect(h.err()).toContain('update failed');
    expect(h.err()).toContain('npm install -g @lyupro/skillforge-mcp@latest');
    expect(h.err()).toContain('sudo npm install -g @lyupro/skillforge-mcp@latest');
  });

  it('spawn error → fail-loud, exit 1', async () => {
    const runUpgrade = vi.fn(async () => {
      throw new Error('spawn npm ENOENT');
    });
    const h = harness({ current: '1.10.0', latest: '1.11.0', runUpgrade });
    const code = await main([], h.deps);
    expect(code).toBe(1);
    expect(h.err()).toContain('spawn npm ENOENT');
    expect(h.err()).toContain('sudo');
  });
});

describe('update.main — --dry-run', () => {
  it('prints the command without running it, exit 0', async () => {
    const runUpgrade = vi.fn(async () => 0);
    const h = harness({ current: '1.10.0', latest: '1.11.0', runUpgrade });
    const code = await main(['--dry-run'], h.deps);
    expect(code).toBe(0);
    expect(h.out()).toContain('Would run: npm install -g @lyupro/skillforge-mcp@latest');
    expect(runUpgrade).not.toHaveBeenCalled();
  });

  it('dry-run when up to date → up-to-date message, no command', async () => {
    const h = harness({ current: '1.11.0', latest: '1.11.0' });
    const code = await main(['--dry-run'], h.deps);
    expect(code).toBe(0);
    expect(h.out()).toContain('up to date');
    expect(h.out()).not.toContain('Would run');
  });
});

describe('update.main — registry / network', () => {
  it('network error → clear message, exit 1', async () => {
    const h = harness({
      fetchLatest: async () => {
        throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org');
      },
    });
    const code = await main([], h.deps);
    expect(code).toBe(1);
    expect(h.err()).toContain('failed to check for updates');
    expect(h.err()).toContain('ENOTFOUND');
  });

  it('--registry override is forwarded to fetchLatest', async () => {
    const fetchLatest = vi.fn(async () => '1.11.0');
    const h = harness({ current: '1.10.0', fetchLatest });
    await main(['--check', '--registry', 'https://npm.internal'], h.deps);
    expect(fetchLatest).toHaveBeenCalledWith('@lyupro/skillforge-mcp', 'https://npm.internal');
  });

  it('--registry without a value → exit 2', async () => {
    const h = harness();
    const code = await main(['--registry'], h.deps);
    expect(code).toBe(2);
    expect(h.err()).toContain('--registry requires a URL');
  });
});

describe('update.main — flags / usage', () => {
  it('--help prints usage and exits 0', async () => {
    const h = harness();
    const code = await main(['--help'], h.deps);
    expect(code).toBe(0);
    expect(h.out()).toContain('skillforge update');
    expect(h.out()).toContain('--dry-run');
  });

  it('unknown flag → exit 2 with usage', async () => {
    const h = harness();
    const code = await main(['--bogus'], h.deps);
    expect(code).toBe(2);
    expect(h.err()).toContain('unknown flag');
  });
});
