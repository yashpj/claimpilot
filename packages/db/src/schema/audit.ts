import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { claims } from "./claims";

// APPEND-ONLY. Never UPDATE or DELETE a row here.
export const claimEvents = pgTable("claim_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  claimId: uuid("claim_id").references(() => claims.id).notNull(),
  actor: text("actor").notNull(),        // "agent" | "reviewer:<id>" | "system"
  eventType: text("event_type").notNull(), // "status_changed", "agent_analysis", ...
  payload: jsonb("payload").notNull(),   // the full detail of what happened
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Stripe idempotency. One row per processed event ID.
export const processedWebhookEvents = pgTable("processed_webhook_events", {
  eventId: text("event_id").primaryKey(), // Stripe's event ID = the dedup key
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});