/**
 * Audit-scope extraction.
 *
 * The auto-audit (PatternScanner) historically scanned the whole SKILL.md body.
 * That produces false positives for skills whose PROSE legitimately mentions a
 * flagged pattern — a security skill documenting `exec(` or `shell=True` in a
 * table excludes itself from the registry. With `allowScripts:false` such a
 * mention is never executed, so scanning prose is wrong.
 *
 * `auditTarget: "scripts"` (the default) narrows the scan to fenced code blocks
 * whose info string names an executable language. `auditTarget: "all"` keeps the
 * whole-body behaviour.
 */

/** Info-string languages treated as executable code worth auditing. */
const EXECUTABLE_LANGS = new Set([
  'sh',
  'bash',
  'zsh',
  'shell',
  'console',
  'python',
  'py',
  'js',
  'javascript',
  'ts',
  'typescript',
  'rb',
  'ruby',
  'php',
  'perl',
  'pl',
  'ps1',
  'powershell',
]);

/** Opening fence: ``` or ~~~ (>=3), optional leading whitespace, optional info string. */
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\n`]*)$/;

/**
 * Return the concatenation of every fenced code block in `body` whose language
 * tag is an executable language. Non-executable blocks (md, json, yaml, text,
 * untagged) and all prose are dropped. Fence char and length must match to close
 * a block, mirroring CommonMark.
 */
export function extractExecutableCode(body: string): string {
  const lines = body.split('\n');
  const out: string[] = [];

  let inBlock = false;
  let fenceChar = '';
  let fenceLen = 0;
  let executable = false;

  for (const line of lines) {
    if (!inBlock) {
      const m = FENCE_RE.exec(line);
      if (m === null) continue;
      inBlock = true;
      fenceChar = m[1]![0]!;
      fenceLen = m[1]!.length;
      const lang = m[2]!.trim().split(/[ \t]/)[0]!.toLowerCase();
      executable = EXECUTABLE_LANGS.has(lang);
      continue;
    }

    // Inside a block: a closing fence is the same char, length >= opening, no info string.
    const closeRe = new RegExp(`^[ \\t]*(${fenceChar === '`' ? '`' : '~'}{${fenceLen},})[ \\t]*$`);
    if (closeRe.test(line)) {
      inBlock = false;
      executable = false;
      continue;
    }

    if (executable) out.push(line);
  }

  return out.join('\n');
}

/** Pick what the auto-audit should scan for a given body + target mode. */
export function auditScopeText(body: string, target: 'scripts' | 'all'): string {
  return target === 'all' ? body : extractExecutableCode(body);
}
