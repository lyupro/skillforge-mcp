# Integration — Custom MCP clients

If you're building your own LLM tool, agent framework, or test harness, SkillForge connects via the standard MCP stdio transport. The MCP TypeScript SDK is the easiest path; any MCP-compliant client over stdio works.

## Minimum reference client

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/absolute/path/to/skillforge-mcp/dist/server.js'],
  env: {
    PATH: process.env.PATH ?? '',
    SKILLFORGE_FOLDERS: '/home/me/skills',
  },
});

const client = new Client(
  { name: 'my-agent', version: '1.0.0' },
  { capabilities: {} },
);
await client.connect(transport);

const { tools } = await client.listTools();
console.log(tools.map((t) => t.name));
// → ['skills__list', 'skills__get', 'skills__invoke', 'skills__configure', 'skills__reload']
```

## Tool surface — invocation cookbook

### `skills__list`

```ts
const result = await client.callTool({
  name: 'skills__list',
  arguments: { search: 'refactor' },  // optional: name substring filter
});
// content[0].text → JSON string of { skills: [...] }
```

Optional arguments:

- `folder`: string — limit to one configured folder (must match a configured folder absolute path).
- `search`: string — name substring (case-insensitive).
- `source`: `'claude' | 'codex' | 'persona' | 'custom'` — dialect filter.

### `skills__get`

```ts
const result = await client.callTool({
  name: 'skills__get',
  arguments: { name: 'apple-hig-check' },
});
// content[0].text → JSON string of full SkillContent (body + raw + metadata + scriptsDir)
```

### `skills__invoke`

```ts
const result = await client.callTool({
  name: 'skills__invoke',
  arguments: {
    name: 'apple-hig-check',
    input: 'Review my login screen for HIG compliance.',
  },
});
// content[0].text → JSON string of InvocationResult { ok, output, error?, durationMs }
```

`output` is the prompt body (or script stdout) you'll feed to your LLM as the next system/user message. For composite skills it's the combined output of all nested skills sequentially, separated by `---` horizontal rules.

### `skills__configure`

```ts
const result = await client.callTool({
  name: 'skills__configure',
  arguments: { action: 'add_folder', folder: '/home/me/extra-skills' },
});
// content[0].text → JSON string of { folders, blacklist, totalSkills }
```

See [CONFIGURATION.md](../CONFIGURATION.md#the-five-skills__configure-actions) for the five action shapes.

### `skills__reload`

```ts
const result = await client.callTool({
  name: 'skills__reload',
  arguments: {},  // or { folder: '/path' } to validate-and-ignore a specific folder
});
// content[0].text → JSON string of { loaded, added, removed, errors }
```

## Error handling

All tools return `content: [{ type: 'text', text: '<JSON string>' }]` on success. On failure they set `isError: true` and the `text` field carries a plain-language error message (not JSON). Defensive pattern:

```ts
const result = await client.callTool({ name: 'skills__invoke', arguments: {...} });
const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';

if (result.isError) {
  throw new Error(`SkillForge tool failed: ${text}`);
}

const parsed = JSON.parse(text);
// ... business logic
```

## Cleanup

```ts
await client.close();
// transport closes automatically with the client
```

The server subprocess exits when the stdio transport closes. SkillForge cleans up: `FolderWatcher.stop()` runs on SIGTERM / SIGINT, and any pending temp `cwd` from `SandboxRunner` is removed in `finally`.

## Tool schemas — programmatic access

```ts
const { tools } = await client.listTools();
for (const tool of tools) {
  console.log(tool.name, tool.description);
  console.log('  inputSchema:', JSON.stringify(tool.inputSchema, null, 2));
}
```

The schemas mirror the Zod definitions exported from `src/tools/*.ts` (`listInputSchema`, `getInputSchema`, `invokeInputSchema`, `configureInputSchema`, `reloadInputSchema`). If you're generating bindings from `inputSchema`, the JSON Schema is the source of truth.

## Streaming / cancellation

The MCP SDK supports request-level cancellation via `AbortSignal`. SkillForge propagates the signal through to `TimeoutDecorator` and `SandboxRunner`, so cancelling a `skills__invoke` call mid-run sends SIGTERM to any spawned subprocess (with the 5-second grace before SIGKILL):

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 1000);

try {
  await client.callTool(
    { name: 'skills__invoke', arguments: {...} },
    { signal: ac.signal },
  );
} catch (err) {
  // AbortError — server's subprocess already received SIGTERM
}
```

## CI usage

SkillForge's own `scripts/smoke-test.mjs` is a fully working reference: it spawns `dist/server.js`, exercises all three core tools, and exits non-zero on regressions. Copy it as a starting template for your own integration smoke test:

```bash
cp node_modules/@lyupro/skillforge-mcp/scripts/smoke-test.mjs ./tests/integration/skillforge-smoke.mjs
```

(After npm publication; until then, copy from the git repo.)

## References

- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- MCP specification: https://modelcontextprotocol.io
- SkillForge issues: https://github.com/lyupro/skillforge-mcp/issues

---

## Verification (2026-05-13)

**Environment:** Node 22.14.0 · @modelcontextprotocol/sdk ^1.0.0 · Windows 11 · SkillForge v1.0.0

### Reference smoke script

`scripts/integration-smoke.mjs` is a fully-working MCP protocol-compliance test. Run it after `pnpm build`:

```bash
node scripts/integration-smoke.mjs
```

### Actual output

```
[integration-smoke] OK   [initialize handshake]
[integration-smoke] OK   [tools/list — 5 tools: skills__configure, skills__get, skills__invoke, skills__list, skills__reload]
[integration-smoke] OK   [skills__list — 1 skill(s), fixture present]
[integration-smoke] OK   [skills__get — full body returned]
[integration-smoke] OK   [skills__configure — folders=[…/skillforge-integration-frMkxA/skills]]
[integration-smoke] OK   [skills__reload — loaded=1 added= removed= errors=]

[integration-smoke] ALL CHECKS PASSED — SkillForge MCP protocol compliance verified.
```

### Checks performed

| Check | Result |
|-------|--------|
| `initialize` handshake | ✓ |
| `tools/list` — 5 tools present | ✓ |
| `skills__list` — `content[0].type === "text"`, valid JSON `{skills:[…]}` | ✓ |
| `skills__get` — full skill body in `content[0].text` | ✓ |
| `skills__configure` — `{folders:[…]}` shape | ✓ |
| `skills__reload` — `{loaded, added, removed, errors}` shape | ✓ |

**Status: verified end-to-end.** All six MCP protocol compliance checks passed.
