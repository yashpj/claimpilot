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