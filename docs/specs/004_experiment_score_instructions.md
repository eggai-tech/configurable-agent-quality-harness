# Mo — experiment-level score + expected output in Langfuse

## User instructions

> mo should score the evals based on results. It should be a number,
> 0 (fail) or 1 (pass). Ideally, the score can be aggregated at the
> experiment level in langfuse. The score should be reported by mo.
>
> I have also noted that in langfuse, the 'expected output' is empty
> for all test cases.

## Context surfaced during the conversation

Per-case `mo.pass` 0/1 scoring was already in place (see
`mo/src/langfuse/reporter.ts:178-194`), and each case's trace is
already linked to a Langfuse DatasetRun (experiment) via
`createDatasetRunItem`. The Langfuse UI will aggregate those trace
scores on the experiment page, but the follow-up flagged in spec
003 — emitting a single run-level `mo.accuracy` score — was still
outstanding.

The second observation ("expected output is empty") is a small bug
in `prepare()`: dataset items were being created with only `id` and
`datasetName`. The YAML eval's `expect.elements` list is exactly the
expected-output contract and should be sent along so reviewers can see
what each case is checking for without opening the YAML.

## Scope

Ship both in one pair:

1. Run-level `mo.accuracy` score attached to the DatasetRun. Value is
   the unit fraction `passed / total`, matching the CLI `accuracy:`
   line.
2. `expectedOutput: { elements: [...] }` on each created dataset item.

## Out of scope

- Score config registration for `mo.accuracy`.
- Changes to the existing per-case `mo.pass` scoring.
- Changes to how "passed" is counted (errored cases still count
  against accuracy, per spec 003).
