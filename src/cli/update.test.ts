import { describe, it, expect, vi } from 'vitest';
import { main, type UpdateDeps } from './update.js';

/**
 * Build deps with a fixed current/latest pair and capturing stdout/stderr.
 * Pre-flight deps default to a no-op shape (writable prefix, no cooldown, no
 * uid) so report/apply tests never touch a real npm / fs / clock; detection
 * tests override the specific knob they exercise.
 */
function harness(
  opts: {
    current?: string;
    latest?: string;
    name?: string;
    publishedAt?: string | null;
    fetchLatest?: UpdateDeps['fetchLatest'];
    runUpgrade?: UpdateDeps['runUpgrade'];
    globalRoot?: UpdateDeps['globalRoot'];
    isWritable?: UpdateDeps['isWritable'];
    getUid?: UpdateDeps['getUid'];
    minReleaseAge?: UpdateDeps['minReleaseAge'];
    now?: UpdateDeps['now'];
    platform?: UpdateDeps['platform'];
  } = {},
) {
  let out = '';
  let err = '';
  const runUpgrade = opts.runUpgrade ?? vi.fn(async () => 0);
  const deps: UpdateDeps = {
    stdout: (t) => (out += t),
    stderr: (t) => (err += t),
    readMeta: async () => ({ name: opts.name ?? '@lyupro/skillforge-mcp', version: opts.current ?? '1.10.0' }),
    fetchLatest:
      opts.fetchLatest ??
      (async () => ({ version: opts.latest ?? '1.11.0', publishedAt: opts.publishedAt ?? null })),
    runUpgrade,
    globalRoot: opts.globalRoot ?? (async () => null),
    isWritable: opts.isWritable ?? (async () => true),
    getUid: opts.getUid ?? (() => null),
    minReleaseAge: opts.minReleaseAge ?? (async () => null),
    now: opts.now ?? (() => 1_700_000_000_000),
    platform: opts.platform ?? 'linux',
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
    const fetchLatest = vi.fn(async () => ({ version: '1.11.0', publishedAt: null }));
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

describe('update.main — sudo pre-flight', () => {
  it('root-owned (non-writable, non-root) prefix → prints sudo, exits non-zero, no install', async () => {
    const runUpgrade = vi.fn(async () => 0);
    const h = harness({
      current: '1.10.0',
      latest: '1.11.0',
      runUpgrade,
      globalRoot: async () => '/usr/lib/node_modules',
      isWritable: async () => false,
      getUid: () => 1000,
    });
    const code = await main([], h.deps);
    expect(code).toBe(1);
    expect(h.err()).toContain('sudo npm install -g @lyupro/skillforge-mcp@latest');
    expect(h.err()).toContain('/usr/lib/node_modules');
    expect(h.err()).toContain('~/.npm-global');
    expect(runUpgrade).not.toHaveBeenCalled();
  });

  it('writable prefix → proceeds to install', async () => {
    const runUpgrade = vi.fn(async () => 0);
    const h = harness({
      current: '1.10.0',
      latest: '1.11.0',
      runUpgrade,
      globalRoot: async () => '/home/me/.npm-global/lib/node_modules',
      isWritable: async () => true,
      getUid: () => 1000,
    });
    const code = await main([], h.deps);
    expect(code).toBe(0);
    expect(runUpgrade).toHaveBeenCalledWith('npm', ['install', '-g', '@lyupro/skillforge-mcp@latest']);
  });

  it('root user (uid 0) → no sudo gate even if writability probe says false', async () => {
    const runUpgrade = vi.fn(async () => 0);
    const h = harness({
      current: '1.10.0',
      latest: '1.11.0',
      runUpgrade,
      globalRoot: async () => '/usr/lib/node_modules',
      isWritable: async () => false,
      getUid: () => 0,
    });
    const code = await main([], h.deps);
    expect(code).toBe(0);
    expect(runUpgrade).toHaveBeenCalled();
  });

  it('Windows (uid null) → no sudo gate, relies on reactive fail-loud', async () => {
    const runUpgrade = vi.fn(async () => 0);
    const h = harness({
      current: '1.10.0',
      latest: '1.11.0',
      runUpgrade,
      platform: 'win32',
      globalRoot: async () => 'C:/npm/node_modules',
      isWritable: async () => false,
      getUid: () => null,
    });
    const code = await main([], h.deps);
    expect(code).toBe(0);
    expect(runUpgrade).toHaveBeenCalled();
  });
});

describe('update.main — min-release-age cooldown', () => {
  const NOW = 1_700_000_000_000;
  const twoDaysAgo = new Date(NOW - 2 * 86_400_000).toISOString();
  const tenDaysAgo = new Date(NOW - 10 * 86_400_000).toISOString();

  it('cooldown blocks a just-published latest → warns + opt-in hint, exits non-zero, no install', async () => {
    const runUpgrade = vi.fn(async () => 0);
    const h = harness({
      current: '1.10.0',
      latest: '1.11.0',
      publishedAt: twoDaysAgo,
      now: () => NOW,
      minReleaseAge: async () => 7,
      runUpgrade,
    });
    const code = await main([], h.deps);
    expect(code).toBe(1);
    expect(h.err()).toContain('min-release-age');
    expect(h.err()).toContain('--min-release-age 0');
    expect(runUpgrade).not.toHaveBeenCalled();
  });

  it('latest older than the cooldown → proceeds normally', async () => {
    const runUpgrade = vi.fn(async () => 0);
    const h = harness({
      current: '1.10.0',
      latest: '1.11.0',
      publishedAt: tenDaysAgo,
      now: () => NOW,
      minReleaseAge: async () => 7,
      runUpgrade,
    });
    const code = await main([], h.deps);
    expect(code).toBe(0);
    expect(runUpgrade).toHaveBeenCalled();
  });

  it('--min-release-age 0 bypasses the cooldown gate and forwards the flag to npm', async () => {
    const runUpgrade = vi.fn(async () => 0);
    const h = harness({
      current: '1.10.0',
      latest: '1.11.0',
      publishedAt: twoDaysAgo,
      now: () => NOW,
      minReleaseAge: async () => 7,
      runUpgrade,
    });
    const code = await main(['--min-release-age', '0'], h.deps);
    expect(code).toBe(0);
    expect(runUpgrade).toHaveBeenCalledWith('npm', [
      'install',
      '-g',
      '@lyupro/skillforge-mcp@latest',
      '--min-release-age=0',
    ]);
  });

  it('--min-release-age=7 inline form also forwards', async () => {
    const runUpgrade = vi.fn(async () => 0);
    const h = harness({ current: '1.10.0', latest: '1.11.0', runUpgrade });
    await main(['--min-release-age=7'], h.deps);
    expect(runUpgrade).toHaveBeenCalledWith('npm', [
      'install',
      '-g',
      '@lyupro/skillforge-mcp@latest',
      '--min-release-age=7',
    ]);
  });

  it('--min-release-age with a non-integer → exit 2', async () => {
    const h = harness();
    const code = await main(['--min-release-age', 'soon'], h.deps);
    expect(code).toBe(2);
    expect(h.err()).toContain('non-negative integer');
  });

  it('no configured cooldown → proceeds even for a fresh publish', async () => {
    const runUpgrade = vi.fn(async () => 0);
    const h = harness({
      current: '1.10.0',
      latest: '1.11.0',
      publishedAt: twoDaysAgo,
      now: () => NOW,
      minReleaseAge: async () => null,
      runUpgrade,
    });
    const code = await main([], h.deps);
    expect(code).toBe(0);
    expect(runUpgrade).toHaveBeenCalled();
  });
});
