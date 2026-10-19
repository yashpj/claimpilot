// Integration test: the real graph, real Postgres (checkpoints, triggers,
// advisory lock), real ClaimsService. Only the LLM and ml-service are fakes.
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, desc } from "drizzle-orm";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as schema from "@claimpilot/db";
import { AgentService } from "../src/agent/agent.service";
import { ClaimsService, CLAIM_TRIAGED } from "../src/claims/claims.service";
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

function setup(overrides: Record<string, (req: any) => unknown> = {}) {
  const llm = new FakeLlm({
    "intake.extract": intakeExtract,
    "documents.extract": () => readableDocs,
    "consistency.vlm": () => goodVerdict,
    "followup.dispute": () => ({ disputes: false }),
    ...overrides,
  });
  const ml = new FakeMl();
  const events = new EventEmitter2();
  const triaged: string[] = [];
  events.on(CLAIM_TRIAGED, (e: { claimId: string }) => triaged.push(e.claimId));
  const agent = new AgentService(checkpointer, llm, db, ml, storage);
  const claims = new ClaimsService(db, agent, storage, events);
  return { llm, ml, agent, claims, triaged };
}

async function seedPolicy(opts: { start?: Date } = {}) {
  const userId = randomUUID();
  await db
    .insert(schema.users)
    .values({ id: userId, email: `${userId}@test.dev` });
  const [vehicle] = await db
    .insert(schema.vehicles)
    .values({
      ownerId: userId,
      make: "Honda",
      model: "Civic",
      year: 2020,
      registration: "ABC123",
      declaredValue: 2_000_000,
    })
    .returning();
  const start = opts.start ?? new Date("2026-01-01T00:00:00Z");
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  const [policy] = await db
    .insert(schema.policies)
    .values({
      userId,
      vehicleId: vehicle.id,
      planType: "comprehensive",
      premium: 60_000,
      status: "active",
      coverageStart: start,
      coverageEnd: end,
    })
    .returning();
  return { userId, policyId: policy.id };
}

const jpeg = (tag: string = randomUUID()) => ({
  buffer: Buffer.from(`fake-jpeg-${tag}`),
  mimetype: "image/jpeg",
  originalname: "x.jpg",
  size: 20,
});

async function fileCompleteClaim(
  claims: ClaimsService,
  userId: string,
  claimId: string,
  photo = jpeg(),
) {
  await claims.sendMessage(
    userId,
    claimId,
    "I was rear-ended on 2026-10-10 on Main St",
  );
  await claims.sendMessage(userId, claimId, "Repair estimate is $1200");
  await claims.uploadDocuments(userId, claimId, { type: "damage_photo" }, [
    photo,
  ]);
  await claims.uploadDocuments(userId, claimId, { type: "license" }, [jpeg()]);
  return claims.uploadDocuments(userId, claimId, { type: "registration" }, [
    jpeg(),
  ]);
}

async function latestAssessment(claimId: string) {
  const [a] = await db
    .select()
    .from(schema.claimAssessments)
    .where(eq(schema.claimAssessments.claimId, claimId))
    .orderBy(desc(schema.claimAssessments.createdAt));
  return a as typeof a & {
    output: { flags: string[]; recommendation: string; priority: string };
  };
}

