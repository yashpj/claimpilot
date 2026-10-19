import { Global, Inject, Module, OnApplicationShutdown } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { Langfuse } from "langfuse";
import { MetricsService } from "./metrics.service";
import { HttpObservabilityInterceptor } from "./http-observability.interceptor";
import { LangfuseTracer, NoopTracer, TRACER, type Tracer } from "./tracer";

@Global()
@Module({
  providers: [
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: HttpObservabilityInterceptor },
    {
      provide: TRACER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Tracer => {
        const publicKey = config.get<string>("LANGFUSE_PUBLIC_KEY");
        const secretKey = config.get<string>("LANGFUSE_SECRET_KEY");
        if (!publicKey || !secretKey) return new NoopTracer();
        return new LangfuseTracer(
          new Langfuse({
            publicKey,
            secretKey,
            baseUrl:
              config.get<string>("LANGFUSE_BASEURL") ??
              "https://cloud.langfuse.com",
          }),
        );
      },
    },
  ],
  exports: [MetricsService, TRACER],
})
export class ObservabilityModule implements OnApplicationShutdown {
  constructor(@Inject(TRACER) private readonly tracer: Tracer) {}

  // Flush buffered traces on SIGTERM, or the last runs before a deploy vanish.
  async onApplicationShutdown() {
    await this.tracer.flush();
  }
}
