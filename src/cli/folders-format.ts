/**
 * Table rendering for the `folders list` subcommand.
 *
 * Split out of `folders.ts` so the entry module stays under the 400-line
 * file-size gate. Pure formatting — no I/O.
 */

import type { FolderEntry } from '../config/config-schema.js';

/** Render the registered folders as a fixed-width text table. */
export function formatFoldersTable(folders: FolderEntry[]): string {
  if (folders.length === 0) {
    return 'No folders registered.\n';
  }
  const rows = folders.map((f) => ({
    priority: String(f.priority),
    enabled: f.enabled ? 'yes' : 'no',
    alias: f.alias !== undefined && f.alias.length > 0 ? f.alias : '-',
    tags: f.tags.length > 0 ? f.tags.join(',') : '-',
    path: f.path,
  }));
  const headers = {
    priority: 'PRIORITY',
    enabled: 'ENABLED',
    alias: 'ALIAS',
    tags: 'TAGS',
    path: 'PATH',
  };
  const width = {
    priority: Math.max(headers.priority.length, ...rows.map((r) => r.priority.length)),
    enabled: Math.max(headers.enabled.length, ...rows.map((r) => r.enabled.length)),
    alias: Math.max(headers.alias.length, ...rows.map((r) => r.alias.length)),
    tags: Math.max(headers.tags.length, ...rows.map((r) => r.tags.length)),
  };
  const pad = (text: string, len: number): string => text.padEnd(len);
  const lines = [
    `${pad(headers.priority, width.priority)}  ${pad(headers.enabled, width.enabled)}  ${pad(headers.alias, width.alias)}  ${pad(headers.tags, width.tags)}  ${headers.path}`,
  ];
  for (const r of rows) {
    lines.push(
      `${pad(r.priority, width.priority)}  ${pad(r.enabled, width.enabled)}  ${pad(r.alias, width.alias)}  ${pad(r.tags, width.tags)}  ${r.path}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
