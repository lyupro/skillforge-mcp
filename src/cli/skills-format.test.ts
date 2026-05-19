import { describe, it, expect } from 'vitest';
import { formatReloadStats } from './skills-format.js';
import type { RebuildStats } from '../tools/loader.js';

describe('formatReloadStats — error breakdown', () => {
  it('zero errors emits a clean count', () => {
    const stats: RebuildStats = { skills: ['a', 'b'], errors: [] };
    const out = formatReloadStats(stats, 2, ['/skills']);
    expect(out).toContain('skills:  2');
    expect(out).toContain('errors:  0');
    expect(out).not.toContain('folder-failures');
  });

  it('splits the sink into folder-failures vs file-skips by path match', () => {
    const folderPaths = ['/configured-a', '/configured-b'];
    const stats: RebuildStats = {
      skills: [],
      errors: [
        { path: '/configured-a', message: 'Folder not found' },
        { path: '/configured-b', message: 'Folder not found' },
        { path: '/configured-a/bad.md', message: 'missing required frontmatter field' },
        { path: '/configured-a/other.md', message: 'parse error' },
      ],
    };
    const out = formatReloadStats(stats, 2, folderPaths);
    expect(out).toContain('errors:  4 (folder-failures: 2, file-skips: 2)');
    // Per-error lines still render below the summary.
    expect(out).toContain('/configured-a/bad.md');
  });

  it('treats every error as a file skip when no folder paths are provided', () => {
    const stats: RebuildStats = {
      skills: [],
      errors: [{ path: '/some/folder', message: 'oops' }],
    };
    const out = formatReloadStats(stats, 1);
    expect(out).toContain('errors:  1 (folder-failures: 0, file-skips: 1)');
  });
});
