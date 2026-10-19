import type { MlDetection } from "../ml/ml.client";
import type { VlmVerdict } from "./vlm";

export type CrossCheck = {
  agree: boolean;
  vlmSeesDamage: boolean;
  mlSeesDamage: boolean;
  mlDetectionCount: number;
  detail: string;
};

// Two independent opinions on "is there damage?": a general VLM and a
// specialist detector. We compare at the level both can actually answer:
// presence of damage. (The detector has no idea what a "rear bumper" is,
// so comparing locations would be comparing apples to bounding boxes.)
// Disagreement doesn't mean either is wrong; it means a human should look.
export function crossCheck(
  vlm: VlmVerdict,
  detectionsPerImage: MlDetection[][],
  mlMinConfidence: number,
): CrossCheck {
  const confident = detectionsPerImage
    .flat()
    .filter((d) => d.confidence >= mlMinConfidence);
  const vlmSeesDamage =
    vlm.severity_estimate !== "none" && vlm.damage_locations.length > 0;
  const mlSeesDamage = confident.length > 0;
  const agree = vlmSeesDamage === mlSeesDamage;

  const classes =
    [...new Set(confident.map((d) => d.class))].join(", ") || "none";
  return {
    agree,
    vlmSeesDamage,
    mlSeesDamage,
    mlDetectionCount: confident.length,
    detail: agree
      ? `Both models ${vlmSeesDamage ? "see" : "see no"} damage (detector: ${classes}).`
      : `VLM ${vlmSeesDamage ? "sees" : "sees no"} damage (${vlm.severity_estimate}); detector ${mlSeesDamage ? `found ${classes}` : "found nothing"}.`,
  };
}
