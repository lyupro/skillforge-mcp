import type { SkillMetadata } from './types.js';

export class SkillRegistry {
  readonly #store = new Map<string, SkillMetadata>();

  register(metadata: SkillMetadata): void {
    if (!metadata.name) {
      throw new Error('Skill name must be a non-empty string');
    }
    this.#store.set(metadata.name, metadata);
  }

  get(name: string): SkillMetadata | undefined {
    return this.#store.get(name);
  }

  has(name: string): boolean {
    return this.#store.has(name);
  }

  unregister(name: string): boolean {
    return this.#store.delete(name);
  }

  clear(): void {
    this.#store.clear();
  }

  getAll(): SkillMetadata[] {
    return [...this.#store.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get size(): number {
    return this.#store.size;
  }
}
