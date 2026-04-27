import { randomBytes } from 'node:crypto';
import { Langfuse, type LangfuseTraceClient } from 'langfuse';
import type { EvalMessage } from '../evals/schema.js';
import type { JudgeVerdict } from '../judge/judge.js';
import type { WallyRunResult } from '../wally-runner/subprocess.js';

export interface LangfuseEnv {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
}

export function readLangfuseEnv(env: NodeJS.ProcessEnv = process.env): LangfuseEnv | null {
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;
  const baseUrl = env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com';
  if (!publicKey || !secretKey) return null;
  return { publicKey, secretKey, baseUrl };
}

export interface RunContext {
  runId: string;
  runName: string;
  startedAt: Date;
  wallyConfigPath: string;
}

export interface CaseReport {
  traceparent: string;
  traceId: string;
  traceUrl: string | null;
  recordOutput(output: WallyRunResult): void;
  recordVerdict(verdict: JudgeVerdict): void;
  recordError(err: Error): void;
}

export interface EvalPrepareInfo {
  name: string;
  expectedElements: string[];
}

export interface Reporter {
  otlpEndpoint: string | undefined;
  otlpHeaders: string | undefined;
  prepare(evals: EvalPrepareInfo[]): Promise<void>;
  startCase(args: { name: string; description: string | undefined; input: EvalMessage[] }): CaseReport;
  recordRunAccuracy(args: { accuracy: number; passed: number; total: number }): Promise<void>;
  flush(): Promise<void>;
  experimentUrl(): Promise<string | null>;
}

export function createReporter(env: LangfuseEnv | null, run: RunContext): Reporter {
  if (!env) return new NoopReporter();
  return new LangfuseReporter(env, run);
}

class NoopReporter implements Reporter {
  otlpEndpoint = undefined;
  otlpHeaders = undefined;
  async prepare(): Promise<void> {}
  startCase(_args: { name: string; description: string | undefined; input: EvalMessage[] }): CaseReport {
    const traceId = randomTraceId();
    const spanId = randomSpanId();
    return {
      traceparent: `00-${traceId}-${spanId}-01`,
      traceId,
      traceUrl: null,
      recordOutput: () => {},
      recordVerdict: () => {},
      recordError: () => {},
    };
  }
  async recordRunAccuracy(): Promise<void> {}
  async flush(): Promise<void> {}
  async experimentUrl(): Promise<string | null> {
    return null;
  }
}

class LangfuseReporter implements Reporter {
  private readonly client: Langfuse;
  readonly otlpEndpoint: string;
  readonly otlpHeaders: string;
  private readonly run: RunContext;
  private readonly baseUrl: string;
  private readonly datasetName: string;
  private datasetPrepared = false;
  private projectId: string | null = null;
  private datasetId: string | null = null;
  private datasetRunId: string | null = null;
  private readonly pendingLinks: Promise<unknown>[] = [];

  constructor(env: LangfuseEnv, run: RunContext) {
    this.client = new Langfuse({
      publicKey: env.publicKey,
      secretKey: env.secretKey,
      baseUrl: env.baseUrl,
    });
    this.baseUrl = env.baseUrl.replace(/\/$/, '');
    this.otlpEndpoint = `${this.baseUrl}/api/public/otel`;
    const token = Buffer.from(`${env.publicKey}:${env.secretKey}`, 'utf8').toString('base64');
    this.otlpHeaders = `Authorization=Basic ${token}`;
    this.run = run;
    this.datasetName = run.runName;
  }

  async prepare(evals: EvalPrepareInfo[]): Promise<void> {
    try {
      await this.client.createDataset({
        name: this.datasetName,
        metadata: { wallyConfigPath: this.run.wallyConfigPath },
      });
      await Promise.all(
        evals.map((e) =>
          this.client.createDatasetItem({
            datasetName: this.datasetName,
            id: this.itemId(e.name),
            expectedOutput: { elements: e.expectedElements },
          }),
        ),
      );
      const ds = await this.client.getDataset(this.datasetName);
      this.projectId = ds.projectId ?? null;
      this.datasetId = ds.id ?? null;
      this.datasetPrepared = true;
    } catch (err) {
      console.warn(`mo: failed to prepare Langfuse dataset: ${asMsg(err)}`);
    }
  }

