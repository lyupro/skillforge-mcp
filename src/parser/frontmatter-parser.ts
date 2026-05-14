import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import matter from 'gray-matter';
import type { SkillContent, StrategyKind } from '../core/types.js';
import { FormatDetector } from './format-detector.js';
import { FsScriptsDirDetector } from './scripts-dir-detector.js';
import type { ScriptsDirDetector } from './scripts-dir-detector.js';

const CONSUMED_KEYS = new Set([
  'name', 'description', 'tags', 'format', 'strategy',
  'allow_scripts', 'allowScripts', 'allow_network', 'allowNetwork',
  'skills', 'timeout_ms', 'timeoutMs',
  'scripts', 'cacheable', 'cache_ttl_ms', 'cacheTtlMs',
]);

const STRATEGY_KINDS: ReadonlySet<string> = new Set(['prompt', 'script', 'hybrid']);

function normalizeTags(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    if (raw.every((t) => typeof t === 'string')) return raw as string[];
    return undefined;
  }
  if (typeof raw === 'string') {
    if (raw.includes(',')) return raw.split(',').map((t) => t.trim()).filter(Boolean);
    return [raw];
  }
  return undefined;
}

interface ParserOptions {
  formatDetector?: FormatDetector;
  scriptsDirDetector?: ScriptsDirDetector;
}

export class FrontmatterParser {
  readonly #detector: FormatDetector;
  readonly #scriptsDirDetector: ScriptsDirDetector;

  constructor(options: ParserOptions = {}) {
    this.#detector = options.formatDetector ?? new FormatDetector();
    this.#scriptsDirDetector = options.scriptsDirDetector ?? new FsScriptsDirDetector();
  }

  async parseFile(absolutePath: string, configuredFolder: string): Promise<SkillContent> {
    const raw = await readFile(absolutePath, 'utf-8');
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;

    const name = typeof data['name'] === 'string' ? data['name'].trim() : '';
    if (!name) {
      throw new Error(`Skill at ${absolutePath}: missing required frontmatter field 'name'`);
    }

    const description =
      typeof data['description'] === 'string' ? data['description'].trim() : undefined;

    const tags = normalizeTags(data['tags']);

    const fileName = basename(absolutePath);
    const format = this.#detector.detect({ fileName, frontmatter: data });

    const strategyRaw = data['strategy'];
    const strategy =
      typeof strategyRaw === 'string' && STRATEGY_KINDS.has(strategyRaw)
        ? (strategyRaw as StrategyKind)
        : undefined;

    const allowScripts = Boolean(data['allow_scripts'] ?? data['allowScripts'] ?? false);
    const allowNetwork = Boolean(data['allow_network'] ?? data['allowNetwork'] ?? false);

    const skillsRaw = data['skills'];
    const skills =
      Array.isArray(skillsRaw) && skillsRaw.every((s) => typeof s === 'string')
        ? (skillsRaw as string[])
        : undefined;

    const timeoutRaw = data['timeout_ms'] ?? data['timeoutMs'];
    const timeoutMs =
      typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw) && timeoutRaw > 0
        ? timeoutRaw
        : undefined;

    const scriptsRaw = data['scripts'];
    const scripts =
      Array.isArray(scriptsRaw) && scriptsRaw.every((s) => typeof s === 'string')
        ? (scriptsRaw as string[])
        : undefined;

    const cacheableRaw = data['cacheable'];
    const cacheable =
      typeof cacheableRaw === 'boolean' ? cacheableRaw : undefined;

    const cacheTtlRaw = data['cache_ttl_ms'] ?? data['cacheTtlMs'];
    const cacheTtlMs =
      typeof cacheTtlRaw === 'number' && Number.isFinite(cacheTtlRaw) && cacheTtlRaw > 0
        ? cacheTtlRaw
        : undefined;

    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!CONSUMED_KEYS.has(key)) extra[key] = value;
    }

    const body = parsed.content.replace(/^\n+/, '');

    const scriptsDir = await this.#scriptsDirDetector.detect(absolutePath);

    return {
      name,
      description,
      sourcePath: absolutePath,
      folder: configuredFolder,
      tags,
      format,
      strategy,
      allowScripts,
      allowNetwork,
      skills,
      timeoutMs,
      scripts,
      cacheable,
      cacheTtlMs,
      extra: Object.keys(extra).length > 0 ? extra : undefined,
      body,
      raw,
      scriptsDir,
    };
  }
}
