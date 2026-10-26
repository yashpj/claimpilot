import type { Langfuse } from "langfuse";

// Agent observability (spec §2): every run is a trace, every LLM call a
// "generation" (model, tokens, latency, cost), every tool call a span.
// An interface so tests/evals/local dev run with a no-op, and the vendor
// (Langfuse) is one class, not sprinkled through the agent.
export interface Tracer {
  startTrace(t: {
    id: string;
    name: string;
    sessionId?: string;
    input?: unknown;
    metadata?: Record<string, unknown>;
  }): void;
  endTrace(id: string, output?: unknown): void;
  generation(g: {
    traceId?: string;
    name: string;
    model: string;
    input: unknown;
    output?: unknown;
    usage?: { input: number; output: number };
    startTime: Date;
    endTime: Date;
    error?: string;
  }): void;
  span(s: {
    traceId?: string;
    name: string;
    input?: unknown;
    output?: unknown;
    startTime: Date;
    endTime: Date;
    error?: string;
  }): void;
  flush(): Promise<void>;
}

export const TRACER = Symbol("TRACER");

export class NoopTracer implements Tracer {
  startTrace() {}
  endTrace() {}
  generation() {}
  span() {}
  async flush() {}
}

export class LangfuseTracer implements Tracer {
  // The SDK batches and sends in the background: tracing never adds
  // latency to the customer's request, and a Langfuse outage only loses traces.
  constructor(private readonly lf: Langfuse) {}

  startTrace(t: Parameters<Tracer["startTrace"]>[0]) {
    this.lf.trace({
      id: t.id,
      name: t.name,
      sessionId: t.sessionId,
      input: t.input,
      metadata: t.metadata,
    });
  }

  endTrace(id: string, output?: unknown) {
    this.lf.trace({ id, output }); // same id = update (upsert)
  }

  generation(g: Parameters<Tracer["generation"]>[0]) {
    this.lf.generation({
      traceId: g.traceId,
      name: g.name,
      model: g.model,
      input: g.input,
      output: g.output,
      usage: g.usage,
      startTime: g.startTime,
      endTime: g.endTime,
      level: g.error ? "ERROR" : "DEFAULT",
      statusMessage: g.error,
    });
  }

  span(s: Parameters<Tracer["span"]>[0]) {
    this.lf.span({
      traceId: s.traceId,
      name: s.name,
      input: s.input,
      output: s.output,
      startTime: s.startTime,
      endTime: s.endTime,
      level: s.error ? "ERROR" : "DEFAULT",
      statusMessage: s.error,
    });
  }

  flush() {
    return this.lf.shutdownAsync();
  }
}
