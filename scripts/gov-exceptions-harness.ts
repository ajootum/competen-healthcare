/**
 * CPR-PD-010 §12 — EXCEPTIONS AND RISK ACCEPTANCE, ACCEPTANCE.
 *
 *   S  structural: no is_active flag, so "expired but still on" is unrepresentable
 *   E  expiry is derived, and an expired exception reads expired without anything having run
 *   A  §19's segregation of duties: the approver is not the requester
 *   R  renewal is a new record, never an extended expiry
 *   Z  nothing this run created survives
 *
 * ⚠ E2 IS THE ONE THIS MODULE EXISTS FOR. Backdate an approved exception past its expiry and read it
 * again: it must report expired WITHOUT any job, cron or update having touched it. That is the whole
 * difference between an expiry that holds and a flag somebody meant to clear.
 *
 *   npx --yes tsx scripts/gov-exceptions-harness.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
/* eslint-disable @typescript-eslint/no-explicit-any */
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};

const FIXTURE = "PD010-EXC";
const made: string[] = [];
let cleanupError: string | null = null;

async function cleanup() {
  for (const id of made) {
    const d = await admin.from("gov_exception").delete().eq("exception_id", id);
    if (d.error) cleanupError = String(d.error.message).slice(0, 70);
  }
  made.length = 0;
}

