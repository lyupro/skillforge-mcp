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
 * whose info string names an executable language. Language tags remain attached
 * so the audit can classify matches in their lexical context.
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

export interface ExecutableCodeBlock {
  lang: string;
  text: string;
}

/**
 * Return every fenced executable block with its normalized language tag.
 * Non-executable blocks (md, json, yaml, text, untagged) and prose are dropped.
 * Fence char and length must match to close a block, mirroring CommonMark.
 */
export function extractExecutableCode(body: string): ExecutableCodeBlock[] {
  const lines = body.split('\n');
  const blocks: ExecutableCodeBlock[] = [];

  let inBlock = false;
  let fenceChar = '';
  let fenceLen = 0;
  let current: ExecutableCodeBlock | null = null;
  let currentLineCount = 0;

  for (const line of lines) {
    if (!inBlock) {
      const m = FENCE_RE.exec(line);
      if (m === null) continue;
      inBlock = true;
      fenceChar = m[1]![0]!;
      fenceLen = m[1]!.length;
      const lang = m[2]!.trim().split(/[ \t]/)[0]!.toLowerCase();
      current = EXECUTABLE_LANGS.has(lang) ? { lang, text: '' } : null;
      currentLineCount = 0;
      continue;
    }

    // Inside a block: a closing fence is the same char, length >= opening, no info string.
    const closeRe = new RegExp(`^[ \\t]*(${fenceChar === '`' ? '`' : '~'}{${fenceLen},})[ \\t]*$`);
    if (closeRe.test(line)) {
      if (current !== null) blocks.push(current);
      inBlock = false;
      current = null;
      currentLineCount = 0;
      continue;
    }

    if (current !== null) {
      current.text += currentLineCount === 0 ? line : `\n${line}`;
      currentLineCount++;
    }
  }

  if (current !== null) blocks.push(current);
  return blocks;
}
