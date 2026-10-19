/**
 * One-command demo data:  pnpm seed
 *
 * Creates a reviewer + a customer with an active policy and five claims in
 * different states. The claims go through the REAL analysis graph, fed by
 * the recorded eval cassettes (no API key, no cost, deterministic), and are
 * checkpointed - so the chat and admin views behave exactly like real ones.
 *
 * Log in as yourself: sign up in the web app, then
 *   SEED_CUSTOMER_ID=<your supabase user id> SEED_REVIEWER_ID=<same or another id> pnpm seed
 * or just promote an existing account:  SEED_PROMOTE_EMAIL=you@example.com pnpm seed
 */
import { ConfigService } from "@nestjs/config";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as schema from "@claimpilot/db";
import { TRIAGE_CONFIG } from "@claimpilot/shared";
import { buildClaimGraph } from "../src/agent/graph";
import { AgentService } from "../src/agent/agent.service";
import { MlClient } from "../src/agent/ml/ml.client";
import { ClaimsService } from "../src/claims/claims.service";
import { ReviewsService } from "../src/reviews/reviews.service";
import { LocalStorageService } from "../src/storage/local-storage.service";
import type { StorageService } from "../src/storage/storage.service";
import { NoopTracer } from "../src/observability/tracer";
import { RecordReplayLlm, RecordReplayMl } from "../evals/record-replay";

const EVALS = path.join(__dirname, "../evals");
const IMAGES = path.join(EVALS, "golden/images");

const CUSTOMER =
  process.env.SEED_CUSTOMER_ID ?? "00000000-0000-4000-8000-0000000c0001";
const REVIEWER =
  process.env.SEED_REVIEWER_ID ?? "00000000-0000-4000-8000-0000000e0001";

