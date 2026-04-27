import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { type EvalCase, EvalCaseSchema } from './schema.js';

export class EvalLoadError extends Error {
  constructor(
    message: string,
    public readonly filePath?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'EvalLoadError';
  }
}

export interface LoadedEval {
  filePath: string;
  case: EvalCase;
}

export function resolveEvalsDir(configPath: string, evalsDir: string): string {
  const configDir = resolve(configPath, '..');
  return resolve(configDir, evalsDir);
}

export function loadEvals(evalsDir: string): LoadedEval[] {
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(evalsDir);
  } catch (err) {
    throw new EvalLoadError(`evals dir not found: ${evalsDir}`, evalsDir, err);
  }
  if (!stats.isDirectory()) {
    throw new EvalLoadError(`evals path is not a directory: ${evalsDir}`, evalsDir);
  }

  const entries = readdirSync(evalsDir);
  const files = entries
    .filter((f) => {
      const ext = extname(f).toLowerCase();
      return ext === '.yaml' || ext === '.yml';
    })
    .sort();

  const loaded: LoadedEval[] = [];
  for (const file of files) {
    const filePath = join(evalsDir, file);
    loaded.push(loadOne(filePath));
  }

  const names = new Set<string>();
  for (const { filePath, case: c } of loaded) {
    if (names.has(c.name)) {
      throw new EvalLoadError(`duplicate eval name "${c.name}"`, filePath);
    }
    names.add(c.name);
  }

  return loaded;
}

function loadOne(filePath: string): LoadedEval {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new EvalLoadError(`could not read eval file`, filePath, err);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new EvalLoadError(`eval file is not valid YAML`, filePath, err);
  }

  const result = EvalCaseSchema.safeParse(parsed);
  if (!result.success) {
    throw new EvalLoadError(`eval file failed validation`, filePath, result.error.format());
  }

  return { filePath, case: result.data };
}
