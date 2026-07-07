import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { userRole } from "./enums";

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),           // matches Supabase auth user id
  email: text("email").notNull().unique(),
  role: userRole("role").default("customer").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});