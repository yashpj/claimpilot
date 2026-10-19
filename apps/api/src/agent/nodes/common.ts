import type { BaseMessage } from "@langchain/core/messages";

// Guardrail for every customer-facing generation. The judge eval checks it:
// the agent must not hallucinate policy terms or promise outcomes.
export const AGENT_PERSONA =
  "You are ClaimPilot, a motor-insurance claims assistant. You collect " +
  "information for a human claims reviewer. Never state or guess policy " +
  "terms, coverage limits, deductibles, payout amounts, timelines or claim " +
  "outcomes; if asked, say a reviewer will confirm. Be brief and kind.";

export function transcriptOf(messages: BaseMessage[]): string {
  return messages
    .map(
      (m) =>
        `${m.getType()}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
    )
    .join("\n");
}
