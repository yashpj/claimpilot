/**
 * Agent eval suite (spec §5). Runs the REAL analysis graph
 * (consistency -> fraud_checks -> triage_claim) over the golden set and
 * reports description-match accuracy, false-flag rate and missed-flag rate.
 * Exits 1 if any metric regresses past evals/baseline.json.
 *
 *   EVAL_MODE=replay pnpm eval            # CI default: cassettes, no network
 *   EVAL_MODE=record pnpm eval            # fill missing cassettes from live Gemini + ml-service
 *   EVAL_MODE=rerecord pnpm eval          # re-record everything (after a prompt/model change)
 *   pnpm eval --update-baseline           # accept current numbers as the baseline
 */
import { ConfigService } from "@nestjs/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import * as schema from "@claimpilot/db";
import { TRIAGE_CONFIG, type TriageFlag } from "@claimpilot/shared";
import { buildClaimGraph } from "../src/agent/graph";
import { MlClient } from "../src/agent/ml/ml.client";
import { GeminiProvider } from "../src/llm/gemini.provider";
import { LocalStorageService } from "../src/storage/local-storage.service";
import { NoopTracer } from "../src/observability/tracer";
import { readCaptureDate } from "../src/claims/exif";
import { RecordReplayLlm, RecordReplayMl, type Mode } from "./record-replay";

type Case = {
  id: string;
  image: string;
  description: string;
  incidentDate?: string;
  claimedAmountCents?: number;
  duplicateOfPriorClaim?: boolean;
  expected: {
    matches_description: boolean;
    is_vehicle?: boolean;
    flags: TriageFlag[];
  };
};

// Flags with a ground truth in the golden set. low_confidence and
// vlm_ml_disagreement are reported but not scored: they're "a human should
// look" signals, not facts about the photo.
const SCORED: TriageFlag[] = [
  "description_mismatch",
  "not_a_vehicle",
  "stock_or_screenshot",
  "duplicate_image",
  "exif_date_mismatch",
  "amount_above_threshold",
];

const ROOT = __dirname;
const IMAGES = path.join(ROOT, "golden/images");
const EVAL_USER = "00000000-0000-4000-8000-00000000e7a1";

const mode = (process.env.EVAL_MODE ?? "replay") as Mode;
const updateBaseline = process.argv.includes("--update-baseline");
const dbUrl =
  process.env.EVAL_DATABASE_URL ??
  "postgresql://claimpilot:localdev@localhost:5433/claimpilot_test";

