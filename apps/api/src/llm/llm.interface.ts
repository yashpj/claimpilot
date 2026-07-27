export interface LlmProvider {
  // Returns parsed JSON matching the caller's shape. Throws on failure.
  extractJson<T>(prompt: string, systemPrompt?: string): Promise<T>;
  // Plain text completion (for conversational replies).
  complete(prompt: string, systemPrompt?: string): Promise<string>;
}

export const LLM = Symbol("LLM");