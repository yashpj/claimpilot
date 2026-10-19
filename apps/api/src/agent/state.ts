import { Annotation } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { TriageFlag, TriageResult } from "@claimpilot/shared";
import type { VlmVerdict } from "./analysis/vlm";
import type { DocExtraction } from "./analysis/doc-extraction";
import type { MlDetection } from "./ml/ml.client";
import type { CrossCheck } from "./analysis/cross-check";

export type Phase =
  | "intake" // collecting date / location / description / amount
  | "documents" // waiting for photos + license + registration
  | "analysis" // consistency -> fraud -> triage (one burst)
  | "review" // with a human reviewer
  | "more_info" // reviewer asked the customer for more
  | "done"; // decided, or rejected at intake

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  calls: number;
};

export type Analysis = {
  runId: string; // also the claim_assessments.id (idempotent insert)
  startedAt: number;
  status: "complete" | "incomplete";
  errors: string[]; // why it is incomplete
  vlm: VlmVerdict | null;
  ml: { modelVersion: string; detections: MlDetection[][] } | null;
  crossCheck: CrossCheck | null;
  docCount: number; // docs analysed; more later => re-analyse
  vlmModel: string | null;
};

const replace = <T>() => ({
  reducer: (_existing: T, update: T) => update,
});

// The full state that flows through the graph and gets checkpointed.
export const ClaimState = Annotation.Root({
  // Conversation history. Reducer APPENDS (concat), never replaces.
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, update) => existing.concat(update),
    default: () => [],
  }),

  // Which claim this conversation belongs to.
  claimId: Annotation<string>(),

  // Structured incident details, filled by the intake node (merge).
  incident: Annotation<{
    date?: string;
    location?: string;
    description?: string;
    claimedAmountCents?: number;
  }>({
    reducer: (existing, update) => ({ ...existing, ...update }),
    default: () => ({}),
  }),

  // Hydrated from claim_documents (the source of truth) on every run.
  documents: Annotation<{
    damagePhotos: string[];
    license?: string;
    registration?: string;
  }>({
    reducer: (_existing, update) => update,
    default: () => ({ damagePhotos: [] }),
  }),

  // Current phase within the agent. Replaces (scalar).
  phase: Annotation<Phase>({ ...replace<Phase>(), default: () => "intake" }),

  // Consecutive user turns with no progress in the current phase.
  // Stall/loop detection = "N turns and nothing new", not a raw turn count,
  // so a customer uploading photos one at a time is never "stalled".
  noProgressTurns: Annotation<number>({
    ...replace<number>(),
    default: () => 0,
  }),

  // How many documents existed the last time the documents node ran.
  docsSeen: Annotation<number>({ ...replace<number>(), default: () => 0 }),

  // Why the conversation ended at intake (policy inactive / out of window).
  closedReason: Annotation<string | null>({
    ...replace<string | null>(),
    default: () => null,
  }),

  // Conversation-level flags (stalled, dispute). Union, never removed.
  flags: Annotation<TriageFlag[]>({
    reducer: (existing, update) => [...new Set([...existing, ...update])],
    default: () => [],
  }),

  docExtraction: Annotation<DocExtraction | null>({
    ...replace<DocExtraction | null>(),
    default: () => null,
  }),

  // Replaced on every analysis run: a re-analysis must not inherit stale fields.
  analysis: Annotation<Analysis | null>({
    ...replace<Analysis | null>(),
    default: () => null,
  }),

  fraudFlags: Annotation<TriageFlag[]>({
    ...replace<TriageFlag[]>(),
    default: () => [],
  }),

  triage: Annotation<(TriageResult & { runId: string }) | null>({
    ...replace<(TriageResult & { runId: string }) | null>(),
    default: () => null,
  }),

  // Extra context from the customer after a reviewer asked for more info.
  additionalInfo: Annotation<string[]>({
    reducer: (existing, update) => existing.concat(update),
    default: () => [],
  }),

  // Running LLM cost for this claim. Additive across every run.
  usage: Annotation<Usage>({
    reducer: (a, b) => ({
      inputTokens: a.inputTokens + b.inputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      costMicroUsd: a.costMicroUsd + b.costMicroUsd,
      calls: a.calls + b.calls,
    }),
    default: () => ({
      inputTokens: 0,
      outputTokens: 0,
      costMicroUsd: 0,
      calls: 0,
    }),
  }),
});

export type ClaimStateType = typeof ClaimState.State;
export type ClaimStateUpdate = typeof ClaimState.Update;
