import type { SkillMetadata } from './types.js';
import {
  parseVersionFromPath,
  parseBundleFromPath,
  compareVersions,
  matchesPin,
} from './version-parse.js';

export class SkillResolver {
  readonly #versionPolicy: Record<string, string>;

  constructor(versionPolicy: Record<string, string> = {}) {
    this.#versionPolicy = versionPolicy;
  }

  resolve(candidates: SkillMetadata[], folderPriority: string[]): SkillMetadata {
    if (candidates.length === 0) {
      throw new Error('SkillResolver.resolve: candidates must not be empty');
    }
    if (candidates.length === 1) {
      return candidates[0]!;
    }

    candidates = this.#applyVersionPolicy(candidates);
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

  /**
   * Drop candidates whose bundle is pinned to a different version. A pin of
   * `latest` (or absent) is a no-op. If a pin matches no candidate the pin is
   * ignored rather than dropping the skill entirely (operator typo shouldn't
   * make a skill vanish — the collision log still shows what was available).
   */
  #applyVersionPolicy(candidates: SkillMetadata[]): SkillMetadata[] {
    const kept = candidates.filter((c) => {
      const bundle = parseBundleFromPath(c.sourcePath);
      if (bundle === null) return true;
      const pin = this.#versionPolicy[bundle];
      if (pin === undefined || pin === 'latest') return true;
      const version = parseVersionFromPath(c.sourcePath);
      return version !== null && matchesPin(version, pin);
    });
    return kept.length > 0 ? kept : candidates;
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
