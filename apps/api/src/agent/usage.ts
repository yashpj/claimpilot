import type { RunnableConfig } from "@langchain/core/runnables";
import type { LlmResult } from "../llm/llm.interface";
import { costMicroUsd } from "../llm/pricing";
import type { Usage } from "./state";

// Turn one LLM result into the additive `usage` state update.
export function usageOf(...results: LlmResult<unknown>[]): Usage {
  return results.reduce<Usage>(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.usage.inputTokens,
      outputTokens: acc.outputTokens + r.usage.outputTokens,
      costMicroUsd: acc.costMicroUsd + costMicroUsd(r.model, r.usage),
      calls: acc.calls + 1,
    }),
    { inputTokens: 0, outputTokens: 0, costMicroUsd: 0, calls: 0 },
  );
}

// One trace per agent run; the service puts the id in `configurable`.
export function traceIdOf(config?: RunnableConfig): string | undefined {
  const id = config?.configurable?.traceId as unknown;
  return typeof id === "string" ? id : undefined;
}
