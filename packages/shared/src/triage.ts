// Triage rules as DATA (spec §4): reviewers and engineers can read this file
// and know exactly why a claim was escalated. No rule lives in a prompt.
//
// Pure module (no I/O, no deps), shared by the API, the eval suite and the
// admin UI (labels).

export const FLAGS = {
  // fraud signals (deterministic checks + VLM verdict)
  duplicate_image: { label: "Photo already used in another claim", kind: "fraud" },
  exif_date_mismatch: { label: "Photo capture date is far from the incident date", kind: "fraud" },
  stock_or_screenshot: { label: "Image looks like a stock photo, screenshot or edit", kind: "fraud" },
  description_mismatch: { label: "Visible damage does not match the description", kind: "fraud" },
  not_a_vehicle: { label: "Damage photo does not show a vehicle", kind: "fraud" },
  // analysis quality
  low_confidence: { label: "Model confidence below threshold", kind: "quality" },
  vlm_ml_disagreement: { label: "VLM and damage detector disagree", kind: "quality" },
  analysis_incomplete: { label: "Automated analysis failed or timed out", kind: "quality" },
  // claim / documents / conversation
  amount_above_threshold: { label: "Claimed amount above review threshold", kind: "policy" },
  unreadable_documents: { label: "License or registration unreadable", kind: "documents" },
  customer_dispute: { label: "Customer disputes the agent", kind: "conversation" },
  conversation_stalled: { label: "Conversation stalled or looped", kind: "conversation" },
} as const;

export type TriageFlag = keyof typeof FLAGS;
export const ALL_FLAGS = Object.keys(FLAGS) as TriageFlag[];

export type Recommendation = "approve" | "deny" | "more_info";
export type Priority = "priority" | "standard";

export const TRIAGE_CONFIG = {
  version: "triage-v1",
  minConfidence: 0.6,
  amountThresholdCents: 500_000,          // $5,000
  exifMaxDaysFromIncident: 7,
  maxNoProgressTurns: 4,                  // turns without progress => stalled
  mlMinConfidence: 0.4,                   // detector score that counts as "damage seen"
  // Any of these => priority queue. Today that's every flag, which is exactly
  // spec §4. It's a list so tuning ("amount alone shouldn't escalate") is a
  // one-line, reviewable config change with an eval run, not a prompt edit.
  escalateOn: ALL_FLAGS,
  // The agent never decides. It suggests, the human decides, and when they
  // disagree that's an "overturn" (primary quality metric). First match wins.
  recommendation: [
    { when: ["duplicate_image", "description_mismatch", "not_a_vehicle", "stock_or_screenshot"], then: "deny" },
    { when: ["unreadable_documents", "analysis_incomplete", "conversation_stalled", "low_confidence", "vlm_ml_disagreement"], then: "more_info" },
  ] as { when: TriageFlag[]; then: Recommendation }[],
  defaultRecommendation: "approve" as Recommendation,
};

export type TriageConfig = typeof TRIAGE_CONFIG;

export type VlmSignal = {
  is_vehicle: boolean;
  matches_description: boolean;
  confidence: number;
};

export type TriageInput = {
  vlm: VlmSignal | null;                  // null => analysis failed / skipped
  claimedAmountCents: number | null;
  flags: TriageFlag[];                    // already-computed flags (fraud, docs, conversation, cross-check)
};

export type TriageResult = {
  priority: Priority;
  recommendation: Recommendation;
  flags: TriageFlag[];
  reasons: string[];
  configVersion: string;
};

export function evaluateTriage(
  input: TriageInput,
  config: TriageConfig = TRIAGE_CONFIG,
): TriageResult {
  const flags = new Set<TriageFlag>(input.flags);

  if (input.vlm) {
    if (input.vlm.confidence < config.minConfidence) flags.add("low_confidence");
    if (!input.vlm.is_vehicle) flags.add("not_a_vehicle");
    // Only a mismatch if it IS a vehicle; otherwise not_a_vehicle says it all.
    else if (!input.vlm.matches_description) flags.add("description_mismatch");
  } else {
    flags.add("analysis_incomplete");
  }

  if ((input.claimedAmountCents ?? 0) > config.amountThresholdCents) {
    flags.add("amount_above_threshold");
  }

  // Stable order (config order) so assessments diff cleanly.
  const ordered = ALL_FLAGS.filter((f) => flags.has(f));
  const escalate = ordered.some((f) => config.escalateOn.includes(f));
  const rule = config.recommendation.find((r) => r.when.some((f) => flags.has(f)));

  return {
    priority: escalate ? "priority" : "standard",
    recommendation: rule?.then ?? config.defaultRecommendation,
    flags: ordered,
    reasons: ordered.map((f) => FLAGS[f].label),
    configVersion: config.version,
  };
}
