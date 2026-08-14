import { SkillCandidateSet } from './skill-candidate-set.js';
import { SkillResolver } from './skill-resolver.js';
import type { SkillMetadata } from './types.js';

export class SkillRegistry {
  readonly #store = new Map<string, SkillCandidateSet>();
  readonly #resolver: SkillResolver;
  // Mutated in place rather than reassigned: candidate sets capture this array
  // through a getter, so a live update keeps every winner in sync with the
  // configured folder order without rebuilding the registry.
  readonly #folderPriority: string[];
  readonly #rootFolders: string[] = [];

  constructor(folderPriority: readonly string[] = [], resolver = new SkillResolver()) {
    this.#folderPriority = [...folderPriority];
    this.#resolver = resolver;
  }

  register(metadata: SkillMetadata): void {
    if (!metadata.name) {
      throw new Error('Skill name must be a non-empty string');
    }
    this.#trackRoot(metadata.folder);
    let candidates = this.#store.get(metadata.name);
    if (!candidates) {
      candidates = new SkillCandidateSet(this.#resolver, () => this.#folderPriority);
      this.#store.set(metadata.name, candidates);
    }
    candidates.add(metadata);
  }

  get(name: string): SkillMetadata | undefined {
    return this.#store.get(name)?.getWinner();
  }

  has(name: string): boolean {
    return this.#store.has(name);
  }

  unregister(name: string): boolean {
    const removed = this.#store.delete(name);
    if (removed) this.#pruneRoots();
    return removed;
  }

  clear(): void {
    this.#store.clear();
    this.#rootFolders.splice(0);
  }

  getAll(): SkillMetadata[] {
    return [...this.#store.values()]
      .map((candidates) => candidates.getWinner())
      .filter((candidate): candidate is SkillMetadata => candidate !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  replaceRoot(folder: string, candidates: SkillMetadata[]): string[] {
    for (const candidate of candidates) {
      if (candidate.folder !== folder) {
        throw new Error(`Candidate folder must match replaced root: ${folder}`);
      }
      if (!candidate.name) {
        throw new Error('Skill name must be a non-empty string');
      }
    }

    const affected = new Set(candidates.map((candidate) => candidate.name));
    for (const [name, set] of this.#store) {
      if (set.getCandidates().some((candidate) => candidate.folder === folder)) {
        affected.add(name);
      }
    }

    const previous = new Map(
      [...affected].map((name) => [name, this.#winnerIdentity(this.get(name))]),
    );
    for (const name of affected) {
      const set = this.#store.get(name);
      set?.removeByRoot(folder);
      if (set?.size === 0) this.#store.delete(name);
    }
    for (const candidate of candidates) this.register(candidate);
    this.#pruneRoots();

    return [...affected]
      .filter((name) => previous.get(name) !== this.#winnerIdentity(this.get(name)))
      .sort((a, b) => a.localeCompare(b));
  }

  getCandidates(name: string): SkillMetadata[] {
    return this.#store.get(name)?.getCandidates() ?? [];
  }

  getRootFolders(): string[] {
    return [...this.#rootFolders];
  }

  setFolderPriority(folderPriority: readonly string[]): void {
    this.#folderPriority.splice(0, this.#folderPriority.length, ...folderPriority);
  }

  get size(): number {
    return this.#store.size;
  }

  #trackRoot(folder: string): void {
    if (!this.#rootFolders.includes(folder)) this.#rootFolders.push(folder);
  }

  #pruneRoots(): void {
    const active = new Set(
      [...this.#store.values()].flatMap((set) =>
        set.getCandidates().map((candidate) => candidate.folder),
      ),
    );
    const remaining = this.#rootFolders.filter((folder) => active.has(folder));
    this.#rootFolders.splice(0, this.#rootFolders.length, ...remaining);
  }

  #winnerIdentity(candidate: SkillMetadata | undefined): string | undefined {
    return candidate && `${candidate.folder}\0${candidate.sourcePath}`;
  }
}
