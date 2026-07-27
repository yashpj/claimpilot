import { z } from "zod";
import { AIMessage } from "@langchain/core/messages";
import type { LlmProvider } from "../../llm/llm.interface";
import type { ClaimStateType } from "../state";
import type { AgentDeps } from "../deps";
import * as schema from "@claimpilot/db";
import { eq } from "drizzle-orm";

// What we try to extract from the conversation so far.
const extractionSchema = z.object({
  date: z.string().nullable(),          // ISO date or null if not yet given
  location: z.string().nullable(),
  description: z.string().nullable(),
});

export function makeIntakeNode({ db, llm }: AgentDeps) {
  return async function intakeNode(state: ClaimStateType) {
    const transcript = state.messages
      .map((m) => `${m.getType()}: ${m.content}`)
      .join("\n");

    const system =
      "You are an insurance intake assistant. From the conversation, extract " +
      "the incident date (ISO format), location, and description. " +
      "Use null for anything not yet provided.";

    // 1. LLM extracts structured data from free-form chat.
    const raw = await llm.extractJson<unknown>(transcript, system);

    // 2. NEVER trust the shape — validate.
    const parsed = extractionSchema.safeParse(raw);
    const extracted = parsed.success
      ? parsed.data
      : { date: null, location: null, description: null };

    // 3. Merge non-null fields into state.incident.
    const incidentUpdate: Record<string, string> = {};
    if (extracted.date) incidentUpdate.date = extracted.date;
    if (extracted.location) incidentUpdate.location = extracted.location;
    if (extracted.description) incidentUpdate.description = extracted.description;

    const merged = { ...state.incident, ...incidentUpdate };
    const complete = merged.date && merged.location && merged.description;

        // NEW: once we have a date, validate coverage before advancing.
    if (merged.date) {
      const [claim] = await db.select().from(schema.claims)
        .where(eq(schema.claims.id, state.claimId));
      const [policy] = await db.select().from(schema.policies)
        .where(eq(schema.policies.id, claim.policyId));

      const incidentDate = new Date(merged.date);
      const active = policy.status === "active";
      const inWindow =
        policy.coverageStart && policy.coverageEnd &&
        incidentDate >= policy.coverageStart &&
        incidentDate <= policy.coverageEnd;

      if (!active || !inWindow) {
        return {
          incident: incidentUpdate,
          phase: "done" as const,   // terminate politely
          messages: [new AIMessage(
            !active
              ? "This policy isn't active, so I can't file a claim against it."
              : "The incident date falls outside your coverage period, so this claim can't be filed.",
          )],
        };
      }
    }



    // 4. Decide the reply.
    if (complete) {
      return {
        incident: incidentUpdate,
        phase: "documents" as const,
        messages: [new AIMessage(
          "Thanks — I have the incident details. Now I'll need some documents.",
        )],
      };
    }

    // Ask for whatever's still missing.
    const missing = ["date", "location", "description"].filter(
      (f) => !merged[f as keyof typeof merged],
    );
    const reply = await llm.complete(
      `Ask the user politely for these missing details: ${missing.join(", ")}. ` +
      `Keep it to one short message.`,
    );

    return {
      incident: incidentUpdate,
      phase: "intake" as const,
      messages: [new AIMessage(reply)],
    };
  };
}