import type {
  ImagePart,
  LlmProvider,
  LlmRequest,
  LlmResult,
} from "../llm/llm.interface";
import { costMicroUsd } from "../llm/pricing";
import type { MetricsService } from "./metrics.service";
import type { Tracer } from "./tracer";

// Decorator: same interface, adds tracing + metrics around any provider.
// Nodes don't know it exists; swapping Gemini for another vendor keeps
// every trace and dashboard working.
export class InstrumentedLlmProvider implements LlmProvider {
  constructor(
    private readonly inner: LlmProvider,
    private readonly tracer: Tracer,
    private readonly metrics: MetricsService | null,
  ) {}

  complete(req: LlmRequest) {
    return this.wrap(req, () => this.inner.complete(req));
  }

  extractJson(req: LlmRequest) {
    return this.wrap(req, () => this.inner.extractJson(req));
  }

  analyzeImages(req: LlmRequest & { images: ImagePart[] }) {
    // Don't ship megabytes of base64 to the tracing backend.
    const input = {
      system: req.system,
      prompt: req.prompt,
      images: req.images.length,
    };
    return this.wrap(req, () => this.inner.analyzeImages(req), input);
  }

  private async wrap<T>(
    req: LlmRequest,
    call: () => Promise<LlmResult<T>>,
    input: unknown = { system: req.system, prompt: req.prompt },
  ): Promise<LlmResult<T>> {
    const startTime = new Date();
    try {
      const res = await call();
      this.tracer.generation({
        traceId: req.traceId,
        name: req.name,
        model: res.model,
        input,
        output: res.value,
        usage: { input: res.usage.inputTokens, output: res.usage.outputTokens },
        startTime,
        endTime: new Date(),
      });
      this.metrics?.llmCalls.inc({
        name: req.name,
        model: res.model,
        outcome: "ok",
      });
      this.metrics?.llmLatency.observe(
        { name: req.name, model: res.model },
        res.latencyMs / 1000,
      );
      this.metrics?.llmCost.inc(
        { model: res.model },
        costMicroUsd(res.model, res.usage),
      );
      return res;
    } catch (err) {
      this.tracer.generation({
        traceId: req.traceId,
        name: req.name,
        model: "unknown",
        input,
        startTime,
        endTime: new Date(),
        error: String(err).slice(0, 500),
      });
      this.metrics?.llmCalls.inc({
        name: req.name,
        model: "unknown",
        outcome: "error",
      });
      throw err;
    }
  }
}
