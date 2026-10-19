import { AIMessage } from "@langchain/core/messages";
import type { AgentDeps } from "../deps";
import type { ClaimStateType } from "../state";

// What documents a claim requires.
const REQUIRED = ["damagePhotos", "license", "registration"] as const;

export function makeDocumentsNode({ db }: AgentDeps) {
  return async function documentsNode(state: ClaimStateType) {
    const docs = state.documents;

    const have = {
      damagePhotos: docs.damagePhotos.length > 0,
      license: !!docs.license,
      registration: !!docs.registration,
    };

    const missing = REQUIRED.filter((d) => !have[d]);

    if (missing.length === 0) {
      return {
        phase: "analysis" as const,
        messages: [
          new AIMessage(
            "Got all your documents. Let me analyze the damage now.",
          ),
        ],
      };
    }

    // Acknowledge what arrived, ask for what's missing.
    const labels: Record<string, string> = {
      damagePhotos: "photos of the damage",
      license: "your driver's license",
      registration: "your vehicle registration",
    };
    const ask = missing.map((m) => labels[m]).join(", ");

    return {
      phase: "documents" as const,
      messages: [new AIMessage(`Please upload: ${ask}.`)],
    };
  };
}
