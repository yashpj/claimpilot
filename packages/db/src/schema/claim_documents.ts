import { pgTable, uuid, integer, text, timestamp } from "drizzle-orm/pg-core";
import { claimStatus, docType } from "./enums";
import { claims } from "./claims";

export const claimDocuments = pgTable("claim_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  claimId: uuid("claim_id").references(() => claims.id).notNull(),
  storagePath: text("storage_path").notNull(),
  type: docType("type").notNull(),
  sha256: text("sha256").notNull(),               // duplicate detection
  exifCaptureDate: timestamp("exif_capture_date"),
});
