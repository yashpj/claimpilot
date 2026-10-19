import { AIMessage } from "@langchain/core/messages";
import { eq } from "drizzle-orm";
import * as schema from "@claimpilot/db";
import { evaluateTriage, type TriageFlag } from "@claimpilot/shared";
import type { AgentDeps } from "../deps";
import type { ClaimStateType, ClaimStateUpdate } from "../state";
import {
  isUnreadable,
  DOC_EXTRACTION_PROMPT_VERSION,
} from "../analysis/doc-extraction";
import { CONSISTENCY_PROMPT_VERSION } from "../analysis/vlm";

// Triage (spec §4.4): explicit rules from config, then persist. The agent's
// output is a PRIORITY and an advisory RECOMMENDATION. Every claim goes to a
// human; triage only decides which queue and what the reviewer sees first.
export function makeTriageNode({ db, triageConfig, now }: AgentDeps) {
  return async function triageNode(
    state: ClaimStateType,
  ): Promise<ClaimStateUpdate> {
    const analysis = state.analysis;
    const runId = analysis?.runId ?? crypto.randomUUID();

    const flags: TriageFlag[] = [...state.flags, ...state.fraudFlags];
    if (!analysis || analysis.status === "incomplete")
      flags.push("analysis_incomplete");
    if (analysis?.crossCheck && !analysis.crossCheck.agree)
      flags.push("vlm_ml_disagreement");
    if (isUnreadable(state.docExtraction)) flags.push("unreadable_documents");
    if (state.docExtraction?.status === "failed")
      flags.push("analysis_incomplete");

    const result = evaluateTriage(
      {
        vlm: analysis?.vlm ?? null,
        claimedAmountCents: state.incident.claimedAmountCents ?? null,
        flags,
      },
      triageConfig,
    );

    const output = {
      ...result,
      incident: state.incident,
      analysisStatus: analysis?.status ?? "incomplete",
      analysisErrors: analysis?.errors ?? ["analysis did not run"],
      vlm: analysis?.vlm ?? null,
      ml: analysis?.ml ?? null,
      crossCheck: analysis?.crossCheck ?? null,
      docExtraction: state.docExtraction,
      additionalInfo: state.additionalInfo,
    };

    // Assessment + audit event + queue priority: one transaction, so the
    // queue never shows a priority without the analysis that justifies it.
    // runId as the PK makes a replay after a crash a no-op, not a duplicate.
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.claimAssessments)
        .values({
          id: runId,
          claimId: state.claimId,
          output,
          modelVersions: {
            vlm: analysis?.vlmModel ?? null,
            ml: analysis?.ml?.modelVersion ?? null,
            prompts: {
              consistency: CONSISTENCY_PROMPT_VERSION,
              extraction: DOC_EXTRACTION_PROMPT_VERSION,
            },
            triage: result.configVersion,
          },
          tokenCost: state.usage.costMicroUsd,
          latencyMs: analysis ? now().getTime() - analysis.startedAt : null,
        })
        .onConflictDoNothing()
        .returning({ id: schema.claimAssessments.id });
      if (!inserted.length) return; // already persisted by an earlier attempt

      await tx.insert(schema.claimEvents).values({
        claimId: state.claimId,
        actor: "agent",
        eventType: "agent_assessment",
        payload: {
          assessmentId: runId,
          priority: result.priority,
          recommendation: result.recommendation,
          flags: result.flags,
        },
      });
      await tx
        .update(schema.claims)
        .set({ priority: result.priority })
        .where(eq(schema.claims.id, state.claimId));
    });

    return {
      phase: "review",
      noProgressTurns: 0,
      triage: { ...result, runId },
      // Deliberately says nothing about flags: telling a fraudster which
      // check fired teaches them to beat it.
      messages: [
        new AIMessage(
          "Your claim has been submitted to our review team. A reviewer will look at it and you'll get an update right here.",
        ),
      ],
    };
  };
}
