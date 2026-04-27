import { spawn } from 'node:child_process';
import type { EvalMessage } from '../evals/schema.js';

export interface WallyRunInput {
  configPath: string;
  messages: EvalMessage[];
  traceparent?: string;
  otlpEndpoint?: string;
  otlpHeaders?: string;
  extraEnv?: Record<string, string>;
  timeoutMs?: number;
}

export interface WallyRunResult {
  ok: boolean;
  finalText: string;
  error: string | null;
}

export class WallyRunError extends Error {
  constructor(
    message: string,
    public readonly stderr?: string,
    public readonly exitCode?: number | null,
  ) {
    super(message);
    this.name = 'WallyRunError';
  }
}

const DEFAULT_TIMEOUT_MS = 300_000;

export async function runWally(input: WallyRunInput): Promise<WallyRunResult> {
  const bin = process.env.MO_WALLY_BIN ?? 'wally';
  const args = ['run', '--config', input.configPath];
  const env: NodeJS.ProcessEnv = { ...process.env, ...input.extraEnv };
  if (input.traceparent) env.TRACEPARENT = input.traceparent;
  if (input.otlpEndpoint) env.OTEL_EXPORTER_OTLP_ENDPOINT = input.otlpEndpoint;
  if (input.otlpHeaders) env.OTEL_EXPORTER_OTLP_HEADERS = input.otlpHeaders;

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<WallyRunResult>((resolve, reject) => {
    const child = spawn(bin, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new WallyRunError(`wally run timed out after ${timeoutMs}ms`, stderr));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new WallyRunError(`failed to spawn wally: ${err.message}`, stderr));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new WallyRunError(`wally exited with code ${code}`, stderr, code));
        return;
      }
      const parsed = parseWallyOutput(stdout);
      if (!parsed) {
        reject(
          new WallyRunError(
            `wally stdout was not a valid JSON run record: ${stdout.slice(0, 200)}`,
            stderr,
            code,
          ),
        );
        return;
      }
      resolve(parsed);
    });

    const stdinPayload = JSON.stringify({ messages: input.messages });
    child.stdin.end(stdinPayload);
  });
}

function parseWallyOutput(raw: string): WallyRunResult | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Accept either a single JSON object on stdout or a JSON object on the last line
  // (to tolerate wally emitting NDJSON event streams followed by a final record).
  const candidates: string[] = [];
  candidates.push(trimmed);
  const lastNewline = trimmed.lastIndexOf('\n');
  if (lastNewline >= 0) candidates.push(trimmed.slice(lastNewline + 1));

  for (const candidate of candidates) {
    try {
      const obj = JSON.parse(candidate);
      if (isRunResult(obj)) return obj;
    } catch {
      // try next
    }
  }
  return null;
}

function isRunResult(v: unknown): v is WallyRunResult {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.ok === 'boolean' && typeof o.finalText === 'string';
}
