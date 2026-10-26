import type { TriageFlag } from "@claimpilot/shared";
import type { VlmVerdict } from "./vlm";

const DAY_MS = 24 * 60 * 60 * 1000;

// EXIF capture date far from the incident => photo may be from another event.
// Missing EXIF is NOT a flag: most messaging apps strip it, so flagging it
// would flag nearly everyone (high false-flag rate = reviewers ignore flags).
export function exifDateMismatch(
  captureDates: (Date | null)[],
  incidentDate: Date,
  maxDays: number,
): boolean {
  return captureDates.some(
    (d) =>
      d !== null &&
      Math.abs(d.getTime() - incidentDate.getTime()) > maxDays * DAY_MS,
  );
}

export function stockOrScreenshot(vlm: VlmVerdict | null): boolean {
  if (!vlm) return false;
  return vlm.flags.some((f) =>
    ["stock_photo", "screenshot", "digitally_altered"].includes(f),
  );
}

export function fraudFlags(input: {
  duplicate: boolean;
  exifMismatch: boolean;
  stockOrScreenshot: boolean;
}): TriageFlag[] {
  const flags: TriageFlag[] = [];
  if (input.duplicate) flags.push("duplicate_image");
  if (input.exifMismatch) flags.push("exif_date_mismatch");
  if (input.stockOrScreenshot) flags.push("stock_or_screenshot");
  return flags;
}
