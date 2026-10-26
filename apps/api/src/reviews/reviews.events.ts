import type { Decision } from "@claimpilot/shared";

export const CLAIM_DECIDED = "claim.decided";
export type ClaimDecidedEvent = {
  claimId: string;
  decision: Decision;
  overturned: boolean;
};
