import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { EvalMessage } from '../evals/schema.js';

export interface ElementVerdict {
  element: string;
  present: boolean;
  reasoning: string;
}

export interface JudgeVerdict {
  passed: boolean;
  elements: ElementVerdict[];
}

const JudgeResponseSchema = z.object({
  results: z.array(
    z.object({
      element: z.string(),
      present: z.boolean(),
      reasoning: z.string(),
    }),
  ),
});

const JUDGE_TIMEOUT_MS = 60_000;

export interface JudgeArgs {
  model: LanguageModel;
  input: EvalMessage[];
  output: string;
  elements: string[];
}

export async function judgeElements(args: JudgeArgs): Promise<JudgeVerdict> {
  const { model, input, output, elements } = args;

  const prompt = buildPrompt(input, output, elements);

  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), JUDGE_TIMEOUT_MS);

  let object: z.infer<typeof JudgeResponseSchema>;
  try {
    ({ object } = await generateObject({
      model,
      schema: JudgeResponseSchema,
      prompt,
      abortSignal: abortController.signal,
      // OpenAI reasoning models (gpt-5*, o-series) reject the temperature
      // parameter; passing it just produces an AI SDK warning. For every
      // other model we pin temperature: 0 so verdicts are deterministic.
      ...(supportsTemperature(model) ? { temperature: 0 } : {}),
    }));
  } finally {
    clearTimeout(timer);
  }

  const byElement = new Map(object.results.map((r) => [r.element, r] as const));

  const verdicts: ElementVerdict[] = elements.map((element) => {
    const r = byElement.get(element);
    if (!r) {
      return {
        element,
        present: false,
        // Distinguish harness failure from genuine test failure so operators
        // know to investigate the judge prompt rather than the agent output.
        reasoning: 'HARNESS: judge did not return a result for this element (element text mismatch?).',
      };
    }
    return { element, present: r.present, reasoning: r.reasoning };
  });

  const passed = verdicts.every((v) => v.present);
  return { passed, elements: verdicts };
}

function supportsTemperature(model: LanguageModel): boolean {
  const provider = typeof model === 'string' ? '' : (model.provider ?? '');
  const modelId = typeof model === 'string' ? model : (model.modelId ?? '');
  if (provider.startsWith('openai') && /^(o\d|gpt-5)/.test(modelId)) return false;
  return true;
}

function buildPrompt(input: EvalMessage[], output: string, elements: string[]): string {
  const inputBlock = input.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');
  const elementsBlock = elements.map((e, i) => `${i + 1}. ${e}`).join('\n');

  return `You are an evaluator deciding whether an assistant's response contains specific required elements.

=== USER/CONVERSATION INPUT ===
${inputBlock}

=== ASSISTANT OUTPUT ===
${output}

=== REQUIRED ELEMENTS ===
${elementsBlock}

For each required element, decide whether it is present in the assistant's output. "Present" means the idea or behavior is conveyed by the output, not that the element is quoted verbatim. Be strict: if the output is silent on the element or only vaguely gestures at it, mark it as not present.

Return a JSON object with a "results" array containing one entry per element. Each entry must have:
- "element": the element text verbatim
- "present": true or false
- "reasoning": one short sentence justifying the decision

Preserve the exact wording of each element in the "element" field so the results can be matched back.`;
}
