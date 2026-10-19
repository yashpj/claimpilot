import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { AgentService } from "./agent.service";
import { CHECKPOINTER } from "./agent.tokens";

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
    AgentService,
  ],
  exports: [CHECKPOINTER, AgentService],
})
export class AgentModule {}
