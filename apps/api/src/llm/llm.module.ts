import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LLM, type LlmProvider } from "./llm.interface";
import { GeminiProvider } from "./gemini.provider";
import { InstrumentedLlmProvider } from "../observability/instrumented-llm.provider";
import { MetricsService } from "../observability/metrics.service";
import { TRACER, type Tracer } from "../observability/tracer";

@Global()
@Module({
  providers: [
    {
      // Swapping vendors = change GeminiProvider here. Nodes inject `LLM`
      // and never know which implementation (or decorator) they got.
      provide: LLM,
      inject: [ConfigService, TRACER, MetricsService],
      useFactory: (
        config: ConfigService,
        tracer: Tracer,
        metrics: MetricsService,
      ): LlmProvider =>
        new InstrumentedLlmProvider(
          new GeminiProvider(config),
          tracer,
          metrics,
        ),
    },
  ],
  exports: [LLM],
})
export class LlmModule {}
