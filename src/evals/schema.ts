import { z } from 'zod';

export const EvalMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1),
});

export const EvalCaseSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    input: z.object({
      messages: z.array(EvalMessageSchema).min(1),
    }),
    expect: z.object({
      elements: z.array(z.string().min(1)).min(1),
    }),
  })
  .strict();

export type EvalMessage = z.infer<typeof EvalMessageSchema>;
export type EvalCase = z.infer<typeof EvalCaseSchema>;
