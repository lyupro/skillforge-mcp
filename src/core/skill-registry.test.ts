import { describe, it, expect, beforeEach } from 'vitest';
import { SkillRegistry } from './skill-registry.js';
import type { SkillMetadata } from './types.js';

function makeSkill(name: string, folder = '/skills'): SkillMetadata {
  return { name, sourcePath: `/skills/${name}.md`, folder, format: 'claude' };
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

  it('register with duplicate name replaces the existing entry', () => {
    registry.register(makeSkill('dup'));
    const updated = makeSkill('dup', '/other');
    registry.register(updated);
    expect(registry.get('dup')).toBe(updated);
    expect(registry.size).toBe(1);
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
});
