import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildDeps, buildServer } from '../../src/server.js';

function responseText(result: { content: unknown }): string {
  return (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
}

describe('context-aware audit integration', () => {
  let fixtureDir: string;
  let client: Client;

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'sf-audit-integration-'));
    const skillDir = join(fixtureDir, 'context-aware-audit');
    await mkdir(skillDir);
    const fixture = [
      '---',
      'name: context-aware-audit',
      'description: Synthetic context-classification fixture',
      '---',
      'Check a staged diff for risky constructs.',
      '',
      '```bash',
      'git diff --cached | grep -E "os\\.system\\(|subprocess.*shell=True"',
      '```',
      '',
      '```python',
      'delegate_task(goal="""Explain why eval()/exec() with user input is unsafe.""")',
      '```',
    ].join('\n');
    await writeFile(join(skillDir, 'SKILL.md'), fixture, 'utf8');

    const deps = await buildDeps();
    deps.folders = [fixtureDir];
    deps.indexEnabled = false;
    deps.metadataCache.invalidate();
    const server = buildServer(deps);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: 'audit-context-test', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await rm(fixtureDir, { recursive: true, force: true });
  });

  it('lists and returns the synthetic skill after reindex', async () => {
    const reload = await client.callTool({ name: 'skills__reload', arguments: {} });
    expect(reload.isError).toBeFalsy();

    const list = await client.callTool({ name: 'skills__list', arguments: {} });
    expect(list.isError).toBeFalsy();
    const listed = JSON.parse(responseText(list)) as { skills: Array<{ name: string }> };
    expect(listed.skills.map((skill) => skill.name)).toContain('context-aware-audit');

    const get = await client.callTool({
      name: 'skills__get',
      arguments: { name: 'context-aware-audit' },
    });
    expect(get.isError).toBeFalsy();
    const content = JSON.parse(responseText(get)) as { name: string; body: string };
    expect(content.name).toBe('context-aware-audit');
    expect(content.body).toContain('git diff --cached');
    expect(content.body).toContain('delegate_task');
  });
});
