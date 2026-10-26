import { evaluateTriage, TRIAGE_CONFIG } from "@claimpilot/shared";
import { crossCheck } from "./cross-check";
import { exifDateMismatch, fraudFlags, stockOrScreenshot } from "./fraud";
import { vlmVerdictSchema, type VlmVerdict } from "./vlm";

const vlm = (over: Partial<VlmVerdict> = {}): VlmVerdict => ({
  is_vehicle: true,
  damage_locations: ["rear bumper"],
  severity_estimate: "moderate",
  matches_description: true,
  flags: [],
  confidence: 0.9,
  summary: "",
  ...over,
});

describe("evaluateTriage", () => {
  it("clean claim => standard queue, recommend approve", () => {
    const r = evaluateTriage({
      vlm: vlm(),
      claimedAmountCents: 100_000,
      flags: [],
    });
    expect(r).toMatchObject({
      priority: "standard",
      recommendation: "approve",
      flags: [],
    });
  });

  it("missing VLM verdict => analysis_incomplete, priority, more_info", () => {
    const r = evaluateTriage({
      vlm: null,
      claimedAmountCents: 100_000,
      flags: [],
    });
    expect(r.flags).toEqual(["analysis_incomplete"]);
    expect(r).toMatchObject({
      priority: "priority",
      recommendation: "more_info",
    });
  });

  it.each([
    [{ confidence: 0.3 }, "low_confidence"],
    [{ matches_description: false }, "description_mismatch"],
    [{ is_vehicle: false }, "not_a_vehicle"],
  ])("VLM %o => %s", (over, flag) => {
    const r = evaluateTriage({
      vlm: vlm(over),
      claimedAmountCents: 0,
      flags: [],
    });
    expect(r.flags).toContain(flag);
    expect(r.priority).toBe("priority");
  });

  it("not a vehicle does not also claim a description mismatch", () => {
    const r = evaluateTriage({
      vlm: vlm({ is_vehicle: false, matches_description: false }),
      claimedAmountCents: 0,
      flags: [],
    });
    expect(r.flags).not.toContain("description_mismatch");
  });

  it("amount threshold is strict >", () => {
    const at = evaluateTriage({
      vlm: vlm(),
      claimedAmountCents: TRIAGE_CONFIG.amountThresholdCents,
      flags: [],
    });
    const above = evaluateTriage({
      vlm: vlm(),
      claimedAmountCents: TRIAGE_CONFIG.amountThresholdCents + 1,
      flags: [],
    });
    expect(at.priority).toBe("standard");
    expect(above.flags).toEqual(["amount_above_threshold"]);
    // Escalated for size, but nothing suspicious: still recommend approve.
    expect(above.recommendation).toBe("approve");
  });

  it("deny rules win over more_info rules", () => {
    const r = evaluateTriage({
      vlm: null,
      claimedAmountCents: 0,
      flags: ["duplicate_image"],
    });
    expect(r.recommendation).toBe("deny");
  });

  it("config is data: removing a flag from escalateOn de-escalates", () => {
    const config = { ...TRIAGE_CONFIG, escalateOn: [] };
    const r = evaluateTriage(
      { vlm: vlm(), claimedAmountCents: 10_000_000, flags: [] },
      config,
    );
    expect(r.priority).toBe("standard");
  });
});

describe("crossCheck", () => {
  const det = (confidence: number) => ({
    class: "dent",
    confidence,
    bbox: [0, 0, 1, 1],
  });

  it("agrees when both see damage", () => {
    expect(crossCheck(vlm(), [[det(0.8)]], 0.4).agree).toBe(true);
  });
  it("disagrees when VLM sees damage and detector finds nothing confident", () => {
    const c = crossCheck(vlm(), [[det(0.2)]], 0.4);
    expect(c).toMatchObject({
      agree: false,
      vlmSeesDamage: true,
      mlSeesDamage: false,
    });
  });
  it("disagrees when detector sees damage but VLM says none", () => {
    const c = crossCheck(
      vlm({ severity_estimate: "none", damage_locations: [] }),
      [[], [det(0.9)]],
      0.4,
    );
    expect(c.agree).toBe(false);
  });
});

describe("fraud rules", () => {
  const incident = new Date("2026-10-01T12:00:00Z");
  it("EXIF within window is fine, far away flags, missing EXIF never flags", () => {
    expect(exifDateMismatch([new Date("2026-10-03")], incident, 7)).toBe(false);
    expect(exifDateMismatch([new Date("2025-01-01")], incident, 7)).toBe(true);
    expect(exifDateMismatch([null, null], incident, 7)).toBe(false);
  });
  it("stock/screenshot comes from VLM flags", () => {
    expect(stockOrScreenshot(vlm({ flags: ["screenshot"] }))).toBe(true);
    expect(stockOrScreenshot(vlm({ flags: ["image_unclear"] }))).toBe(false);
    expect(stockOrScreenshot(null)).toBe(false);
  });
  it("maps booleans to flags", () => {
    expect(
      fraudFlags({
        duplicate: true,
        exifMismatch: false,
        stockOrScreenshot: true,
      }),
    ).toEqual(["duplicate_image", "stock_or_screenshot"]);
  });
});

describe("vlmVerdictSchema (never trust model output)", () => {
  it("normalises case and defaults summary", () => {
    const v = vlmVerdictSchema.parse({
      is_vehicle: true,
      damage_locations: [],
      severity_estimate: "Moderate",
      matches_description: true,
      flags: ["Screenshot"],
      confidence: 0.5,
    });
    expect(v.severity_estimate).toBe("moderate");
    expect(v.flags).toEqual(["screenshot"]);
    expect(v.summary).toBe("");
  });
  it("rejects out-of-range confidence and wrong types", () => {
    expect(
      vlmVerdictSchema.safeParse({ ...vlm(), confidence: 7 }).success,
    ).toBe(false);
    expect(
      vlmVerdictSchema.safeParse({ ...vlm(), is_vehicle: "yes" }).success,
    ).toBe(false);
  });
});
