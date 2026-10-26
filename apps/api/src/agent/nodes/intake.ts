import { z } from "zod";
import { AIMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { eq } from "drizzle-orm";
import * as schema from "@claimpilot/db";
import type { AgentDeps } from "../deps";
import type { ClaimStateType, ClaimStateUpdate } from "../state";
import { traceIdOf, usageOf } from "../usage";
import { AGENT_PERSONA, transcriptOf } from "./common";

// What we try to extract from the conversation so far.
const extractionSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .catch(null),
  location: z.string().min(1).nullable().catch(null),
  description: z.string().min(1).nullable().catch(null),
  // Dollars from the model (people talk in dollars); stored as cents.
  claimed_amount: z.number().nonnegative().nullable().catch(null),
  // The customer-facing message, generated in the SAME call: one LLM round
  // trip per turn instead of two (free-tier calls take 10-20s each).
  reply: z.string().catch(""),
});

const FIELDS = [
  "date",
  "location",
  "description",
  "claimedAmountCents",
] as const;
const FIELD_LABELS: Record<(typeof FIELDS)[number], string> = {
  date: "the date of the incident",
  location: "where it happened",
  description: "what happened and which parts of the car were damaged",
  claimedAmountCents: "a rough estimate of the repair cost",
};

export function makeIntakeNode({ db, llm, triageConfig, now }: AgentDeps) {
  return async function intakeNode(
    state: ClaimStateType,
    config?: RunnableConfig,
  ): Promise<ClaimStateUpdate> {
    const traceId = traceIdOf(config);
    const today = now().toISOString().slice(0, 10);

    const system =
      `${AGENT_PERSONA}\n\n` +
      "From the conversation, return JSON with exactly these keys: " +
      '"date" (incident date, format YYYY-MM-DD), ' +
      '"location" (where it happened), ' +
      '"description" (what happened, including damaged parts), ' +
      '"claimed_amount" (estimated repair cost in dollars, number), ' +
      '"reply" (one short, friendly message to the customer asking for ' +
      "whichever of those four are still missing; if they asked a question " +
      "about the claims process answer it briefly first; empty string if " +
      "nothing is missing). " +
      `Today is ${today}; resolve relative dates like "yesterday". ` +
      "Use null for any field not yet provided. Never invent values.";

    // 1. LLM extracts structured data from free-form chat.
    // If it fails (429, timeout, bad JSON) we degrade to "nothing extracted"
    // and ask again. The customer is never shown a 500.
    let extracted: z.infer<typeof extractionSchema> = {
      date: null,
      location: null,
      description: null,
      claimed_amount: null,
      reply: "",
    };
    const results = [];
    try {
      const res = await llm.extractJson({
        name: "intake.extract",
        traceId,
        system,
        prompt: transcriptOf(state.messages),
      });
      results.push(res);
      // 2. NEVER trust the shape — validate. `.catch(null)` per field means one
      // bad field (e.g. "next Tuesday") doesn't throw away the good ones.
      const parsed = extractionSchema.safeParse(res.value);
      if (parsed.success) extracted = parsed.data;
    } catch {
      /* fall through with nothing extracted */
    }

    // 3. Merge non-null fields into state.incident.
    const update: ClaimStateType["incident"] = {};
    if (extracted.date) update.date = extracted.date;
    if (extracted.location) update.location = extracted.location;
    if (extracted.description) update.description = extracted.description;
    if (extracted.claimed_amount !== null) {
      update.claimedAmountCents = Math.round(extracted.claimed_amount * 100);
    }

    const merged = { ...state.incident, ...update };
    const missing = FIELDS.filter((f) => merged[f] === undefined);
    const progressed = FIELDS.some(
      (f) => state.incident[f] === undefined && merged[f] !== undefined,
    );

    // 4. Once we have a date, validate coverage before advancing (spec §4).
    if (merged.date) {
      const [row] = await db
        .select({ policy: schema.policies })
        .from(schema.claims)
        .innerJoin(
          schema.policies,
          eq(schema.claims.policyId, schema.policies.id),
        )
        .where(eq(schema.claims.id, state.claimId));

      const policy = row?.policy;
      const incidentDate = new Date(`${merged.date}T12:00:00Z`);
      const active = policy?.status === "active";
      const inWindow =
        !!policy?.coverageStart &&
        !!policy.coverageEnd &&
        incidentDate >= startOfDay(policy.coverageStart) &&
        incidentDate <= policy.coverageEnd;

      if (!active || !inWindow) {
        return {
          incident: update,
          phase: "done", // terminate politely
          closedReason: !active
            ? "policy_not_active"
            : "outside_coverage_window",
          usage: usageOf(...results),
          messages: [
            new AIMessage(
              !active
                ? "This policy isn't active, so I can't file a claim against it."
                : "The incident date falls outside your coverage period, so this claim can't be filed. If the date is wrong, please start a new claim with the correct date.",
            ),
          ],
        };
      }
    }

    // 5. Complete => hand over to documents (same run, see graph.ts).
    if (missing.length === 0) {
      return {
        incident: update,
        phase: "documents",
        noProgressTurns: 0,
        usage: usageOf(...results),
        messages: [new AIMessage("Thanks — I have the incident details.")],
      };
    }

    // 6. Stall detection: N turns in a row with nothing new => human takes over.
    const noProgressTurns = progressed ? 0 : state.noProgressTurns + 1;
    if (noProgressTurns >= triageConfig.maxNoProgressTurns) {
      return {
        incident: update,
        phase: "analysis",
        flags: ["conversation_stalled"],
        noProgressTurns,
        usage: usageOf(...results),
        messages: [
          new AIMessage(
            "I'm having trouble collecting the details, so I'm passing your claim to a member of our team who will follow up with you here.",
          ),
        ],
      };
    }

    // 7. Ask for whatever's still missing. The model's reply if it gave one,
    // else a deterministic question (LLM down must not mean "no reply").
    const ask = missing.map((f) => FIELD_LABELS[f]).join(", ");
    const reply = extracted.reply.trim() || `Could you tell me ${ask}?`;

    return {
      incident: update,
      phase: "intake",
      noProgressTurns,
      usage: usageOf(...results),
      messages: [new AIMessage(reply)],
    };
  };
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
