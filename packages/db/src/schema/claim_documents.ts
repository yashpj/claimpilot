import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { docType } from "./enums";
import { claims } from "./claims";

export const claimDocuments = pgTable(
  "claim_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    claimId: uuid("claim_id").references(() => claims.id).notNull(),
    storagePath: text("storage_path").notNull(),
    type: docType("type").notNull(),
    mimeType: text("mime_type").notNull().default("image/jpeg"),
    sha256: text("sha256").notNull(),               // duplicate detection
    exifCaptureDate: timestamp("exif_capture_date"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  // The duplicate-image fraud check looks up every upload by hash.
  (t) => [index("claim_documents_sha256_idx").on(t.sha256)],
);
