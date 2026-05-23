/**
 * Table rendering for the `security` subcommand list views.
 *
 * Split out of `security.ts` so the entry module stays under the 400-line
 * file-size gate. Pure formatting — no I/O.
 */

import { classifyPattern } from '../security/blacklist-pattern.js';

/** Render a flat string list (audit-exceptions / audit-patterns) as a fixed-width table. */
export function formatStringListTable(title: string, items: readonly string[]): string {
  if (items.length === 0) {
    return `No ${title} configured.\n`;
  }
  const header = title.toUpperCase();
  const lines = [header];
  for (const item of items) {
    lines.push(item);
  }
  return `${lines.join('\n')}\n`;
}

/** Render the blacklist as a fixed-width table showing PATTERN + classified KIND. */
export function formatBlacklistTable(patterns: readonly string[]): string {
  if (patterns.length === 0) {
    return 'No blacklist patterns configured.\n';
  }
  const rows = patterns.map((p) => ({
    pattern: p,
    kind: classifyPattern(p),
  }));
  const headers = { pattern: 'PATTERN', kind: 'KIND' };
  const width = {
    pattern: Math.max(headers.pattern.length, ...rows.map((r) => r.pattern.length)),
  };
  const pad = (text: string, len: number): string => text.padEnd(len);
  const lines = [`${pad(headers.pattern, width.pattern)}  ${headers.kind}`];
  for (const r of rows) {
    lines.push(`${pad(r.pattern, width.pattern)}  ${r.kind}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Render the current audit-target value as a one-line statement. */
export function formatAuditTarget(value: string): string {
  return `audit-target: ${value}\n`;
}
