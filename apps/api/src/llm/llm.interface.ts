export interface ImagePart {
  data: string;      // base64
  mimeType: string;  // e.g. "image/jpeg"
}

export interface LlmProvider {
  // Returns parsed JSON matching the caller's shape. Throws on failure.
  extractJson<T>(prompt: string, systemPrompt?: string): Promise<T>;
  // Plain text completion (for conversational replies).
  complete(prompt: string, systemPrompt?: string): Promise<string>;
    // NEW: multimodal — prompt + images → structured JSON verdict.
  analyzeImages<T>(prompt: string, images: ImagePart[], systemPrompt?: string): Promise<T>;
}

export const LLM = Symbol("LLM");