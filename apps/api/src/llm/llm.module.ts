import { Global, Module } from "@nestjs/common";
import { LLM } from "./llm.interface";
import { GeminiProvider } from "./gemini.provider";

@Global()
@Module({
  providers: [{ provide: LLM, useClass: GeminiProvider }],
  exports: [LLM],
})
export class LlmModule {}
