// Drizzle wraps driver errors: the Postgres SQLSTATE ("23505" unique
// violation, "23503" FK violation) may be on err.code or on err.cause.code.
export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}
