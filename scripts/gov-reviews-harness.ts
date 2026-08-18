/**
 * CPR-PD-010 §14 — GOVERNANCE REVIEWS, ACCEPTANCE.
 *
 *   O  a review cannot close silently — outputs, or an explicit declaration that none arose
 *   L  outputs are FOREIGN KEYS into records that already exist, never copies
 *   K  a recurring review and a triggered one cannot borrow each other's shape
 *   A  the agenda records what was NOT reached, separately from what was planned
 *   Z  nothing this run created survives
 *
 * ⚠ O1 AND O3 ARE THE PAIR §14 TURNS ON. A review with no linked outputs cannot be closed — and a
 * review that declares "no actions arising" CAN. Both must hold, because the rule is not "every review
 * must produce work". It is that a review which decided nothing and a review whose outputs nobody
 * recorded must not produce identical artefacts.
 *
 *   npx --yes tsx scripts/gov-reviews-harness.ts
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

const FIXTURE = "PD010-REV";
const madeReviews: string[] = [];
const madeRisks: string[] = [];
let cleanupError: string | null = null;

async function cleanup() {
  for (const id of madeReviews) {
    const d = await admin.from("gov_review").delete().eq("review_id", id);
    if (d.error) cleanupError = `review: ${String(d.error.message).slice(0, 60)}`;
  }
  for (const id of madeRisks) {
    const d = await admin.from("gov_product_risk").delete().eq("risk_id", id);
    if (d.error) cleanupError = `risk: ${String(d.error.message).slice(0, 60)}`;
  }
  madeReviews.length = 0; madeRisks.length = 0;
}

async function mustReject(table: string, row: Record<string, unknown>, pk: string) {
  const res = await admin.from(table).insert(row).select(pk).limit(1);
  if (res.error) return { rejected: true, message: String(res.error.message).slice(0, 70) };
  if (res.data?.[0]?.[pk]) await admin.from(table).delete().eq(pk, res.data[0][pk]);
  return { rejected: false, message: "the write was ACCEPTED" };
}

const today = new Date().toISOString().slice(0, 10);

async function main() {
  console.log("\nCPR-PD-010 §14 — GOVERNANCE REVIEWS\n");

  const probe = await admin.from("gov_review").select("review_id").limit(1);
  if (probe.error) {
    console.log(`  ---- MIGRATION 328 IS NOT APPLIED ---- (${String(probe.error.message).slice(0, 60)})\n`);
    console.log("NOT READY  0 passed, 0 failed\n");
    process.exit(2);
  }

  const rawSql = readdirSync("supabase/migrations").filter(f => f.startsWith("328-"))
    .map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
  const sql = rawSql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");

  // ── L · outputs are links, not copies ────────────────────────────────────
  const outputDdl = sql.slice(sql.indexOf("create table if not exists gov_review_output ("),
    sql.indexOf("comment on table gov_review_output "));
  ok("L1", /gov_review_output_one_parent/.test(outputDdl),
    "§14: an output names exactly one existing record — typed parents, on the pattern migration 319 had to introduce");
  ok("L2", !/\b(title|action|decision_text|summary)\s+text/.test(outputDdl),
    "⚠ and it carries NO copy of what it points at — a review's conclusion lives in the register that owns it, so closing the action there closes it everywhere");

  try {
    // ── K · a review's kind determines its shape ───────────────────────────
    const bothShapes = await mustReject("gov_review", {
      reference: `${FIXTURE}-001`, title: "Confused review", review_kind: "recurring",
      cadence: "quarterly", trigger_kind: "sev1_incident",
    }, "review_id");
    ok("K1", bothShapes.rejected,
      `§14/§17: a RECURRING review cannot also claim an event trigger — the two answer different questions about why it happened — ${bothShapes.message}`);

    const triggeredNoTrigger = await mustReject("gov_review", {
      reference: `${FIXTURE}-002`, title: "Triggered by nothing", review_kind: "event_triggered",
    }, "review_id");
    ok("K2", triggeredNoTrigger.rejected,
      `and an EVENT-TRIGGERED review naming no trigger is refused — §17 asks which events cause governance action, and free text cannot answer it later — ${triggeredNoTrigger.message}`);

    // ── O · closing ────────────────────────────────────────────────────────
    const r = await admin.from("gov_review").insert({
      reference: `${FIXTURE}-003`, title: "Quarterly governance review",
      review_kind: "recurring", cadence: "quarterly",
      period_start: "2026-04-01", period_end: "2026-06-30",
      held_on: today, chaired_by: "Chief Executive", state: "held",
    }).select("review_id").limit(1);
    const reviewId = r.data?.[0]?.review_id ?? null;
    if (reviewId) madeReviews.push(reviewId);
    ok("O0", !!reviewId, `a review records — ${r.error ? String(r.error.message).slice(0, 50) : "created"}`);

    const closeEmpty = await admin.from("gov_review")
      .update({ state: "closed", closed_at: new Date().toISOString() }).eq("review_id", reviewId);
    ok("O1", !!closeEmpty.error,
      `⚠⚠ §14: closing a review with NO linked outputs is refused — minutes are not a governance record — ${String(closeEmpty.error?.message ?? "ACCEPTED").slice(0, 60)}`);

    // link a real record as an output
    const risk = await admin.from("gov_product_risk").insert({
      reference: `${FIXTURE}-RSK`, title: "Risk raised at the review", category_code: "operational",
    }).select("risk_id").limit(1);
    const riskId = risk.data?.[0]?.risk_id ?? null;
    if (riskId) madeRisks.push(riskId);

    const linkOut = await admin.from("gov_review_output").insert({
      review_id: reviewId, risk_id: riskId, note: "Raised and assigned",
    }).select("output_id").limit(1);
    ok("O2a", !linkOut.error, `an output links to a real record — ${String(linkOut.error?.message ?? "linked").slice(0, 45)}`);

    const closeLinked = await admin.from("gov_review")
      .update({ state: "closed", closed_at: new Date().toISOString() }).eq("review_id", reviewId);
    ok("O2", !closeLinked.error,
      `⚠ CONTROL — with a linked output it DOES close, so O1 is about recording outcomes rather than a ban on closing — ${String(closeLinked.error?.message ?? "closed").slice(0, 45)}`);

    // the other legitimate ending
    const quiet = await admin.from("gov_review").insert({
      reference: `${FIXTURE}-004`, title: "Quiet quarter", review_kind: "recurring",
      cadence: "quarterly", held_on: today, state: "closed", closed_at: new Date().toISOString(),
      no_actions_arising: true,
      no_actions_rationale: "Risk posture unchanged, no overdue actions, no findings raised.",
    }).select("review_id").limit(1);
    if (quiet.data?.[0]?.review_id) madeReviews.push(quiet.data[0].review_id);
    ok("O3", !quiet.error,
      `⚠⚠ and a review declaring NO ACTIONS ARISING closes cleanly — concluding nothing is a legitimate outcome, concluding nothing SILENTLY is not — ${String(quiet.error?.message ?? "closed").slice(0, 45)}`);

    const quietNoReason = await mustReject("gov_review", {
      reference: `${FIXTURE}-005`, title: "Silently quiet", review_kind: "recurring",
      cadence: "quarterly", held_on: today, state: "closed", closed_at: new Date().toISOString(),
      no_actions_arising: true,
    }, "review_id");
    ok("O4", quietNoReason.rejected,
      `§14: declaring no actions arising without a rationale is refused — it is a conclusion, so it carries reasoning — ${quietNoReason.message}`);

    // and the declaration must be true
    const lying = await admin.from("gov_review")
      .update({ no_actions_arising: true, no_actions_rationale: "Nothing arose." })
      .eq("review_id", reviewId);
    ok("O5", !!lying.error,
      `⚠ a CLOSED review with linked outputs cannot then claim nothing arose — the declaration is checked against the records, not trusted — ${String(lying.error?.message ?? "ACCEPTED").slice(0, 55)}`);

    // ── A · the agenda records what was not reached ────────────────────────
    const item = await admin.from("gov_review_agenda_item").insert({
      review_id: reviewId, topic: "control_effectiveness", was_reviewed: false,
      not_reached_reason: "Ran out of time, carried to next quarter.",
    }).select("item_id").limit(1);
    ok("A1", !item.error,
      "⚠ §14: an agenda item can record that it was NOT reached, with a reason — an item tabled three times and never discussed is a governance signal a merged field would erase");

    const attendee = await mustReject("gov_review_attendee", {
      review_id: reviewId, person_name: "Somebody", attended: true, apology: true,
    }, "attendee_id");
    ok("A2", attendee.rejected, `somebody cannot both attend and send apologies — ${attendee.message}`);
  } finally {
    await cleanup();
  }

  // ── Z ────────────────────────────────────────────────────────────────────
  const leftReviews = await admin.from("gov_review").select("review_id", { count: "exact", head: true })
    .like("reference", `${FIXTURE}%`);
  ok("Z1", !leftReviews.error && (leftReviews.count ?? 0) === 0, `no fixture review is left — ${leftReviews.count ?? "?"} found`);

  const leftOutputs = await admin.from("gov_review_output").select("output_id", { count: "exact", head: true });
  ok("Z2", !leftOutputs.error && (leftOutputs.count ?? 0) === 0,
    `⚠ and no output row survives — it cascades from BOTH sides, so neither deleting the review nor the record it pointed at strands one — ${leftOutputs.count ?? "?"} found`);

  const leftAgenda = await admin.from("gov_review_agenda_item").select("item_id", { count: "exact", head: true });
  ok("Z3", !leftAgenda.error && (leftAgenda.count ?? 0) === 0, `nor any agenda item — ${leftAgenda.count ?? "?"} found`);

  ok("Z4", cleanupError === null, `control: cleanup reported no error — ${cleanupError ?? "clean"}`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => { await cleanup(); console.error("\nHARNESS CRASHED (fixtures removed):", e); process.exit(1); });
