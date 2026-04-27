import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { JudgeEnvConfig } from './env.js';

export function buildJudgeModel(cfg: JudgeEnvConfig): LanguageModel {
  switch (cfg.provider) {
    case 'anthropic': {
      const client = createAnthropic({ apiKey: cfg.apiKey });
      return client(cfg.model);
    }
    case 'openai': {
      const client = createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
      return client(cfg.model);
    }
    case 'google': {
      const client = createGoogleGenerativeAI({ apiKey: cfg.apiKey });
      return client(cfg.model);
    }
    case 'ollama': {
      const baseURL = cfg.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
      const client = createOpenAICompatible({ name: 'ollama', baseURL });
      return client(cfg.model);
    }
  }
}
