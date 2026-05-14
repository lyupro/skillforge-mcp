import { describe, it, expect } from 'vitest';
import { FormatDetector } from './format-detector.js';

const detector = new FormatDetector();

describe('FormatDetector', () => {
  it('returns claude for SKILL.md', () => {
    expect(detector.detect({ fileName: 'SKILL.md' })).toBe('claude');
  });

  it('returns codex for AGENTS.md', () => {
    expect(detector.detect({ fileName: 'AGENTS.md' })).toBe('codex');
  });

  it('returns persona when frontmatter has non-empty persona', () => {
    expect(detector.detect({ fileName: 'guide.md', frontmatter: { persona: 'guide' } })).toBe('persona');
  });

  it('returns custom for generic .md with no persona', () => {
    expect(detector.detect({ fileName: 'random.md' })).toBe('custom');
  });

  it('falls through to custom when persona is empty string', () => {
    expect(detector.detect({ fileName: 'random.md', frontmatter: { persona: '' } })).toBe('custom');
  });

  it('falls through to custom when persona is whitespace only', () => {
    expect(detector.detect({ fileName: 'random.md', frontmatter: { persona: '   ' } })).toBe('custom');
  });
});
