import { z } from "zod";

const detectionSchema = z.object({
  class: z.string(),
  confidence: z.number(),
  bbox: z.array(z.number()).length(4), // x1, y1, x2, y2 in pixels
});
export type MlDetection = z.infer<typeof detectionSchema>;

const responseSchema = z.object({
  model_version: z.string(),
  images: z.array(z.object({ detections: z.array(detectionSchema) })),
});

export const ML_CLIENT = Symbol("ML_CLIENT");

// HTTP client for apps/ml-service. Hard timeout: a slow detector must never
// hold the customer's request hostage (spec §4 failure handling).
export class MlClient {
  constructor(
    private readonly baseUrl: string | null,
    private readonly timeoutMs: number,
  ) {}

  async detect(images: { data: Buffer; mimeType: string }[]) {
    if (!this.baseUrl)
      throw new Error("ml-service not configured (ML_SERVICE_URL)");

    const form = new FormData();
    images.forEach((img, i) =>
      form.append(
        "files",
        new Blob([new Uint8Array(img.data)], { type: img.mimeType }),
        `image-${i}`,
      ),
    );

    const res = await fetch(`${this.baseUrl}/detect`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`ml-service ${res.status}`);

    // Our own service, but still an external boundary: validate.
    const parsed = responseSchema.parse(await res.json());
    return {
      modelVersion: parsed.model_version,
      detections: parsed.images.map((i) => i.detections),
    };
  }
}
