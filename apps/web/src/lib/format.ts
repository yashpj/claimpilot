import { FLAGS, type TriageFlag } from "@claimpilot/shared";

export const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "—" : `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

export const flagLabel = (f: string) => FLAGS[f as TriageFlag]?.label ?? f;

export const ago = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins}m`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
};

export const usd = (micro: number | null | undefined) =>
  micro === null || micro === undefined ? "—" : `$${(micro / 1_000_000).toFixed(4)}`;
