export interface PatternMatch {
  /** Regex source as supplied to the scanner (caller's original string). */
  pattern: string;
  /** Substring of input that matched. */
  match: string;
  /** Zero-based character offset of the match in the input. */
  index: number;
}

export interface ScanResult {
  /** true when zero patterns matched. */
  safe: boolean;
  /** All matches across all patterns, ordered by `index` ascending. */
  matches: PatternMatch[];
}

export interface PatternScannerOptions {
  /** Regex source strings. Each will be compiled once with the `g` flag for full-input scan. */
  patterns: string[];
  /** Compile flags appended to the default `g`. Defaults to `''` (case-sensitive). Pass `'i'` for case-insensitive. */
  flags?: string;
}

interface CompiledEntry {
  source: string;
  regex: RegExp;
}

export class PatternScanner {
  readonly #compiled: CompiledEntry[];

  constructor(opts: PatternScannerOptions) {
    const extraFlags = opts.flags ?? '';
    const seen = new Set<string>();
    this.#compiled = [];

    for (const source of opts.patterns) {
      if (source === '') {
        process.stderr.write(`[skillforge:pattern-scanner] invalid pattern "": empty pattern discarded\n`);
        continue;
      }
      if (seen.has(source)) {
        continue;
      }
      seen.add(source);

      try {
        const regex = new RegExp(source, 'g' + extraFlags);
        this.#compiled.push({ source, regex });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[skillforge:pattern-scanner] invalid pattern "${source}": ${msg}\n`);
      }
    }
  }

  scan(input: string): ScanResult {
    const matches: PatternMatch[] = [];

    for (const { source, regex } of this.#compiled) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(input)) !== null) {
        if (m[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        matches.push({ pattern: source, match: m[0], index: m.index });
      }
    }

    matches.sort((a, b) => a.index - b.index);

    return { safe: matches.length === 0, matches };
  }

  getPatterns(): string[] {
    return this.#compiled.map((e) => e.source);
  }
}
