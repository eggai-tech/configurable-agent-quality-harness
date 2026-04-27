# Mo — create real Langfuse Dataset/Experiment + print experiment URL

## Context

`mo` (`/home/nherment/eai/platform-poc/mo/`) is the evals runner for Wally. Per its
design spec (`mo/docs/specs/001_evals_framework_plan.md` §"Langfuse ownership"),
each `mo run` should surface in Langfuse as a **Dataset** (eval cases) with one
**DatasetRun / Experiment** per invocation, and each per-case trace linked as a
**DatasetRunItem**.

**Today the implementation stopped short.** `mo/src/langfuse/reporter.ts` only
creates tagged traces (`tags: ['mo', 'run:${runId}']`). It never calls
`createDataset`, `createDatasetItem`, or `createDatasetRunItem`. Consequently,
the Langfuse UI has no Dataset/Experiment view for Mo runs, and the CLI only
prints per-case trace URLs — there is no single experiment URL the user can
open to see all cases for a run side-by-side.

**Goal:** Wire `mo` to the Langfuse Dataset/Experiment APIs (as the spec
intends), and print the experiment URL at the end of every `mo run` (both TUI
and `--json` output).

## Approach

Dataset name = `wallyConfig.name` (already the config file basename minus `.yaml`).
`createDataset` upserts, so re-runs against the same config land in the same
Dataset; each run becomes a new DatasetRun (experiment) under it.

Dataset item id = eval case name. `createDatasetItem` also upserts on id, so
re-running the same eval set does not duplicate items.

Run name = existing `runId` (e.g. `mo-1708...-abcdef`).

Experiment URL format (Langfuse UI):
```
{baseUrl}/project/{projectId}/datasets/{datasetId}/runs/{datasetRunId}
```
`projectId` + `datasetId` come from `client.getDataset(name)`. `datasetRunId`
comes either from the response of `createDatasetRunItem` or from a final
`client.getDatasetRun({datasetName, runName})` call.

All Langfuse-specific calls are best-effort: any failure logs a warning and
returns `experimentUrl = null`; eval execution and per-case tracing must not
regress.

## Files to modify

1. `mo/src/langfuse/reporter.ts` — extend `Reporter` + `LangfuseReporter` +
   `NoopReporter` with `prepare(evalNames)` and `experimentUrl()`; add
   dataset/item upserts; link each trace to the run.
2. `mo/src/runner/run.ts` — call `reporter.prepare(evalNames)` once before the
   per-case loop; after `flush()`, fetch `experimentUrl()`; add
   `experimentUrl: string | null` to `RunSummary`.
3. `mo/src/output/tui.ts` — if `summary.experimentUrl`, print a final gray
   `experiment: ${url}` line after `run: ${runId}`.
4. `mo/src/output/json.ts` — include top-level `experimentUrl` field.

## Detailed design

### `Reporter` interface (reporter.ts)

```ts
export interface Reporter {
  otlpEndpoint: string | undefined;
  otlpHeaders: string | undefined;
  prepare(evalNames: string[]): Promise<void>;      // NEW — upsert dataset + items
  startCase(args: { name: string; description: string | undefined; input: EvalMessage[] }): CaseReport;
  flush(): Promise<void>;
  experimentUrl(): Promise<string | null>;          // NEW — URL to DatasetRun
}
```

`NoopReporter`: `async prepare() {}`, `async experimentUrl() { return null }`.

### `LangfuseReporter` additions

New private fields:
```ts
private readonly baseUrl: string;           // captured from env in constructor
private datasetPrepared = false;
private projectId: string | null = null;
private datasetId: string | null = null;
private datasetRunId: string | null = null; // captured lazily
```

`prepare(evalNames)` — upsert dataset, upsert one item per eval case (id =
eval name), fetch dataset to capture `projectId` + `datasetId`. Wrapped in
try/catch; on failure log `mo: failed to prepare Langfuse dataset: …` and
leave `datasetPrepared = false`.

