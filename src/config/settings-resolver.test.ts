import { describe, expect, it } from 'vitest';
import {
  SettingResolutionError,
  booleanParser,
  integerAtLeast,
  nonEmptyStringParser,
  resolveSetting,
  stringListParser,
  type SettingDeclaration,
} from './settings-resolver.js';

interface ParserCase<T> {
  label: string;
  declaration: SettingDeclaration<T>;
  envValue: string;
  configValue: T;
  defaultValue: T;
}

const parserCases: ParserCase<unknown>[] = [
  {
    label: 'bounded integer',
    declaration: {
      envKey: 'SKILLFORGE_TTL_MS',
      configPath: ['cache', 'metadataTtlMs'],
      parser: integerAtLeast(0),
      defaultValue: 300_000,
      expected: 'a non-negative integer',
    },
    envValue: '300000',
    configValue: 60_000,
    defaultValue: 300_000,
  },
  {
    label: 'boolean',
    declaration: {
      envKey: 'SKILLFORGE_WATCHER',
      configPath: ['watcher', 'enabled'],
      parser: booleanParser,
      defaultValue: true,
      expected: 'true or false',
    },
    envValue: 'false',
    configValue: true,
    defaultValue: true,
  },
  {
    label: 'non-empty string',
    declaration: {
      envKey: 'SKILLFORGE_INDEX_PATH',
      configPath: ['cache', 'indexPath'],
      parser: nonEmptyStringParser,
      defaultValue: 'default.json',
      expected: 'a non-empty string',
    },
    envValue: 'env.json',
    configValue: 'config.json',
    defaultValue: 'default.json',
  },
  {
    label: 'delimited string list',
    declaration: {
      envKey: 'SKILLFORGE_TAGS',
      configPath: ['tags'],
      parser: stringListParser(','),
      defaultValue: ['default'],
      expected: 'a comma-separated list of non-empty strings',
    },
    envValue: 'env,shared',
    configValue: ['config', 'shared'],
    defaultValue: ['default'],
  },
];

describe.each(parserCases)('$label parser and resolution', (parserCase) => {
  const { declaration } = parserCase;

  it('uses the default when neither source is set', () => {
    expect(resolveSetting(declaration, {}, {})).toEqual({
      value: parserCase.defaultValue,
      source: 'default',
    });
  });

  it('uses the environment when only it is set', () => {
    const result = resolveSetting(declaration, {}, { [declaration.envKey]: parserCase.envValue });
    expect(result.value).toEqual(declaration.parser.parse(parserCase.envValue));
    expect(result.source).toBe('env');
    expect(result.conflict).toBeUndefined();
  });

  it('uses persisted config when only it is set', () => {
    const config = nestedConfig(declaration.configPath, parserCase.configValue);
    expect(resolveSetting(declaration, config, {})).toEqual({
      value: parserCase.configValue,
      source: 'config',
    });
  });

  it('lets environment win and reports both conflicting source values', () => {
    const config = nestedConfig(declaration.configPath, parserCase.configValue);
    const result = resolveSetting(declaration, config, {
      [declaration.envKey]: parserCase.envValue,
    });
    expect(result).toEqual({
      value: declaration.parser.parse(parserCase.envValue),
      source: 'env',
      conflict: {
        settingKey: declaration.configPath.at(-1),
        configValue: parserCase.configValue,
        envKey: declaration.envKey,
        envValue: parserCase.envValue,
      },
    });
  });

  it('treats an empty environment string as unset when config is set', () => {
    const config = nestedConfig(declaration.configPath, parserCase.configValue);
    expect(resolveSetting(declaration, config, { [declaration.envKey]: '' })).toEqual({
      value: parserCase.configValue,
      source: 'config',
    });
  });

  it('treats an empty environment string as unset when config is absent', () => {
    expect(resolveSetting(declaration, {}, { [declaration.envKey]: '' })).toEqual({
      value: parserCase.defaultValue,
      source: 'default',
    });
  });
});

describe('invalid values', () => {
  const invalidCases = [
    {
      declaration: parserCases[0]!.declaration,
      value: 'not-a-number',
    },
    {
      declaration: parserCases[1]!.declaration,
      value: 'sometimes',
    },
    {
      declaration: parserCases[2]!.declaration,
      value: '   ',
    },
    {
      declaration: parserCases[3]!.declaration,
      value: 'valid,,invalid',
    },
  ];

  it.each(invalidCases)('fails loud for invalid $declaration.envKey environment input', ({
    declaration,
    value,
  }) => {
    let thrown: unknown;
    try {
      resolveSetting(declaration, {}, { [declaration.envKey]: value });
    } catch (error) {
      thrown = error;
    }

    const settingKey = declaration.configPath.at(-1)!;
    expect(thrown).toBeInstanceOf(SettingResolutionError);
    expect((thrown as Error).message).toContain(settingKey);
    expect((thrown as Error).message).toContain('env');
    expect((thrown as Error).message).toContain(value);
    expect((thrown as Error).message).toContain(declaration.expected);
  });

  it('identifies config as the source of an invalid persisted value', () => {
    const declaration = parserCases[1]!.declaration;
    const value = 'yes';
    expect(() =>
      resolveSetting(declaration, nestedConfig(declaration.configPath, value), {}),
    ).toThrow(/enabled.*config.*yes.*true or false/);
  });

  it('fails loud for an invalid losing config value', () => {
    const declaration = parserCases[0]!.declaration;
    const config = nestedConfig(declaration.configPath, 'garbage');

    let thrown: unknown;
    try {
      resolveSetting(declaration, config, { SKILLFORGE_TTL_MS: '60000' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SettingResolutionError);
    expect((thrown as SettingResolutionError).source).toBe('config');
  });

  it('accepts an empty persisted string list', () => {
    const declaration = parserCases[3]!.declaration;
    expect(resolveSetting(declaration, { tags: [] }, {})).toEqual({
      value: [],
      source: 'config',
    });
  });
});

describe('integer boundaries and presence semantics', () => {
  const declaration = parserCases[0]!.declaration;

  it.each([
    ['env', {}, { SKILLFORGE_TTL_MS: '0' }],
    ['config', { cache: { metadataTtlMs: 0 } }, {}],
  ] as const)('accepts zero from %s', (source, config, environment) => {
    expect(resolveSetting(declaration, config, environment)).toMatchObject({ value: 0, source });
  });

  it.each([
    ['env', {}, { SKILLFORGE_TTL_MS: '-1' }],
    ['config', { cache: { metadataTtlMs: -1 } }, {}],
  ] as const)('rejects a negative integer from %s', (_source, config, environment) => {
    expect(() => resolveSetting(declaration, config, environment)).toThrow(
      SettingResolutionError,
    );
  });

  it('treats an optional config field with value undefined as unset', () => {
    expect(resolveSetting(declaration, { cache: { metadataTtlMs: undefined } }, {})).toEqual({
      value: 300_000,
      source: 'default',
    });
  });
});

function nestedConfig(path: readonly string[], value: unknown): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let current = root;
  path.forEach((key, index) => {
    if (index === path.length - 1) {
      current[key] = value;
    } else {
      const child: Record<string, unknown> = {};
      current[key] = child;
      current = child;
    }
  });
  return root;
}
