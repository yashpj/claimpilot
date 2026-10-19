import { EventEmitter2 } from "@nestjs/event-emitter";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as schema from "@claimpilot/db";
import { AgentService } from "../src/agent/agent.service";
import { ClaimsService } from "../src/claims/claims.service";
import { ReviewsService, CLAIM_DECIDED } from "../src/reviews/reviews.service";
import { LocalStorageService } from "../src/storage/local-storage.service";
import {
  FakeLlm,
  FakeMl,
  goodVerdict,
  intakeExtract,
  readableDocs,
} from "./support/fakes";

const URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://claimpilot:localdev@localhost:5433/claimpilot_test";
const sql = postgres(URL, { max: 5 });
const db = drizzle(sql, { schema });
let checkpointer: PostgresSaver;
const storage = new LocalStorageService(
  mkdtempSync(path.join(tmpdir(), "cp-")),
);

beforeAll(async () => {
  checkpointer = PostgresSaver.fromConnString(URL);
  await checkpointer.setup();
});
afterAll(async () => {
  await checkpointer.end();
  await sql.end();
});

function setup(vlm: object = goodVerdict) {
  const llm = new FakeLlm({
    "intake.extract": intakeExtract,
    "documents.extract": () => readableDocs,
    "consistency.vlm": () => vlm,
    "followup.dispute": () => ({ disputes: false }),
  });
  const events = new EventEmitter2();
  const decided: unknown[] = [];
  events.on(CLAIM_DECIDED, (e) => decided.push(e));
  const agent = new AgentService(checkpointer, llm, db, new FakeMl(), storage);
  const claims = new ClaimsService(db, agent, storage, events);
  const reviews = new ReviewsService(db, agent, claims, events);
  return { agent, claims, reviews, decided };
}

const jpeg = () => ({
  buffer: Buffer.from(`img-${randomUUID()}`),
  mimetype: "image/jpeg",
  originalname: "x.jpg",
  size: 10,
});

async function triagedClaim(claims: ClaimsService) {
  const userId = randomUUID();
  const reviewerId = randomUUID();
  await db.insert(schema.users).values([
    { id: userId, email: `${userId}@test.dev` },
    { id: reviewerId, email: `${reviewerId}@test.dev`, role: "reviewer" },
  ]);
  const [vehicle] = await db
    .insert(schema.vehicles)
    .values({
      ownerId: userId,
      make: "VW",
      model: "Golf",
      year: 2019,
      registration: "R1",
      declaredValue: 1_500_000,
    })
    .returning();
  const [policy] = await db
    .insert(schema.policies)
    .values({
      userId,
      vehicleId: vehicle.id,
      planType: "comprehensive",
      premium: 60_000,
      status: "active",
      coverageStart: new Date("2026-01-01"),
      coverageEnd: new Date("2027-01-01"),
    })
    .returning();
  const claim = await claims.create(userId, policy.id);
  await claims.sendMessage(
    userId,
    claim.id,
    "I was rear-ended on 2026-10-10 on Main St, about $800",
  );
  await claims.uploadDocuments(userId, claim.id, { type: "damage_photo" }, [
    jpeg(),
  ]);
  await claims.uploadDocuments(userId, claim.id, { type: "license" }, [jpeg()]);
  await claims.uploadDocuments(userId, claim.id, { type: "registration" }, [
    jpeg(),
  ]);
  return { userId, reviewerId, claimId: claim.id };
}