`startCase(...)` — after creating the trace, if `datasetPrepared`:
```ts
this.client.createDatasetRunItem({
  runName: this.run.runId,
  datasetItemId: args.name,
  traceId,
})
.then((res) => { if (!this.datasetRunId) this.datasetRunId = res?.datasetRunId ?? null; })
.catch((err) => console.warn(`mo: link dataset run item failed for ${args.name}: ${asMsg(err)}`));
```
Fire-and-forget; the Langfuse client's internal queue is drained by the
existing `shutdownAsync()` in `flush()`.

`experimentUrl()` — if dataset was prepared, ensure we have `datasetRunId`
(fall back to `client.getDatasetRun({datasetName, runName})` if none was
captured during `startCase`), then build and return the URL. Any error → warn
and return `null`.

Dataset name = `this.run.runName` (already plumbed via `RunContext`).

### `runEvals` changes (run.ts)

Insert after reporter creation, before the `Promise.all` loop:
```ts
await reporter.prepare(evals.map((e) => e.case.name));
```
After `await reporter.flush();`:
```ts
const experimentUrl = await reporter.experimentUrl();
```
Add `experimentUrl` to `RunSummary` interface and return value.

### Output

`tui.ts` — after `console.log(pc.gray('run: …'))`:
```ts
if (summary.experimentUrl) {
  console.log(pc.gray(`experiment: ${summary.experimentUrl}`));
}
```

`json.ts` — add `experimentUrl: summary.experimentUrl` to the top level of
the emitted object.

## Existing functions being reused

- `createReporter(env, run)` (reporter.ts:44) — unchanged entry point.
- `readLangfuseEnv()` (reporter.ts:13) — unchanged env plumbing.
- `LangfuseReporter.client: Langfuse` (reporter.ts:68) — same SDK instance
  handles datasets via `createDataset` / `createDatasetItem` /
  `createDatasetRunItem` / `getDataset` / `getDatasetRun` (verified in
  `node_modules/.pnpm/langfuse-core@3.38.20/.../lib/index.d.ts` lines 7361–7392,
  7373–7375, 7466–7475).
- `RunContext.runName` (reporter.ts:23) — already carries the dataset name
  (derived from `wallyConfig.name` in `runEvals`).

## Out of scope

- No new CLI flags (no opt-out for dataset creation — POC).
- No `evals.datasetName` config field; can be added later if two configs ever
  need to share or split datasets.
- No backfilling of `expectedOutput`/`input` into Dataset items from eval YAML
  (could be a later polish; initial change just creates stub items so linking
  works).
- No changes to the Langfuse OTLP wiring for nested wally spans — that path
  already works and is untouched.

## Verification

Build:
```sh
cd /home/nherment/eai/platform-poc/mo && pnpm build
```

End-to-end (TUI):
```sh
LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=... LANGFUSE_BASEURL=... \
  node dist/index.js run -c ../wally/wally.config.yaml
```
Expect: unchanged per-case PASS/FAIL output, plus a final gray line
`experiment: https://<host>/project/<pid>/datasets/<did>/runs/<rid>`. Open the
URL — should show the DatasetRun with one item per eval case, each linked to
its trace with nested wally spans.

JSON:
```sh
node dist/index.js run -c ../wally/wally.config.yaml --json | jq '.experimentUrl, .runId'
```
Expect: non-null string `experimentUrl`, plus the existing `runId`.

Negative — no Langfuse env:
```sh
unset LANGFUSE_PUBLIC_KEY LANGFUSE_SECRET_KEY
node dist/index.js run -c ../wally/wally.config.yaml --json | jq '.experimentUrl'
```
Expect: `null`, run still completes successfully, no `experiment:` line in
TUI, no crash.

Negative — bad credentials: `prepare()` warns once, per-case linking warns,
`experimentUrl` is `null`, run exit code unchanged (still reflects
pass/fail/error counts from judging, not the Langfuse state).
