import { StateGraph, START, END } from "@langchain/langgraph";
import { ClaimState, type ClaimStateType } from "./state";
import type { AgentDeps } from "./deps";
import { makeIntakeNode } from "./nodes/intake";
import { makeDocumentsNode, docCount } from "./nodes/documents";
import { makeConsistencyNode } from "./nodes/consistency";
import { makeFraudNode } from "./nodes/fraud";
import { makeTriageNode } from "./nodes/triage";
import { makeFollowupNode } from "./nodes/followup";
import { makeClosedNode, makeReopenNode } from "./nodes/reopen";

// Node names can't collide with state channels (LangGraph rule), hence
// "collect_documents" (channel: documents) and "triage_claim" (channel: triage).
//
// Every invoke() starts at START with one customer turn, and the router picks
// the node from the checkpointed phase. "Ask the user" = return to END; the
// next message resumes from the checkpoint. The graph owns control flow; the
// LLM only does language work inside nodes.
//
//   START ─► intake ─► collect_documents ─► consistency ─► fraud_checks ─► triage_claim ─► END
//     │        │ (ask)     │ (ask)        ▲
//     │        ▼           ▼              │ stalled / re-analysis
//     ├─► followup (review) ─────────────┘ (when new documents arrive)
//     ├─► reopen (more_info) ────────────► consistency
//     └─► closed (done)
export function routeByPhase(state: ClaimStateType) {
  switch (state.phase) {
    case "intake":
      return "intake";
    case "documents":
      return "collect_documents";
    case "analysis":
      // Only reachable if a previous run died mid-analysis: just redo it.
      return "consistency";
    case "review":
      // New evidence after triage => re-analyse instead of chatting.
      return state.analysis &&
        docCount(state.documents) > state.analysis.docCount
        ? "consistency"
        : "followup";
    case "more_info":
      return "reopen";
    case "done":
      return "closed";
  }
}

const afterIntake = (s: ClaimStateType) =>
  s.phase === "documents"
    ? "collect_documents"
    : s.phase === "analysis"
      ? "consistency"
      : END;

const afterDocuments = (s: ClaimStateType) =>
  s.phase === "analysis" ? "consistency" : END;

export function buildClaimGraph(deps: AgentDeps) {
  return new StateGraph(ClaimState)
    .addNode("intake", makeIntakeNode(deps))
    .addNode("collect_documents", makeDocumentsNode(deps))
    .addNode("consistency", makeConsistencyNode(deps))
    .addNode("fraud_checks", makeFraudNode(deps))
    .addNode("triage_claim", makeTriageNode(deps))
    .addNode("followup", makeFollowupNode(deps))
    .addNode("reopen", makeReopenNode())
    .addNode("closed", makeClosedNode())
    .addConditionalEdges(START, routeByPhase, [
      "intake",
      "collect_documents",
      "consistency",
      "followup",
      "reopen",
      "closed",
    ])
    .addConditionalEdges("intake", afterIntake, [
      "collect_documents",
      "consistency",
      END,
    ])
    .addConditionalEdges("collect_documents", afterDocuments, [
      "consistency",
      END,
    ])
    .addEdge("consistency", "fraud_checks")
    .addEdge("fraud_checks", "triage_claim")
    .addEdge("triage_claim", END)
    .addEdge("reopen", "consistency")
    .addEdge("followup", END)
    .addEdge("closed", END);
}
