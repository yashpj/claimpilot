import { pgTable, uuid, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { claimStatus } from "./enums";
import { claims } from "./claims";

export const claimAssessments = pgTable("claim_assessments", {
  id: uuid("id").defaultRandom().primaryKey(),
  claimId: uuid("claim_id").references(() => claims.id).notNull(),
  output: jsonb("output").notNull(),              // structured agent result (§4)
  modelVersions: jsonb("model_versions").notNull(),
  tokenCost: integer("token_cost"),               // micro-dollars, keep it integer
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
