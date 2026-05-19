import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { kebabNormalize, deriveNameFromPath } from './name-derivation.js';

describe('kebabNormalize', () => {
  it('lowercases and keeps an already-kebab name', () => {
    expect(kebabNormalize('migration-architect')).toBe('migration-architect');
  });

  it('collapses spaces and underscores to single dashes', () => {
    expect(kebabNormalize('Migration  Architect_v2')).toBe('migration-architect-v2');
  });

  it('trims leading and trailing separators', () => {
    expect(kebabNormalize('__weird name__')).toBe('weird-name');
  });

  it('returns an empty string for a separator-only input', () => {
    expect(kebabNormalize('___')).toBe('');
  });
});

describe('deriveNameFromPath', () => {
  it('derives the kebab parent directory name', () => {
    const p = join('whatever', 'migration-architect', 'SKILL.md');
    expect(deriveNameFromPath(p)).toBe('migration-architect');
  });

  it('normalizes a non-kebab directory name', () => {
    const p = join('root', 'My Cool Skill', 'AGENTS.md');
    expect(deriveNameFromPath(p)).toBe('my-cool-skill');
  });

  it('returns null when the parent directory normalizes to empty', () => {
    const p = join('___', 'SKILL.md');
    expect(deriveNameFromPath(p)).toBeNull();
  });
});
