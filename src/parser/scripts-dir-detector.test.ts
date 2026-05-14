import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FsScriptsDirDetector } from './scripts-dir-detector.js';

describe('FsScriptsDirDetector', () => {
  let tmpDir: string;
  const detector = new FsScriptsDirDetector();

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'skillforge-detector-test-'));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns absolute path when sibling scripts/ directory exists', async () => {
    const skillDir = join(tmpDir, 'skill-with-scripts');
    const scriptsDir = join(skillDir, 'scripts');
    await rm(skillDir, { recursive: true, force: true });
    const { mkdir } = await import('node:fs/promises');
    await mkdir(scriptsDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, '---\nname: test\n---\nbody');

    const result = await detector.detect(skillFile);
    expect(result).toBe(scriptsDir);
  });

  it('returns undefined when sibling scripts/ directory does not exist', async () => {
    const skillDir = join(tmpDir, 'skill-no-scripts');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, '---\nname: test\n---\nbody');

    const result = await detector.detect(skillFile);
    expect(result).toBeUndefined();
  });

  it('returns undefined when scripts path is a file not a directory', async () => {
    const skillDir = join(tmpDir, 'skill-scripts-is-file');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(skillDir, { recursive: true });
    const skillFile = join(skillDir, 'SKILL.md');
    await writeFile(skillFile, '---\nname: test\n---\nbody');
    // Create "scripts" as a file, not a directory
    await writeFile(join(skillDir, 'scripts'), 'not a directory');

    const result = await detector.detect(skillFile);
    expect(result).toBeUndefined();
  });
});
