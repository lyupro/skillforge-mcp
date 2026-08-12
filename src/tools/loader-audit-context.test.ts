import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDeps } from '../server.js';
import { BlacklistFilter } from '../security/blacklist-filter.js';
import { PatternScanner } from '../security/pattern-scanner.js';
import type { Logger } from '../decorators/index.js';
import { rebuildRegistry } from './loader.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('rebuildRegistry audit notes', () => {
  it('logs each informational match at debug level without excluding the skill', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'sf-audit-note-'));
    tempDirs.push(folder);
    const body = [
      '---',
      'name: context-aware-audit',
      '---',
      '```bash',
      'git diff --cached | grep -E "os\\.system\\(|subprocess.*shell=True"',
      '```',
      '```python',
      'message = """Review eval()/exec() risks."""',
      '```',
    ].join('\n');
    await writeFile(join(folder, 'SKILL.md'), body, 'utf8');

    const lines: Array<{ level: string; message: string }> = [];
    const logger: Logger = {
      debug: (message) => { lines.push({ level: 'debug', message }); },
      info: (message) => { lines.push({ level: 'info', message }); },
      warn: (message) => { lines.push({ level: 'warn', message }); },
      error: (message) => { lines.push({ level: 'error', message }); },
    };
    const deps = await buildDeps();
    deps.folders = [folder];
    deps.indexEnabled = false;
    deps.logger = logger;
    deps.blacklistFilter = new BlacklistFilter({
      patternScanner: new PatternScanner({
        patterns: ['shell=True', 'eval\\(', 'exec\\(', 'base64\\.b64decode'],
      }),
    });

    await rebuildRegistry(deps);

    expect(deps.registry.has('context-aware-audit')).toBe(true);
    const notes = lines.filter((line) => line.message.includes('audit note (informational)'));
    expect(notes).toHaveLength(3);
    expect(notes.every((line) => line.level === 'debug')).toBe(true);
    expect(notes[0]!.message).toContain('"shell=True" in scanner-command context');
    expect(notes[1]!.message).toContain('"eval\\(" in Python string literal');
    expect(notes[2]!.message).toContain('"exec\\(" in Python string literal');
    expect(notes.every((line) => line.message.includes('not blocking "context-aware-audit"')))
      .toBe(true);
  });
});