  // Langfuse Cloud enforces global uniqueness of `dataset-items.id` within a
  // project: POSTing an id that already exists in ANOTHER dataset 404s with
  // "Dataset item with id X not found for project Y". Namespace item ids by
  // dataset so two agents in the same project can share case names.
  private itemId(caseName: string): string {
    return `${this.datasetName}/${caseName}`;
  }

  startCase(args: { name: string; description: string | undefined; input: EvalMessage[] }): CaseReport {
    const traceId = randomTraceId();
    const spanId = randomSpanId();
    const traceparent = `00-${traceId}-${spanId}-01`;

    const trace: LangfuseTraceClient = this.client.trace({
      id: traceId,
      name: args.name,
      input: { messages: args.input },
      tags: ['mo', `run:${this.run.runId}`],
      metadata: {
        runId: this.run.runId,
        runName: this.run.runName,
        wallyConfigPath: this.run.wallyConfigPath,
        description: args.description,
      },
    });

    const traceUrl = safeTraceUrl(this.baseUrl, traceId);

    if (this.datasetPrepared) {
      const p = this.client
        .createDatasetRunItem({
          runName: this.run.runId,
          datasetItemId: this.itemId(args.name),
          traceId,
        })
        .then((res) => {
          const rid = (res as { datasetRunId?: string } | null)?.datasetRunId ?? null;
          if (rid && !this.datasetRunId) this.datasetRunId = rid;
        })
        .catch((err) => {
          console.warn(`mo: link dataset run item failed for ${args.name}: ${asMsg(err)}`);
        });
      this.pendingLinks.push(p);
    }

    return {
      traceparent,
      traceId,
      traceUrl,
      recordOutput: (result) => {
        trace.update({
          output: { finalText: result.finalText },
        });
      },
      recordVerdict: (verdict) => {
        this.client.score({
          traceId,
          name: 'mo.pass',
          value: verdict.passed ? 1 : 0,
          comment: formatVerdictComment(verdict),
        });
      },
      recordError: (err) => {
        trace.update({
          output: { error: err.message },
        });
        this.client.score({
          traceId,
          name: 'mo.pass',
          value: 0,
          comment: `error: ${err.message}`,
        });
      },
    };
  }

  async recordRunAccuracy(args: { accuracy: number; passed: number; total: number }): Promise<void> {
    if (!this.datasetPrepared) return;
    const runId = await this.resolveDatasetRunId();
    if (!runId) {
      console.warn('mo: cannot emit mo.accuracy score — datasetRunId unresolved');
      return;
    }
    this.client.score({
      datasetRunId: runId,
      name: 'mo.accuracy',
      value: args.accuracy,
      dataType: 'NUMERIC',
      comment: `${args.passed}/${args.total} cases passed`,
    });
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.pendingLinks);
    await this.client.shutdownAsync();
  }

  async experimentUrl(): Promise<string | null> {
    if (!this.datasetPrepared || !this.projectId || !this.datasetId) return null;
    const runId = await this.resolveDatasetRunId();
    if (!runId) return null;
    return `${this.baseUrl}/project/${this.projectId}/datasets/${this.datasetId}/runs/${runId}`;
  }

  private async resolveDatasetRunId(): Promise<string | null> {
    await Promise.allSettled(this.pendingLinks);
    if (this.datasetRunId) return this.datasetRunId;
    try {
      const run = await this.client.getDatasetRun({
        datasetName: this.datasetName,
        runName: this.run.runId,
      });
      this.datasetRunId = run.id ?? null;
    } catch (err) {
      console.warn(`mo: could not resolve datasetRunId: ${asMsg(err)}`);
    }
    return this.datasetRunId;
  }
}

function randomTraceId(): string {
  return randomBytes(16).toString('hex');
}

function randomSpanId(): string {
  return randomBytes(8).toString('hex');
}

function formatVerdictComment(verdict: JudgeVerdict): string {
  const missing = verdict.elements.filter((e) => !e.present);
  if (missing.length === 0) return 'all elements present';
  const lines = missing.map((m) => `- missing: ${m.element} (${m.reasoning})`);
  return `missing ${missing.length}/${verdict.elements.length} elements:\n${lines.join('\n')}`;
}

function safeTraceUrl(baseUrl: string, traceId: string): string | null {
  if (!baseUrl) return null;
  return `${baseUrl}/trace/${traceId}`;
}

function asMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
