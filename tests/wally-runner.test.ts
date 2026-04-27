import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WallyRunError, runWally } from '../src/wally-runner/subprocess.js';

describe('runWally', () => {
  let dir: string;
  let originalBin: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mo-runner-'));
    originalBin = process.env.MO_WALLY_BIN;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalBin === undefined) delete process.env.MO_WALLY_BIN;
    else process.env.MO_WALLY_BIN = originalBin;
  });

  function installFakeWally(script: string): string {
    const path = join(dir, 'fake-wally.sh');
    writeFileSync(path, `#!/usr/bin/env bash\n${script}\n`, 'utf8');
    chmodSync(path, 0o755);
    process.env.MO_WALLY_BIN = path;
    return path;
  }

  it('parses a single-line JSON response', async () => {
    installFakeWally(
      `cat >/dev/null
echo '{"ok":true,"finalText":"hello","error":null}'`,
    );

    const r = await runWally({
      configPath: '/tmp/cfg.yaml',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(r.ok).toBe(true);
    expect(r.finalText).toBe('hello');
    expect(r.error).toBeNull();
  });

  it('parses a final JSON object after NDJSON event lines', async () => {
    installFakeWally(
      `cat >/dev/null
echo '{"type":"event"}'
echo '{"type":"event2"}'
echo '{"ok":true,"finalText":"done","error":null}'`,
    );

    const r = await runWally({
      configPath: '/tmp/cfg.yaml',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(r.finalText).toBe('done');
  });

  it('throws WallyRunError on non-zero exit code', async () => {
    installFakeWally(`cat >/dev/null
echo "boom" >&2
exit 2`);

    await expect(
      runWally({
        configPath: '/tmp/cfg.yaml',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(WallyRunError);
  });

  it('throws WallyRunError on unparseable stdout', async () => {
    installFakeWally(`cat >/dev/null
echo "not json"`);

    await expect(
      runWally({
        configPath: '/tmp/cfg.yaml',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toBeInstanceOf(WallyRunError);
  });

  it('forwards TRACEPARENT and OTEL endpoint as env vars', async () => {
    installFakeWally(
      `cat >/dev/null
echo "{\\"ok\\":true,\\"finalText\\":\\"tp=$TRACEPARENT otlp=$OTEL_EXPORTER_OTLP_ENDPOINT\\",\\"error\\":null}"`,
    );

    const r = await runWally({
      configPath: '/tmp/cfg.yaml',
      messages: [{ role: 'user', content: 'hi' }],
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      otlpEndpoint: 'https://langfuse.example/api/public/otel',
    });
    expect(r.finalText).toContain('tp=00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
    expect(r.finalText).toContain('otlp=https://langfuse.example/api/public/otel');
  });

  it('times out long-running wally', async () => {
    installFakeWally(`cat >/dev/null
sleep 5
echo '{"ok":true,"finalText":"late","error":null}'`);

    await expect(
      runWally({
        configPath: '/tmp/cfg.yaml',
        messages: [{ role: 'user', content: 'hi' }],
        timeoutMs: 200,
      }),
    ).rejects.toBeInstanceOf(WallyRunError);
  });
});
