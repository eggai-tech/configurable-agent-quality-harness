import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JudgeVerdict } from '../src/judge/judge.js';
import type { LoadedEval } from '../src/evals/loader.js';
import type { RunOptions } from '../src/runner/run.js';

// ---------------------------------------------------------------------------
// Module mocks — hoisted by vitest before any imports run
// ---------------------------------------------------------------------------

vi.mock('../src/config/wally-config.js', () => ({
  loadWallyConfigForMo: vi.fn(() => ({
    absPath: '/fake/wally.config.yaml',
    name: 'test-agent',
    evalsDir: '/fake/evals',
  })),
}));

vi.mock('../src/evals/loader.js', () => ({
  loadEvals: vi.fn((): LoadedEval[] => []),
}));

vi.mock('../src/judge/env.js', () => ({
  readJudgeEnv: vi.fn(() => ({
    provider: 'anthropic' as const,
    model: 'claude-haiku-4-5',
    apiKey: 'sk-test',
    baseUrl: undefined,
  })),
}));

vi.mock('../src/judge/model.js', () => ({
  buildJudgeModel: vi.fn(() => ({ provider: 'anthropic', modelId: 'claude-haiku-4-5' })),
}));

vi.mock('../src/judge/judge.js', () => ({
  judgeElements: vi.fn(),
}));

vi.mock('../src/langfuse/reporter.js', () => {
  const makeCaseReport = () => ({
    traceparent: '00-00000000000000000000000000000001-0000000000000001-01',
    traceId: '00000000000000000000000000000001',
    traceUrl: null,
    recordOutput: vi.fn(),
    recordVerdict: vi.fn(),
    recordError: vi.fn(),
  });
  const makeReporter = () => ({
    otlpEndpoint: undefined,
    otlpHeaders: undefined,
    prepare: vi.fn(async () => {}),
    startCase: vi.fn(() => makeCaseReport()),
    recordRunAccuracy: vi.fn(async () => {}),
    flush: vi.fn(async () => {}),
    experimentUrl: vi.fn(async () => null),
  });
  return {
    readLangfuseEnv: vi.fn(() => null),
    createReporter: vi.fn(() => makeReporter()),
  };
});

vi.mock('../src/wally-runner/subprocess.js', () => {
  class WallyRunError extends Error {
    stderr?: string;
    exitCode?: number | null;
    constructor(message: string, stderr?: string, exitCode?: number | null) {
      super(message);
      this.name = 'WallyRunError';
      this.stderr = stderr;
      this.exitCode = exitCode;
    }
  }
  return { runWally: vi.fn(), WallyRunError };
});

// ---------------------------------------------------------------------------
// Import under-test after mocks are declared
// ---------------------------------------------------------------------------

import { runEvals } from '../src/runner/run.js';
import { loadEvals } from '../src/evals/loader.js';
import { judgeElements } from '../src/judge/judge.js';
import { runWally, WallyRunError } from '../src/wally-runner/subprocess.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLoadedEval(name: string): LoadedEval {
  return {
    filePath: `/fake/evals/${name}.yaml`,
    case: {
      name,
      description: `${name} description`,
      input: { messages: [{ role: 'user', content: `prompt for ${name}` }] },
      expect: { elements: [`expected element for ${name}`] },
    },
  };
}

function passVerdict(element: string): JudgeVerdict {
  return { passed: true, elements: [{ element, present: true, reasoning: 'ok' }] };
}

function failVerdict(element: string): JudgeVerdict {
  return { passed: false, elements: [{ element, present: false, reasoning: 'not found' }] };
}

