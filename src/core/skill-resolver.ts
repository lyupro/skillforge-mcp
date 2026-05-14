import type { SkillMetadata } from './types.js';

export class SkillResolver {
  resolve(candidates: SkillMetadata[], folderPriority: string[]): SkillMetadata {
    if (candidates.length === 0) {
      throw new Error('SkillResolver.resolve: candidates must not be empty');
    }
    if (candidates.length === 1) {
      return candidates[0]!;
    }

    const priorityIndex = new Map<string, number>();
    for (let i = 0; i < folderPriority.length; i++) {
      const folder = folderPriority[i]!;
      if (!priorityIndex.has(folder)) {
        priorityIndex.set(folder, i);
      }
    }

    let best = candidates[0]!;
    let bestRank = this.#rankOf(best.folder, priorityIndex);

    for (let i = 1; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      const rank = this.#rankOf(candidate.folder, priorityIndex);
      if (rank < bestRank) {
        best = candidate;
        bestRank = rank;
      }
    }

    return best;
  }

  #rankOf(folder: string, priorityIndex: ReadonlyMap<string, number>): number {
    return priorityIndex.get(folder) ?? Number.MAX_SAFE_INTEGER;
  }
}
