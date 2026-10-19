import { z } from "zod";

export const DOC_EXTRACTION_PROMPT_VERSION = "doc-extract-v1";

const nullableString = z.string().nullable().default(null);

export const docExtractionSchema = z.object({
  license: z.object({
    readable: z.boolean(),
    full_name: nullableString,
    license_number: nullableString,
    expiry_date: nullableString,
  }),
  registration: z.object({
    readable: z.boolean(),
    registration_number: nullableString,
    make: nullableString,
    model: nullableString,
  }),
});

export type DocExtraction =
  | ({ status: "complete" } & z.infer<typeof docExtractionSchema>)
  | { status: "failed"; error: string };

export const DOC_EXTRACTION_SYSTEM = [
  "You extract fields from identity documents for an insurance claim.",
  "Image 1 is a driver's license. Image 2 is a vehicle registration.",
  "Return JSON with exactly this shape:",
  '{"license": {"readable": boolean, "full_name": string|null, "license_number": string|null, "expiry_date": "YYYY-MM-DD"|null},',
  ' "registration": {"readable": boolean, "registration_number": string|null, "make": string|null, "model": string|null}}',
  'Set "readable" to false if the image is not that document, is too blurry, or key fields cannot be read.',
  "Never guess a value you cannot read; use null.",
].join("\n");

export function isUnreadable(x: DocExtraction | null): boolean {
  return (
    x?.status === "complete" &&
    (!x.license.readable || !x.registration.readable)
  );
}
