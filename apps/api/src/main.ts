import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { MetricsService } from "./observability/metrics.service";
import { startMetricsServer } from "./observability/metrics-server";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // Stripe and Slack sign the raw bytes; Nest keeps the buffer
  });

  // Explicit allow-list, never `origin: true` (reflects any origin).
  app.enableCors({
    origin: [
      "http://localhost:5173",
      process.env.WEB_ORIGIN ?? "", // set to your Vercel URL on Render
    ].filter(Boolean),
  });

  // k8s sends SIGTERM before killing a pod; this lets in-flight requests
  // (and agent runs) finish and DB pools close instead of being cut off.
  app.enableShutdownHooks();

  const metricsServer = startMetricsServer(
    app.get(MetricsService),
    Number(process.env.METRICS_PORT ?? 9464),
  );
  process.once("SIGTERM", () => metricsServer.close());

  // 0.0.0.0 so it's reachable inside Docker / k8s; PORT for Render.
  await app.listen(process.env.PORT ?? 3000, "0.0.0.0");
}
void bootstrap();
