import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readJsonSafe,
  readTomlSafe,
  writeJsonAtomic,
  writeTomlAtomic,
} from './atomic-write.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skillforge-aw-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readJsonSafe', () => {
  it('returns null for missing file', async () => {
    const p = join(dir, 'missing.json');
    expect(await readJsonSafe(p)).toBeNull();
  });

  it('returns parsed JSON for valid file', async () => {
    const p = join(dir, 'ok.json');
    writeFileSync(p, JSON.stringify({ a: 1, nested: { b: 'x' } }));
    expect(await readJsonSafe(p)).toEqual({ a: 1, nested: { b: 'x' } });
  });

  it('throws for corrupt JSON', async () => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not json');
    await expect(readJsonSafe(p)).rejects.toThrow(/invalid JSON/);
  });
});

describe('readTomlSafe', () => {
  it('returns null for missing file', async () => {
    const p = join(dir, 'missing.toml');
    expect(await readTomlSafe(p)).toBeNull();
  });

  it('returns parsed TOML for valid file', async () => {
    const p = join(dir, 'ok.toml');
    writeFileSync(p, 'name = "x"\n[server]\nport = 8080\n');
    const out = await readTomlSafe(p);
    expect(out).toEqual({ name: 'x', server: { port: 8080 } });
  });

  it('throws for corrupt TOML', async () => {
    const p = join(dir, 'bad.toml');
    writeFileSync(p, '== this is not toml ==\n[unterminated');
    await expect(readTomlSafe(p)).rejects.toThrow(/invalid TOML/);
  });
});

describe('writeJsonAtomic', () => {
  it('writes to new file, no backup created', async () => {
    const p = join(dir, 'new.json');
    await writeJsonAtomic(p, { a: 1 });
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ a: 1 });
    expect(existsSync(`${p}.backup`)).toBe(false);
    expect(existsSync(`${p}.tmp`)).toBe(false);
  });

  it('writes over existing file and snapshots .backup', async () => {
    const p = join(dir, 'exist.json');
    writeFileSync(p, JSON.stringify({ old: true }));
    await writeJsonAtomic(p, { fresh: 1 });
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ fresh: 1 });
    expect(JSON.parse(readFileSync(`${p}.backup`, 'utf8'))).toEqual({ old: true });
  });

  it('creates nested directories on write', async () => {
    const sub = await mkdtemp(join(tmpdir(), 'skillforge-aw-nest-'));
    const p = join(sub, 'a', 'b', 'c.json');
    await writeJsonAtomic(p, { ok: true });
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({ ok: true });
    rmSync(sub, { recursive: true, force: true });
  });
});

describe('writeTomlAtomic', () => {
  it('writes valid TOML output', async () => {
    const p = join(dir, 'out.toml');
    await writeTomlAtomic(p, { foo: 'bar', n: 3 });
    const raw = readFileSync(p, 'utf8');
    expect(raw).toContain('foo = "bar"');
    expect(raw).toContain('n = 3');
  });

  it('snapshots .backup when overwriting', async () => {
    const p = join(dir, 'exist.toml');
    writeFileSync(p, 'prev = 1\n');
    await writeTomlAtomic(p, { now: 2 });
    expect(readFileSync(p, 'utf8')).toContain('now = 2');
    expect(readFileSync(`${p}.backup`, 'utf8')).toContain('prev = 1');
  });
});
