import { SkillResolver } from './skill-resolver.js';
import type { SkillMetadata } from './types.js';

export class SkillCandidateSet {
  readonly #candidates: SkillMetadata[] = [];
  readonly #resolver: SkillResolver;
  readonly #folderPriority: () => readonly string[];

  constructor(
    resolver: SkillResolver,
    folderPriority: readonly string[] | (() => readonly string[]),
  ) {
    this.#resolver = resolver;
    this.#folderPriority =
      typeof folderPriority === 'function' ? folderPriority : () => folderPriority;
  }

  add(candidate: SkillMetadata): void {
    this.#candidates.unshift(candidate);
  }

  removeByRoot(folder: string): boolean {
    const remaining = this.#candidates.filter((candidate) => candidate.folder !== folder);
    if (remaining.length === this.#candidates.length) return false;
    this.#candidates.splice(0, this.#candidates.length, ...remaining);
    return true;
  }

  getWinner(): SkillMetadata | undefined {
    if (this.#candidates.length === 0) return undefined;
    return this.#resolver.resolve([...this.#candidates], [...this.#folderPriority()]);
  }

  getCandidates(): SkillMetadata[] {
    return [...this.#candidates];
  }

  get size(): number {
    return this.#candidates.length;
  }
}
