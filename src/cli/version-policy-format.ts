/**
 * Table rendering for the `version-policy list` subcommand.
 *
 * Split out of `version-policy.ts` so the entry module stays under the
 * 400-line file-size gate. Pure formatting — no I/O.
 */

/** Render the version policies as a fixed-width BUNDLE | POLICY table, sorted by bundle. */
export function formatVersionPolicyTable(record: Record<string, string>): string {
  const bundles = Object.keys(record).sort();
  if (bundles.length === 0) {
    return 'No version policies set.\n';
  }
  const rows = bundles.map((bundle) => ({ bundle, policy: record[bundle]! }));
  const headers = { bundle: 'BUNDLE', policy: 'POLICY' };
  const width = {
    bundle: Math.max(headers.bundle.length, ...rows.map((r) => r.bundle.length)),
  };
  const pad = (text: string, len: number): string => text.padEnd(len);
  const lines = [`${pad(headers.bundle, width.bundle)}  ${headers.policy}`];
  for (const r of rows) {
    lines.push(`${pad(r.bundle, width.bundle)}  ${r.policy}`);
  }
  return `${lines.join('\n')}\n`;
}
