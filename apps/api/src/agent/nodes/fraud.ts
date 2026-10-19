import { and, eq, inArray, ne } from "drizzle-orm";
import * as schema from "@claimpilot/db";
import type { AgentDeps } from "../deps";
import type { ClaimStateType, ClaimStateUpdate } from "../state";
import {
  exifDateMismatch,
  fraudFlags,
  stockOrScreenshot,
} from "../analysis/fraud";

// Cheap, deterministic fraud checks (spec §4.3). No LLM: these are plain
// rules that either fire or don't, are free, and are explainable to anyone.
export function makeFraudNode({ db, triageConfig }: AgentDeps) {
  return async function fraudNode(
    state: ClaimStateType,
  ): Promise<ClaimStateUpdate> {
    const docs = await db
      .select()
      .from(schema.claimDocuments)
      .where(eq(schema.claimDocuments.claimId, state.claimId));

    // Same bytes already submitted on a DIFFERENT claim (any customer).
    let duplicate = false;
    const hashes = docs
      .filter((d) => d.type === "damage_photo")
      .map((d) => d.sha256);
    if (hashes.length) {
      const dupes = await db
        .select({ id: schema.claimDocuments.id })
        .from(schema.claimDocuments)
        .where(
          and(
            inArray(schema.claimDocuments.sha256, hashes),
            ne(schema.claimDocuments.claimId, state.claimId),
          ),
        )
        .limit(1);
      duplicate = dupes.length > 0;
    }

    const exifMismatch = state.incident.date
      ? exifDateMismatch(
          docs
            .filter((d) => d.type === "damage_photo")
            .map((d) => d.exifCaptureDate),
          new Date(`${state.incident.date}T12:00:00Z`),
          triageConfig.exifMaxDaysFromIncident,
        )
      : false;

    return {
      fraudFlags: fraudFlags({
        duplicate,
        exifMismatch,
        stockOrScreenshot: stockOrScreenshot(state.analysis?.vlm ?? null),
      }),
    };
  };
}
