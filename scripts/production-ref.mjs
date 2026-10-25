/**
 * THE PRODUCTION PROJECT REF, for the .mjs launchers (dev-staging.mjs, smoke-staging.mjs).
 *
 * ⚠ ONE SOURCE. The ref is the constant PRODUCTION_REF in scripts/production-guard.ts, the judge every TypeScript
 * guard uses. A .mjs file cannot import TypeScript, so this READS that constant from the file rather than keeping a
 * second copy that could drift.
 *
 * ⚠ WHY IT EXISTS (25 October 2026). Both launchers used to take "production" to mean whatever NEXT_PUBLIC_SUPABASE_URL
 * named in .env.local. Since 23 October .env.local names STAGING, so they compared staging with itself and refused
 * with a false "resolves to PRODUCTION" alarm. The schema check had the same defect and was fixed the same way.
 *
 * FAILS CLOSED: if the constant cannot be read, it throws, and the launcher refuses to start.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function productionRef() {
  const file = join(dirname(fileURLToPath(import.meta.url)), "production-guard.ts");
  const m = /export const PRODUCTION_REF\s*=\s*"([a-z0-9]{20})"/.exec(readFileSync(file, "utf8"));
  if (!m) throw new Error(`could not read PRODUCTION_REF from ${file}: refusing to start`);
  return m[1];
}
