import type { SkillFormat } from '../core/types.js';

interface DetectInput {
  filePath?: string;
  fileName: string;
  frontmatter?: Record<string, unknown>;
}

export class FormatDetector {
  detect({ fileName, frontmatter }: DetectInput): SkillFormat {
    if (fileName === 'SKILL.md') return 'claude';
    if (fileName === 'AGENTS.md') return 'codex';
    const persona = frontmatter?.['persona'];
    if (typeof persona === 'string' && persona.trim().length > 0) return 'persona';
    return 'custom';
  }
}
