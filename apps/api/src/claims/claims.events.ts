import type { Priority, Recommendation } from "@claimpilot/shared";

// In-process domain events. Listeners: metrics, Slack. Own file so
// listeners don't import (and create cycles with) the services.
export const CLAIM_CREATED = "claim.created";
export const CLAIM_TRIAGED = "claim.triaged";
export type ClaimTriagedEvent = {
  claimId: string;
  priority: Priority;
  recommendation: Recommendation;
};
