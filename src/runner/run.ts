import { randomBytes } from 'node:crypto';
import pLimit from 'p-limit';
import { loadWallyConfigForMo } from '../config/wally-config.js';
import { type LoadedEval, loadEvals } from '../evals/loader.js';
import { readJudgeEnv } from '../judge/env.js';
import { judgeElements, type JudgeVerdict } from '../judge/judge.js';
import { buildJudgeModel } from '../judge/model.js';
import { createReporter, readLangfuseEnv } from '../langfuse/reporter.js';
import { runWally, WallyRunError, type WallyRunResult } from '../wally-runner/subprocess.js';

export type RunProgressEvent =
  | { type: 'case_start'; name: string; filePath: string }
  | {
      type: 'case_finish';
      name: string;
      filePath: string;
      passed: boolean;
      durationMs: number;
      error: string | null;
    };

export type RunProgressCallback = (event: RunProgressEvent) => void | Promise<void>;

export interface RunOptions {
  configPath: string;
  filter?: string | undefined;
  concurrency?: number | undefined;
  onProgress?: RunProgressCallback | undefined;
}

export interface CaseResult {
  name: string;
  filePath: string;
  passed: boolean;
  verdict: JudgeVerdict | null;
  wallyResult: WallyRunResult | null;
  error: string | null;
  traceUrl: string | null;
  durationMs: number;
}

export interface RunSummary {
  runId: string;
  wallyConfigPath: string;
  totalCases: number;
  passed: number;
  failed: number;
  errored: number;
  accuracy: number | null;
  cases: CaseResult[];
  startedAt: string;
  finishedAt: string;
  experimentUrl: string | null;
}

const DEFAULT_CONCURRENCY = 4;

export async function runEvals(options: RunOptions): Promise<RunSummary> {
  const startedAt = new Date();

  const wallyConfig = loadWallyConfigForMo(options.configPath);

  const allEvals = loadEvals(wallyConfig.evalsDir);
  const evals = options.filter
    ? allEvals.filter((e) => e.case.name.includes(options.filter as string))
    : allEvals;

  const judgeCfg = readJudgeEnv();
  const judgeModel = buildJudgeModel(judgeCfg);

  const langfuseEnv = readLangfuseEnv();
  const runId = `mo-${Date.now()}-${randomBytes(3).toString('hex')}`;
  const reporter = createReporter(langfuseEnv, {
    runId,
    runName: wallyConfig.name,
    startedAt,
    wallyConfigPath: wallyConfig.absPath,
  });

  await reporter.prepare(
    evals.map((e) => ({ name: e.case.name, expectedElements: e.case.expect.elements })),
  );

  const limit = pLimit(options.concurrency ?? DEFAULT_CONCURRENCY);
  const cases = await Promise.all(
    evals.map((e) =>
      limit(() => runOne(e, wallyConfig.absPath, reporter, judgeModel, options.onProgress)),
    ),
  );

  const finishedAt = new Date();
  const passed = cases.filter((c) => c.passed && c.error === null).length;
  const errored = cases.filter((c) => c.error !== null).length;
  const failed = cases.length - passed - errored;
  const accuracy = cases.length === 0 ? null : passed / cases.length;

  if (accuracy !== null) {
    await reporter.recordRunAccuracy({ accuracy, passed, total: cases.length });
  }
  await reporter.flush();
  const experimentUrl = await reporter.experimentUrl();

  return {
    runId,
    wallyConfigPath: wallyConfig.absPath,
    totalCases: cases.length,
    passed,
    failed,
    errored,
    accuracy,
    cases,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    experimentUrl,
  };
}

async function runOne(
  loaded: LoadedEval,
  wallyConfigPath: string,
  reporter: ReturnType<typeof createReporter>,
  judgeModel: ReturnType<typeof buildJudgeModel>,
  onProgress: RunProgressCallback | undefined,
): Promise<CaseResult> {
  const start = Date.now();
  const { case: c, filePath } = loaded;

  await notify(onProgress, { type: 'case_start', name: c.name, filePath });

  const caseReport = reporter.startCase({
    name: c.name,
    description: c.description,
    input: c.input.messages,
  });

  const finish = async (result: CaseResult): Promise<CaseResult> => {
    await notify(onProgress, {
      type: 'case_finish',
      name: result.name,
      filePath: result.filePath,
      passed: result.passed,
      durationMs: result.durationMs,
      error: result.error,
    });
    return result;
  };

  try {
    const wallyResult = await runWally({
      configPath: wallyConfigPath,
      messages: c.input.messages,
      traceparent: caseReport.traceparent,
      otlpEndpoint: reporter.otlpEndpoint,
      otlpHeaders: reporter.otlpHeaders,
    });

    caseReport.recordOutput(wallyResult);

    const verdict = await judgeElements({
      model: judgeModel,
      input: c.input.messages,
      output: wallyResult.finalText,
      elements: c.expect.elements,
    });

    caseReport.recordVerdict(verdict);

    return await finish({
      name: c.name,
      filePath,
      passed: verdict.passed,
      verdict,
      wallyResult,
      error: null,
      traceUrl: caseReport.traceUrl,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    caseReport.recordError(error);
    return await finish({
      name: c.name,
      filePath,
      passed: false,
      verdict: null,
      wallyResult: err instanceof WallyRunError ? null : null,
      error: error.message,
      traceUrl: caseReport.traceUrl,
      durationMs: Date.now() - start,
    });
  }
}

async function notify(
  onProgress: RunProgressCallback | undefined,
  event: RunProgressEvent,
): Promise<void> {
  if (!onProgress) return;
  try {
    await onProgress(event);
  } catch (err) {
    // A misbehaving callback must not kill the eval run.
    console.error('[mo] onProgress callback threw:', err);
  }
}
