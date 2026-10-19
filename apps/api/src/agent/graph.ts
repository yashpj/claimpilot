// import { StateGraph, START, END } from "@langchain/langgraph";
// import { ClaimState } from "./state";

// // A placeholder node — just proves the wiring. Real logic in 3.3.
// async function intakeNode(state: typeof ClaimState.State) {
//   return { phase: "intake" as const };
// }

// export function buildClaimGraph() {
//   const graph = new StateGraph(ClaimState)
//     .addNode("intake", intakeNode)
//     .addEdge(START, "intake")   // entry point
//     .addEdge("intake", END);    // for now, intake → end

//   return graph;
// }

import { StateGraph, START, END } from "@langchain/langgraph";
import { ClaimState } from "./state";
import { makeIntakeNode } from "./nodes/intake";
import type { LlmProvider } from "../llm/llm.interface";
import { AgentDeps } from "./deps";

export function buildClaimGraph(deps: AgentDeps) {
  return new StateGraph(ClaimState)
    .addNode("intake", makeIntakeNode(deps))
    .addEdge(START, "intake")
    .addEdge("intake", END); // one node for now; 3.4 adds documents
}
