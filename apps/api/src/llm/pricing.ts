import type { LlmUsage } from "./llm.interface";

// Nominal list prices (USD per 1M tokens) used to put a cost on every claim.
// The free tier bills $0, but "what would this cost at scale" is the number
// that matters, so we price as if paid. Update when the model changes.
export const LLM_PRICING: Record<string, { input: number; output: number }> = {
  "gemini-flash-latest": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
};

const FALLBACK = { input: 0.3, output: 2.5 };

// Integer micro-dollars, same reason money is integer cents: no float drift
// when summing thousands of rows.
export function costMicroUsd(model: string, usage: LlmUsage): number {
  const p = LLM_PRICING[model] ?? FALLBACK;
  return Math.round(
    usage.inputTokens * p.input + usage.outputTokens * p.output,
  );
}