describe("claim agent flow", () => {
  it("happy path: intake -> documents -> analysis -> standard review queue", async () => {
    const { claims, triaged } = setup();
    const { userId, policyId } = await seedPolicy();
    const claim = await claims.create(userId, policyId);

    const t1 = await claims.sendMessage(
      userId,
      claim.id,
      "I was rear-ended on 2026-10-10 on Main St",
    );
    expect(t1.phase).toBe("intake"); // still missing the amount

    const t2 = await claims.sendMessage(
      userId,
      claim.id,
      "Repair estimate is $1200",
    );
    expect(t2.phase).toBe("documents");
    expect(t2.replies.at(-1)).toMatch(
      /Please upload: photos of the damage, your driver's license, your vehicle registration/,
    );

    const t3 = await claims.uploadDocuments(
      userId,
      claim.id,
      { type: "damage_photo" },
      [jpeg()],
    );
    expect(t3.replies.at(-1)).toMatch(
      /I have 1 damage photo\. Please upload: your driver's license/,
    );
    await claims.uploadDocuments(userId, claim.id, { type: "license" }, [
      jpeg(),
    ]);
    const t5 = await claims.uploadDocuments(
      userId,
      claim.id,
      { type: "registration" },
      [jpeg()],
    );
    expect(t5.phase).toBe("review");

    const [row] = await db
      .select()
      .from(schema.claims)
      .where(eq(schema.claims.id, claim.id));
    expect(row).toMatchObject({
      status: "pending_review",
      priority: "standard",
      claimedAmount: 120_000,
    });

    const a = await latestAssessment(claim.id);
    expect(a.output).toMatchObject({
      priority: "standard",
      recommendation: "approve",
      flags: [],
    });
    expect(a.tokenCost).toBeGreaterThan(0);
    expect(a.modelVersions).toMatchObject({
      ml: "fake-yolo",
      triage: "triage-v1",
    });
    expect(triaged).toEqual([claim.id]);

    const { messages } = await claims.getClaim(userId, claim.id);
    expect(messages.at(-1)?.text).toMatch(/submitted to our review team/);
  });

  it("ml-service failure never blocks the customer: analysis_incomplete + priority", async () => {
    const { claims, ml } = setup();
    ml.fail = true;
    const { userId, policyId } = await seedPolicy();
    const claim = await claims.create(userId, policyId);
    const last = await fileCompleteClaim(claims, userId, claim.id);
    expect(last.phase).toBe("review");
    const a = await latestAssessment(claim.id);
    expect(a.output.flags).toContain("analysis_incomplete");
    expect(a.output.priority).toBe("priority");
  });

  it("VLM returning garbage is caught by Zod, not trusted", async () => {
    const { claims } = setup({
      "consistency.vlm": () => ({ verdict: "looks fine to me" }),
    });
    const { userId, policyId } = await seedPolicy();
    const claim = await claims.create(userId, policyId);
    await fileCompleteClaim(claims, userId, claim.id);
    expect((await latestAssessment(claim.id)).output.flags).toContain(
      "analysis_incomplete",
    );
  });

  it("same photo bytes on another claim => duplicate_image, recommend deny", async () => {
    const { claims } = setup();
    const photo = jpeg("shared-bytes-" + randomUUID());
    const a = await seedPolicy();
    const c1 = await claims.create(a.userId, a.policyId);
    await fileCompleteClaim(claims, a.userId, c1.id, photo);
    const b = await seedPolicy();
    const c2 = await claims.create(b.userId, b.policyId);
    await fileCompleteClaim(claims, b.userId, c2.id, photo);
    const out = (await latestAssessment(c2.id)).output;
    expect(out.flags).toContain("duplicate_image");
    expect(out.recommendation).toBe("deny");
  });

  it("VLM/ML disagreement escalates", async () => {
    const { claims, ml } = setup();
    ml.detections = [];
    const { userId, policyId } = await seedPolicy();
    const claim = await claims.create(userId, policyId);
    await fileCompleteClaim(claims, userId, claim.id);
    expect((await latestAssessment(claim.id)).output.flags).toContain(
      "vlm_ml_disagreement",
    );
  });

  it("incident outside the coverage window is declined politely (status draft)", async () => {
    const { claims } = setup();
    const { userId, policyId } = await seedPolicy({
      start: new Date("2026-06-01T00:00:00Z"),
    });
    const claim = await claims.create(userId, policyId);
    const r = await claims.sendMessage(
      userId,
      claim.id,
      "I was rear-ended on 2026-01-15 on Main St",
    );
    expect(r.phase).toBe("done");
    expect(r.replies[0]).toMatch(/outside your coverage period/);
    const [row] = await db
      .select()
      .from(schema.claims)
      .where(eq(schema.claims.id, claim.id));
    expect(row.status).toBe("draft");
  });

  it("stalled conversation is handed to a human (priority, conversation_stalled)", async () => {
    const { claims } = setup();
    const { userId, policyId } = await seedPolicy();
    const claim = await claims.create(userId, policyId);
    let r: { phase: string } | undefined;
    for (let i = 0; i < 4; i++)
      r = await claims.sendMessage(userId, claim.id, "hmm I don't know");
    expect(r?.phase).toBe("review");
    const out = (await latestAssessment(claim.id)).output;
    expect(out.flags).toEqual(
      expect.arrayContaining(["conversation_stalled", "analysis_incomplete"]),
    );
  });

  it("reviewer asks for more info -> customer replies -> re-analysed with a new assessment", async () => {
    const { claims, agent, llm } = setup();
    const { userId, policyId } = await seedPolicy();
    const claim = await claims.create(userId, policyId);
    await fileCompleteClaim(claims, userId, claim.id);

    await agent.applyDecision(
      claim.id,
      "more_info",
      "Please describe the other car.",
    );
    const r = await claims.sendMessage(
      userId,
      claim.id,
      "It was a blue pickup truck",
    );
    expect(r?.phase).toBe("review");
    const all = await db
      .select()
      .from(schema.claimAssessments)
      .where(eq(schema.claimAssessments.claimId, claim.id));
    expect(all).toHaveLength(2);
    expect(llm.calls.filter((c) => c === "consistency.vlm")).toHaveLength(2);
    const state = await agent.getState(claim.id);
    expect(state?.additionalInfo).toEqual(["It was a blue pickup truck"]);
  });

  it("customer dispute after triage escalates priority", async () => {
    const { claims } = setup({
      "followup.dispute": () => ({ disputes: true }),
    });
    const { userId, policyId } = await seedPolicy();
    const claim = await claims.create(userId, policyId);
    await fileCompleteClaim(claims, userId, claim.id);
    const r = await claims.sendMessage(
      userId,
      claim.id,
      "This is wrong, I want a human",
    );
    expect(r.replies[0]).toMatch(/flagged your concern/);
    const [row] = await db
      .select()
      .from(schema.claims)
      .where(eq(schema.claims.id, claim.id));
    expect(row.priority).toBe("priority");
  });

  it("state survives a 'restart' (new service instances, same Postgres)", async () => {
    const first = setup();
    const { userId, policyId } = await seedPolicy();
    const claim = await first.claims.create(userId, policyId);
    await first.claims.sendMessage(
      userId,
      claim.id,
      "I was rear-ended on 2026-10-10 on Main St",
    );

    const second = setup(); // fresh AgentService/graph, as after a pod restart
    const r = await second.claims.sendMessage(
      userId,
      claim.id,
      "Repair estimate is $1200",
    );
    expect(r.phase).toBe("documents");
  });

  it("concurrent uploads are serialised per claim (advisory lock)", async () => {
    const { claims } = setup();
    const { userId, policyId } = await seedPolicy();
    const claim = await claims.create(userId, policyId);
    await claims.sendMessage(
      userId,
      claim.id,
      "I was rear-ended on 2026-10-10 on Main St, about $900",
    );
    const results = await Promise.all([
      claims.uploadDocuments(userId, claim.id, { type: "damage_photo" }, [
        jpeg(),
      ]),
      claims.uploadDocuments(userId, claim.id, { type: "license" }, [jpeg()]),
      claims.uploadDocuments(userId, claim.id, { type: "registration" }, [
        jpeg(),
      ]),
    ]);
    // Files are stored before the lock, so the first run to get the lock sees
    // all three and triages; the other two find the claim already in review.
    // What matters: exactly ONE triage and ONE assessment, never three.
    const triagedRuns = results.filter((r) =>
      r.replies.some((t) => /submitted to our review team/.test(t)),
    );
    expect(triagedRuns).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.claimAssessments)
        .where(eq(schema.claimAssessments.claimId, claim.id)),
    ).toHaveLength(1);
  });

  it("someone else's claim is 404, not 403", async () => {
    const { claims } = setup();
    const a = await seedPolicy();
    const claim = await claims.create(a.userId, a.policyId);
    const b = await seedPolicy();
    await expect(claims.getClaim(b.userId, claim.id)).rejects.toThrow(
      "Not Found",
    );
  });

  it("claim_events is append-only at the database level", async () => {
    await expect(
      sql`update claim_events set actor = 'x' where id = (select id from claim_events limit 1)`,
    ).rejects.toThrow(/append-only/);
  });
});
