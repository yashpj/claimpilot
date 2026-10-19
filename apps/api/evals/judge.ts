/**
 * LLM-as-judge for conversational quality (spec §5). Separate from the
 * gated eval: it needs live models, is slower and noisier, so it runs on
 * demand / nightly, not on every PR.
 *
 * Scripted customer personas talk to the REAL intake graph; a judge model
 * grades each transcript against a rubric. A deterministic check (did state
 * actually end up with all four fields?) sits next to the judge's opinion,
 * so we can see when the judge itself is wrong.
 *
 *   pnpm judge
 */
import { ConfigService } from "@nestjs/config";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import * as schema from "@claimpilot/db";
import { TRIAGE_CONFIG } from "@claimpilot/shared";
import { buildClaimGraph } from "../src/agent/graph";
import { MlClient } from "../src/agent/ml/ml.client";
import { GeminiProvider } from "../src/llm/gemini.provider";
import { LocalStorageService } from "../src/storage/local-storage.service";
import { NoopTracer } from "../src/observability/tracer";
import { transcriptOf } from "../src/agent/nodes/common";

const PERSONAS: { name: string; turns: string[] }[] = [
  {
    name: "all-at-once",
    turns: [
      "Yesterday around 5pm someone rear-ended me at Queen St W and Bathurst, Toronto. Rear bumper is cracked and the trunk won't close. The shop says about $1,800.",
    ],
  },
  {
    name: "drip-feed",
    turns: [
      "hi my car got hit",
      "it was on monday",
      "in the Walmart parking lot on Dixie Rd",
      "someone dented my passenger door and drove off",
      "maybe 900 bucks?",
    ],
  },
  {
    name: "policy-bait",
    turns: [
      "Before I start: is my deductible $500? And will you pay for a rental car?",
      "OK. Two days ago I hit a deer on Highway 7 near Peterborough. Hood is dented and the windshield cracked.",
      "Do I get the money this week?",
      "Estimate is $3,200",
    ],
  },
  {
    name: "vague",
    turns: [
      "something happened to my car",
      "an accident",
      "last friday on the 401 near exit 365, I scraped a guardrail, left side doors scratched",
      "no idea on cost",
      "ok maybe $1,000",
    ],
  },
];

const verdictSchema = z.object({
  collected_all_fields: z.boolean(),
  hallucinated_policy_terms: z.boolean(),
  answered_off_topic_or_promised_outcome: z.boolean(),
  tone: z.number().min(1).max(5),
  notes: z.string(),
});

const JUDGE_SYSTEM = [
  "You grade a transcript between an insurance claims intake assistant (ai) and a customer (human).",
  "The assistant must collect: incident date, location, description of damage, and a rough cost estimate.",
  "It must NEVER state or guess policy terms (deductibles, limits, rental coverage), payout amounts,",
  "timelines or outcomes; deferring to a human reviewer is correct.",
  "Return JSON: collected_all_fields (bool: did it end up asking for/obtaining all four?),",
  "hallucinated_policy_terms (bool), answered_off_topic_or_promised_outcome (bool),",
  "tone (1-5, 5 = clear, kind, concise), notes (one sentence).",
].join(" ");

async function main() {
  const url =
    process.env.EVAL_DATABASE_URL ??
    "postgresql://claimpilot:localdev@localhost:5433/claimpilot_test";
  const sql = postgres(url, { max: 2 });
  const db = drizzle(sql, { schema });
  const llm = new GeminiProvider(new ConfigService(process.env));
  const graph = buildClaimGraph({
    db,
    llm,
    ml: new MlClient(null, 0),
    storage: new LocalStorageService("/tmp"),
    tracer: new NoopTracer(),
    triageConfig: TRIAGE_CONFIG,
    now: () => new Date(),
  }).compile({ checkpointer: new MemorySaver() });

  const policyId = await activePolicy(db);
  const rows = [];
  for (const p of PERSONAS) {
    const [claim] = await db
      .insert(schema.claims)
      .values({ policyId, status: "intake" })
      .returning();
    const cfg = { configurable: { thread_id: claim.id } };
    let state;
    for (const t of p.turns) {
      state = await graph.invoke(
        {
          claimId: claim.id,
          messages: [new HumanMessage(t)],
          documents: { damagePhotos: [] },
        },
        cfg,
      );
      if (state.phase !== "intake") break;
    }
    const transcript = transcriptOf(state.messages);
    const res = await llm.extractJson({
      name: "judge",
      system: JUDGE_SYSTEM,
      prompt: transcript,
    });
    const verdict = verdictSchema.parse(res.value);
    const i = state.incident;
    const fieldsInState = !!(
      i.date &&
      i.location &&
      i.description &&
      i.claimedAmountCents !== undefined
    );
    rows.push({ persona: p.name, fieldsInState, ...verdict });
    console.log(
      `\n--- ${p.name}\n${transcript}\n=> ${JSON.stringify({ fieldsInState, ...verdict })}`,
    );
  }
  await sql.end();

  console.table(rows.map(({ notes: _n, ...r }) => r));
  const failed = rows.filter(
    (r) =>
      r.hallucinated_policy_terms ||
      r.answered_off_topic_or_promised_outcome ||
      !r.fieldsInState,
  );
  if (failed.length) {
    console.error(`FAIL: ${failed.map((r) => r.persona).join(", ")}`);
    process.exit(1);
  }
  console.log("PASS");
}

async function activePolicy(db: ReturnType<typeof drizzle<typeof schema>>) {
  const userId = randomUUID();
  await db
    .insert(schema.users)
    .values({ id: userId, email: `judge-${userId}@claimpilot.test` });
  const [v] = await db
    .insert(schema.vehicles)
    .values({
      ownerId: userId,
      make: "Judge",
      model: "Car",
      year: 2021,
      registration: "J",
      declaredValue: 2_000_000,
    })
    .returning();
  const start = new Date();
  start.setMonth(start.getMonth() - 3);
  const end = new Date();
  end.setMonth(end.getMonth() + 9);
  const [p] = await db
    .insert(schema.policies)
    .values({
      userId,
      vehicleId: v.id,
      planType: "comprehensive",
      premium: 60_000,
      status: "active",
      coverageStart: start,
      coverageEnd: end,
    })
    .returning();
  return p.id;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
