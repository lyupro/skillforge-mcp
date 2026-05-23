import type { SkillMetadata } from './types.js';
import { parseVersionFromPath, compareVersions } from './version-parse.js';

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
      } else if (rank === bestRank && this.#isNewer(candidate, best)) {
        // Same registered folder (e.g. one plugin-cache root holding two installed
        // bundle versions) — break the tie by highest semver in the source path so
        // a newer install wins over a stale one instead of relying on scan order.
        best = candidate;
      }
    }

    return best;
  }

  #rankOf(folder: string, priorityIndex: ReadonlyMap<string, number>): number {
    return priorityIndex.get(folder) ?? Number.MAX_SAFE_INTEGER;
  }

  /** True when `candidate`'s path-derived version is strictly newer than `best`'s.
   *  When either path has no parseable version, the incumbent is kept (stable). */
  #isNewer(candidate: SkillMetadata, best: SkillMetadata): boolean {
    const cv = parseVersionFromPath(candidate.sourcePath);
    const bv = parseVersionFromPath(best.sourcePath);
    if (cv === null || bv === null) return false;
    return compareVersions(cv, bv) > 0;
  }
}
