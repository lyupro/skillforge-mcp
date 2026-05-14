/**
 * Thrown when DFS through composite skill `skills:` references reaches
 * a skill already on the visit path. Carries the cycle path for diagnosis.
 */
export class CyclicSkillDependencyError extends Error {
  readonly path: readonly string[];

  constructor(path: readonly string[]) {
    super(`composite skill cycle detected: ${path.join(' → ')}`);
    this.name = 'CyclicSkillDependencyError';
    this.path = path;
  }
}
