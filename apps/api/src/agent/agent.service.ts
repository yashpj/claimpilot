import { Inject, Injectable } from "@nestjs/common";
import type { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { buildClaimGraph } from "./graph";
import { CHECKPOINTER } from "./agent.tokens";
import * as llmInterface from "src/llm/llm.interface";
import { DRIZZLE } from "src/database/database.module";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@claimpilot/db";
import { ClaimStateType } from "./state";
import { StorageService } from "src/storage/storage.service";
@Injectable()
export class AgentService {
  private readonly app;

  // constructor(@Inject(CHECKPOINTER) checkpointer: PostgresSaver) {
  //   // compile() turns the graph definition into a runnable, wired to persistence.
  //   this.app = buildClaimGraph().compile({ checkpointer });
  // }

constructor(
  @Inject(CHECKPOINTER) checkpointer: PostgresSaver,
  @Inject(llmInterface.LLM) llm: llmInterface.LlmProvider,
  @Inject(DRIZZLE) db: PostgresJsDatabase<typeof schema>,
  private readonly storage: StorageService,   // NEW
) {
  const deps = { db, llm, storage };
  this.app = buildClaimGraph(deps).compile({ checkpointer });
}

async invoke(input: Partial<ClaimStateType>, config: any) {
  return this.app.invoke(input, config);
}
}

