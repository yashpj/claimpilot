import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { AgentService } from "./agent.service";
import { CHECKPOINTER } from "./agent.tokens";
import { ML_CLIENT, MlClient } from "./ml/ml.client";

@Global()
@Module({
  providers: [
    {
      provide: CHECKPOINTER,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const saver = PostgresSaver.fromConnString(
          config.getOrThrow("DATABASE_URL"),
        );
        await saver.setup(); // creates checkpoint tables if absent
        return saver;
      },
    },
    {
      provide: ML_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new MlClient(
          config.get<string>("ML_SERVICE_URL") ?? null,
          Number(config.get("ML_TIMEOUT_MS") ?? 15_000),
        ),
    },
    AgentService,
  ],
  exports: [CHECKPOINTER, AgentService],
})
export class AgentModule {}
