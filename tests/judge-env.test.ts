import { describe, expect, it } from 'vitest';
import { JudgeEnvError, readJudgeEnv } from '../src/judge/env.js';

describe('readJudgeEnv', () => {
  it('reads a valid anthropic config', () => {
    const cfg = readJudgeEnv({
      EVAL_LLM_PROVIDER: 'anthropic',
      EVAL_LLM_MODEL: 'claude-haiku-4-5',
      EVAL_LLM_API_KEY: 'sk-xxx',
    });
    expect(cfg.provider).toBe('anthropic');
    expect(cfg.model).toBe('claude-haiku-4-5');
    expect(cfg.apiKey).toBe('sk-xxx');
    expect(cfg.baseUrl).toBeUndefined();
  });

  it('allows ollama without an api key', () => {
    const cfg = readJudgeEnv({
      EVAL_LLM_PROVIDER: 'ollama',
      EVAL_LLM_MODEL: 'llama3',
    });
    expect(cfg.provider).toBe('ollama');
    expect(cfg.apiKey).toBeUndefined();
  });

  it('throws when provider is missing', () => {
    expect(() => readJudgeEnv({ EVAL_LLM_MODEL: 'x' })).toThrow(JudgeEnvError);
  });

  it('throws when provider is unknown', () => {
    expect(() =>
      readJudgeEnv({
        EVAL_LLM_PROVIDER: 'cohere',
        EVAL_LLM_MODEL: 'x',
        EVAL_LLM_API_KEY: 'k',
      }),
    ).toThrow(JudgeEnvError);
  });

  it('throws when model is missing', () => {
    expect(() =>
      readJudgeEnv({ EVAL_LLM_PROVIDER: 'anthropic', EVAL_LLM_API_KEY: 'k' }),
    ).toThrow(JudgeEnvError);
  });

  it('throws when api key is missing for non-ollama provider', () => {
    expect(() =>
      readJudgeEnv({ EVAL_LLM_PROVIDER: 'openai', EVAL_LLM_MODEL: 'gpt-4o' }),
    ).toThrow(JudgeEnvError);
  });
});
