import { pgTable, uuid, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { claimStatus } from "./enums";
import { policies } from "./policies";

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    policyId: uuid("policy_id").references(() => policies.id).notNull(),
    status: claimStatus("status").default("draft").notNull(),
    claimedAmount: integer("claimed_amount"),       // cents
    incidentDate: timestamp("incident_date"),
    incidentLocation: text("incident_location"),
    incidentDescription: text("incident_description"),
    priority: text("priority").default("standard"), // "standard" | "priority"
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // The review queue filters by status and sorts by priority.
  (t) => [index("claims_status_priority_idx").on(t.status, t.priority)],
);
