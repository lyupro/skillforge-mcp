/**
 * Rendering for the `config` subcommand: the settings table and its JSON form.
 *
 * Split out of `config.ts` so the entry module stays under the 400-line gate.
 * Pure formatting — no I/O.
 */

import type { SettingSource } from '../config/settings-resolver.js';

export interface SettingRow {
  setting: string;
  value: string;
  source: SettingSource;
  /** What lost, when two sources both supplied a value. Absent when nothing lost. */
  overridden?: string;
}

export interface ConfigReport {
  configPath: string;
  configExists: boolean;
  settings: SettingRow[];
  /** Values too long for a table cell, printed underneath it instead. */
  lists?: Array<{ setting: string; items: string[] }>;
}

/** Render the resolved settings as a fixed-width text table. */
export function formatSettingsTable(report: ConfigReport): string {
  const location = report.configExists
    ? `Config file: ${report.configPath}\n`
    : `Config file: ${report.configPath} (does not exist yet — defaults in use)\n`;

  if (report.settings.length === 0) {
    return `${location}\nNo settings declared.\n`;
  }

  const headers = {
    setting: 'SETTING',
    value: 'VALUE',
    source: 'SOURCE',
    overridden: 'OVERRIDDEN',
  };
  const rows = report.settings.map((row) => ({
    setting: row.setting,
    value: row.value,
    source: row.source,
    overridden: row.overridden ?? '-',
  }));
  // A folder list runs to hundreds of characters; padding every other row to
  // its width turns the table into a horizon of spaces. Past the cap the long
  // value simply overruns its own line and leaves the rest aligned.
  const VALUE_WIDTH_CAP = 48;
  const width = {
    setting: Math.max(headers.setting.length, ...rows.map((r) => r.setting.length)),
    value: Math.min(
      VALUE_WIDTH_CAP,
      Math.max(headers.value.length, ...rows.map((r) => r.value.length)),
    ),
    source: Math.max(headers.source.length, ...rows.map((r) => r.source.length)),
  };
  const pad = (text: string, len: number): string => text.padEnd(len);

  const lines = [
    `${pad(headers.setting, width.setting)}  ${pad(headers.value, width.value)}  ${pad(headers.source, width.source)}  ${headers.overridden}`,
  ];
  for (const r of rows) {
    lines.push(
      `${pad(r.setting, width.setting)}  ${pad(r.value, width.value)}  ${pad(r.source, width.source)}  ${r.overridden}`,
    );
  }
  const blocks = (report.lists ?? [])
    .filter((list) => list.items.length > 0)
    .map((list) => `\n${list.setting}:\n${list.items.map((item) => `  ${item}`).join('\n')}\n`)
    .join('');
  return `${location}\n${lines.join('\n')}\n${blocks}`;
}

/** Same data, machine-readable. */
export function formatSettingsJson(report: ConfigReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
