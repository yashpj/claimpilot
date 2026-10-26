ALTER TABLE "claim_documents" ADD COLUMN "mime_type" text DEFAULT 'image/jpeg' NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_documents" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "claim_events_claim_created_idx" ON "claim_events" USING btree ("claim_id","created_at");--> statement-breakpoint
CREATE INDEX "claim_documents_sha256_idx" ON "claim_documents" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "claims_status_priority_idx" ON "claims" USING btree ("status","priority");