/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * EMAIL SYNC RECONCILIATION -- a READ-ONLY count of profiles whose email differs from the confirmed Auth
 * email (migration 381, owner review item 6).
 *
 *   npx tsx scripts/email-sync-reconcile.ts                       staging (or any non-production target)
 *   COMPETEN_PRODUCTION_READ_GO=<named GO> npx tsx scripts/email-sync-reconcile.ts --production
 *                                                                 production, only with --production AND a
 *                                                                 named owner GO (productionReadDecision, R13)
 *
 * ⚠ IT WRITES NOTHING. Two reads: the Auth user list and profiles(id, email). It prints COUNTS and profile
 * IDS only -- never an email address -- so its output can be pasted into a build record or a chat.
 *
 * What it counts, for CONFIRMED Auth accounts only (email_confirmed_at set), which is exactly the set 381
 * keeps in step:
 *   mismatched        profiles.email differs from auth.users.email (including a profile with no email)
 *   missingProfile    a confirmed Auth user with no profiles row
 * and, for context, unconfirmed accounts (381 never copies them) and pending changes (new_email set).
 *
 * Use it before deciding on a one-time backfill for production (381 itself does none), and after 381 is
 * applied, where every NEW confirmed change keeps the count from growing.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { productionReadDecision, refOf } from "./production-guard";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const decision = productionReadDecision(url);
if (!decision.allowed) {
  console.error(decision.reason === "NOT_AUTHORISED"
    ? "REFUSING: this is PRODUCTION. Pass --production and set COMPETEN_PRODUCTION_READ_GO to the named owner GO."
    : "REFUSING: the target does not identify a Supabase project.");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

async function allAuthUsers() {
  const out: any[] = [];
  for (let page = 1; page <= 200; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`auth list failed: ${error.message}`);
    const users = data?.users ?? [];
    out.push(...users);
    if (users.length < 1000) return out;
  }
  throw new Error("more than 200,000 auth users -- refusing to guess");
}

async function main() {
  console.log(`EMAIL SYNC RECONCILIATION (read-only) -- target ${refOf(url)}${decision.allowed && decision.production ? ` -- PRODUCTION under GO "${decision.go}"` : ""}\n`);
  const users = await allAuthUsers();
  const ids = users.map(u => u.id);
  const profiles = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await admin.from("profiles").select("id, email").in("id", ids.slice(i, i + 500));
    if (error) throw new Error(`profiles read failed: ${error.message}`);
    for (const p of data ?? []) profiles.set(p.id, p.email ?? null);
  }
  const confirmed = users.filter(u => !!u.email_confirmed_at);
  const mismatched = confirmed.filter(u => profiles.has(u.id) && (profiles.get(u.id) ?? null) !== (u.email ?? null)).map(u => u.id);
  const missingProfile = confirmed.filter(u => !profiles.has(u.id)).map(u => u.id);
  const unconfirmed = users.length - confirmed.length;
  const pending = users.filter(u => !!u.new_email).length;

  console.log(JSON.stringify({
    authUsers: users.length, confirmed: confirmed.length, unconfirmed, pendingChanges: pending,
    mismatched: mismatched.length, missingProfile: missingProfile.length,
    mismatchedIds: mismatched, missingProfileIds: missingProfile,
  }, null, 1));
  console.log(`\n${mismatched.length === 0 ? "IN STEP" : "MISMATCHES FOUND"} -- ${mismatched.length} confirmed account(s) whose profiles.email differs from Auth. Ids only; no address printed.`);
}

main().catch(e => { console.error(e?.message ?? e); process.exit(1); });