async function main() {
  const golden = JSON.parse(
    readFileSync(path.join(ROOT, "golden/cases.json"), "utf8"),
  ) as {
    defaults: { incidentDate: string; claimedAmountCents: number };
    cases: Case[];
  };
  const sql = postgres(dbUrl, { max: 4 });
  const db = drizzle(sql, { schema });

  const config = new ConfigService(process.env);
  const real = mode === "replay" ? null : new GeminiProvider(config);
  const visionModel =
    config.get<string>("GEMINI_VISION_MODEL") ?? "gemini-flash-lite-latest";
  const llm = new RecordReplayLlm(
    real,
    path.join(ROOT, "cache/llm"),
    mode,
    visionModel,
  );
  const ml = new RecordReplayMl(
    new MlClient(config.get<string>("ML_SERVICE_URL") ?? null, 30_000),
    path.join(ROOT, "cache/ml"),
    mode,
  );
  // Same graph code as production; only the edges of the world are swapped.
  const graph = buildClaimGraph({
    db,
    llm,
    ml,
    storage: new LocalStorageService(IMAGES),
    tracer: new NoopTracer(),
    triageConfig: TRIAGE_CONFIG,
    now: () => new Date(),
  }).compile();

  const policyId = await ensureEvalPolicy(db);
  const results = [];

  // Free tier: 15 requests/min. Pace live calls instead of eating 429s.
  const pauseMs =
    mode === "replay" ? 0 : Number(process.env.EVAL_CASE_DELAY_MS ?? 4500);

  for (const c of golden.cases) {
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    // Isolation: earlier cases reuse the same photos on purpose (correct vs
    // mismatched description), which must not look like duplicate fraud.
    await clearEvalDocuments(db);
    if (c.duplicateOfPriorClaim)
      await insertClaimWithDoc(db, policyId, c.image);
    const claimId = await insertClaimWithDoc(db, policyId, c.image);

    const incident = {
      date: c.incidentDate ?? golden.defaults.incidentDate,
      location: "Eval St",
      description: c.description,
      claimedAmountCents:
        c.claimedAmountCents ?? golden.defaults.claimedAmountCents,
    };
    const started = Date.now();
    const out = await graph.invoke({
      claimId,
      phase: "analysis",
      incident,
      documents: {
        damagePhotos: [c.image],
        license: "n/a",
        registration: "n/a",
      },
      docExtraction: {
        status: "complete",
        license: {
          readable: true,
          full_name: "E",
          license_number: "1",
          expiry_date: null,
        },
        registration: {
          readable: true,
          registration_number: "1",
          make: null,
          model: null,
        },
      },
    });

    const flags = out.triage?.flags ?? [];
    const vlm = out.analysis?.vlm ?? null;
    const scored = flags.filter((f) => SCORED.includes(f));
    const falseFlags = scored.filter((f) => !c.expected.flags.includes(f));
    const missedFlags = c.expected.flags.filter((f) => !flags.includes(f));
    const errors = out.analysis?.errors ?? [];
    results.push({
      id: c.id,
      matchCorrect: vlm?.matches_description === c.expected.matches_description,
      expectedMatch: c.expected.matches_description,
      vlmMatch: vlm?.matches_description ?? null,
      confidence: vlm?.confidence ?? null,
      flags,
      falseFlags,
      missedFlags,
      errors,
      priority: out.triage?.priority,
      recommendation: out.triage?.recommendation,
      crossCheck: out.analysis?.crossCheck?.detail ?? null,
      costMicroUsd: out.usage.costMicroUsd,
      ms: Date.now() - started,
    });
    const r = results.at(-1)!;
    const mark =
      r.matchCorrect && !falseFlags.length && !missedFlags.length
        ? "PASS"
        : "FAIL";
    console.log(
      `${mark} ${c.id.padEnd(26)} match=${String(r.vlmMatch).padEnd(5)} flags=[${flags.join(",")}]${errors.length ? ` errors=${errors.join("; ")}` : ""}`,
    );
  }
  await sql.end();

  const n = results.length;
  const metrics = {
    descriptionMatchAccuracy: round(
      results.filter((r) => r.matchCorrect).length / n,
    ),
    falseFlagRate: round(results.filter((r) => r.falseFlags.length).length / n),
    missedFlagRate: round(
      results.filter((r) => r.missedFlags.length).length /
        Math.max(1, golden.cases.filter((c) => c.expected.flags.length).length),
    ),
    // reported, not gated
    vlmMlDisagreementRate: round(
      results.filter((r) => r.flags.includes("vlm_ml_disagreement")).length / n,
    ),
    lowConfidenceRate: round(
      results.filter((r) => r.flags.includes("low_confidence")).length / n,
    ),
    analysisIncompleteRate: round(
      results.filter((r) => r.flags.includes("analysis_incomplete")).length / n,
    ),
    avgCostMicroUsd: Math.round(
      results.reduce((s, r) => s + r.costMicroUsd, 0) / n,
    ),
  };

  const baselinePath = path.join(ROOT, "baseline.json");
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
    tolerance: number;
    descriptionMatchAccuracy: number;
    falseFlagRate: number;
    missedFlagRate: number;
  };
  const t = baseline.tolerance;
  const regressions = [
    metrics.descriptionMatchAccuracy < baseline.descriptionMatchAccuracy - t &&
      `descriptionMatchAccuracy ${metrics.descriptionMatchAccuracy} < baseline ${baseline.descriptionMatchAccuracy}`,
    metrics.falseFlagRate > baseline.falseFlagRate + t &&
      `falseFlagRate ${metrics.falseFlagRate} > baseline ${baseline.falseFlagRate}`,
    metrics.missedFlagRate > baseline.missedFlagRate + t &&
      `missedFlagRate ${metrics.missedFlagRate} > baseline ${baseline.missedFlagRate}`,
  ].filter(Boolean) as string[];

  mkdirSync(path.join(ROOT, "reports"), { recursive: true });
  writeFileSync(
    path.join(ROOT, "reports/latest.json"),
    JSON.stringify(
      {
        mode,
        at: new Date().toISOString(),
        metrics,
        baseline,
        regressions,
        results,
      },
      null,
      2,
    ),
  );

  console.log("\nmetrics", metrics);
  const summary = [
    `### Agent evals (${mode}, ${n} cases)`,
    "| metric | value | baseline |",
    "|---|---|---|",
    `| description-match accuracy | ${metrics.descriptionMatchAccuracy} | ${baseline.descriptionMatchAccuracy} |`,
    `| false-flag rate | ${metrics.falseFlagRate} | ${baseline.falseFlagRate} |`,
    `| missed-flag rate | ${metrics.missedFlagRate} | ${baseline.missedFlagRate} |`,
    `| VLM/ML disagreement rate | ${metrics.vlmMlDisagreementRate} | — |`,
    regressions.length
      ? `\n**Regressions:** ${regressions.join("; ")}`
      : "\nNo regressions.",
  ].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");

  if (updateBaseline) {
    writeFileSync(
      baselinePath,
      JSON.stringify(
        {
          tolerance: t,
          descriptionMatchAccuracy: metrics.descriptionMatchAccuracy,
          falseFlagRate: metrics.falseFlagRate,
          missedFlagRate: metrics.missedFlagRate,
        },
        null,
        2,
      ) + "\n",
    );
    console.log("baseline updated");
    return;
  }
  if (regressions.length) {
    console.error("\nEVAL REGRESSION:\n- " + regressions.join("\n- "));
    process.exit(1);
  }
  console.log("\nno regressions vs baseline");
}

