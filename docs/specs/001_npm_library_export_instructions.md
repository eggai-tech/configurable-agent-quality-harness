# Expose mo as an npm library + publish to npmjs.com

Wally currently shells out to `mo` via `spawn('mo', ...)`. Refactor so
wally can consume mo as an npm package `@eggai-tech/mo`, while keeping
the CLI intact for users running evals manually from a terminal.

Scope for this package:

- Rename the package to `@eggai-tech/mo`.
- Emit TypeScript declaration files so consumers get real types, not
  `any`.
- Add a dedicated library entry (`src/lib.ts`) that re-exports the
  supported programmatic surface: `runEvals`, `RunOptions`,
  `RunSummary`, `CaseResult`, a new `RunProgressEvent` type, and
  `buildJsonSummary`.
- Add an optional `onProgress?: (event: RunProgressEvent) => void |
  Promise<void>` callback on `RunOptions` so consumers can stream
  per-case events to their own UI. Invoked at case start + case
  finish; a throwing callback must not kill the run.
- Add the publish metadata needed for npmjs.com public publish:
  `license`, `repository`, `publishConfig: { access: public }`,
  `files` allowlist, `description`. Remove `private: true`.
- Keep the CLI at `bin: { mo: ./dist/index.js }` — users still run
  `mo run ...` in a terminal.
- Release flow: manual `pnpm publish` for now. A `RELEASING.md` in
  mo/ documents the steps.

Out of scope: CI release workflow, changes to mo's judge/langfuse
internals.

Paired wally spec: `wally/docs/specs/007_mo_as_npm_dep_*`.
