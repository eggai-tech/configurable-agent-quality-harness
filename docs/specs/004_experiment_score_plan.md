# Mo — experiment-level score + expected output in Langfuse

## Context

Two gaps in `mo`'s Langfuse integration, shipped together:

1. **Experiment-level score.** Per-case `mo.pass` (0/1) scoring
   already existed on every trace, and traces were already linked to
   DatasetRun items so Langfuse's UI could aggregate them per
   experiment. But spec 003 explicitly deferred a single
   **run-level `mo.accuracy`** score attached directly to the
   DatasetRun. This plan delivers that follow-up.
2. **Empty `expectedOutput` on dataset items.** The previous
   `createDatasetItem` call only sent `id` and `datasetName`, so the
   Langfuse UI showed a blank "Expected Output" for every case even
   though the YAML has `expect.elements`.

## Changes

### 1. Reporter interface

`mo/src/langfuse/reporter.ts`:

- Added `EvalPrepareInfo { name; expectedElements }` and changed
  `Reporter.prepare(evalNames: string[])` →
  `Reporter.prepare(evals: EvalPrepareInfo[])`.
- Added `Reporter.recordRunAccuracy({ accuracy, passed, total })`.
- `LangfuseReporter.prepare` now sends
  `expectedOutput: { elements: expectedElements }` when creating each
  dataset item.
- New `resolveDatasetRunId()` private helper shared by
  `recordRunAccuracy` and `experimentUrl`. It awaits any pending
  `createDatasetRunItem` promises (so the first one that captures the
  id wins), then falls back to `getDatasetRun` if the id is still
  unknown.
- `LangfuseReporter.recordRunAccuracy` emits:
  ```ts
  client.score({
    datasetRunId: runId,
    name: 'mo.accuracy',
    value: accuracy,          // 0..1 unit fraction
    dataType: 'NUMERIC',
    comment: `${passed}/${total} cases passed`,
  });
  ```
  Failures are swallowed with a warning — a missing experiment score
  must not fail the run. The Langfuse SDK supports `datasetRunId` on
  the score body (see `ApiScoreBody`, `ApiCreateScoreRequest`), so no
  raw-fetch workaround is needed.
- `NoopReporter.recordRunAccuracy` is a no-op, matching the existing
  pattern for environments without Langfuse credentials.

### 2. Runner wiring

`mo/src/runner/run.ts`:

- `reporter.prepare` now receives
  `{ name: e.case.name, expectedElements: e.case.expect.elements }`.
- The `passed`/`errored`/`failed`/`accuracy` calculation moved *before*
  `reporter.flush()` so the run-level score can be sent in the same
  ingestion window as the per-case scores.
- When `accuracy !== null`, `reporter.recordRunAccuracy` is called
  before `flush()`. Zero-case runs skip the score (same branch as
  the CLI output logic).

## Why this shape

- **`value: accuracy` rather than a 0/1 boolean.** The user asked
  for 0/1 per case (already shipping as `mo.pass`) and aggregation
  at the experiment level. A single `mo.accuracy ∈ [0, 1]` gives the
  same information as a Langfuse-side avg of `mo.pass`, but without
  depending on the UI's aggregation view — it's visible on the
  experiment row itself.
- **`expectedOutput: { elements: [...] }` rather than a bare array.**
  Leaves room for additional expect-side fields later
  (`forbidden`, `tone`, etc.) without a schema break.
- **`resolveDatasetRunId` factored out.** `recordRunAccuracy` needs
  the same id that `experimentUrl` needs, and both should share the
  lazy-resolution path. Awaiting `pendingLinks` first avoids a race
  where all cases finish but the `createDatasetRunItem` .then
  callback hasn't landed yet.

## Files changed

- `mo/src/langfuse/reporter.ts`
- `mo/src/runner/run.ts`

## Verification

With `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` and an `EVAL_LLM_*`
provider configured:

1. `pnpm --filter @eggai-tech/mo typecheck` — passes.
2. `pnpm --filter @eggai-tech/mo build` — passes.
3. `pnpm --filter @eggai-tech/mo start run --config ../wally/eval.config.yaml`
4. Open the printed `experiment:` URL. Check:
   - Experiment page shows a `mo.accuracy` numeric score matching the
     CLI `accuracy:` line.
   - Each dataset item shows an `Expected Output` panel with
     `{"elements": [...]}` matching the YAML's `expect.elements`.
   - Per-case traces still carry the `mo.pass` 0/1 score (no
     regression).
5. Run with a `--filter` that matches zero cases to confirm no crash
   and no `mo.accuracy` score is emitted.

## Non-goals

- Score config registration for `mo.accuracy` (min/max hints). Numeric
  scores work without it; can be added later if the team wants UI
  hints.
- Backfilling `expectedOutput` on already-created dataset items.
  `createDatasetItem` upserts on `id`, so subsequent runs update
  existing rows automatically.
