import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Spawns real processes / boots a real server, so it is not bound by the 5s
// default meant for pure unit tests: on a busy machine that budget expires
// mid-setup and reports a timeout where nothing is actually broken.
vi.setConfig({ testTimeout: 20_000 });

const root = resolve(import.meta.dirname, '..', '..');
const dispatcher = resolve(root, 'dist', 'cli', 'dispatcher.js');
const tsc = resolve(root, 'node_modules', 'typescript', 'bin', 'tsc');
const profiles: string[] = [];

function buildDist(): void {
  const result = spawnSync(process.execPath, [tsc, '-p', resolve(root, 'tsconfig.json')], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`dist build required by lifecycle guard failed:\n${result.stderr || result.stdout}`);
  }
}

function isolatedEnv(lifecycle: Record<string, unknown>): NodeJS.ProcessEnv {
  const profile = mkdtempSync(resolve(tmpdir(), 'skillforge-lifecycle-'));
  profiles.push(profile);
  const configPath = resolve(profile, '.lyupro', '.skillforge', 'config.json');
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ lifecycle }), 'utf8');
  return { ...process.env, HOME: profile, USERPROFILE: profile };
}

function initialize(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolveHandshake, reject) => {
    let stdout = '';
    const timeout = setTimeout(() => reject(new Error('MCP initialize timed out')), 10_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      const lines = stdout.split('\n');
      stdout = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line) as { id?: number; error?: unknown };
        if (message.id === 1) {
          clearTimeout(timeout);
          if (message.error !== undefined) reject(new Error(JSON.stringify(message.error)));
          else resolveHandshake();
        }
      }
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'lifecycle-test', version: '1.0.0' },
      },
    })}\n`);
  });
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs = 5_000): Promise<number | null> {
  return new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`process ${child.pid} remained alive after ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolveExit(code);
    });
  });
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessGone(pid: number, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!processAlive(pid)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // The process may exit between the final probe and cleanup.
  }
  throw new Error(`server process ${pid} remained alive after ${timeoutMs}ms`);
}

beforeAll(buildDist, 30_000);

afterAll(() => {
  for (const profile of profiles) rmSync(profile, { recursive: true, force: true });
});

describe('built server lifecycle', () => {
  it('exits with code 0 after the MCP host closes stdin', async () => {
    const started = Date.now();
    const child = spawn(process.execPath, [dispatcher, 'serve'], {
      cwd: root,
      env: isolatedEnv({ parentCheck: false }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const errors: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));

    await initialize(child);
    const handshakeMs = Date.now() - started;
    const closedAt = Date.now();
    child.stdin.end();
    const code = await waitForExit(child);
    const exitAfterCloseMs = Date.now() - closedAt;

    expect(code, Buffer.concat(errors).toString('utf8')).toBe(0);
    console.info(JSON.stringify({ handshakeMs, aliveAfterStdinClose: false, exitAfterCloseMs }));
  }, 20_000);

  it('exits on a supervisor tick when its parent disappears but stdin stays open', async () => {
    const wrapperScript = `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, [process.argv[1], 'serve'], {
        env: process.env,
        stdio: ['inherit', 'pipe', 'pipe']
      });
      process.stderr.write('SERVER_PID=' + child.pid + '\\n');
      child.stderr.pipe(process.stderr);
      let relayed = false;
      child.stdout.on('data', chunk => {
        process.stdout.write(chunk, () => {
          if (!relayed && chunk.includes(10)) {
            relayed = true;
            setTimeout(() => process.exit(0), 10);
          }
        });
      });
    `;
    const wrapper = spawn(process.execPath, ['-e', wrapperScript, dispatcher], {
      cwd: root,
      env: isolatedEnv({
        shutdownGraceMs: 100,
        parentCheck: true,
        idleTimeoutMs: 0,
        supervisorIntervalMs: 50,
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let serverPid = 0;
    wrapper.stderr.on('data', (chunk: Buffer) => {
      const match = chunk.toString('utf8').match(/SERVER_PID=(\d+)/);
      if (match) serverPid = Number(match[1]);
    });

    await initialize(wrapper);
    expect(await waitForExit(wrapper)).toBe(0);
    expect(serverPid).toBeGreaterThan(0);
    await waitForProcessGone(serverPid);
  }, 20_000);
});
