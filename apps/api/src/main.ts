import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

async function bootstrap() {
  // const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // ← Nest keeps the raw buffer
  });

  // app.enableCors({ origin: "http://localhost:5173" });

  app.enableCors({
    origin: [
      "http://localhost:5173",
      process.env.WEB_ORIGIN ?? "", // set to your Vercel URL on Render
    ].filter(Boolean),
  });

  // await app.listen(3000, "0.0.0.0"); // 0.0.0.0 so it's reachable inside Docker later
  await app.listen(process.env.PORT ?? 3000, "0.0.0.0");
}
bootstrap();
