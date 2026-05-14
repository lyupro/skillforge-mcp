#!/usr/bin/env node
/**
 * MCP protocol-compliance smoke test for SkillForge.
 *
 * Uses @modelcontextprotocol/sdk StdioClientTransport + Client to:
 *   1. Connect to dist/server.js via stdio
 *   2. Verify initialize handshake succeeds
 *   3. tools/list — expect 5 tools with correct names
 *   4. tools/call skills__list — verify MCP content shape { content: [{type:'text',text:string}] }
 *   5. tools/call skills__get — verify full skill body returned
 *   6. tools/call skills__configure (action='list_folders') — verify response shape
 *   7. tools/call skills__reload — verify { loaded, added, removed, errors } shape
 *
 * Run: node scripts/integration-smoke.mjs
 * Exit 0 = all checks passed. Exit 1 = assertion failure. Exit 2 = unexpected crash.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const SERVER_PATH = join(REPO_ROOT, 'dist', 'server.js');

const EXPECTED_TOOLS = [
  'skills__list',
  'skills__get',
  'skills__invoke',
  'skills__configure',
  'skills__reload',
];

const FIXTURE_SKILL = `---
name: integration-probe
description: Protocol-compliance probe skill used by scripts/integration-smoke.mjs.
---

This is the integration-probe skill body.
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fail(label, detail) {
  console.error(`[integration-smoke] FAIL [${label}]: ${detail}`);
  process.exit(1);
}

function ok(label) {
  console.log(`[integration-smoke] OK   [${label}]`);
}

/**
 * Assert that a tools/call result has the canonical MCP content shape:
 *   { content: Array<{ type: 'text', text: string }>, isError?: false }
 */
function assertContentShape(label, result) {
  if (result.isError) {
    fail(label, `isError=true — ${JSON.stringify(result.content)}`);
  }
  if (!Array.isArray(result.content) || result.content.length === 0) {
    fail(label, `content is not a non-empty array: ${JSON.stringify(result.content)}`);
  }
  const first = result.content[0];
  if (first.type !== 'text') {
    fail(label, `content[0].type expected "text", got "${first.type}"`);
  }
  if (typeof first.text !== 'string' || first.text.length === 0) {
    fail(label, `content[0].text is not a non-empty string`);
  }
  return first.text;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --- fixture setup ---
  const dir = await mkdtemp(join(tmpdir(), 'skillforge-integration-'));
  const skillDir = join(dir, 'skills');
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), FIXTURE_SKILL, 'utf8');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: { ...process.env, SKILLFORGE_FOLDERS: skillDir },
  });

  const client = new Client(
    { name: 'skillforge-integration-smoke', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    // 1. initialize handshake (implicit in client.connect)
    await client.connect(transport);
    ok('initialize handshake');

    // 2. tools/list — expect exactly EXPECTED_TOOLS
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    if (tools.length !== EXPECTED_TOOLS.length) {
      fail('tools/list count', `expected ${EXPECTED_TOOLS.length} tools, got ${tools.length}: ${names.join(', ')}`);
    }
    for (const expected of EXPECTED_TOOLS) {
      if (!names.includes(expected)) {
        fail('tools/list names', `tool "${expected}" not registered (got: ${names.join(', ')})`);
      }
    }
    ok(`tools/list — ${tools.length} tools: ${names.join(', ')}`);

    // 3. skills__list — MCP content shape + fixture skill present
    const listResult = await client.callTool({ name: 'skills__list', arguments: {} });
    const listText = assertContentShape('skills__list shape', listResult);
    let listParsed;
    try {
      listParsed = JSON.parse(listText);
    } catch {
      fail('skills__list JSON', `content[0].text is not valid JSON: ${listText.slice(0, 200)}`);
    }
    if (!Array.isArray(listParsed?.skills)) {
      fail('skills__list response', `expected { skills: [...] }, got: ${JSON.stringify(listParsed).slice(0, 200)}`);
    }
    if (!listParsed.skills.some((s) => s.name === 'integration-probe')) {
      fail('skills__list fixture', `"integration-probe" not found in skills list`);
    }
    ok(`skills__list — ${listParsed.skills.length} skill(s), fixture present`);

    // 4. skills__get — full body returned
    const getResult = await client.callTool({ name: 'skills__get', arguments: { name: 'integration-probe' } });
    const getText = assertContentShape('skills__get shape', getResult);
    if (!getText.includes('integration-probe skill body')) {
      fail('skills__get body', `expected skill body text, got: ${getText.slice(0, 200)}`);
    }
    ok('skills__get — full body returned');

    // 5. skills__configure (list_folders) — folder array in response
    const configResult = await client.callTool({
      name: 'skills__configure',
      arguments: { action: 'list_folders' },
    });
    const configText = assertContentShape('skills__configure shape', configResult);
    let configParsed;
    try {
      configParsed = JSON.parse(configText);
    } catch {
      fail('skills__configure JSON', `content[0].text is not valid JSON: ${configText.slice(0, 200)}`);
    }
    if (!Array.isArray(configParsed?.folders)) {
      fail('skills__configure response', `expected { folders: [...] }, got: ${JSON.stringify(configParsed).slice(0, 200)}`);
    }
    ok(`skills__configure — folders=[${configParsed.folders.join(', ')}]`);

    // 6. skills__reload — { loaded, added, removed, errors } shape
    const reloadResult = await client.callTool({ name: 'skills__reload', arguments: {} });
    const reloadText = assertContentShape('skills__reload shape', reloadResult);
    let reloadParsed;
    try {
      reloadParsed = JSON.parse(reloadText);
    } catch {
      fail('skills__reload JSON', `content[0].text is not valid JSON: ${reloadText.slice(0, 200)}`);
    }
    for (const key of ['loaded', 'added', 'removed', 'errors']) {
      if (!(key in reloadParsed)) {
        fail('skills__reload shape', `missing key "${key}" in response: ${JSON.stringify(reloadParsed).slice(0, 200)}`);
      }
    }
    ok(`skills__reload — loaded=${reloadParsed.loaded} added=${reloadParsed.added} removed=${reloadParsed.removed} errors=${reloadParsed.errors}`);

    console.log('\n[integration-smoke] ALL CHECKS PASSED — SkillForge MCP protocol compliance verified.');
  } finally {
    await client.close().catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error('[integration-smoke] CRASH:', err);
  process.exit(2);
});
