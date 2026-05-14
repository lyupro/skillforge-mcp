import { describe, it, expect } from 'vitest';
import { SkillResolver } from './skill-resolver.js';
import type { SkillMetadata } from './types.js';

function makeSkill(name: string, folder: string): SkillMetadata {
  return { name, sourcePath: `${folder}/${name}.md`, folder, format: 'claude' };
}

const resolver = new SkillResolver();

describe('SkillResolver', () => {
  it('throws when candidates is empty', () => {
    expect(() => resolver.resolve([], [])).toThrow(
      'SkillResolver.resolve: candidates must not be empty',
    );
  });

  it('returns single candidate as-is', () => {
    const skill = makeSkill('solo', '/a');
    expect(resolver.resolve([skill], [])).toBe(skill);
  });

  it('two candidates, one in priority list — listed one wins', () => {
    const a = makeSkill('x', '/a');
    const b = makeSkill('x', '/b');
    expect(resolver.resolve([b, a], ['/a'])).toBe(a);
  });

  it('both in priority list — lower index wins', () => {
    const a = makeSkill('x', '/a');
    const b = makeSkill('x', '/b');
    expect(resolver.resolve([b, a], ['/a', '/b'])).toBe(a);
    expect(resolver.resolve([a, b], ['/b', '/a'])).toBe(b);
  });

  it('neither in priority list — first one wins (input-order tiebreaker)', () => {
    const a = makeSkill('x', '/a');
    const b = makeSkill('x', '/b');
    expect(resolver.resolve([a, b], [])).toBe(a);
    expect(resolver.resolve([b, a], [])).toBe(b);
  });

  it('one in list, one not — listed one wins', () => {
    const listed = makeSkill('x', '/listed');
    const unlisted = makeSkill('x', '/unlisted');
    expect(resolver.resolve([unlisted, listed], ['/listed'])).toBe(listed);
  });

  it('priority list with duplicate entries — earliest position counts, no crash', () => {
    const a = makeSkill('x', '/a');
    const b = makeSkill('x', '/b');
    expect(resolver.resolve([b, a], ['/a', '/a', '/b'])).toBe(a);
  });
});
