import { pgEnum } from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["customer", "reviewer"]);
export const policyStatus = pgEnum("policy_status", [
  "pending_payment", "active", "expired", "cancelled",
]);
export const claimStatus = pgEnum("claim_status", [
  "draft", "intake", "analysis", "pending_review",
  "more_info_requested", "approved", "denied",
]);
export const docType = pgEnum("doc_type", [
  "damage_photo", "license", "registration", "other",
]);