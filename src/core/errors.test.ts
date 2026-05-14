import { describe, it, expect } from 'vitest';
import { CyclicSkillDependencyError } from './errors.js';

describe('CyclicSkillDependencyError', () => {
  it('name is CyclicSkillDependencyError', () => {
    const err = new CyclicSkillDependencyError(['a', 'b', 'a']);
    expect(err.name).toBe('CyclicSkillDependencyError');
  });

  it('message includes arrow-separated cycle path', () => {
    const err = new CyclicSkillDependencyError(['a', 'b', 'c', 'a']);
    expect(err.message).toContain('a → b → c → a');
  });

  it('path array is preserved exactly', () => {
    const path = ['root', 'child', 'grandchild', 'root'];
    const err = new CyclicSkillDependencyError(path);
    expect(err.path).toEqual(path);
  });
});
