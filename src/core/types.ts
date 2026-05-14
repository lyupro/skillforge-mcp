/**
 * Shared core types for SkillForge MCP.
 *
 * SkillSummary  — lightweight metadata returned by `skills__list`.
 * SkillMetadata — normalized frontmatter (Adapter target for FrontmatterParser).
 * SkillContent  — metadata + full SKILL.md body (returned by `skills__get`).
 * InvocationContext / InvocationResult — IInvocationStrategy.invoke() I/O.
 */

export type SkillFormat = 'claude' | 'codex' | 'persona' | 'custom';

export type StrategyKind = 'prompt' | 'script' | 'hybrid';

export interface SkillSummary {
  /** Unique identifier — primary key in SkillRegistry. */
  name: string;
  /** One-line description (frontmatter `description`), optional. */
  description?: string;
  /** Absolute path to the SKILL.md (or equivalent) file on disk. */
  sourcePath: string;
  /** Absolute path to the configured root folder this skill was discovered under. */
  folder: string;
  /** Free-form tags from frontmatter `tags`. */
  tags?: string[];
  /** Detected frontmatter dialect — drives the Adapter selection in FrontmatterParser. */
  format: SkillFormat;
}

export interface SkillMetadata extends SkillSummary {
  /** Explicit strategy hint from frontmatter; otherwise inferred by StrategyFactory. */
  strategy?: StrategyKind;
  /** Opt-in flag: allow ScriptStrategy to spawn subprocesses for this skill. */
  allowScripts?: boolean;
  /** Opt-in flag: allow ScriptStrategy network access in sandbox. */
  allowNetwork?: boolean;
  /** Composite skill — names of skills to invoke before/around this one. */
  skills?: string[];
  /** Per-skill invocation timeout in ms; falls back to TimeoutDecorator default. */
  timeoutMs?: number;
  /** Opt-in: cache InvocationResult per (skillName + input) hash, TTL-based. */
  cacheable?: boolean;
  /** Per-skill TTL override (ms). Falls back to global cache config if absent. */
  cacheTtlMs?: number;
  /** Frontmatter passthrough for fields SkillForge does not interpret. */
  extra?: Record<string, unknown>;
  /** Filenames within sibling scripts/ directory, in interpreter-resolvable form
   *  (`main.py`, `entry.sh`, `app.mjs`). Current implementation supports single-entry only —
   *  index 0 is used by ScriptStrategy; multi-entry semantics deferred. */
  scripts?: string[];
}

export interface SkillContent extends SkillMetadata {
  /** SKILL.md body (everything after the frontmatter block). */
  body: string;
  /** Full SKILL.md file content including frontmatter. */
  raw: string;
  /** Absolute path to the sibling `scripts/` directory next to SKILL.md,
   *  populated by ScriptsDirDetector when present. Undefined when no scripts/
   *  directory exists. */
  scriptsDir?: string;
}

export interface InvocationContext {
  /** Which MCP tool initiated the invocation. */
  callerTool: 'invoke';
  /** User-supplied input forwarded to the skill. */
  input: string;
  /** AbortSignal injected by TimeoutDecorator. Strategies that spawn subprocess
   *  or perform long I/O should propagate this signal to honor cancellation. */
  signal?: AbortSignal;
  /** Optional per-call overrides (e.g. timeoutMs). */
  options?: {
    timeoutMs?: number;
  };
}

export interface InvocationResult {
  /** True on success, false on caught error. */
  ok: boolean;
  /** Skill output (prompt body for PromptStrategy, stdout for ScriptStrategy). */
  output: string;
  /** Populated when `ok` is false. */
  error?: string;
  /** Wall-clock duration of the invocation in ms. */
  durationMs: number;
}
