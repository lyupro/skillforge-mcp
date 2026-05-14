import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface ScriptsDirDetector {
  detect(skillFilePath: string): Promise<string | undefined>;
}

export class FsScriptsDirDetector implements ScriptsDirDetector {
  async detect(skillFilePath: string): Promise<string | undefined> {
    const candidate = join(dirname(skillFilePath), 'scripts');
    try {
      const s = await stat(candidate);
      if (s.isDirectory()) return candidate;
      return undefined;
    } catch {
      return undefined;
    }
  }
}
