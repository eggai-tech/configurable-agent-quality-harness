export type JudgeProvider = 'anthropic' | 'openai' | 'google' | 'ollama';

export interface JudgeEnvConfig {
  provider: JudgeProvider;
  model: string;
  apiKey: string | undefined;
  baseUrl: string | undefined;
}

export class JudgeEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JudgeEnvError';
  }
}

const PROVIDERS: readonly JudgeProvider[] = ['anthropic', 'openai', 'google', 'ollama'];

function isProvider(v: string): v is JudgeProvider {
  return (PROVIDERS as readonly string[]).includes(v);
}

export function readJudgeEnv(env: NodeJS.ProcessEnv = process.env): JudgeEnvConfig {
  const provider = env.EVAL_LLM_PROVIDER;
  if (!provider) {
    throw new JudgeEnvError(
      'EVAL_LLM_PROVIDER is required (one of: anthropic, openai, google, ollama)',
    );
  }
  if (!isProvider(provider)) {
    throw new JudgeEnvError(
      `EVAL_LLM_PROVIDER must be one of: ${PROVIDERS.join(', ')} (got "${provider}")`,
    );
  }

  const model = env.EVAL_LLM_MODEL;
  if (!model) {
    throw new JudgeEnvError('EVAL_LLM_MODEL is required');
  }

  const apiKey = env.EVAL_LLM_API_KEY;
  const baseUrl = env.EVAL_LLM_BASE_URL;

  if (provider !== 'ollama' && !apiKey) {
    throw new JudgeEnvError(`EVAL_LLM_API_KEY is required for provider "${provider}"`);
  }

  return { provider, model, apiKey, baseUrl };
}
