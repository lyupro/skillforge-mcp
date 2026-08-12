import { describe, expect, it } from 'vitest';
import { classifyAuditMatch } from './audit-context.js';
import { PatternScanner } from './pattern-scanner.js';

function classifications(lang: string, text: string, patterns: string[]) {
  const scanner = new PatternScanner({ patterns });
  return scanner.scan(text).matches.map((match) => classifyAuditMatch({ lang, text }, match));
}

describe('shell audit context', () => {
  it.each(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack'])(
    'treats a quoted pattern passed to %s as informational',
    (command) => {
      expect(classifications('bash', `${command} "eval("`, ['eval\\('])).toEqual([
        { blocking: false, reason: 'scanner-command context' },
      ]);
    },
  );

  it('recognizes git grep only within its own pipeline segment', () => {
    const text = 'git diff --cached | git grep "shell=True"';
    expect(classifications('shell', text, ['shell=True'])).toEqual([
      { blocking: false, reason: 'scanner-command context' },
    ]);
  });

  it.each([
    'echo "eval("',
    'python -c "eval(input())"',
    'sh -c "exec(x)"',
    'unknown "base64.b64decode"',
  ])('keeps quoted arguments of non-scanner commands blocking: %s', (text) => {
    expect(classifications('sh', text, ['eval\\(', 'exec\\(', 'base64\\.b64decode']))
      .toContainEqual({ blocking: true });
  });

  it('fails closed on an unterminated quoted scanner argument', () => {
    expect(classifications('bash', 'rg "eval(', ['eval\\('])).toEqual([{ blocking: true }]);
  });

  it.each([
    'rg "$(python -c \'eval(input())\')"',
    'rg pattern # "eval(input())"',
  ])('does not treat non-literal shell text as a quoted scanner argument: %s', (text) => {
    expect(classifications('bash', text, ['eval\\('])).toEqual([{ blocking: true }]);
  });

  it.each([
    'grep $(python -c "eval(input())") file',
    'grep `python -c "eval(input())"` file',
    'grep -f <(python -c "eval(input())") file',
  ])('blocks matches in a scanner segment tainted by substitution: %s', (text) => {
    expect(classifications('bash', text, ['eval\\('])).toEqual([{ blocking: true }]);
  });

  it('splits on a single & so a background command is not a scanner argument', () => {
    const text = 'grep "safe" file & python -c "eval(input())"';
    expect(classifications('bash', text, ['eval\\('])).toEqual([{ blocking: true }]);
  });

  it('keeps a single-quoted substitution opener inert', () => {
    expect(classifications('bash', `grep '$(x)' "eval("`, ['eval\\('])).toEqual([
      { blocking: false, reason: 'scanner-command context' },
    ]);
  });

  it('keeps a quoted scanner pattern informational before a redirection ampersand', () => {
    expect(classifications('bash', 'grep "shell=True" file 2>&1', ['shell=True'])).toEqual([
      { blocking: false, reason: 'scanner-command context' },
    ]);
  });
});

describe('Python audit context', () => {
  it.each([
    "'eval()'",
    'r"exec()"',
    "b'''base64.b64decode'''",
  ])('treats a match inside a closed string as informational: %s', (text) => {
    expect(classifications('python', text, [
      'shell=True',
      'eval\\(',
      'exec\\(',
      'base64\\.b64decode',
    ])).toContainEqual({ blocking: false, reason: 'Python string literal' });
  });

  it('treats a match inside a comment as informational', () => {
    expect(classifications('py', '# avoid eval(user_input)', ['eval\\('])).toEqual([
      { blocking: false, reason: 'Python comment' },
    ]);
  });

  it.each([
    'subprocess.run(command, shell=True)',
    'eval(user_input)',
    'exec(untrusted_code)',
    'base64.b64decode(untrusted_payload)',
  ])('keeps executable Python matches blocking: %s', (text) => {
    expect(classifications('python', text, [
      'shell=True',
      'eval\\(',
      'exec\\(',
      'base64\\.b64decode',
    ])).toContainEqual({ blocking: true });
  });

  it.each([
    'f"{eval(user_input)}"',
    'rf"{exec(payload)}"',
    'f"""multi\nline {eval(x)}"""',
    'f"shell=True"',
  ])('keeps f-string content blocking — replacement fields execute: %s', (text) => {
    expect(classifications('python', text, [
      'shell=True',
      'eval\\(',
      'exec\\(',
      'base64\\.b64decode',
    ])).toContainEqual({ blocking: true });
  });

  it('fails closed on an unterminated string', () => {
    expect(classifications('python', 'message = "eval(', ['eval\\('])).toEqual([
      { blocking: true },
    ]);
  });
});

describe('unclassified executable languages', () => {
  it('keeps matches in JavaScript strings blocking', () => {
    expect(classifications('js', 'const text = "eval(";', ['eval\\('])).toEqual([
      { blocking: true },
    ]);
  });
});
