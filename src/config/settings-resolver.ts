export type SettingSource = 'config' | 'env' | 'default';

export interface SettingParser<T> {
  parse(value: unknown): T;
}

export interface SettingDeclaration<T> {
  settingKey: string;
  envKey: string | readonly string[];
  configPath?: readonly string[];
  isEnvValueUnset?: (value: string) => boolean;
  parser: SettingParser<T>;
  defaultValue: T;
  expected: string;
}

export interface SettingConflict<T> {
  settingKey: string;
  configValue: T;
  envKey: string;
  envValue: string;
}

export interface ResolvedSetting<T> {
  value: T;
  source: SettingSource;
  conflict?: SettingConflict<T>;
}

export class SettingResolutionError extends Error {
  readonly settingKey: string;
  readonly source: Exclude<SettingSource, 'default'>;
  readonly received: unknown;
  readonly expected: string;
  /** Which environment name carried the bad value — a setting may declare several. */
  readonly envKey: string | undefined;

  constructor(
    settingKey: string,
    source: Exclude<SettingSource, 'default'>,
    received: unknown,
    expected: string,
    options?: ErrorOptions & { envKey?: string },
  ) {
    const envSuffix = options?.envKey === undefined ? '' : `; environment key ${options.envKey}`;
    super(
      `Invalid setting ${settingKey} from ${source}: received ${formatReceived(received)}; expected ${expected}${envSuffix}`,
      options,
    );
    this.name = 'SettingResolutionError';
    this.settingKey = settingKey;
    this.source = source;
    this.received = received;
    this.expected = expected;
    this.envKey = options?.envKey;
  }
}

export function resolveSetting<T>(
  declaration: SettingDeclaration<T>,
  persistedConfig: unknown,
  environment: Readonly<Record<string, string | undefined>>,
): ResolvedSetting<T> {
  const { settingKey } = declaration;
  if (declaration.configPath?.length === 0) {
    throw new Error('Setting configPath must contain at least one key when provided');
  }
  const configValue =
    declaration.configPath === undefined
      ? undefined
      : readConfigValue(persistedConfig, declaration.configPath);
  const envKeys =
    typeof declaration.envKey === 'string' ? [declaration.envKey] : declaration.envKey;
  const selectedEnv = envKeys
    .map((envKey) => ({ envKey, envValue: environment[envKey] }))
    .find(
      (candidate): candidate is { envKey: string; envValue: string } =>
        candidate.envValue !== undefined && candidate.envValue !== '',
    );
  const activeEnv =
    selectedEnv !== undefined && declaration.isEnvValueUnset?.(selectedEnv.envValue) !== true
      ? selectedEnv
      : undefined;

  // Parsed up front even when the environment wins: a malformed config key is
  // an error whoever ends up supplying the value. Boxed so that `undefined`
  // means "the key is absent" rather than "the key parsed to undefined".
  const parsedConfig: { value: T } | undefined =
    configValue !== undefined
      ? { value: parseValue(declaration, settingKey, 'config', configValue) }
      : undefined;

  if (activeEnv !== undefined) {
    const value = parseValue(
      declaration,
      settingKey,
      'env',
      activeEnv.envValue,
      activeEnv.envKey,
    );
    return parsedConfig === undefined
      ? { value, source: 'env' }
      : {
          value,
          source: 'env',
          conflict: {
            settingKey,
            configValue: parsedConfig.value,
            envKey: activeEnv.envKey,
            envValue: activeEnv.envValue,
          },
        };
  }

  if (parsedConfig !== undefined) {
    return { value: parsedConfig.value, source: 'config' };
  }

  return { value: declaration.defaultValue, source: 'default' };
}

export function integerAtLeast(minimum: number): SettingParser<number> {
  return {
    parse(value: unknown): number {
      const parsed =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && /^-?\d+$/.test(value)
            ? Number(value)
            : Number.NaN;
      if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error('invalid integer');
      return parsed;
    },
  };
}

export const booleanParser: SettingParser<boolean> = {
  parse(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error('invalid boolean');
  },
};

export const nonEmptyStringParser: SettingParser<string> = {
  parse(value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error('invalid non-empty string');
    }
    return value;
  },
};

export function stringListParser(delimiter: string): SettingParser<string[]> {
  if (delimiter === '') throw new Error('List delimiter must not be empty');

  return {
    parse(value: unknown): string[] {
      const items = Array.isArray(value)
        ? value
        : typeof value === 'string'
          ? value.split(delimiter)
          : undefined;
      if (
        items === undefined ||
        items.some((item) => typeof item !== 'string' || item.trim() === '')
      ) {
        throw new Error('invalid string list');
      }
      return items.map((item) => item.trim());
    },
  };
}

function parseValue<T>(
  declaration: SettingDeclaration<T>,
  settingKey: string,
  source: Exclude<SettingSource, 'default'>,
  received: unknown,
  envKey?: string,
): T {
  try {
    return declaration.parser.parse(received);
  } catch (error) {
    throw new SettingResolutionError(settingKey, source, received, declaration.expected, {
      cause: error,
      ...(envKey === undefined ? {} : { envKey }),
    });
  }
}

function readConfigValue(config: unknown, path: readonly string[]): unknown {
  let current = config;
  for (const key of path) {
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function formatReceived(value: unknown): string {
  const serialized = JSON.stringify(value);
  return serialized ?? String(value);
}
