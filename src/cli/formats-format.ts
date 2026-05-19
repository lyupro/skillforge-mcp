/**
 * Table rendering for the `formats list` subcommand.
 *
 * Split out of `formats.ts` so the entry module stays under the 400-line
 * file-size gate. Pure formatting — no I/O.
 */

import type { SkillFormat } from '../config/config-schema.js';
import { describeMatch } from './formats-shared.js';

/** Render the registered skill formats as a fixed-width text table. */
export function formatFormatsTable(formats: SkillFormat[]): string {
  if (formats.length === 0) {
    return 'No skill formats registered.\n';
  }
  const rows = formats.map((f) => ({
    id: f.id,
    priority: String(f.priority),
    enabled: f.enabled ? 'yes' : 'no',
    derive: f.deriveNameFromDir ? 'yes' : 'no',
    nameField: f.nameField,
    match: describeMatch(f.match),
  }));
  const headers = {
    id: 'ID',
    priority: 'PRIORITY',
    enabled: 'ENABLED',
    derive: 'DERIVE',
    nameField: 'NAME-FIELD',
    match: 'MATCH',
  };
  const width = {
    id: Math.max(headers.id.length, ...rows.map((r) => r.id.length)),
    priority: Math.max(headers.priority.length, ...rows.map((r) => r.priority.length)),
    enabled: Math.max(headers.enabled.length, ...rows.map((r) => r.enabled.length)),
    derive: Math.max(headers.derive.length, ...rows.map((r) => r.derive.length)),
    nameField: Math.max(headers.nameField.length, ...rows.map((r) => r.nameField.length)),
  };
  const pad = (text: string, len: number): string => text.padEnd(len);
  const lines = [
    `${pad(headers.id, width.id)}  ${pad(headers.priority, width.priority)}  ${pad(headers.enabled, width.enabled)}  ${pad(headers.derive, width.derive)}  ${pad(headers.nameField, width.nameField)}  ${headers.match}`,
  ];
  for (const r of rows) {
    lines.push(
      `${pad(r.id, width.id)}  ${pad(r.priority, width.priority)}  ${pad(r.enabled, width.enabled)}  ${pad(r.derive, width.derive)}  ${pad(r.nameField, width.nameField)}  ${r.match}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
