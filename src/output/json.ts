import type { RunSummary } from '../runner/run.js';

export function buildJsonSummary(summary: RunSummary): unknown {
  return {
    runId: summary.runId,
    wallyConfigPath: summary.wallyConfigPath,
    experimentUrl: summary.experimentUrl,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    totals: {
      cases: summary.totalCases,
      passed: summary.passed,
      failed: summary.failed,
      errored: summary.errored,
      accuracy: summary.accuracy,
    },
    cases: summary.cases.map((c) => ({
      name: c.name,
      filePath: c.filePath,
      passed: c.passed,
      durationMs: c.durationMs,
      traceUrl: c.traceUrl,
      error: c.error,
      missingElements:
        c.verdict === null
          ? null
          : c.verdict.elements
              .filter((e) => !e.present)
              .map((e) => ({ element: e.element, reasoning: e.reasoning })),
    })),
  };
}

export function printJsonSummary(summary: RunSummary): void {
  process.stdout.write(`${JSON.stringify(buildJsonSummary(summary), null, 2)}\n`);
}