async function mustReject(table: string, row: Record<string, unknown>, pk: string) {
  const res = await admin.from(table).insert(row).select(pk).limit(1);
  if (res.error) return { rejected: true, message: String(res.error.message).slice(0, 66) };
  if (res.data?.[0]?.[pk]) await admin.from(table).delete().eq(pk, res.data[0][pk]);
  return { rejected: false, message: "the write was ACCEPTED" };
}

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function main() {
  console.log("\nCPR-PD-010 §12 — EXCEPTIONS AND RISK ACCEPTANCE\n");

  const probe = await admin.from("gov_exception").select("exception_id").limit(1);
  if (probe.error) {
    console.log(`  ---- MIGRATION 323 IS NOT APPLIED ---- (${String(probe.error.message).slice(0, 60)})\n`);
    console.log("NOT READY  0 passed, 0 failed\n");
    process.exit(2);
  }

  // ── S · structural ───────────────────────────────────────────────────────
  const rawSql = readdirSync("supabase/migrations").filter(f => f.startsWith("323-"))
    .map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
  //
  // ⚠ SQL COMMENTS STRIPPED, AND THE FIRST VERSION DID NOT DO IT — so S1 failed on the migration's own
  // explanation, which contains the sentence "an is_active boolean is exactly how they do". That is the
  // SECOND time today a structural pin matched the prose arguing against the thing it forbids (the
  // first was in the evidence-gate harness). The class is recorded; the lesson evidently is that it
  // applies to every language a harness reads, not just the one it is written in.
  const sql = rawSql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");

  ok("S1", !/is_active\s+boolean/.test(sql),
    "⚠ §12: gov_exception declares NO is_active column — an expired exception cannot stay switched on because there is no switch");
  //
  // ⚠ COUNTS, NOT ABSENCE — and the first version of THIS control was wrong too. It asserted the word
  // vanishes entirely from the stripped text, and it does not: `comment on table ... is '...'` is a SQL
  // STATEMENT carrying a string literal, not a line comment, and the table's own comment says "Carries
  // NO is_active flag". So the word legitimately survives, in a place that is neither DDL nor prose the
  // stripper owns. Asserting that stripping REMOVED SOME is the claim that is actually true.
  const occurrences = (t: string) => (t.match(/is_active/g) ?? []).length;
  ok("S1c", occurrences(rawSql) > occurrences(sql) && occurrences(rawSql) > 0,
    `control: the phrase appears ${occurrences(rawSql)} times in the file and ${occurrences(sql)} after stripping, so S1 read past the commentary rather than matching it`);
  ok("S2", /expires_on\s+date not null/.test(sql),
    "and expires_on is NOT NULL — a permanent exception is not an exception, it is an undocumented change of policy");

  try {
    // ── E · derived expiry ─────────────────────────────────────────────────
    const live = await admin.from("gov_exception").insert({
      reference: `${FIXTURE}-001`, kind: "exception", title: "Acceptance exception",
      scope: "One booking rule", reason: "Vendor fix pending",
      requested_by: "Product Director", status: "approved",
      approved_by: "Chief Executive", approved_at: new Date().toISOString(),
      approval_authority: "Chief Executive",
      starts_on: day(-1), expires_on: day(30),
    }).select("exception_id").limit(1);
    const liveId = live.data?.[0]?.exception_id ?? null;
    if (liveId) made.push(liveId);
    ok("E1", !!liveId, `an approved exception records — ${live.error ? String(live.error.message).slice(0, 50) : "created"}`);

    const liveView = await admin.from("gov_exception_live").select("is_live, is_expired, days_to_expiry").eq("exception_id", liveId).limit(1);
    ok("E1b", liveView.data?.[0]?.is_live === true && liveView.data?.[0]?.is_expired === false,
      `it reads LIVE with ${liveView.data?.[0]?.days_to_expiry} days to expiry`);

    // ⚠ THE HEADLINE. An exception whose window has passed, with nothing having run.
    const stale = await admin.from("gov_exception").insert({
      reference: `${FIXTURE}-002`, kind: "waiver", title: "Lapsed waiver",
      scope: "A control", reason: "Was meant to be temporary",
      requested_by: "Product Director", status: "approved",
      approved_by: "Chief Executive", approved_at: new Date(Date.now() - 90 * 86_400_000).toISOString(),
      starts_on: day(-60), expires_on: day(-30),
    }).select("exception_id").limit(1);
    const staleId = stale.data?.[0]?.exception_id ?? null;
    if (staleId) made.push(staleId);

    const staleView = await admin.from("gov_exception_live").select("is_live, is_expired, status").eq("exception_id", staleId).limit(1);
    ok("E2", staleView.data?.[0]?.is_expired === true && staleView.data?.[0]?.is_live === false,
      `⚠⚠ §12: an exception 30 days past its expiry reads EXPIRED and NOT live — with no job, cron or update having touched it. Its status column still says "${staleView.data?.[0]?.status}"`);

    ok("E3", staleView.data?.[0]?.status === "approved",
      "⚠ and that is the point: the row is still APPROVED. Approval is a historical fact, being in force is a question about today, and conflating them is what an is_active flag does");

    // ── A · §19's segregation of duties ────────────────────────────────────
    const selfApprove = await mustReject("gov_exception", {
      reference: `${FIXTURE}-003`, kind: "exception", title: "Self-approved",
      scope: "x", reason: "y", requested_by: "Product Director", status: "approved",
      approved_by: "product director", approved_at: new Date().toISOString(),
      expires_on: day(10),
    }, "exception_id");
    ok("A1", selfApprove.rejected,
      `⚠ §19: the requester cannot approve their own exception, case-insensitively — ${selfApprove.message}`);

    const noExpiry = await mustReject("gov_exception", {
      reference: `${FIXTURE}-004`, kind: "exception", title: "Forever",
      scope: "x", reason: "y", requested_by: "A", status: "requested",
    }, "exception_id");
    ok("A2", noExpiry.rejected, `§12: an exception with no expiry is refused — ${noExpiry.message}`);

    const acceptanceNoAssessment = await mustReject("gov_exception", {
      reference: `${FIXTURE}-005`, kind: "risk_acceptance", title: "Generic acceptance",
      scope: "x", reason: "y", requested_by: "A", status: "requested", expires_on: day(10),
    }, "exception_id");
    ok("A3", acceptanceNoAssessment.rejected,
      `⚠ §12: a RISK ACCEPTANCE naming no assessment is refused — it must accept a specific measured residual, not grant a general permission to ignore controls — ${acceptanceNoAssessment.message}`);

    const plainException = await admin.from("gov_exception").insert({
      reference: `${FIXTURE}-006`, kind: "exception", title: "Control exception",
      scope: "x", reason: "y", requested_by: "A", status: "requested", expires_on: day(10),
    }).select("exception_id").limit(1);
    if (plainException.data?.[0]?.exception_id) made.push(plainException.data[0].exception_id);
    ok("A4", !plainException.error,
      "control: a plain EXCEPTION needs no assessment — A3 constrains risk acceptance specifically, not every record");

    // ── R · renewal ────────────────────────────────────────────────────────
    const extend = await admin.from("gov_exception")
      .update({ expires_on: day(365) }).eq("exception_id", liveId);
    ok("R1", !!extend.error,
      `⚠ §12: extending an approved exception's expiry IN PLACE is refused — renewal without reassessment or new approval is the quiet path this rule closes — ${String(extend.error?.message ?? "ACCEPTED").slice(0, 55)}`);

    const renewal = await admin.from("gov_exception").insert({
      reference: `${FIXTURE}-007`, kind: "exception", title: "Acceptance exception (renewed)",
      scope: "One booking rule", reason: "Vendor fix still pending",
      requested_by: "Product Director", status: "approved",
      approved_by: "Chief Executive", approved_at: new Date().toISOString(),
      starts_on: day(0), expires_on: day(60), renews_exception_id: liveId,
    }).select("exception_id").limit(1);
    if (renewal.data?.[0]?.exception_id) made.push(renewal.data[0].exception_id);
    ok("R2", !renewal.error,
      `control: a renewal IS accepted as a NEW record pointing back — so the prior approval and its window survive — ${String(renewal.error?.message ?? "created").slice(0, 45)}`);

    const priorStillThere = await admin.from("gov_exception").select("expires_on").eq("exception_id", liveId).limit(1);
    ok("R3", priorStillThere.data?.[0]?.expires_on === day(30),
      "⚠ and the ORIGINAL still carries its original expiry — history preserved rather than overwritten");
  } finally {
    await cleanup();
  }

  // ── Z ────────────────────────────────────────────────────────────────────
  const left = await admin.from("gov_exception").select("exception_id", { count: "exact", head: true })
    .like("reference", `${FIXTURE}%`);
  ok("Z1", !left.error && (left.count ?? 0) === 0, `no fixture exception is left — ${left.count ?? "?"} found`);

  const leftEvents = await admin.from("gov_exception_event").select("event_id", { count: "exact", head: true });
  ok("Z2", !leftEvents.error && (leftEvents.count ?? 0) === 0,
    `and no lifecycle event survives the cascade — ${leftEvents.count ?? "?"} found`);

  ok("Z3", cleanupError === null, `control: cleanup reported no error — ${cleanupError ?? "clean"}`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => { await cleanup(); console.error("\nHARNESS CRASHED (fixtures removed):", e); process.exit(1); });