describe("reviews", () => {
  it("approve agrees with an 'approve' recommendation: no overturn; customer notified; claim closed", async () => {
    const { claims, reviews, decided } = setup();
    const { userId, reviewerId, claimId } = await triagedClaim(claims);

    const review = await reviews.decide({
      claimId,
      reviewerId,
      decision: "approved",
      source: "admin",
    });
    expect(review.overturnedAgent).toBe(false);
    expect(decided).toEqual([
      { claimId, decision: "approved", overturned: false },
    ]);

    const { claim, messages } = await claims.getClaim(userId, claimId);
    expect(claim.status).toBe("approved");
    expect(messages.at(-1)?.text).toMatch(/approved your claim/);

    // Next customer message is routed to the "closed" node by the checkpoint.
    const r = await claims.sendMessage(userId, claimId, "thanks!");
    expect(r.replies[0]).toMatch(/decided and is now closed/);
  });

  it("deny against an 'approve' recommendation is an overturn", async () => {
    const { claims, reviews } = setup();
    const { reviewerId, claimId } = await triagedClaim(claims);
    const review = await reviews.decide({
      claimId,
      reviewerId,
      decision: "denied",
      notes: "Pre-existing damage",
      source: "admin",
    });
    expect(review.overturnedAgent).toBe(true);
  });

  it("deciding twice is a 409 (row lock + status check)", async () => {
    const { claims, reviews } = setup();
    const { reviewerId, claimId } = await triagedClaim(claims);
    const results = await Promise.allSettled([
      reviews.decide({
        claimId,
        reviewerId,
        decision: "approved",
        source: "admin",
      }),
      reviews.decide({
        claimId,
        reviewerId,
        decision: "denied",
        source: "slack",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ status: 409 }),
    });
  });

  it("reconciles a missed checkpoint update from claims.status", async () => {
    const { claims, reviews, agent } = setup();
    const { userId, reviewerId, claimId } = await triagedClaim(claims);
    jest
      .spyOn(agent, "applyDecision")
      .mockRejectedValueOnce(new Error("checkpoint write failed"));
    await reviews.decide({
      claimId,
      reviewerId,
      decision: "denied",
      source: "admin",
    });
    expect((await agent.getState(claimId))?.phase).toBe("review"); // stale

    const r = await claims.sendMessage(userId, claimId, "any update?");
    expect(r.replies[0]).toMatch(/decided and is now closed/);
  });

  it("queue sorts priority first and exposes recommendation + flags", async () => {
    const standard = setup();
    const a = await triagedClaim(standard.claims);
    const escalated = setup({ ...goodVerdict, matches_description: false });
    const b = await triagedClaim(escalated.claims);

    const queue = await standard.reviews.queue(["pending_review"]);
    const ia = queue.findIndex((c) => c.id === a.claimId);
    const ib = queue.findIndex((c) => c.id === b.claimId);
    expect(ib).toBeLessThan(ia);
    expect(queue[ib]).toMatchObject({
      priority: "priority",
      recommendation: "deny",
      flags: ["description_mismatch"],
    });
  });

  it("metrics compute overturn and escalation rates", async () => {
    const { reviews } = setup();
    const m = await reviews.metrics();
    expect(m.reviews).toBeGreaterThan(0);
    expect(m.overturnRate).toBeGreaterThan(0);
    expect(m.overturnRate).toBeLessThanOrEqual(1);
    expect(m.escalationRate).not.toBeNull();
    expect(m.avgCostUsdPerClaim).toBeGreaterThan(0);
    expect(m.funnel.approved).toBeGreaterThan(0);
  });

  it("more_info: status + chat message, then the customer's reply re-triages", async () => {
    const { claims, reviews } = setup();
    const { userId, reviewerId, claimId } = await triagedClaim(claims);
    await reviews.decide({
      claimId,
      reviewerId,
      decision: "more_info",
      notes: "Photo of the other car?",
      source: "admin",
    });
    let [row] = await db
      .select()
      .from(schema.claims)
      .where(eq(schema.claims.id, claimId));
    expect(row.status).toBe("more_info_requested");
    await claims.sendMessage(userId, claimId, "The other car was a grey Prius");
    [row] = await db
      .select()
      .from(schema.claims)
      .where(eq(schema.claims.id, claimId));
    expect(row.status).toBe("pending_review");
  });
});
