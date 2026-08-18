import { z } from "zod";
import type { AgentDeps } from "../deps";
import type { ClaimStateType } from "../state";

// The structured verdict we demand from the VLM.
const consistencySchema = z.object({
  observedDamage: z.string(),        // what the model sees in the photos
  matchesDescription: z.boolean(),   // does it fit the customer's story
  confidence: z.number().min(0).max(1),
  discrepancies: z.array(z.string()), // specific mismatches, if any
});

export function makeConsistencyNode({ llm, storage }: AgentDeps) {
  return async function consistencyNode(state: ClaimStateType) {
    const photos = state.documents.damagePhotos;

    // No photos → nothing to analyze. Skip, let triage/human handle it.
    if (!photos.length) {
      return { analysis: { status: "skipped" as const }, phase: "triage" as const };
    }

    try {
      // Fetch image bytes from storage.
      const images = await Promise.all(photos.map((p) => storage.getImage(p)));

      const system =
        "You are an auto-damage assessor. You will see damage photos and an " +
        "incident description. Assess whether the visible damage is consistent " +
        "with the description. Use exactly these JSON keys: observedDamage " +
        "(string), matchesDescription (boolean), confidence (number 0-1), " +
        "discrepancies (array of strings).";
      const prompt = `Incident description: "${state.incident.description}". Assess the attached photos.`;

      const raw = await llm.analyzeImages<unknown>(prompt, images, system);

      // Untrusted output — validate.
      const parsed = consistencySchema.safeParse(raw);
      if (!parsed.success) {
        return { analysis: { status: "failed" as const }, phase: "triage" as const };
      }

      return {
        analysis: { ...parsed.data, status: "complete" as const },
        phase: "triage" as const,
      };
    } catch {
      // VLM/storage failure (429, download error) — DON'T block the claim.
      // Mark failed, route to human. This is the 4.1 rule made real.
      return { analysis: { status: "failed" as const }, phase: "triage" as const };
    }
  };
}