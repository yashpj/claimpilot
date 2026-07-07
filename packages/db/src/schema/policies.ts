import { pgTable, uuid, integer, text, timestamp } from "drizzle-orm/pg-core";
import { policyStatus } from "./enums";
import { users } from "./users";
import { vehicles } from "./vehicles";

export const policies = pgTable("policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  vehicleId: uuid("vehicle_id").references(() => vehicles.id).notNull(),
  planType: text("plan_type").notNull(), // third_party | comprehensive | comprehensive_plus
  premium: integer("premium").notNull(),          // cents
  status: policyStatus("status").default("pending_payment").notNull(),
  coverageStart: timestamp("coverage_start"),
  coverageEnd: timestamp("coverage_end"),
  stripeSessionId: text("stripe_session_id"),
  stripeCustomerId: text("stripe_customer_id"),
});
