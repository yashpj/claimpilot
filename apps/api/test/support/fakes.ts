import type {
  ImagePart,
  LlmProvider,
  LlmRequest,
  LlmResult,
} from "../../src/llm/llm.interface";
import { MlClient, type MlDetection } from "../../src/agent/ml/ml.client";

type Handler = (req: LlmRequest & { images?: ImagePart[] }) => unknown;

// Scripted LLM: a handler per call-site name. Records every call so tests can
// assert what the agent asked for (and that it didn't call the LLM at all
// when it shouldn't).
export class FakeLlm implements LlmProvider {
  calls: string[] = [];
  constructor(public handlers: Record<string, Handler>) {}

  private run<T>(req: LlmRequest & { images?: ImagePart[] }): LlmResult<T> {
    this.calls.push(req.name);
    const h = this.handlers[req.name];
    if (!h) throw new Error(`FakeLlm: no handler for ${req.name}`);
    return {
      value: h(req) as T,
      usage: { inputTokens: 1000, outputTokens: 100 },
      model: "fake-model",
      latencyMs: 1,
    };
  }
  async complete(req: LlmRequest) {
    return this.run<string>(req);
  }
  async extractJson(req: LlmRequest) {
    return this.run<unknown>(req);
  }
  async analyzeImages(req: LlmRequest & { images: ImagePart[] }) {
    return this.run<unknown>(req);
  }
}

export class FakeMl extends MlClient {
  fail = false;
  detections: MlDetection[] = [
    { class: "dent", confidence: 0.85, bbox: [10, 10, 50, 50] },
  ];
  constructor() {
    super("http://fake", 1000);
  }
  async detect(images: { data: Buffer; mimeType: string }[]) {
    if (this.fail) throw new Error("ml-service timeout");
    return {
      modelVersion: "fake-yolo",
      detections: images.map(() => this.detections),
    };
  }
}

// Field extraction by regex over the transcript: deterministic stand-in for
// the model, good enough to drive the state machine through every branch.
export function intakeExtract(req: LlmRequest) {
  const t = req.prompt;
  return {
    date: /(\d{4}-\d{2}-\d{2})/.exec(t)?.[1] ?? null,
    location: /on ([A-Z][\w ]*(?:St|Ave|Rd))/.exec(t)?.[1] ?? null,
    description: /rear-ended/.test(t)
      ? "Rear-ended at a light; rear bumper dented"
      : null,
    claimed_amount: /\$(\d+)/.exec(t) ? Number(/\$(\d+)/.exec(t)![1]) : null,
  };
}

export const goodVerdict = {
  is_vehicle: true,
  damage_locations: ["rear bumper"],
  severity_estimate: "moderate",
  matches_description: true,
  flags: [],
  confidence: 0.92,
  summary: "Dented rear bumper consistent with a rear-end collision.",
};

export const readableDocs = {
  license: {
    readable: true,
    full_name: "Test User",
    license_number: "D123",
    expiry_date: "2030-01-01",
  },
  registration: {
    readable: true,
    registration_number: "ABC123",
    make: "Honda",
    model: "Civic",
  },
};