// Fixed ids => re-running the seed is a no-op, not duplicates.
const CLAIMS = [
  {
    id: "5eed0000-0000-4000-8000-000000000001",
    image: "rear_end_sedan.jpg",
    amount: 150000,
    description:
      "A taxi rear-ended me at a red light. The rear bumper was knocked loose and the trunk is damaged.",
  },
  {
    id: "5eed0000-0000-4000-8000-000000000002",
    image: "front_tree_hatchback.jpg",
    amount: 150000,
    description:
      "Someone backed into my rear bumper in a parking lot and drove off.",
  },
  {
    id: "5eed0000-0000-4000-8000-000000000003",
    image: "undamaged_sedan.jpg",
    amount: 150000,
    description: "I was sideswiped and the driver side door is smashed in.",
  },
  {
    id: "5eed0000-0000-4000-8000-000000000004",
    image: "screenshot_rear_end.jpg",
    amount: 150000,
    description:
      "A taxi rear-ended me at a red light. The rear bumper was knocked loose and the trunk is damaged.",
  },
  {
    id: "5eed0000-0000-4000-8000-000000000005",
    image: "hood_windshield_suv.jpg",
    amount: 150000,
    description:
      "I hit a deer on a rural road. The hood is dented and the windshield is smashed.",
    decide: "approved" as const,
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  // Seeding is for local/dev databases only.
  const host = new URL(url).hostname;
  if (
    !["localhost", "127.0.0.1", "postgres"].includes(host) &&
    process.env.SEED_ALLOW_REMOTE !== "1"
  ) {
    throw new Error(
      `refusing to seed non-local database host "${host}" (set SEED_ALLOW_REMOTE=1 to override)`,
    );
  }

  const sql = postgres(url, { max: 4 });
  const db = drizzle(sql, { schema });
  const storage: StorageService = new LocalStorageService(
    process.env.LOCAL_STORAGE_DIR ?? ".data/uploads",
  );
  const llm = new RecordReplayLlm(
    null,
    path.join(EVALS, "cache/llm"),
    "replay",
    "gemini-flash-lite-latest",
  );
  const ml = new RecordReplayMl(
    new MlClient(null, 0),
    path.join(EVALS, "cache/ml"),
    "replay",
  );
  const checkpointer = PostgresSaver.fromConnString(url);
  await checkpointer.setup();

  const graph = buildClaimGraph({
    db,
    llm,
    ml,
    storage,
    tracer: new NoopTracer(),
    triageConfig: TRIAGE_CONFIG,
    now: () => new Date(),
  }).compile({ checkpointer });
  const agent = new AgentService(checkpointer, llm, db, ml, storage);
  const events = new EventEmitter2();
  const reviews = new ReviewsService(
    db,
    agent,
    new ClaimsService(db, agent, storage, events),
    events,
  );

  // --- users ---
  await db
    .insert(schema.users)
    .values([
      {
        id: CUSTOMER,
        email: process.env.SEED_CUSTOMER_EMAIL ?? "customer@claimpilot.test",
      },
      {
        id: REVIEWER,
        email: process.env.SEED_REVIEWER_EMAIL ?? "reviewer@claimpilot.test",
        role: "reviewer",
      },
    ])
    .onConflictDoNothing();
  await db
    .update(schema.users)
    .set({ role: "reviewer" })
    .where(eq(schema.users.id, REVIEWER));
  if (process.env.SEED_PROMOTE_EMAIL) {
    const promoted = await db
      .update(schema.users)
      .set({ role: "reviewer" })
      .where(eq(schema.users.email, process.env.SEED_PROMOTE_EMAIL))
      .returning();
    console.log(`promoted ${promoted.length} user(s) to reviewer`);
  }

  // --- vehicle + active policy ---
  let [policy] = await db
    .select()
    .from(schema.policies)
    .where(eq(schema.policies.userId, CUSTOMER));
  if (!policy) {
    const [vehicle] = await db
      .insert(schema.vehicles)
      .values({
        ownerId: CUSTOMER,
        make: "Toyota",
        model: "Corolla",
        year: 2021,
        registration: "CPLT 001",
        declaredValue: 2_200_000,
      })
      .returning();
    const start = new Date();
    start.setMonth(start.getMonth() - 4);
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
    [policy] = await db
      .insert(schema.policies)
      .values({
        userId: CUSTOMER,
        vehicleId: vehicle.id,
        planType: "comprehensive",
        premium: 60_000,
        status: "active",
        coverageStart: start,
        coverageEnd: end,
      })
      .returning();
  }

  // --- claims ---
  const incidentDate = new Date();
  incidentDate.setDate(incidentDate.getDate() - 3);
  const date = incidentDate.toISOString().slice(0, 10);
  for (const c of CLAIMS) {
    const [exists] = await db
      .select()
      .from(schema.claims)
      .where(eq(schema.claims.id, c.id));
    if (exists) {
      console.log(`skip ${c.id} (exists)`);
      continue;
    }

    const bytes = readFileSync(path.join(IMAGES, c.image));
    const storagePath = `${c.id}/${c.image}`;
    await storage.put(storagePath, bytes, "image/jpeg");
    await db.insert(schema.claims).values({
      id: c.id,
      policyId: policy.id,
      status: "analysis",
      claimedAmount: c.amount,
      incidentDate,
      incidentLocation: "King St W & Spadina Ave, Toronto",
      incidentDescription: c.description,
    });
    await db.insert(schema.claimDocuments).values({
      claimId: c.id,
      storagePath,
      type: "damage_photo",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });

    const transcript: [string, string][] = [
      [
        "user",
        `${c.description} It happened on ${date} at King St W & Spadina. Estimate is $${c.amount / 100}.`,
      ],
      ["agent", "Thanks — I have the incident details."],
      [
        "agent",
        "Please upload: photos of the damage, your driver's license, your vehicle registration.",
      ],
      [
        "agent",
        "Thanks, I have all your documents. I'm reviewing the photos now.",
      ],
    ];
    await db.insert(schema.claimEvents).values([
      {
        claimId: c.id,
        actor: `user:${CUSTOMER}`,
        eventType: "claim_created",
        payload: { policyId: policy.id, seeded: true },
      },
      ...transcript.map(([role, text]) => ({
        claimId: c.id,
        actor: role === "user" ? `user:${CUSTOMER}` : "agent",
        eventType: role === "user" ? "user_message" : "agent_message",
        payload: { text },
      })),
    ]);

    // Real graph from the analysis phase onward, checkpointed under the
    // claim's thread so the customer can keep chatting.
    const out = await graph.invoke(
      {
        claimId: c.id,
        phase: "analysis",
        messages: transcript.map(([role, text]) =>
          role === "user" ? new HumanMessage(text) : new AIMessage(text),
        ),
        incident: {
          date,
          location: "King St W & Spadina Ave, Toronto",
          description: c.description,
          claimedAmountCents: c.amount,
        },
        documents: {
          damagePhotos: [storagePath],
          license: "seed",
          registration: "seed",
        },
        docExtraction: {
          status: "complete",
          license: {
            readable: true,
            full_name: "Demo Customer",
            license_number: "D1234-56789",
            expiry_date: "2029-05-01",
          },
          registration: {
            readable: true,
            registration_number: "CPLT 001",
            make: "Toyota",
            model: "Corolla",
          },
        },
      },
      { configurable: { thread_id: c.id } },
    );

    await db
      .update(schema.claims)
      .set({ status: "pending_review" })
      .where(eq(schema.claims.id, c.id));
    await db.insert(schema.claimEvents).values([
      {
        claimId: c.id,
        actor: "agent",
        eventType: "agent_message",
        payload: { text: String(out.messages.at(-1)?.content ?? "") },
      },
      {
        claimId: c.id,
        actor: "agent",
        eventType: "status_changed",
        payload: { from: "analysis", to: "pending_review" },
      },
    ]);

    if (c.decide) {
      await reviews.decide({
        claimId: c.id,
        reviewerId: REVIEWER,
        decision: c.decide,
        notes: "Consistent with photos.",
        source: "admin",
      });
    }
    console.log(
      `seeded ${c.id.slice(-4)} ${c.image.padEnd(26)} -> ${out.triage?.priority} / ${out.triage?.recommendation} [${out.triage?.flags.join(", ")}]${c.decide ? ` -> ${c.decide}` : ""}`,
    );
  }

  await checkpointer.end();
  await sql.end();
  console.log(`\ncustomer ${CUSTOMER}\nreviewer ${REVIEWER}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
