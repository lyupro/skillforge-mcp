import type { ExecutableCodeBlock } from './audit-scope.js';
import type { PatternMatch } from './pattern-scanner.js';

export type InformationalReason =
  | 'scanner-command context'
  | 'Python string literal'
  | 'Python comment';

export type AuditMatchClassification =
  | { blocking: true }
  | { blocking: false; reason: InformationalReason };

interface Span {
  start: number;
  end: number;
  reason: InformationalReason;
}

const SHELL_LANGS = new Set(['sh', 'bash', 'zsh', 'shell', 'console']);
const PYTHON_LANGS = new Set(['python', 'py']);
const PYTHON_PREFIXES = new Set(['r', 'b', 'f', 'br', 'rb', 'fr', 'rf']);
const SCANNER_COMMAND_RE = /^[ \t]*(?:grep|egrep|fgrep|rg|ag|ack)(?:[ \t]|$)/;
const GIT_GREP_RE = /^[ \t]*git[ \t]+grep(?:[ \t]|$)/;

function containsMatch(span: Span, match: PatternMatch): boolean {
  return match.index >= span.start && match.index + match.match.length <= span.end;
}

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

function pythonStringStart(
  text: string,
  index: number,
): { quote: number; interpolated: boolean } | null {
  const char = text[index];
  if ((char === '"' || char === "'") && !isIdentifierChar(text[index - 1])) {
    return { quote: index, interpolated: false };
  }
  if (char === undefined || !/[rRbBfF]/.test(char) || isIdentifierChar(text[index - 1])) {
    return null;
  }

  for (const length of [2, 1]) {
    const prefix = text.slice(index, index + length).toLowerCase();
    const quote = text[index + length];
    if (PYTHON_PREFIXES.has(prefix) && (quote === '"' || quote === "'")) {
      return { quote: index + length, interpolated: prefix.includes('f') };
    }
  }
  return null;
}

function pythonSpans(text: string): { spans: Span[]; ambiguous: boolean } {
  const spans: Span[] = [];
  let index = 0;

  while (index < text.length) {
    if (text[index] === '#') {
      const end = text.indexOf('\n', index);
      const spanEnd = end === -1 ? text.length : end;
      spans.push({ start: index, end: spanEnd, reason: 'Python comment' });
      index = spanEnd;
      continue;
    }

    const start = pythonStringStart(text, index);
    if (start === null) {
      index++;
      continue;
    }

    const quoteChar = text[start.quote]!;
    const triple = text.slice(start.quote, start.quote + 3) === quoteChar.repeat(3);
    const delimiterLength = triple ? 3 : 1;
    const contentStart = start.quote + delimiterLength;
    let cursor = contentStart;
    let closed = false;

    while (cursor < text.length) {
      if (text[cursor] === '\\') {
        if (cursor + 1 >= text.length) return { spans, ambiguous: true };
        cursor += 2;
        continue;
      }
      if (!triple && text[cursor] === '\n') return { spans, ambiguous: true };
      if (text.slice(cursor, cursor + delimiterLength) === quoteChar.repeat(delimiterLength)) {
        // f-strings execute their replacement fields, so their content is never inert.
        if (!start.interpolated) {
          spans.push({ start: contentStart, end: cursor, reason: 'Python string literal' });
        }
        index = cursor + delimiterLength;
        closed = true;
        break;
      }
      cursor++;
    }

    if (!closed) return { spans, ambiguous: true };
  }

  return { spans, ambiguous: false };
}

interface ShellSegment {
  start: number;
  end: number;
  quoted: Span[];
  /** Segment contains an unquoted command/process substitution — its quoted
   *  spans may belong to a nested executable command, never trust them. */
  tainted: boolean;
}

function shellSegments(text: string): { segments: ShellSegment[]; ambiguous: boolean } {
  const segments: ShellSegment[] = [];
  let segmentStart = 0;
  let quote: '"' | "'" | null = null;
  let quoteStart = 0;
  let quoted: Span[] = [];
  let tainted = false;

  const finishSegment = (end: number, nextStart: number): void => {
    segments.push({ start: segmentStart, end, quoted, tainted });
    segmentStart = nextStart;
    quoted = [];
    tainted = false;
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quote !== null) {
      if (quote === '"' && (char === '`' || (char === '$' && text[index + 1] === '('))) {
        return { segments, ambiguous: true };
      }
      if (char === '\\' && quote === '"') {
        if (index + 1 >= text.length) return { segments, ambiguous: true };
        index++;
      } else if (char === quote) {
        quoted.push({
          start: quoteStart + 1,
          end: index,
          reason: 'scanner-command context',
        });
        quote = null;
      }
      continue;
    }

    if (char === '\\') {
      if (index + 1 >= text.length) return { segments, ambiguous: true };
      index++;
      continue;
    }
    if (char === '#' && (index === 0 || /[ \t\n;|&]/.test(text[index - 1]!))) {
      const newline = text.indexOf('\n', index);
      if (newline === -1) break;
      index = newline - 1;
      continue;
    }
    if (char === '`' || ((char === '$' || char === '<' || char === '>') && text[index + 1] === '(')) {
      tainted = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      quoteStart = index;
      continue;
    }

    const pair = text.slice(index, index + 2);
    if (pair === '&&' || pair === '||') {
      finishSegment(index, index + 2);
      index++;
    } else if (char === '|' || char === ';' || char === '\n' || char === '&') {
      finishSegment(index, index + 1);
    }
  }

  if (quote !== null) return { segments, ambiguous: true };
  finishSegment(text.length, text.length);
  return { segments, ambiguous: false };
}

function classifyShell(text: string, match: PatternMatch): AuditMatchClassification {
  const parsed = shellSegments(text);
  if (parsed.ambiguous) return { blocking: true };

  const matchEnd = match.index + match.match.length;
  const segment = parsed.segments.find(
    (candidate) => match.index >= candidate.start && matchEnd <= candidate.end,
  );
  if (segment === undefined) return { blocking: true };
  if (segment.tainted) return { blocking: true };

  const command = text.slice(segment.start, segment.end);
  const commandMatch = SCANNER_COMMAND_RE.exec(command) ?? GIT_GREP_RE.exec(command);
  if (commandMatch === null) return { blocking: true };

  const commandEnd = segment.start + commandMatch[0].length;
  const inQuotedArgument = segment.quoted.some(
    (span) => span.start >= commandEnd && containsMatch(span, match),
  );
  return inQuotedArgument
    ? { blocking: false, reason: 'scanner-command context' }
    : { blocking: true };
}

function classifyPython(text: string, match: PatternMatch): AuditMatchClassification {
  const parsed = pythonSpans(text);
  if (parsed.ambiguous) return { blocking: true };
  const span = parsed.spans.find((candidate) => containsMatch(candidate, match));
  return span === undefined ? { blocking: true } : { blocking: false, reason: span.reason };
}

export function classifyAuditMatch(
  block: ExecutableCodeBlock,
  match: PatternMatch,
): AuditMatchClassification {
  if (SHELL_LANGS.has(block.lang)) return classifyShell(block.text, match);
  if (PYTHON_LANGS.has(block.lang)) return classifyPython(block.text, match);
  return { blocking: true };
}
