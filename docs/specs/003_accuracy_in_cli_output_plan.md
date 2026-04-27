# Mo — accuracy in CLI output + deterministic judge

## Context

`mo` (`/home/nherment/workspace/eai/egg-platform/mo/`) is the evals
runner for Wally. Its callers — most importantly Gaia's core agent
during its new eval-driven deploy flow
(`gaia/docs/specs/009_eval_driven_deploy_plan.md`) — need two small
things from Mo's output:

1. A single accuracy number per run, so the agent can measure whether
   an iteration round improved the Wally agent's behavior.
2. Deterministic judge verdicts for an unchanged wally output + eval,
   so that round-over-round accuracy deltas reflect real change, not
   sampling noise in the judge's LLM.

Today Mo reports `passed / failed / errored` counts (`run.ts:76-78`,
rendered in `tui.ts` and `json.ts`) but no accuracy, and the judge
(`judge/judge.ts` via `generateObject`) runs at whatever temperature
the provider defaults to.

## Approach

Compute accuracy as `passed / cases.length` (errored cases count
against — they didn't pass). Add it to `RunSummary`, thread it
through both output formats. Clamp to `null` when the suite is empty
(keeps the existing exit-code behavior, which already exits 2 on
empty suites). Pin the judge's temperature to `0` at the model
factory so every call-site benefits without per-call plumbing.

No new CLI flags. Exit codes unchanged: 0 when every case passed, 1
when any case failed or errored, 2 when Mo itself failed (bad config,
missing env, wally crash before any case ran).

## Files to modify

1. `mo/src/runner/run.ts` — extend `RunSummary`, compute accuracy,
   return it.
2. `mo/src/output/tui.ts` — print the accuracy line after the tally.
3. `mo/src/output/json.ts` — add `accuracy` to `totals`.
4. `mo/src/judge/model.ts` — pin temperature 0 on the judge model.
5. `mo/README.md` — fix the stale flat-fields JSON example, show the
   new `totals.accuracy` field.
6. `mo/tests/` — new unit test covering the accuracy field (full suite
   pass/fail/mixed/empty).

## Detailed design

### `RunSummary` (`runner/run.ts`)

Extend the interface (line 28):

```ts
export interface RunSummary {
  runId: string;
  wallyConfigPath: string;
  totalCases: number;
  passed: number;
  failed: number;
  errored: number;
  accuracy: number | null;   // NEW — passed / totalCases, null when 0 cases
  cases: CaseResult[];
  startedAt: string;
  finishedAt: string;
  experimentUrl: string | null;
}
```

Compute after the existing counts (lines 76-78):

```ts
const accuracy = cases.length === 0 ? null : passed / cases.length;
```

Include in the returned object (line 80-91).

### TUI (`output/tui.ts`)

After the tally line (current line 42), add:

```ts
if (summary.accuracy !== null) {
  const pct = (summary.accuracy * 100).toFixed(1);
  const color = summary.passed === summary.totalCases ? pc.green : pc.red;
  console.log(
    color(`accuracy: ${pct}%`) +
      pc.gray(`  (${summary.passed} of ${summary.totalCases} cases passed)`),
  );
}
```

Skip entirely when `totalCases === 0` (the existing early return at
line 7 already prints `no evals found`).

### JSON (`output/json.ts`)

Add `accuracy` to `totals` (unit fraction, `null` on empty):

```ts
totals: {
  cases: summary.totalCases,
  passed: summary.passed,
  failed: summary.failed,
  errored: summary.errored,
  accuracy: summary.accuracy,
},
```

### Judge (`judge/model.ts`)

At the model factory, add `temperature: 0` to every provider branch.
Vercel AI SDK provider factories accept temperature either at model
creation or at `generateObject` call time — `generateObject` wins if
both are set. Since `judge/judge.ts:38-42` already calls
`generateObject` and doesn't pass temperature, setting it on the model
factory is the one-line fix that applies to every provider.

If a given provider's factory doesn't accept `temperature`, fall back
to passing `temperature: 0` in the `generateObject` call inside
`judge/judge.ts` (single call-site, same effect). Prefer the factory
for locality.

### README

Fix `mo/README.md:118-136`: replace the flat-field example with the
current nested shape and show the new accuracy field, e.g.:

```json
{
  "runId": "mo-...",
  "wallyConfigPath": "...",
  "experimentUrl": "...",
  "startedAt": "...",
  "finishedAt": "...",
  "totals": {
    "cases": 10,
    "passed": 8,
    "failed": 1,
    "errored": 1,
    "accuracy": 0.8
  },
  "cases": [ ... ]
}
```

## Existing functions being reused

- `runEvals` (`run.ts:43`) — unchanged control flow; adds only the
  accuracy field on the way out.
- `buildJudgeModel` (`judge/model.ts`) — wraps provider factories;
  all call-sites flow through here.
- `printTuiSummary` / `printJsonSummary` — no signature change, just a
  new field rendered.

## Out of scope

- `--min-accuracy` flag. The core agent reads `totals.accuracy` from
  JSON and makes its own decisions; a CLI-side threshold gate is not
  needed.
- Per-case accuracy weighting or partial-credit judging — still
  binary pass/fail per case.
- Langfuse reporting of the accuracy score (can be added later as a
  run-level `mo.accuracy` score alongside the existing per-case
  `mo.pass` scores).

## Verification

Build + unit test:
```sh
cd mo && pnpm build && pnpm test
```

End-to-end against the existing wally eval fixtures (expects the new
accuracy line in TUI):
```sh
cd mo && pnpm start run --config ../wally/eval.config.yaml
```

JSON:
```sh
cd mo && pnpm start run --config ../wally/eval.config.yaml --json \
  | jq '.totals'
# expect: { cases: N, passed: P, failed: F, errored: E, accuracy: P/N }
```

Judge determinism — run the same config twice in a row and compare
`totals.accuracy`:
```sh
pnpm start run --config ../wally/eval.config.yaml --json | jq '.totals.accuracy' > /tmp/a1
pnpm start run --config ../wally/eval.config.yaml --json | jq '.totals.accuracy' > /tmp/a2
diff /tmp/a1 /tmp/a2   # expected identical (modulo wally-side non-determinism)
```

Empty suite — point `evals.dir` at an empty dir and confirm exit 2 +
no `accuracy` line printed.
