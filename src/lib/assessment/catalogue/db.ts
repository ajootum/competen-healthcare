/* eslint-disable @typescript-eslint/no-explicit-any */
import type { createAdminClient } from "@/lib/supabase/server";

/**
 * The service role client the HQ gate hands to a page or route. Every catalogue function takes it as an argument, so
 * the module holds no client of its own and a caller cannot read the catalogue without having passed an HQ gate.
 *
 * THE CATALOGUE READS DEFINITIONS AND CLASSIFICATION ONLY. It never names an instance, response, evidence, outcome or
 * progression table. The plane boundary harness and the assessment core harness both pin that.
 */
export type Admin = ReturnType<typeof createAdminClient>;

/** A failed read or write becomes an Error with the database's own message. A missing read is never an empty list. */
export function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? null) as T;
}

export function mustOk(res: { error: { message: string } | null }, what: string): void {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
}

/** The text of a database refusal, without the function name prefix, for showing to a person. */
export function plainError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^[a-z_ ]+:\s*/i, "").replace(/\s+/g, " ").trim();
}

export type Row = Record<string, any>;
