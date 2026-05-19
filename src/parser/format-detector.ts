import type { SkillFormat as SkillFormatDialect } from '../core/types.js';
import { SkillFormatRegistry } from './skill-format-registry.js';
import { defaultConfig } from '../config/config-schema.js';

interface DetectInput {
  filePath?: string;
  fileName: string;
  frontmatter?: Record<string, unknown>;
}

/** The four dialect labels the registry surfaces in `skills__list`. */
const DIALECTS: ReadonlySet<string> = new Set(['claude', 'codex', 'persona', 'custom']);

/**
 * Thin client of the SkillFormatRegistry. The registry decides which format
 * descriptor a file matches; the detector maps that descriptor's `id` onto the
 * coarse dialect label (`claude` / `codex` / `persona` / `custom`) that drives
 * the `skills__list` `source` filter. An operator-defined format whose id is
 * not one of the four built-ins is reported under the `custom` dialect.
 */
export class FormatDetector {
  readonly #registry: SkillFormatRegistry;

  /** Defaults to the built-in registry; the server injects a config-backed one. */
  constructor(registry?: SkillFormatRegistry) {
    this.#registry = registry ?? SkillFormatRegistry.fromConfig(defaultConfig());
  }

  detect({ fileName, frontmatter }: DetectInput): SkillFormatDialect {
    const matched = this.#registry.matchFile(fileName, frontmatter);
    if (matched === null) return 'custom';
    return DIALECTS.has(matched.id) ? (matched.id as SkillFormatDialect) : 'custom';
  }
}
