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

  it('same folder, two installed bundle versions — highest semver wins (any input order)', () => {
    const root = '/cache/claude-code-skills';
    const older: SkillMetadata = {
      name: 'dependency-auditor',
      sourcePath: `${root}/engineering-advanced-skills/2.3.0/dependency-auditor/SKILL.md`,
      folder: root,
      format: 'claude',
    };
    const newer: SkillMetadata = {
      name: 'dependency-auditor',
      sourcePath: `${root}/engineering-advanced-skills/2.4.4/skills/dependency-auditor/SKILL.md`,
      folder: root,
      format: 'claude',
    };
    expect(resolver.resolve([older, newer], [root])).toBe(newer);
    expect(resolver.resolve([newer, older], [root])).toBe(newer);
  });

  it('same folder, no parseable version — keeps input order (stable)', () => {
    const f = '/cache';
    const a: SkillMetadata = { name: 'x', sourcePath: `${f}/a/SKILL.md`, folder: f, format: 'claude' };
    const b: SkillMetadata = { name: 'x', sourcePath: `${f}/b/SKILL.md`, folder: f, format: 'claude' };
    expect(resolver.resolve([a, b], [f])).toBe(a);
  });

  it('higher folder priority beats a newer version in a lower-priority folder', () => {
    const hi: SkillMetadata = { name: 'x', sourcePath: '/hi/1.0.0/x/SKILL.md', folder: '/hi', format: 'claude' };
    const lo: SkillMetadata = { name: 'x', sourcePath: '/lo/9.9.9/x/SKILL.md', folder: '/lo', format: 'claude' };
    // /hi ranks first — version tiebreak only applies within the same rank.
    expect(resolver.resolve([lo, hi], ['/hi', '/lo'])).toBe(hi);
  });
});
