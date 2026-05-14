import { join } from 'node:path';
import type { InvocationContext, InvocationResult, SkillContent, StrategyKind } from '../core/types.js';
import type { InvocationStrategy } from './invocation-strategy.js';
import type { SandboxRunner } from '../security/sandbox-runner.js';
import type { Logger } from '../decorators/logging-decorator.js';

export interface ScriptStrategyDeps {
  sandboxRunner: SandboxRunner;
  /** Reads global `config.security.allowScripts` at invoke-time (not boot-time)
   *  so config changes via `mcp__skills__configure` reflect without restart. */
  isGloballyAllowed: () => boolean;
  logger?: Logger;
  clock?: () => number;
}

const INTERPRETER_BY_EXT: Record<string, { cmd: string; needsScriptPath: true }> = {
  '.py':  { cmd: 'python3', needsScriptPath: true },
  '.sh':  { cmd: 'bash',    needsScriptPath: true },
  '.js':  { cmd: 'node',    needsScriptPath: true },
  '.mjs': { cmd: 'node',    needsScriptPath: true },
};

function lowerExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

function fail(error: string, durationMs = 0): InvocationResult {
  return { ok: false, output: '', error, durationMs };
}

export class ScriptStrategy implements InvocationStrategy {
  readonly kind: StrategyKind = 'script';
  readonly #sandbox: SandboxRunner;
  readonly #isGlobalAllowed: () => boolean;
  readonly #logger?: Logger;
  readonly #clock: () => number;

  constructor(deps: ScriptStrategyDeps) {
    this.#sandbox = deps.sandboxRunner;
    this.#isGlobalAllowed = deps.isGloballyAllowed;
    this.#logger = deps.logger;
    this.#clock = deps.clock ?? (() => performance.now());
  }

  canHandle(skill: SkillContent): boolean {
    if (skill.strategy === 'script') return true;
    if (skill.strategy !== undefined) return false;
    // Auto-detect: scripts[] non-empty.
    return Array.isArray(skill.scripts) && skill.scripts.length > 0;
  }

  async invoke(skill: SkillContent, context: InvocationContext): Promise<InvocationResult> {
    const start = this.#clock();

    // Gate 1: global config flag.
    if (!this.#isGlobalAllowed()) {
      return fail('scripts disabled globally (config.security.allowScripts=false)', Math.round(this.#clock() - start));
    }

    // Gate 2: per-skill opt-in.
    if (skill.allowScripts !== true) {
      return fail('scripts disabled for this skill (metadata.allowScripts must be true)', Math.round(this.#clock() - start));
    }

    // Resolve script path: single-entry only.
    const entries = skill.scripts ?? [];
    if (entries.length === 0) {
      return fail('no script entries declared (metadata.scripts is empty)', Math.round(this.#clock() - start));
    }
    if (!skill.scriptsDir) {
      return fail('no scripts/ directory found next to skill file', Math.round(this.#clock() - start));
    }

    const scriptName = entries[0];
    const ext = lowerExt(scriptName);
    const interp = INTERPRETER_BY_EXT[ext];
    if (!interp) {
      return fail(`unsupported script extension: ${ext || '(none)'} — allowed: .py, .sh, .js, .mjs`, Math.round(this.#clock() - start));
    }

    const scriptPath = join(skill.scriptsDir, scriptName);

    try {
      const sandboxResult = await this.#sandbox.run(interp.cmd, [scriptPath], {
        env: { SKILLFORGE_INPUT: context.input },
        signal: context.signal,
        allowNetwork: skill.allowNetwork === true,
      });

      const durationMs = sandboxResult.durationMs;

      if (sandboxResult.timedOut) {
        return { ok: false, output: sandboxResult.stdout, error: 'timeout', durationMs };
      }
      if (sandboxResult.exitCode === 0) {
        return { ok: true, output: sandboxResult.stdout, durationMs };
      }
      return {
        ok: false,
        output: sandboxResult.stdout,
        error: sandboxResult.stderr || `exit code ${sandboxResult.exitCode}`,
        durationMs,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.#logger?.error(`[skillforge] script-strategy error skill=${skill.name} err=${errMsg}`);
      return fail(`sandbox error: ${errMsg}`, Math.round(this.#clock() - start));
    }
  }
}
