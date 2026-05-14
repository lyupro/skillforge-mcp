interface MetadataCacheOptions {
  ttlMs?: number;
  now?: () => number;
}

export class SkillMetadataCache {
  readonly #ttlMs: number;
  readonly #now: () => number;
  #freshAt: number | null = null;

  constructor(options?: MetadataCacheOptions) {
    const ttlMs = options?.ttlMs ?? 300_000;
    if (ttlMs <= 0) {
      throw new Error('ttlMs must be a positive number');
    }
    this.#ttlMs = ttlMs;
    this.#now = options?.now ?? Date.now;
  }

  isValid(): boolean {
    return this.#freshAt !== null && this.#now() - this.#freshAt < this.#ttlMs;
  }

  markFresh(): void {
    this.#freshAt = this.#now();
  }

  invalidate(): void {
    this.#freshAt = null;
  }

  expiresAt(): number | null {
    if (this.#freshAt === null) return null;
    return this.#freshAt + this.#ttlMs;
  }

  get ttlMs(): number {
    return this.#ttlMs;
  }
}
