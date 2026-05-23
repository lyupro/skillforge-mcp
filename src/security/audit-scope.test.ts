import { describe, it, expect } from 'vitest';
import { extractExecutableCode, auditScopeText } from './audit-scope.js';

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
    expect(out).toContain('shell=True');
    expect(out).not.toContain('Some prose');
    expect(out).not.toContain('More prose');
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
    expect(extractExecutableCode(body)).toBe('');
  });

  it('ignores patterns that appear only in a markdown table (prose)', () => {
    // Mirrors security-guidance SKILL.md line 22: pattern names live in a table.
    const body = '| `child_process.exec`, `exec(`, `execSync(` | Substring | injection |';
    expect(extractExecutableCode(body)).toBe('');
  });

  it('handles tilde fences and language with extra info string', () => {
    const body = ['~~~ bash copy', 'rm -rf shell=True', '~~~'].join('\n');
    expect(extractExecutableCode(body)).toContain('shell=True');
  });

  it('does not close on a shorter/longer mismatched fence inside block', () => {
    const body = ['````python', '```', 'exec(1)', '````'].join('\n');
    // Opening fence is 4 backticks; the inner 3-backtick line stays content.
    const out = extractExecutableCode(body);
    expect(out).toContain('exec(1)');
  });
});

describe('auditScopeText', () => {
  const body = ['prose exec(', '```python', 'shell=True', '```'].join('\n');

  it('scripts mode → executable code only', () => {
    const out = auditScopeText(body, 'scripts');
    expect(out).toContain('shell=True');
    expect(out).not.toContain('prose exec(');
  });

  it('all mode → whole body', () => {
    expect(auditScopeText(body, 'all')).toBe(body);
  });
});
