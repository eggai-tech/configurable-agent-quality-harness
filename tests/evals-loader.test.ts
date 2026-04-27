import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EvalLoadError, loadEvals, resolveEvalsDir } from '../src/evals/loader.js';

describe('loadEvals', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mo-evals-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, body: string): string {
    const p = join(dir, name);
    writeFileSync(p, body, 'utf8');
    return p;
  }

  it('loads valid yaml evals sorted by filename', () => {
    write(
      'b.yaml',
      `name: second
input:
  messages:
    - role: user
      content: "hello"
expect:
  elements:
    - "a response"
`,
    );
    write(
      'a.yaml',
      `name: first
description: The first one.
input:
  messages:
    - role: user
      content: "hi"
expect:
  elements:
    - "greets back"
    - "is polite"
`,
    );

    const evals = loadEvals(dir);
    expect(evals).toHaveLength(2);
    expect(evals[0]?.case.name).toBe('first');
    expect(evals[1]?.case.name).toBe('second');
    expect(evals[0]?.case.expect.elements).toEqual(['greets back', 'is polite']);
  });

  it('accepts .yml in addition to .yaml', () => {
    write(
      'x.yml',
      `name: x
input:
  messages:
    - role: user
      content: "?"
expect:
  elements:
    - "an answer"
`,
    );
    const evals = loadEvals(dir);
    expect(evals).toHaveLength(1);
  });

  it('ignores non-yaml files', () => {
    write('readme.md', 'not an eval');
    write(
      'x.yaml',
      `name: x
input:
  messages:
    - role: user
      content: "?"
expect:
  elements:
    - "a"
`,
    );
    const evals = loadEvals(dir);
    expect(evals).toHaveLength(1);
  });

  it('throws on duplicate eval names across files', () => {
    const body = `name: dup
input:
  messages:
    - role: user
      content: "?"
expect:
  elements:
    - "a"
`;
    write('a.yaml', body);
    write('b.yaml', body);
    expect(() => loadEvals(dir)).toThrow(EvalLoadError);
  });

  it('throws on invalid yaml', () => {
    write('bad.yaml', 'this: is: not: yaml: [');
    expect(() => loadEvals(dir)).toThrow(EvalLoadError);
  });

  it('throws on schema violations (missing expect.elements)', () => {
    write(
      'bad.yaml',
      `name: bad
input:
  messages:
    - role: user
      content: "?"
`,
    );
    expect(() => loadEvals(dir)).toThrow(EvalLoadError);
  });

  it('throws when the dir does not exist', () => {
    expect(() => loadEvals(join(dir, 'nope'))).toThrow(EvalLoadError);
  });
});

describe('resolveEvalsDir', () => {
  it('resolves relative to the config file dir', () => {
    const configPath = '/tmp/project/wally-config.yaml';
    expect(resolveEvalsDir(configPath, './evals')).toBe('/tmp/project/evals');
    expect(resolveEvalsDir(configPath, '../shared/evals')).toBe('/tmp/shared/evals');
  });

  it('passes absolute paths through', () => {
    expect(resolveEvalsDir('/a/b/c.yaml', '/abs/evals')).toBe('/abs/evals');
  });
});