const wallyOk = { ok: true, finalText: 'some output', error: null };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runEvals', () => {
  const baseOptions: RunOptions = { configPath: '/fake/wally.config.yaml' };

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- accuracy ----------------------------------------------------------

  it('returns null accuracy for an empty eval suite', async () => {
    vi.mocked(loadEvals).mockReturnValue([]);

    const summary = await runEvals(baseOptions);

    expect(summary.accuracy).toBeNull();
    expect(summary.totalCases).toBe(0);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.errored).toBe(0);
  });

  it('returns accuracy 1.0 when all cases pass', async () => {
    vi.mocked(loadEvals).mockReturnValue([makeLoadedEval('a'), makeLoadedEval('b')]);
    vi.mocked(runWally).mockResolvedValue(wallyOk);
    vi.mocked(judgeElements)
      .mockResolvedValueOnce(passVerdict('expected element for a'))
      .mockResolvedValueOnce(passVerdict('expected element for b'));

    const summary = await runEvals(baseOptions);

    expect(summary.accuracy).toBe(1);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.errored).toBe(0);
  });

  it('calculates accuracy correctly for a mixed suite', async () => {
    vi.mocked(loadEvals).mockReturnValue([
      makeLoadedEval('pass1'),
      makeLoadedEval('fail1'),
      makeLoadedEval('pass2'),
    ]);
    vi.mocked(runWally).mockResolvedValue(wallyOk);
    vi.mocked(judgeElements)
      .mockResolvedValueOnce(passVerdict('expected element for pass1'))
      .mockResolvedValueOnce(failVerdict('expected element for fail1'))
      .mockResolvedValueOnce(passVerdict('expected element for pass2'));

    const summary = await runEvals(baseOptions);

    expect(summary.totalCases).toBe(3);
    expect(summary.passed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.errored).toBe(0);
    expect(summary.accuracy).toBeCloseTo(2 / 3);
  });

  it('counts wally errors against accuracy as errored (not passed)', async () => {
    vi.mocked(loadEvals).mockReturnValue([makeLoadedEval('ok'), makeLoadedEval('boom')]);
    vi.mocked(runWally)
      .mockResolvedValueOnce(wallyOk)
      .mockRejectedValueOnce(new WallyRunError('wally crashed'));
    vi.mocked(judgeElements).mockResolvedValueOnce(passVerdict('expected element for ok'));

    const summary = await runEvals(baseOptions);

    expect(summary.passed).toBe(1);
    expect(summary.errored).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.accuracy).toBeCloseTo(1 / 2);
  });

  // --- filter ------------------------------------------------------------

  it('runs only cases whose names include the filter string', async () => {
    vi.mocked(loadEvals).mockReturnValue([
      makeLoadedEval('hello-world'),
      makeLoadedEval('goodbye'),
      makeLoadedEval('hello-there'),
    ]);
    vi.mocked(runWally).mockResolvedValue(wallyOk);
    vi.mocked(judgeElements).mockResolvedValue({ passed: true, elements: [] });

    const summary = await runEvals({ ...baseOptions, filter: 'hello' });

    expect(summary.totalCases).toBe(2);
    const names = summary.cases.map((c) => c.name);
    expect(names).toContain('hello-world');
    expect(names).toContain('hello-there');
    expect(names).not.toContain('goodbye');
  });

  it('returns an empty suite when filter matches nothing', async () => {
    vi.mocked(loadEvals).mockReturnValue([makeLoadedEval('alpha'), makeLoadedEval('beta')]);

    const summary = await runEvals({ ...baseOptions, filter: 'zzz' });

    expect(summary.totalCases).toBe(0);
    expect(summary.accuracy).toBeNull();
  });

  // --- onProgress callback -----------------------------------------------

  it('invokes onProgress with case_start before case_finish for each case', async () => {
    vi.mocked(loadEvals).mockReturnValue([makeLoadedEval('c1'), makeLoadedEval('c2')]);
    vi.mocked(runWally).mockResolvedValue(wallyOk);
    vi.mocked(judgeElements).mockResolvedValue({ passed: true, elements: [] });

    const events: string[] = [];
    await runEvals({
      ...baseOptions,
      concurrency: 1,
      onProgress: (e) => {
        events.push(`${e.type}:${e.name}`);
      },
    });

    // Each case must have a start before its finish
    for (const name of ['c1', 'c2']) {
      const startIdx = events.indexOf(`case_start:${name}`);
      const finishIdx = events.indexOf(`case_finish:${name}`);
      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(finishIdx).toBeGreaterThan(startIdx);
    }
  });

  it('does not crash when the onProgress callback throws', async () => {
    vi.mocked(loadEvals).mockReturnValue([makeLoadedEval('x')]);
    vi.mocked(runWally).mockResolvedValue(wallyOk);
    vi.mocked(judgeElements).mockResolvedValue(passVerdict('expected element for x'));

    await expect(
      runEvals({
        ...baseOptions,
        onProgress: () => {
          throw new Error('callback error');
        },
      }),
    ).resolves.toBeDefined();
  });

  // --- result shape ------------------------------------------------------

  it('includes runId, startedAt, finishedAt and wallyConfigPath in the summary', async () => {
    vi.mocked(loadEvals).mockReturnValue([]);

    const summary = await runEvals(baseOptions);

    expect(summary.runId).toMatch(/^mo-\d+-[0-9a-f]+$/);
    expect(summary.wallyConfigPath).toBe('/fake/wally.config.yaml');
    expect(summary.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(summary.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(summary.experimentUrl).toBeNull();
  });

  it('records error message on errored cases', async () => {
    vi.mocked(loadEvals).mockReturnValue([makeLoadedEval('fail')]);
    vi.mocked(runWally).mockRejectedValue(new WallyRunError('subprocess died', 'stderr text', 1));

    const summary = await runEvals(baseOptions);

    const c = summary.cases[0];
    expect(c).toBeDefined();
    expect(c?.passed).toBe(false);
    expect(c?.error).toContain('subprocess died');
    expect(c?.verdict).toBeNull();
  });
});
