import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  GoogleGenerativeAI,
  type GenerativeModel,
  type Part,
} from "@google/generative-ai";
import type {
  ImagePart,
  LlmProvider,
  LlmRequest,
  LlmResult,
} from "./llm.interface";

@Injectable()
export class GeminiProvider implements LlmProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly text: GenerativeModel;
  private readonly json: GenerativeModel;
  private readonly vision: GenerativeModel;
  readonly textModel: string;
  readonly visionModel: string;

  constructor(config: ConfigService) {
    const genAI = new GoogleGenerativeAI(config.getOrThrow("GEMINI_API_KEY"));
    // Model names churn (1.5-flash retired, 2.5-flash "not available to new
    // users", ...), so names are config, not code. The "-latest" aliases are
    // the stable handles.
    // Routing by task: chat/extraction runs on flash-lite (~1s/call); only
    // the vision verdict (the core judgement) pays for flash (~15-20s/call).
    this.textModel =
      config.get<string>("GEMINI_MODEL") ?? "gemini-flash-lite-latest";
    this.visionModel =
      config.get<string>("GEMINI_VISION_MODEL") ?? "gemini-flash-latest";
    const timeout = Number(config.get("LLM_TIMEOUT_MS") ?? 60_000);

    // JSON mode: the API constrains output to JSON, so no more stripping
    // ```json fences with a regex. Shape is still validated by callers.
    const jsonMode = { responseMimeType: "application/json" };
    this.text = genAI.getGenerativeModel(
      { model: this.textModel },
      { timeout },
    );
    this.json = genAI.getGenerativeModel(
      { model: this.textModel, generationConfig: jsonMode },
      { timeout },
    );
    this.vision = genAI.getGenerativeModel(
      { model: this.visionModel, generationConfig: jsonMode },
      { timeout },
    );
  }

  async complete(req: LlmRequest): Promise<LlmResult<string>> {
    return this.generate(
      this.text,
      this.textModel,
      req,
      [{ text: req.prompt }],
      (t) => t,
    );
  }

  async extractJson(req: LlmRequest): Promise<LlmResult<unknown>> {
    return this.generate(
      this.json,
      this.textModel,
      req,
      [{ text: req.prompt }],
      parseJson,
    );
  }

  async analyzeImages(
    req: LlmRequest & { images: ImagePart[] },
  ): Promise<LlmResult<unknown>> {
    const parts: Part[] = [
      { text: req.prompt },
      ...req.images.map((img) => ({
        inlineData: { data: img.data, mimeType: img.mimeType },
      })),
    ];
    return this.generate(this.vision, this.visionModel, req, parts, parseJson);
  }

  private async generate<T>(
    model: GenerativeModel,
    modelName: string,
    req: LlmRequest,
    parts: Part[],
    parse: (raw: string) => T,
  ): Promise<LlmResult<T>> {
    const started = Date.now();
    const request = {
      contents: [{ role: "user", parts }],
      ...(req.system ? { systemInstruction: req.system } : {}),
    };

    let result;
    try {
      result = await model.generateContent(request);
    } catch (err) {
      // One retry for rate limits / transient 5xx. More than that belongs to
      // the caller's failure path (analysis_incomplete), not a retry loop.
      if (!isRetryable(err)) throw err;
      this.logger.warn({ msg: "LLM retry", name: req.name, err: String(err) });
      await new Promise((r) => setTimeout(r, 2_000));
      result = await model.generateContent(request);
    }

    const usage = result.response.usageMetadata;
    return {
      value: parse(result.response.text()),
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
      },
      model: modelName,
      latencyMs: Date.now() - started,
    };
  }
}

function parseJson(raw: string): unknown {
  // JSON mode makes fences rare, but strip them defensively; a parse error
  // here throws, which callers treat like any other LLM failure.
  return JSON.parse(raw.replace(/```json\n?|\n?```/g, "").trim());
}

function isRetryable(err: unknown): boolean {
  return /\b(429|500|502|503|504)\b/.test(String(err));
}
