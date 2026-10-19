import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

// The full state that flows through the graph and gets checkpointed.
export const ClaimState = Annotation.Root({
  // Conversation history. Reducer APPENDS (concat), never replaces.
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, update) => existing.concat(update),
    default: () => [],
  }),

  // Which claim this conversation belongs to.
  claimId: Annotation<string>(),

  // Structured incident details, filled by the intake node.
  incident: Annotation<{
    date?: string;
    location?: string;
    description?: string;
  }>({
    reducer: (existing, update) => ({ ...existing, ...update }),
    default: () => ({}),
  }),

  // What documents we've collected / still need (filled in 3.4).
  documents: Annotation<{
    damagePhotos: string[];
    license?: string;
    registration?: string;
  }>({
    reducer: (existing, update) => ({ ...existing, ...update }),
    default: () => ({ damagePhotos: [] }),
  }),

  // Current phase within the agent. Replaces (scalar).
  phase: Annotation<"intake" | "documents" | "analysis" | "triage" | "done">({
    value: (_existing, update) => update, // replace
    default: () => "intake",
  }),

  analysis: Annotation<{
    observedDamage?: string;
    matchesDescription?: boolean;
    confidence?: number;
    discrepancies?: string[];
    status?: "complete" | "failed" | "skipped";
  }>({
    value: (existing, update) => ({ ...existing, ...update }),
    default: () => ({}),
  }),
});

export type ClaimStateType = typeof ClaimState.State;
