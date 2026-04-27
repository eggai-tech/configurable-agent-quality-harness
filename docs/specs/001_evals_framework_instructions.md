# 001 — Evals framework for wally (user instructions)

## Original request

> Help me define an evals framework/repository for wally.
>
> Wally is a configurable genAI agent.
> Gaia is the platform that helps users build and define these agents (along with workflows, ingestion, disposition, etc.).
> The new subfolder to the EggAI Foundry should be a helper to run evals against an agent that is built through Gaia.
>
> Some thoughts:
> - I'm wondering if a CLI is the right interface. This CLI would require a standard way to define evals (inputs+expected outputs). The CLI would then invoke Wally using the user/agent defined config because wally is a standard and well known interface.
> - Let's find a name for this new library.
> - It would be good if whatever tool we build for evals can easily be invoked as a LLM tool (used by Gaia's core agent that uses wally). CLI seems to make that easy.
> - The tool should report its evals to langfuse.
> - I think that Gaia will actually maintain a single repository with all projects that are created from it, at least at first. In practice, it means that the core agent can iterate over a specific project by pulling the main repo, making edits to the target project in that repo, iterate with running the evals, thus improving the agent config, and then commiting/pushing in a branch.
>
> I don't want an implementation plan just yet (if at all). Let's problem solve together what's the best approach. Don't make any assumptions and don't make any unilateral decisions.

## Clarifications collected during problem-solving

1. **Invocation path**: implement a new **wally CLI** alongside its existing HTTP interface. The evals tool calls wally via that CLI. EggAI-SDK integration may come later but is out of scope. The wally CLI itself is a separate task for a separate agent, with its own spec under `wally/docs/specs/`.
2. **Name**: **Mo** (lowercase).
3. **Project layout**: decoupled. Mo takes `--config <wally-config.yaml>`. The evals directory is declared *inside the wally config* (there is no second flag for it) — the eval files always ship alongside the config.
4. **Eval file format**: YAML, declarative only. No code hooks.
5. **Eval type at MVP**: LLM-as-judge **only**. The judge's sole job is to decide whether all the elements declared in the eval are present in wally's output. Verdict is **binary pass/fail**, not a score.
6. **Judge model**: not hardcoded. Configured via dedicated env vars under an `EVAL_*` prefix so that Mo's judge config cannot collide with wally's own model env vars when they run in the same shell / container. Example: `EVAL_LLM_MODEL`.
7. **Langfuse**: Mo owns the integration and emits its own traces. Crucially, each Mo Experiment must include the detailed tool-call and iteration traces that wally emits — Mo must bubble up wally's OTEL traces into the Langfuse experiment run, not just capture Mo's own view.
8. **Parallelism**: Mo runs eval cases in parallel by default, with a `--concurrency` flag to override.
