import { Inject, Injectable } from "@nestjs/common";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { TRIAGE_CONFIG, type Decision } from "@claimpilot/shared";
import { buildClaimGraph } from "./graph";
import { CHECKPOINTER } from "./agent.tokens";
import { LLM, type LlmProvider } from "../llm/llm.interface";
import { DRIZZLE, type Db } from "../database/database.module";
import { StorageService } from "../storage/storage.service";
import { ML_CLIENT, MlClient } from "./ml/ml.client";
import type { ClaimStateType } from "./state";
import { NoopTracer, TRACER, type Tracer } from "../observability/tracer";

@Injectable()
export class AgentService {
  private readonly app: ReturnType<
    ReturnType<typeof buildClaimGraph>["compile"]
  >;

  constructor(
    @Inject(CHECKPOINTER) checkpointer: PostgresSaver,
    @Inject(LLM) llm: LlmProvider,
    @Inject(DRIZZLE) db: Db,
    @Inject(ML_CLIENT) ml: MlClient,
    storage: StorageService,
    @Inject(TRACER) private readonly tracer: Tracer = new NoopTracer(),
  ) {
    const deps = {
      db,
      llm,
      storage,
      ml,
      tracer,
      triageConfig: TRIAGE_CONFIG,
      now: () => new Date(),
    };
    // compile() turns the graph definition into a runnable, wired to persistence.
    this.app = buildClaimGraph(deps).compile({ checkpointer });
  }

  private config(claimId: string, traceId?: string) {
    // thread_id = conversation identity = checkpoint lookup key.
    return { configurable: { thread_id: claimId, traceId } };
  }

  // One customer turn: resumes from the checkpoint, runs until the graph
  // needs the customer again (END), checkpoints after every node.
  async runTurn(input: {
    claimId: string;
    text: string;
    documents: ClaimStateType["documents"];
    traceId?: string;
  }): Promise<ClaimStateType> {
    // One trace per customer turn; session = claim, so Langfuse shows the
    // whole conversation as a session of traces.
    const traceId = input.traceId ?? crypto.randomUUID();
    this.tracer.startTrace({
      id: traceId,
      name: "claim-turn",
      sessionId: input.claimId,
      input: input.text,
    });
    const result = await this.app.invoke(
      {
        claimId: input.claimId,
        documents: input.documents,
        messages: [new HumanMessage(input.text)],
      },
      this.config(input.claimId, traceId),
    );
    this.tracer.endTrace(traceId, {
      phase: result.phase,
      priority: result.triage?.priority,
      costMicroUsd: result.usage.costMicroUsd,
    });
    return result;
  }

  async getState(claimId: string): Promise<ClaimStateType | null> {
    const snapshot = await this.app.getState(this.config(claimId));
    // A thread with no checkpoint yet has empty values.
    return snapshot.values && "phase" in snapshot.values
      ? (snapshot.values as ClaimStateType)
      : null;
  }

  // Reconciliation: claims.status (DB) is the source of truth for decisions.
  // If the checkpoint missed a decision (crash between commit and update),
  // align the phase before the next run.
  async syncPhase(claimId: string, phase: "done" | "more_info") {
    await this.app.updateState(this.config(claimId), {
      phase,
      noProgressTurns: 0,
    });
  }

  // Human decisions happen OUTSIDE the graph (spec §4.5) and re-enter as a
  // state update, so the next customer message is routed correctly and the
  // agent's transcript contains the decision.
  async applyDecision(claimId: string, decision: Decision, message: string) {
    await this.app.updateState(this.config(claimId), {
      phase: decision === "more_info" ? "more_info" : "done",
      noProgressTurns: 0,
      messages: [new AIMessage(message)],
    });
  }
}
