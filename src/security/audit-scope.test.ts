import { describe, it, expect } from 'vitest';
import { extractExecutableCode } from './audit-scope.js';

describe('extractExecutableCode', () => {
  it('keeps fenced executable blocks, drops prose', () => {
    const body = [
      'Some prose mentioning exec( in a sentence.',
      '',
      '```python',
      'subprocess.run(cmd, shell=True)',
      '```',
      '',
      'More prose with eval( here.',
    ].join('\n');
    const out = extractExecutableCode(body);
    expect(out).toEqual([{ lang: 'python', text: 'subprocess.run(cmd, shell=True)' }]);
  });

  it('drops non-executable fenced blocks (text/json/none)', () => {
    const body = [
      '```',
      'exec( in an untagged block',
      '```',
      '```json',
      '{ "x": "exec(" }',
      '```',
      '```text',
      'shell=True in a text block',
      '```',
    ].join('\n');
    expect(extractExecutableCode(body)).toEqual([]);
  });

  it('ignores patterns that appear only in a markdown table (prose)', () => {
    // Mirrors security-guidance SKILL.md line 22: pattern names live in a table.
    const body = '| `child_process.exec`, `exec(`, `execSync(` | Substring | injection |';
    expect(extractExecutableCode(body)).toEqual([]);
  });

  it('handles tilde fences and language with extra info string', () => {
    const body = ['~~~ bash copy', 'rm -rf shell=True', '~~~'].join('\n');
    expect(extractExecutableCode(body)).toEqual([{ lang: 'bash', text: 'rm -rf shell=True' }]);
  });

  it('does not close on a shorter/longer mismatched fence inside block', () => {
    const body = ['````python', '```', 'exec(1)', '````'].join('\n');
    // Opening fence is 4 backticks; the inner 3-backtick line stays content.
    const out = extractExecutableCode(body);
    expect(out).toEqual([{ lang: 'python', text: '```\nexec(1)' }]);
  });

  it('keeps block order and normalized language tags', () => {
    const body = ['```BASH', 'echo ok', '```', '```py', 'print(1)', '```'].join('\n');
    expect(extractExecutableCode(body)).toEqual([
      { lang: 'bash', text: 'echo ok' },
      { lang: 'py', text: 'print(1)' },
    ]);
  });

  it('preserves leading blank lines inside a block', () => {
    const body = ['```python', '', 'eval(user_input)', '```'].join('\n');
    expect(extractExecutableCode(body)).toEqual([
      { lang: 'python', text: '\neval(user_input)' },
    ]);
  });
});
