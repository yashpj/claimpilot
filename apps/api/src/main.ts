import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({ origin: "http://localhost:5173" });
  await app.listen(3000, "0.0.0.0"); // 0.0.0.0 so it's reachable inside Docker later
}
bootstrap();