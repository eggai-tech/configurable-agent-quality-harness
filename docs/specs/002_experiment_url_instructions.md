# 002 — Real Langfuse Dataset/Experiment + experiment URL (user instructions)

## Original request

> Check ./mo. It is supposed to generate datasets/experiments in langfuse.
> Then let's make sure that when run it outputs the URL to the langfuse experiment.

## Findings that shaped the work

- The design spec (001) describes Mo modelling its runs as Langfuse
  **Datasets** (eval cases) with one **DatasetRun / Experiment** per
  `mo run` invocation, and each per-case trace linked as a
  **DatasetRunItem**.
- The existing implementation only created tagged traces
  (`tags: ['mo', 'run:${runId}']`). It never called `createDataset`,
  `createDatasetItem`, or `createDatasetRunItem`, so the Langfuse UI had no
  Dataset/Experiment view for Mo runs.
- The CLI previously printed per-case trace URLs but no single experiment
  URL for the whole run.

## What the change must deliver

1. Wire `mo` to the Langfuse Dataset / DatasetRun / DatasetRunItem APIs.
2. Print the experiment URL at the end of `mo run` (TUI + `--json`).
3. Be best-effort: Langfuse failures must not break eval execution.
