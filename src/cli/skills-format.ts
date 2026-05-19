/**
 * Table rendering for the `skills list` and `skills get` subcommands.
 *
 * Split out of `skills.ts` so the entry module stays under the 400-line
 * file-size gate. Pure formatting — no I/O.
 */

import type { SkillSummary, SkillContent } from '../core/types.js';
import type { RebuildStats } from '../tools/loader.js';

const DESC_MAX = 60;

function truncate(s: string | undefined, max: number): string {
  if (s === undefined || s.length === 0) return '-';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** Render the skills list as a fixed-width text table. */
export function formatSkillsTable(
  skills: SkillSummary[],
  folderLabel: (path: string) => string,
): string {
  if (skills.length === 0) {
    return 'No skills found.\n';
  }
  const rows = skills.map((s) => ({
    name: s.name,
    source: s.format,
    folder: folderLabel(s.folder),
    description: truncate(s.description, DESC_MAX),
  }));
  const headers = {
    name: 'NAME',
    source: 'SOURCE',
    folder: 'FOLDER',
    description: 'DESCRIPTION',
  };
  const width = {
    name: Math.max(headers.name.length, ...rows.map((r) => r.name.length)),
    source: Math.max(headers.source.length, ...rows.map((r) => r.source.length)),
    folder: Math.max(headers.folder.length, ...rows.map((r) => r.folder.length)),
  };
  const pad = (text: string, len: number): string => text.padEnd(len);
  const lines = [
    `${pad(headers.name, width.name)}  ${pad(headers.source, width.source)}  ${pad(headers.folder, width.folder)}  ${headers.description}`,
  ];
  for (const r of rows) {
    lines.push(
      `${pad(r.name, width.name)}  ${pad(r.source, width.source)}  ${pad(r.folder, width.folder)}  ${r.description}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** Render a single skill's content in human-readable form. */
export function formatSkillGet(skill: SkillContent): string {
  const lines: string[] = [];
  lines.push(`name:        ${skill.name}`);
  lines.push(`format:      ${skill.format}`);
  lines.push(`folder:      ${skill.folder}`);
  lines.push(`sourcePath:  ${skill.sourcePath}`);
  if (skill.description !== undefined) {
    lines.push(`description: ${skill.description}`);
  }
  if (skill.tags !== undefined && skill.tags.length > 0) {
    lines.push(`tags:        ${skill.tags.join(', ')}`);
  }
  if (skill.strategy !== undefined) {
    lines.push(`strategy:    ${skill.strategy}`);
  }
  lines.push('');
  lines.push('--- body ---');
  lines.push(skill.body.trimEnd());
  return `${lines.join('\n')}\n`;
}

/** Render the reload summary in human-readable form. */
export function formatReloadStats(
  stats: RebuildStats,
  folderCount: number,
): string {
  const lines: string[] = [];
  lines.push(`Reload complete.`);
  lines.push(`  folders: ${folderCount}`);
  lines.push(`  skills:  ${stats.skills.length}`);
  if (stats.errors.length > 0) {
    lines.push(`  errors:  ${stats.errors.length}`);
    for (const e of stats.errors) {
      lines.push(`    ${e.path}: ${e.message}`);
    }
  } else {
    lines.push(`  errors:  0`);
  }
  return `${lines.join('\n')}\n`;
}

/** Render the reindex summary in human-readable form. */
export function formatReindexStats(
  stats: RebuildStats,
  indexPath: string,
  buildMs: number,
): string {
  const lines: string[] = [];
  lines.push(`Reindex complete.`);
  lines.push(`  skills:    ${stats.skills.length}`);
  lines.push(`  indexPath: ${indexPath}`);
  lines.push(`  buildTime: ${buildMs}ms`);
  if (stats.errors.length > 0) {
    lines.push(`  errors:    ${stats.errors.length}`);
    for (const e of stats.errors) {
      lines.push(`    ${e.path}: ${e.message}`);
    }
  } else {
    lines.push(`  errors:    0`);
  }
  return `${lines.join('\n')}\n`;
}
