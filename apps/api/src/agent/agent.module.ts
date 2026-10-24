import { Global, Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { AgentService } from "./agent.service";
import { CHECKPOINTER } from "./agent.tokens";
import { ML_CLIENT, MlClient } from "./ml/ml.client";

// Found on the first k3d deploy: API pods start before Postgres is ready
// (fresh install, DB failover). A single attempt crashed the pod, and
// k8s' restart backoff grows to 5 min. Retry ~45s instead: inside the
// startupProbe's 60s window, still fail loudly if the DB never shows up.
async function setupWithRetry(saver: PostgresSaver) {
  const logger = new Logger("Checkpointer");
  const delaysMs = [1000, 2000, 4000, 8000, 15000, 15000];
  for (let attempt = 0; ; attempt++) {
    try {
      await saver.setup();
      return;
    } catch (err) {
      if (attempt >= delaysMs.length) throw err;
      logger.warn({
        msg: "checkpointer setup failed, retrying",
        attempt: attempt + 1,
        err: String(err),
      });
      await new Promise((r) => setTimeout(r, delaysMs[attempt]));
    }
  }
}

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
        await setupWithRetry(saver); // creates checkpoint tables if absent
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
