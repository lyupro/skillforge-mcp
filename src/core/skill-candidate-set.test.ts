import { describe, expect, it } from 'vitest';
import { SkillCandidateSet } from './skill-candidate-set.js';
import { SkillResolver } from './skill-resolver.js';
import type { SkillMetadata } from './types.js';

function makeSkill(name: string, folder: string, version: string): SkillMetadata {
  return {
    name,
    sourcePath: `${folder}/bundle/${version}/${name}/SKILL.md`,
    folder,
    format: 'claude',
  };
}

describe('SkillCandidateSet', () => {
  it('chooses a winner by folder rank', () => {
    const set = new SkillCandidateSet(new SkillResolver(), ['/high', '/low']);
    const low = makeSkill('shared', '/low', '9.0.0');
    const high = makeSkill('shared', '/high', '1.0.0');
    set.add(low);
    set.add(high);

    expect(set.getWinner()).toBe(high);
    expect(set.getCandidates()).toEqual([high, low]);
  });

  it('removes every candidate from a root and exposes the lower-ranked winner', () => {
    const set = new SkillCandidateSet(new SkillResolver(), ['/high', '/low']);
    const low = makeSkill('shared', '/low', '1.0.0');
    set.add(low);
    set.add(makeSkill('shared', '/high', '2.0.0'));

    expect(set.removeByRoot('/high')).toBe(true);
    expect(set.getWinner()).toBe(low);
  });

  it('uses semver to break ties between folders with the same rank', () => {
    const set = new SkillCandidateSet(new SkillResolver(), []);
    const older = makeSkill('shared', '/cache-a', '1.2.0');
    const newer = makeSkill('shared', '/cache-b', '1.10.0');
    set.add(older);
    set.add(newer);

    expect(set.getWinner()).toBe(newer);
  });
});
