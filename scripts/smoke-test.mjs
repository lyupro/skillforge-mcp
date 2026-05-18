#!/usr/bin/env node
/**
 * Subprocess smoke test for the built SkillForge MCP server.
 *
 * Spawns `node dist/cli/dispatcher.js serve`, connects via StdioClientTransport,
 * lists tools, calls each one against a tiny tmp-folder fixture, exits 0 on success.
 *
 * Use after `pnpm build` to verify the binary is callable end-to-end, separate
 * from the in-process integration test (which uses InMemoryTransport).
 *
 * Usage: pnpm smoke
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const DISPATCHER_PATH = join(REPO_ROOT, 'dist', 'cli', 'dispatcher.js');

const FIXTURE_SKILL = `---
name: smoke-skill
description: Smoke-test skill used by scripts/smoke-test.mjs.
---

This is the body of the smoke-test skill.
`;

const EXPECTED_TOOLS = ['skills__list', 'skills__get', 'skills__invoke'];

async function setupFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'skillforge-smoke-'));
  const skillDir = join(dir, 'skills');
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), FIXTURE_SKILL, 'utf8');
  return { dir, skillDir };
}

function fail(message) {
  console.error(`[smoke] FAIL: ${message}`);
  process.exit(1);
}

async function main() {
  const fixture = await setupFixture();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [DISPATCHER_PATH, 'serve'],
    env: { ...process.env, SKILLFORGE_FOLDERS: fixture.skillDir },
  });

  const client = new Client({ name: 'skillforge-smoke', version: '0.0.0' });

  try {
    await client.connect(transport);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    for (const expected of EXPECTED_TOOLS) {
      if (!names.includes(expected)) {
        fail(`tool ${expected} not registered (got: ${names.join(', ')})`);
      }
    }

    const listResult = await client.callTool({ name: 'skills__list', arguments: {} });
    if (listResult.isError) fail(`skills__list returned isError: ${JSON.stringify(listResult.content)}`);
    const listText = listResult.content[0]?.text ?? '';
    if (!listText.includes('smoke-skill')) {
      fail(`skills__list did not include 'smoke-skill': ${listText}`);
    }

    const getResult = await client.callTool({
      name: 'skills__get',
      arguments: { name: 'smoke-skill' },
    });
    if (getResult.isError) fail(`skills__get returned isError: ${JSON.stringify(getResult.content)}`);
    if (!(getResult.content[0]?.text ?? '').includes('This is the body')) {
      fail('skills__get did not return the skill body');
    }

    const invokeResult = await client.callTool({
      name: 'skills__invoke',
      arguments: { name: 'smoke-skill', input: 'hello' },
    });
    if (invokeResult.isError) fail(`skills__invoke returned isError: ${JSON.stringify(invokeResult.content)}`);
    const invokeText = invokeResult.content[0]?.text ?? '';
    if (!invokeText.includes('hello') || !invokeText.includes('smoke-skill')) {
      fail(`skills__invoke output missing expected pieces: ${invokeText}`);
    }

    console.log('[smoke] OK — all 3 tools registered, list/get/invoke each return expected payload.');
  } finally {
    await client.close().catch(() => {});
    await rm(fixture.dir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error('[smoke] crashed:', err);
  process.exit(2);
});
