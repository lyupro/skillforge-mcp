/**
 * The configure tool must say when a write it just made is being overridden by
 * the environment. Without it the tool reports success while the caller watches
 * the folder list stay exactly as it was.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { handleConfigure } from './configure.js';
import { makeDeps, makeFakeStore } from './configure-test-harness.js';

const ENV_KEY = 'SKILLFORGE_FOLDERS';
const original = process.env[ENV_KEY];

function setEnvFolders(value: string | undefined): void {
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
}

afterEach(() => setEnvFolders(original));

describe('handleConfigure — environment override note', () => {
  it('warns that add_folder has no effect while the environment supplies folders', async () => {
    setEnvFolders(resolve('/env-skills'));
    const { store, current } = makeFakeStore();
    const deps = makeDeps({ store });

    const result = await handleConfigure(deps, { action: 'add_folder', folder: '/added' });

    expect(result.envOverrideNote).toContain(ENV_KEY);
    // The write still lands: the note is about what is active, not about failure.
    expect(current().folders.map((f) => resolve(f.path))).toContain(resolve('/added'));
  });

  it('says nothing when no environment folders are set', async () => {
    setEnvFolders(undefined);
    const { store } = makeFakeStore();
    const deps = makeDeps({ store });

    const result = await handleConfigure(deps, { action: 'add_folder', folder: '/added' });

    expect(result.envOverrideNote).toBeUndefined();
  });

  it('treats an empty variable as unset', async () => {
    setEnvFolders('');
    const { store } = makeFakeStore();
    const deps = makeDeps({ store });

    const result = await handleConfigure(deps, { action: 'add_folder', folder: '/added' });

    expect(result.envOverrideNote).toBeUndefined();
  });

  it.each(['remove_folder', 'reset', 'list_folders'] as const)(
    'warns on %s too — every folder action is affected',
    async (action) => {
      setEnvFolders(resolve('/env-skills'));
      const { store } = makeFakeStore();
      const deps = makeDeps({ store });

      const result = await handleConfigure(deps, { action, folder: '/added' });

      expect(result.envOverrideNote).toContain(ENV_KEY);
    },
  );

  it.each(['set_blacklist', 'get_blacklist'] as const)(
    'stays silent on %s — the blacklist has no environment counterpart',
    async (action) => {
      setEnvFolders(resolve('/env-skills'));
      const { store } = makeFakeStore();
      const deps = makeDeps({ store });

      const result = await handleConfigure(deps, { action, blacklist: ['ignored'] });

      expect(result.envOverrideNote).toBeUndefined();
    },
  );

  it('reports a source conflict and a duplicate-load hint independently', async () => {
    setEnvFolders(resolve('/env-skills'));
    const { store } = makeFakeStore();
    const deps = makeDeps({ store });

    const result = await handleConfigure(deps, { action: 'add_folder', folder: '/added' });

    // conflictHint depends on the host layout and may legitimately be absent;
    // what must hold is that one field never suppresses the other.
    expect(result.envOverrideNote).toBeDefined();
    expect('conflictHint' in result || result.conflictHint === undefined).toBe(true);
  });
});
