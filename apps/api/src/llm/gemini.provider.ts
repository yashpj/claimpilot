import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { LlmProvider } from "./llm.interface";

@Injectable()
export class GeminiProvider implements LlmProvider {
  private model;

  constructor(config: ConfigService) {
    const genAI = new GoogleGenerativeAI(config.getOrThrow("GEMINI_API_KEY"));
    this.model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  }

  async complete(prompt: string, systemPrompt?: string): Promise<string> {
    const full = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
    const result = await this.model.generateContent(full);
    return result.response.text();
  }

  async extractJson<T>(prompt: string, systemPrompt?: string): Promise<T> {
    const sys = `${systemPrompt ?? ""}\nRespond with ONLY valid JSON, no markdown, no prose.`;
    const raw = await this.complete(prompt, sys);
    // Models often wrap JSON in ```json fences despite instructions — strip them.
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(cleaned) as T;
  }
}