# Plan — Expose mo as an npm library + publish to npmjs.com

## Context

Mo today is CLI-only: `bin: ./dist/index.js`, no `main`/`exports`, no
emitted declarations. Wally consumes it via subprocess, which means
two node_modules trees in the core-agent image and no types on
wally's side. We want mo to be a real npm package consumable by
wally (and anyone else) as `@eggai-tech/mo`, while keeping the CLI.

## Changes

### 1. package.json

- `"name": "@eggai-tech/mo"` (was `mo`).
- Drop `"private": true`.
- Add:
  ```json
  "description": "Eval runner for wally agents",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/eggai-tech/platform-poc.git",
    "directory": "mo"
  },
  "publishConfig": { "access": "public" },
  "files": ["dist", "README.md", "LICENSE"],
  "main": "./dist/lib.js",
  "types": "./dist/lib.d.ts",
  "exports": {
    ".": { "types": "./dist/lib.d.ts", "import": "./dist/lib.js" },
    "./cli": "./dist/index.js"
  }
  ```
- Keep `"bin": { "mo": "./dist/index.js" }`.
- Add a `"prepublishOnly": "pnpm build"` script so publish always
  ships fresh artifacts.

### 2. tsconfig.build.json

Flip `declaration: true` and `declarationMap: true`. Wally (and any
future consumer) will get full types through `.d.ts` files + source
maps.

### 3. New `src/lib.ts`

```ts
export { runEvals } from './runner/run.js';
export type {
  RunOptions,
  RunSummary,
  CaseResult,
  RunProgressEvent,
} from './runner/run.js';
export { buildJsonSummary } from './output/json.js';
```

Nothing else is part of the public surface — keep the judge /
langfuse / wally-runner internals unexported.

### 4. `src/runner/run.ts` — progress callback

Add the event type and option:

```ts
export type RunProgressEvent =
  | { type: 'case_start'; name: string; filePath: string }
  | {
      type: 'case_finish';
      name: string;
      passed: boolean;
      durationMs: number;
      error: string | null;
    };

export interface RunOptions {
  configPath: string;
  filter?: string;
  concurrency?: number;
  onProgress?: (event: RunProgressEvent) => void | Promise<void>;
}
```

Wire `onProgress`:
- Top of `runOne()` → emit `case_start`.
- Before the function resolves (success or caught error branch) →
  emit `case_finish` with the outcome.
- Wrap each call in a try/catch that logs (stderr) and continues; a
  misbehaving consumer callback cannot kill an eval run.

### 5. Publish-facing files

- `LICENSE` — MIT text.
- `README.md` — short: install (`pnpm add @eggai-tech/mo`), CLI usage
  (`mo run --config ... --json`), library usage (one code block
  showing `await runEvals({ configPath, onProgress })`).
- `RELEASING.md` — the 4-step manual release:
  1. `pnpm --filter @eggai-tech/mo build`
  2. `pnpm --filter @eggai-tech/mo version patch|minor|major`
  3. `pnpm --filter @eggai-tech/mo publish --access public`
  4. `git push --follow-tags`

First publish ships `@eggai-tech/mo@0.1.0`.

## Files

**New**
- `src/lib.ts`
- `LICENSE`
- `README.md`
- `RELEASING.md`

**Modified**
- `package.json` — rename, drop private, add publish metadata, add
  `main`/`types`/`exports`/`files`/`publishConfig`/`prepublishOnly`.
- `tsconfig.build.json` — enable declarations.
- `src/runner/run.ts` — add `RunProgressEvent` + `onProgress` + wiring.

## Verification

1. `pnpm --filter @eggai-tech/mo build` emits `dist/lib.js` and
   `dist/lib.d.ts`.
2. CLI still works: `pnpm --filter @eggai-tech/mo exec mo --help`.
3. Wally (paired spec 007) builds against the new types with no
   `any`.
4. `pnpm pack` inside `mo/` produces a tarball with only `dist/`,
   `README.md`, `LICENSE`, and `package.json` — no src, no tests, no
   node_modules.
5. `pnpm publish --dry-run` succeeds (doesn't actually publish).

## Out of scope

- Running `pnpm publish` for real — first publish is a user action,
  requires npm auth for the `@eggai-tech` scope.
- GitHub Actions release workflow.
- Refactoring mo's judge/langfuse internals.
