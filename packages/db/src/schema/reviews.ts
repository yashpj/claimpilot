import { pgTable, uuid, integer, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { claims } from "./claims";
import { users } from "./users";

export const reviews = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  claimId: uuid("claim_id").references(() => claims.id).notNull(),
  reviewerId: uuid("reviewer_id").references(() => users.id).notNull(),
  decision: text("decision").notNull(),           // approved | denied | more_info
  notes: text("notes"),
  overturnedAgent: boolean("overturned_agent").notNull(), // key quality metric
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
