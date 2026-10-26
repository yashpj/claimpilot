import { randomUUID } from "node:crypto";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { AgentDeps } from "../deps";
import type { Analysis, ClaimStateType, ClaimStateUpdate } from "../state";
import { traceIdOf, usageOf } from "../usage";
import {
  CONSISTENCY_SYSTEM,
  consistencyPrompt,
  vlmVerdictSchema,
} from "../analysis/vlm";
import { crossCheck } from "../analysis/cross-check";
import { docCount } from "./documents";
import type { Tracer } from "../../observability/tracer";

// Tool call => span (the LLM calls are traced by the LLM decorator).
async function traced<T>(
  tracer: Tracer,
  traceId: string | undefined,
  name: string,
  input: unknown,
  fn: () => Promise<T>,
) {
  const startTime = new Date();
  try {
    const output = await fn();
    tracer.span({
      traceId,
      name,
      input,
      output,
      startTime,
      endTime: new Date(),
    });
    return output;
  } catch (err) {
    tracer.span({
      traceId,
      name,
      input,
      startTime,
      endTime: new Date(),
      error: String(err),
    });
    throw err;
  }
}

// Cap images per call: cost and latency grow linearly, signal doesn't.
const MAX_PHOTOS = 4;

// The core node (spec §4.3). Calls the VLM and the ml-service IN PARALLEL,
// then cross-checks them. Any failure => analysis "incomplete", never a
// thrown error: the claim still reaches a human, with a flag saying why.
export function makeConsistencyNode({
  llm,
  storage,
  ml,
  tracer,
  triageConfig,
  now,
}: AgentDeps) {
  return async function consistencyNode(
    state: ClaimStateType,
    config?: RunnableConfig,
  ): Promise<ClaimStateUpdate> {
    const base: Analysis = {
      runId: randomUUID(),
      startedAt: now().getTime(),
      status: "incomplete",
      errors: [],
      vlm: null,
      ml: null,
      crossCheck: null,
      docCount: docCount(state.documents),
      vlmModel: null,
    };

    const photos = state.documents.damagePhotos.slice(0, MAX_PHOTOS);
    if (!photos.length) {
      return { analysis: { ...base, errors: ["no damage photos"] } };
    }

    let images;
    try {
      images = await Promise.all(photos.map((p) => storage.getImage(p)));
    } catch (err) {
      return {
        analysis: {
          ...base,
          errors: [`storage: ${String(err).slice(0, 200)}`],
        },
      };
    }

    // allSettled, not all: one failing must not discard the other's result.
    const [vlmRes, mlRes] = await Promise.allSettled([
      llm.analyzeImages({
        name: "consistency.vlm",
        traceId: traceIdOf(config),
        system: CONSISTENCY_SYSTEM,
        prompt: consistencyPrompt(
          state.incident.description ?? "",
          state.additionalInfo,
        ),
        images,
      }),
      traced(tracer, traceIdOf(config), "ml.detect", photos.length, () =>
        ml.detect(
          images.map((i) => ({
            data: Buffer.from(i.data, "base64"),
            mimeType: i.mimeType,
          })),
        ),
      ),
    ]);

    const analysis: Analysis = { ...base };
    let usage;

    if (vlmRes.status === "fulfilled") {
      usage = usageOf(vlmRes.value);
      analysis.vlmModel = vlmRes.value.model;
      const parsed = vlmVerdictSchema.safeParse(vlmRes.value.value);
      if (parsed.success) analysis.vlm = parsed.data;
      else analysis.errors.push("vlm: output failed validation");
    } else {
      analysis.errors.push(`vlm: ${String(vlmRes.reason).slice(0, 200)}`);
    }

    if (mlRes.status === "fulfilled") {
      analysis.ml = mlRes.value;
    } else {
      analysis.errors.push(`ml: ${String(mlRes.reason).slice(0, 200)}`);
    }

    if (analysis.vlm && analysis.ml) {
      analysis.crossCheck = crossCheck(
        analysis.vlm,
        analysis.ml.detections,
        triageConfig.mlMinConfidence,
      );
      analysis.status = "complete";
    }

    return { analysis, ...(usage ? { usage } : {}) };
  };
}
