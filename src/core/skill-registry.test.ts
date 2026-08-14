import { describe, it, expect, beforeEach } from 'vitest';
import { SkillRegistry } from './skill-registry.js';
import type { SkillMetadata } from './types.js';

function makeSkill(name: string, folder = '/skills'): SkillMetadata {
  return { name, sourcePath: `${folder}/${name}.md`, folder, format: 'claude' };
}

let registry: SkillRegistry;

beforeEach(() => {
  registry = new SkillRegistry();
});

describe('SkillRegistry', () => {
  it('register then get returns the same object', () => {
    const skill = makeSkill('foo');
    registry.register(skill);
    expect(registry.get('foo')).toBe(skill);
  });

  it('register with duplicate name shadows the existing entry but keeps it as a candidate', () => {
    const original = makeSkill('dup');
    registry.register(original);
    const updated = makeSkill('dup', '/other');
    registry.register(updated);
    expect(registry.get('dup')).toBe(updated);
    expect(registry.size).toBe(1);
    expect(registry.getCandidates('dup')).toEqual([updated, original]);
  });

  it('register rejects empty name', () => {
    expect(() => registry.register(makeSkill(''))).toThrow(
      'Skill name must be a non-empty string',
    );
  });

  it('has returns true when skill exists, false otherwise', () => {
    registry.register(makeSkill('exists'));
    expect(registry.has('exists')).toBe(true);
    expect(registry.has('missing')).toBe(false);
  });

  it('size reflects number of registered skills', () => {
    expect(registry.size).toBe(0);
    registry.register(makeSkill('a'));
    expect(registry.size).toBe(1);
    registry.register(makeSkill('b'));
    expect(registry.size).toBe(2);
  });

  it('unregister returns true when removed, false when not present', () => {
    registry.register(makeSkill('removable'));
    expect(registry.unregister('removable')).toBe(true);
    expect(registry.unregister('removable')).toBe(false);
    expect(registry.has('removable')).toBe(false);
  });

  it('getAll returns a sorted snapshot — mutation does not affect internal state', () => {
    registry.register(makeSkill('zebra'));
    registry.register(makeSkill('alpha'));
    registry.register(makeSkill('monkey'));

    const all = registry.getAll();
    expect(all.map((s) => s.name)).toEqual(['alpha', 'monkey', 'zebra']);

    all.splice(0, all.length);
    expect(registry.size).toBe(3);
  });

  it('clear empties the registry', () => {
    registry.register(makeSkill('a'));
    registry.register(makeSkill('b'));
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.getAll()).toEqual([]);
  });

  it('higher-priority candidates shadow lower ones without removing them', () => {
    registry = new SkillRegistry(['/high', '/low']);
    const low = makeSkill('shared', '/low');
    const high = makeSkill('shared', '/high');
    registry.register(low);
    registry.register(high);

    expect(registry.get('shared')).toBe(high);
    expect(registry.getCandidates('shared')).toEqual([high, low]);
  });

  it('deleting a high-priority root surfaces the lower-priority candidate', () => {
    registry = new SkillRegistry(['/high', '/low']);
    const low = makeSkill('shared', '/low');
    registry.register(low);
    registry.register(makeSkill('shared', '/high'));

    expect(registry.replaceRoot('/high', [])).toEqual(['shared']);
    expect(registry.get('shared')).toBe(low);
    expect(registry.getRootFolders()).toEqual(['/low']);
  });

  it('replacing a root reports only names whose winner changed', () => {
    registry = new SkillRegistry(['/high', '/low']);
    const untouched = makeSkill('untouched', '/other');
    const oldWinner = makeSkill('changed', '/low');
    registry.register(untouched);
    registry.register(oldWinner);
    registry.register(makeSkill('shadowed', '/low'));
    const shadowingWinner = makeSkill('shadowed', '/high');
    registry.register(shadowingWinner);

    const changed = registry.replaceRoot('/low', []);

    expect(changed).toEqual(['changed']);
    expect(registry.get('untouched')).toBe(untouched);
    expect(registry.get('shadowed')).toBe(shadowingWinner);
  });

  it('an equivalent folder rescan does not report an unchanged winner', () => {
    registry = new SkillRegistry(['/high']);
    registry.register(makeSkill('same', '/high'));

    expect(registry.replaceRoot('/high', [makeSkill('same', '/high')])).toEqual([]);
    expect(registry.getRootFolders()).toEqual(['/high']);
  });
});
