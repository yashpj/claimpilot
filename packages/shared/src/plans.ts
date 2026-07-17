export const PLANS = {
  third_party: {
    name: "Third Party",
    premiumCents: 25_000,
    coverageMonths: 12,
  },
  comprehensive: {
    name: "Comprehensive",
    premiumCents: 60_000,
    coverageMonths: 12,
  },
  comprehensive_plus: {
    name: "Comprehensive Plus",
    premiumCents: 95_000,
    coverageMonths: 12,
  },
} as const;

export type PlanType = keyof typeof PLANS;