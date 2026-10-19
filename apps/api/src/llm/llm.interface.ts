export interface ImagePart {
  data: string; // base64
  mimeType: string; // e.g. "image/jpeg"
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

// Every call returns the value AND what it cost. Cost tracking per claim
// (spec §5) is impossible if usage is thrown away at the provider boundary.
export interface LlmResult<T> {
  value: T;
  usage: LlmUsage;
  model: string;
  latencyMs: number;
}

export interface LlmRequest {
  prompt: string;
  system?: string;
  // Name of the call site ("intake.extract", "consistency.vlm"); used for
  // tracing so a Langfuse trace reads like the graph, not "generate x7".
  name: string;
  // Groups calls into one trace (= one agent run).
  traceId?: string;
}

export interface LlmProvider {
  // Plain text completion (conversational replies).
  complete(req: LlmRequest): Promise<LlmResult<string>>;
  // JSON output. Returns `unknown` on purpose: callers MUST Zod-parse it.
  extractJson(req: LlmRequest): Promise<LlmResult<unknown>>;
  // Multimodal: prompt + images -> JSON. Also `unknown`, same reason.
  analyzeImages(
    req: LlmRequest & { images: ImagePart[] },
  ): Promise<LlmResult<unknown>>;
}

export const LLM = Symbol("LLM");

export const ZERO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 };
