# 003 — Accuracy in CLI output (user instructions)

## Original request

This spec is the Mo-scoped slice of a joint task with `gaia/` — see
`gaia/docs/specs/009_eval_driven_deploy_instructions.md` for the
full picture. The user's words, in part:

> Make sure Mo outputs wally's accuracy in its CLI output.

The joint task has Gaia's core agent run Mo in a loop and iterate on
the prompt + evals of the Wally agent being deployed until accuracy
is satisfying. For that loop to work cleanly, the core agent needs to
read a single accuracy number per run, and it needs the verdicts to
be deterministic enough to compare round-over-round.

## Findings that shaped the work

- Mo today reports per-case pass/fail plus a tally line
  (`3 passed  1 failed  0 errored  (4 total)`) but never computes or
  prints accuracy. `mo/src/runner/run.ts:76-78` counts
  `passed / failed / errored`; `mo/src/output/tui.ts` and
  `mo/src/output/json.ts` both stop at those fields.
- The JSON shape already nests under `totals` — `mo/README.md:124-134`
  still shows a stale flat-field example and needs correcting alongside
  this change.
- The judge (`mo/src/judge/judge.ts` → `generateObject` via the Vercel
  AI SDK) runs at the model's default temperature, which is non-zero
  for most providers. Rerunning the same eval set can produce
  different verdicts near the decision boundary. When Gaia's core
  agent compares round-over-round accuracy to decide whether an
  iteration improved the agent, judge non-determinism becomes noise
  that can flip iteration decisions.
- Errored cases (wally subprocess crash, timeout) did not pass;
  accuracy must count them against the total — not exclude them.

## What the change must deliver

1. Compute `accuracy = passed / totalCases` (errored counts against)
   and surface it on `RunSummary`.
2. Print it in the TUI after the tally line, as
   `accuracy: 80.0%  (8 of 10 cases passed)`.
3. Include it in the JSON output under `totals.accuracy`, as a unit
   fraction (e.g. `0.8`), or `null` when the suite is empty.
4. Pin the judge model's temperature to 0 so round-over-round
   verdicts are reproducible for an unchanged wally output + eval.
5. No new CLI flags. Existing exit codes (0 all-pass, 1 any
   fail/errored, 2 Mo internal failure) remain unchanged.

## Out of scope

- Any `--min-accuracy` threshold flag. The core agent drives
  improvement decisions off the JSON output; a CLI-level threshold
  gate is not needed.
- Any change to what the judge checks or how verdicts are formed.
- Any change to Langfuse reporting, dataset shapes, or trace URLs.
