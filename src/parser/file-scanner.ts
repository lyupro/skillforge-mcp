import { readdir, access } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_IGNORE_DIRS = ['node_modules', '.git', 'dist', 'coverage'];

interface FileScannerOptions {
  ignoreDirs?: string[];
}

export class FileScanner {
  readonly #ignoreDirs: ReadonlySet<string>;

  constructor(options: FileScannerOptions = {}) {
    this.#ignoreDirs = new Set(options.ignoreDirs ?? DEFAULT_IGNORE_DIRS);
  }

  async scan(folderAbsolutePath: string): Promise<string[]> {
    try {
      await access(folderAbsolutePath);
    } catch {
      throw new Error(`Folder not found: ${folderAbsolutePath}`);
    }

    const entries = await readdir(folderAbsolutePath, {
      withFileTypes: true,
      recursive: true,
    });

    const results: string[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const entryPath = join(
        entry.parentPath ?? (entry as unknown as { path: string }).path ?? folderAbsolutePath,
        entry.name,
      );

      const relativePath = entryPath.slice(folderAbsolutePath.length);
      const segments = relativePath.split(/[\\/]/).filter(Boolean);

      const inIgnored = segments.slice(0, -1).some((seg) => this.#ignoreDirs.has(seg));
      if (inIgnored) continue;

      if (!entry.name.toLowerCase().endsWith('.md')) continue;

      results.push(entryPath);
    }

    return results.sort();
  }
}