const round = (x: number) => Math.round(x * 1000) / 1000;

async function ensureEvalPolicy(db: ReturnType<typeof drizzle<typeof schema>>) {
  await db
    .insert(schema.users)
    .values({ id: EVAL_USER, email: "eval@claimpilot.test" })
    .onConflictDoNothing();
  const [existing] = await db
    .select()
    .from(schema.policies)
    .where(eq(schema.policies.userId, EVAL_USER));
  if (existing) return existing.id;
  const [vehicle] = await db
    .insert(schema.vehicles)
    .values({
      ownerId: EVAL_USER,
      make: "Eval",
      model: "Car",
      year: 2020,
      registration: "EVAL",
      declaredValue: 3_000_000,
    })
    .returning();
  const [policy] = await db
    .insert(schema.policies)
    .values({
      userId: EVAL_USER,
      vehicleId: vehicle.id,
      planType: "comprehensive",
      premium: 60_000,
      status: "active",
      coverageStart: new Date("2026-01-01"),
      coverageEnd: new Date("2027-01-01"),
    })
    .returning();
  return policy.id;
}

async function clearEvalDocuments(
  db: ReturnType<typeof drizzle<typeof schema>>,
) {
  const claims = db
    .select({ id: schema.claims.id })
    .from(schema.claims)
    .innerJoin(schema.policies, eq(schema.claims.policyId, schema.policies.id))
    .where(eq(schema.policies.userId, EVAL_USER));
  await db
    .delete(schema.claimDocuments)
    .where(inArray(schema.claimDocuments.claimId, claims));
}

async function insertClaimWithDoc(
  db: ReturnType<typeof drizzle<typeof schema>>,
  policyId: string,
  image: string,
) {
  const bytes = readFileSync(path.join(IMAGES, image));
  const [claim] = await db
    .insert(schema.claims)
    .values({ policyId, status: "analysis" })
    .returning();
  await db.insert(schema.claimDocuments).values({
    claimId: claim.id,
    storagePath: image,
    type: "damage_photo",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    exifCaptureDate: await readCaptureDate(bytes),
  });
  return claim.id;
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
