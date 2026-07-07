import { pgTable, uuid, integer, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users";

export const vehicles = pgTable("vehicles", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").references(() => users.id).notNull(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  registration: text("registration").notNull(),
  declaredValue: integer("declared_value").notNull(), // store money as integer cents
});
