import { z } from "zod";

export const createPolicySchema = z.object({
  vehicle: z.object({
    make: z.string().min(1),
    model: z.string().min(1),
    year: z.number().int().min(1900).max(new Date().getFullYear() + 1),
    registration: z.string().min(1),
    declaredValueCents: z.number().int().positive(),
  }),
  planType: z.enum(["third_party", "comprehensive", "comprehensive_plus"]),
});

export type CreatePolicyInput = z.infer<typeof createPolicySchema>;

export const createClaimSchema = z.object({
  policyId: z.uuid(),
});
export type CreateClaimInput = z.infer<typeof createClaimSchema>;

export const sendMessageSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const DOCUMENT_TYPES = ["damage_photo", "license", "registration", "other"] as const;
export const uploadDocumentsSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
});
export type UploadDocumentsInput = z.infer<typeof uploadDocumentsSchema>;

export const DECISIONS = ["approved", "denied", "more_info"] as const;
export type Decision = (typeof DECISIONS)[number];
export const reviewDecisionSchema = z
  .object({
    decision: z.enum(DECISIONS),
    notes: z.string().trim().max(2000).optional(),
  })
  // Asking for more info without saying what is useless to the customer.
  .refine((d) => d.decision !== "more_info" || (d.notes?.length ?? 0) > 0, {
    message: "notes are required when requesting more info",
    path: ["notes"],
  });
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;
