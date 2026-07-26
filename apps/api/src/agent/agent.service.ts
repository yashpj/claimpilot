import { Inject, Injectable } from "@nestjs/common";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { buildClaimGraph } from "./graph";
import { CHECKPOINTER } from "./agent.module";

@Injectable()
export class AgentService {
  private readonly app;

  constructor(@Inject(CHECKPOINTER) checkpointer: PostgresSaver) {
    // compile() turns the graph definition into a runnable, wired to persistence.
    this.app = buildClaimGraph().compile({ checkpointer });
  }

  // Minimal smoke test: run the graph for a thread, return final state.
  async run(claimId: string) {
    const config = { configurable: { thread_id: claimId } };
    return this.app.invoke({ claimId }, config);
  }
}