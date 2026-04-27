import { describe, expect, it } from 'vitest';
import { buildJsonSummary } from '../src/output/json.js';
import type { CaseResult, RunSummary } from '../src/runner/run.js';

function makeCase(overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    name: 'case',
    filePath: '/tmp/case.yaml',
    passed: true,
    verdict: null,
    wallyResult: null,
    error: null,
    traceUrl: null,
    durationMs: 100,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: 'mo-test',
    wallyConfigPath: '/tmp/eval.yaml',
    totalCases: 0,
    passed: 0,
    failed: 0,
    errored: 0,
    accuracy: null,
    cases: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    experimentUrl: null,
    ...overrides,
  };
}

describe('buildJsonSummary totals.accuracy', () => {
  it('is null when the suite is empty', () => {
    const out = buildJsonSummary(makeSummary()) as { totals: { accuracy: number | null } };
    expect(out.totals.accuracy).toBeNull();
  });

  it('equals passed/cases on a mixed suite', () => {
    const summary = makeSummary({
      totalCases: 4,
      passed: 3,
      failed: 1,
      errored: 0,
      accuracy: 3 / 4,
      cases: [makeCase(), makeCase(), makeCase(), makeCase({ passed: false })],
    });
    const out = buildJsonSummary(summary) as { totals: { accuracy: number } };
    expect(out.totals.accuracy).toBe(0.75);
  });

  it('counts errored cases against accuracy', () => {
    const summary = makeSummary({
      totalCases: 4,
      passed: 2,
      failed: 0,
      errored: 2,
      accuracy: 2 / 4,
      cases: [
        makeCase(),
        makeCase(),
        makeCase({ passed: false, error: 'boom' }),
        makeCase({ passed: false, error: 'boom' }),
      ],
    });
    const out = buildJsonSummary(summary) as { totals: { accuracy: number } };
    expect(out.totals.accuracy).toBe(0.5);
  });

  it('is 1.0 on an all-pass suite', () => {
    const summary = makeSummary({
      totalCases: 2,
      passed: 2,
      accuracy: 1,
      cases: [makeCase(), makeCase()],
    });
    const out = buildJsonSummary(summary) as { totals: { accuracy: number } };
    expect(out.totals.accuracy).toBe(1);
  });

  it('carries the totals fields alongside accuracy', () => {
    const summary = makeSummary({
      totalCases: 3,
      passed: 2,
      failed: 1,
      errored: 0,
      accuracy: 2 / 3,
      cases: [makeCase(), makeCase(), makeCase({ passed: false })],
    });
    const out = buildJsonSummary(summary) as {
      totals: { cases: number; passed: number; failed: number; errored: number; accuracy: number };
    };
    expect(out.totals).toEqual({
      cases: 3,
      passed: 2,
      failed: 1,
      errored: 0,
      accuracy: 2 / 3,
    });
  });
});
