import { AIMessage } from "@langchain/core/messages";
import type { ClaimStateType, ClaimStateUpdate } from "../state";

// A reviewer asked for more info and the customer answered (text and/or new
// uploads). Keep their answer as context and re-run analysis -> fresh triage.
export function makeReopenNode() {
  return async function reopenNode(
    state: ClaimStateType,
  ): Promise<ClaimStateUpdate> {
    const last = state.messages.at(-1);
    const text =
      last?.getType() === "human" && typeof last.content === "string"
        ? last.content
        : "";
    return {
      phase: "analysis",
      additionalInfo: text ? [text] : [],
      messages: [
        new AIMessage(
          "Thanks — I've added that to your claim and sent it back for review.",
        ),
      ],
    };
  };
}

export function makeClosedNode() {
  return async function closedNode(
    state: ClaimStateType,
  ): Promise<ClaimStateUpdate> {
    return {
      messages: [
        new AIMessage(
          state.closedReason
            ? "This claim couldn't be filed (see above). You can start a new claim from your policy page."
            : "This claim has been decided and is now closed. Please contact support if you have questions.",
        ),
      ],
    };
  };
}
