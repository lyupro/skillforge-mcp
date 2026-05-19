import { describe, it, expect } from 'vitest';
import { SkillFormatRegistry } from './skill-format-registry.js';
import { configSchema, defaultConfig } from '../config/config-schema.js';

const builtinRegistry = (): SkillFormatRegistry =>
  SkillFormatRegistry.fromConfig(defaultConfig());

describe('SkillFormatRegistry — built-in formats', () => {
  it('lists the 4 built-in formats', () => {
    expect(builtinRegistry().list().map((f) => f.id)).toEqual([
      'claude',
      'codex',
      'persona',
      'custom',
    ]);
  });

  it('matches SKILL.md to the claude format', () => {
    expect(builtinRegistry().matchFile('SKILL.md')!.id).toBe('claude');
  });

  it('matches AGENTS.md to the codex format', () => {
    expect(builtinRegistry().matchFile('AGENTS.md')!.id).toBe('codex');
  });

  it('matches a frontmatter persona field to the persona format', () => {
    const m = builtinRegistry().matchFile('guide.md', { persona: 'a guide' });
    expect(m!.id).toBe('persona');
  });

  it('matches a generic .md to the custom format', () => {
    expect(builtinRegistry().matchFile('random.md')!.id).toBe('custom');
  });

  it('ignores an empty persona field — falls through to custom', () => {
    expect(builtinRegistry().matchFile('random.md', { persona: '   ' })!.id).toBe(
      'custom',
    );
  });

  it('returns null for a non-.md file', () => {
    expect(builtinRegistry().matchFile('notes.txt')).toBeNull();
  });
});

describe('SkillFormatRegistry — conflict resolution by priority', () => {
  it('resolves SKILL.md (matches claude + custom) to the higher priority', () => {
    const reg = builtinRegistry();
    expect(reg.matchAll('SKILL.md').map((f) => f.id).sort()).toEqual([
      'claude',
      'custom',
    ]);
    expect(reg.matchFile('SKILL.md')!.id).toBe('claude');
  });

  it('an operator format with higher priority wins over a built-in', () => {
    const config = configSchema.parse({
      skillFormats: [
        { id: 'super', match: { type: 'filename', value: 'SKILL.md' }, priority: 500 },
      ],
    });
    const reg = SkillFormatRegistry.fromConfig(config);
    expect(reg.matchFile('SKILL.md')!.id).toBe('super');
  });
});

describe('SkillFormatRegistry — match rule types', () => {
  it('matches a filenameGlob descriptor', () => {
    const config = configSchema.parse({
      skillFormats: [
        { id: 'dot-skill', match: { type: 'filenameGlob', value: '*.skill.md' } },
      ],
    });
    const reg = SkillFormatRegistry.fromConfig(config);
    expect(reg.matchFile('review.skill.md')!.id).toBe('dot-skill');
    expect(reg.matchAll('plain.md').map((f) => f.id)).not.toContain('dot-skill');
  });

  it('a filenameGlob does not match across the dotted boundary literally', () => {
    const config = configSchema.parse({
      skillFormats: [
        { id: 'g', match: { type: 'filenameGlob', value: '*.md' }, priority: 1 },
      ],
    });
    const reg = SkillFormatRegistry.fromConfig(config);
    expect(reg.matchFile('readmeXmd')).toBeNull();
  });

  it('matches an operator-defined filename format with no code change', () => {
    const config = configSchema.parse({
      skillFormats: [
        { id: 'gemini-gem', match: { type: 'filename', value: 'GEMINI.md' } },
      ],
    });
    const reg = SkillFormatRegistry.fromConfig(config);
    expect(reg.matchFile('GEMINI.md')!.id).toBe('gemini-gem');
  });
});

describe('SkillFormatRegistry — enabled flag', () => {
  it('a disabled format never matches', () => {
    const config = configSchema.parse({
      skillFormats: [
        { id: 'custom', match: { type: 'filenameGlob', value: '*.md' }, enabled: false },
      ],
    });
    const reg = SkillFormatRegistry.fromConfig(config);
    // custom is disabled, so a plain .md matches nothing.
    expect(reg.matchFile('random.md')).toBeNull();
    expect(reg.isCandidate('random.md')).toBe(false);
  });

  it('SKILL.md still matches claude when custom is disabled', () => {
    const config = configSchema.parse({
      skillFormats: [
        { id: 'custom', match: { type: 'filenameGlob', value: '*.md' }, enabled: false },
      ],
    });
    const reg = SkillFormatRegistry.fromConfig(config);
    expect(reg.matchFile('SKILL.md')!.id).toBe('claude');
  });
});

describe('SkillFormatRegistry — get', () => {
  it('returns a format by id', () => {
    expect(builtinRegistry().get('claude')!.id).toBe('claude');
  });

  it('returns null for an unknown id', () => {
    expect(builtinRegistry().get('nope')).toBeNull();
  });
});
