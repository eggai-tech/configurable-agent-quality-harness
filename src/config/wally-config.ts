import { readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const WallyConfigForMoSchema = z
  .object({
    evals: z
      .object({
        dir: z.string().min(1),
      })
      .optional(),
  })
  .passthrough();

export class WallyConfigError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'WallyConfigError';
  }
}

export interface WallyConfigForMo {
  absPath: string;
  name: string;
  evalsDir: string;
}

export function loadWallyConfigForMo(configPath: string): WallyConfigForMo {
  const absPath = resolve(configPath);
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch (err) {
    throw new WallyConfigError(`could not read wally config at ${absPath}`, err);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new WallyConfigError(`wally config at ${absPath} is not valid YAML`, err);
  }

  const result = WallyConfigForMoSchema.safeParse(parsed);
  if (!result.success) {
    throw new WallyConfigError('wally config failed validation', result.error.format());
  }

  const evals = result.data.evals;
  if (!evals) {
    throw new WallyConfigError(
      `wally config at ${absPath} has no "evals.dir" field — Mo requires one to know where to find eval files`,
    );
  }

  const evalsDir = resolve(absPath, '..', evals.dir);

  return {
    absPath,
    name: deriveName(absPath),
    evalsDir,
  };
}

// Gaia's classifier template names every agent's config `wally.config.yaml`
// and uses the parent directory as the agent identity (e.g.
// `agents/nicolas-classifier/wally.config.yaml` → `nicolas-classifier`).
// Stripping only `.yaml` yields `wally.config`, which some CDNs (including
// Langfuse Cloud's) block as a suspected config-file path — the dataset API
// then returns an HTML 403 and the SDK chokes on `JSON.parse`. Prefer the
// parent dir's basename in that case.
function deriveName(absPath: string): string {
  const fileStem = basename(absPath).replace(/\.(ya?ml)$/i, '');
  if (fileStem === 'wally.config') {
    return basename(dirname(absPath));
  }
  return fileStem;
}
