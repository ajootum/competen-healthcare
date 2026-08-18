/**
 * CPR-PD-010 §11 — DECISIONS AND APPROVALS, ACCEPTANCE.
 *
 *   S  structural: no in_effect column, so a conditional approval cannot be flagged into force
 *   E  in-effect is derived, and a conditional decision comes into force when its LAST condition is met
 *   M  §19 maker/checker: the decider is not the submitter
 *   G  §20: a decided decision cannot be re-decided in place
 *   R  emergency approvals are identified and their retrospective review is trackable
 *   Z  nothing this run created survives
 *
 * ⚠ E3 IS THE ONE THIS MODEL EXISTS FOR. A conditional approval with one unmet before-effect condition
 * must read NOT in force; meet the condition and it must read in force, with nothing having been
 * updated on the decision itself. "Approved subject to a penetration test" is not an approval until the
 * test happens, and an in_effect boolean set at decision time says it is for ever.
 *
 *   npx --yes tsx scripts/gov-decisions-harness.ts
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

const FIXTURE = "PD010-DEC";
const made: string[] = [];
let cleanupError: string | null = null;

async function cleanup() {
  for (const id of made) {
    const d = await admin.from("gov_decision").delete().eq("decision_id", id);
    if (d.error) cleanupError = String(d.error.message).slice(0, 70);
  }
  made.length = 0;
}

async function mustReject(table: string, row: Record<string, unknown>, pk: string) {
  const res = await admin.from(table).insert(row).select(pk).limit(1);
  if (res.error) return { rejected: true, message: String(res.error.message).slice(0, 70) };
  if (res.data?.[0]?.[pk]) await admin.from(table).delete().eq(pk, res.data[0][pk]);
  return { rejected: false, message: "the write was ACCEPTED" };
}

const live = async (id: string) =>
  (await admin.from("gov_decision_live")
    .select("is_in_effect, unmet_before_effect, unmet_after_effect, retrospective_review_outstanding, outcome")
    .eq("decision_id", id).limit(1)).data?.[0];

async function main() {
  console.log("\nCPR-PD-010 §11 — DECISIONS AND APPROVALS\n");

  const probe = await admin.from("gov_decision").select("decision_id").limit(1);
  if (probe.error) {
    console.log(`  ---- MIGRATION 324 IS NOT APPLIED ---- (${String(probe.error.message).slice(0, 60)})\n`);
    console.log("NOT READY  0 passed, 0 failed\n");
    process.exit(2);
  }

  // ── S · structural ───────────────────────────────────────────────────────
  //
  // ⚠ COMMENTS STRIPPED FIRST. Twice in one day a structural pin matched the prose arguing against the
  // thing it forbids, and this migration's header says "the decision carries no in_effect" in words.
  const rawSql = readdirSync("supabase/migrations").filter(f => f.startsWith("324-"))
    .map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
  const sql = rawSql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");
  const occurrences = (t: string, w: RegExp) => (t.match(w) ?? []).length;

  ok("S1", !/in_effect\s+boolean/.test(sql),
    "⚠ §11: gov_decision declares NO in_effect column — a conditional approval cannot be flagged into force at decision time");
  ok("S1c", occurrences(rawSql, /in_effect/g) > occurrences(sql, /in_effect/g),
    `control: the phrase appears ${occurrences(rawSql, /in_effect/g)} times in the file and ${occurrences(sql, /in_effect/g)} after stripping, so S1 read DDL rather than commentary`);

  try {
    // ── M · maker/checker ──────────────────────────────────────────────────
    const selfDecide = await mustReject("gov_decision", {
      reference: `${FIXTURE}-001`, title: "Self-decided", request: "Ship it",
      submitted_by: "Product Director", outcome: "approved",
      decided_by: "product director", decided_at: new Date().toISOString(),
    }, "decision_id");
    ok("M1", selfDecide.rejected,
      `⚠ §19 maker/checker: the submitter cannot decide their own request, case-insensitively — ${selfDecide.message}`);

    const noRationale = await mustReject("gov_decision", {
      reference: `${FIXTURE}-002`, title: "Silent rejection", request: "x",
      submitted_by: "A", outcome: "rejected", decided_by: "B", decided_at: new Date().toISOString(),
    }, "decision_id");
    ok("M2", noRationale.rejected,
      `§11: a REJECTED decision with no rationale is refused — accountable reasoning is what makes it reviewable — ${noRationale.message}`);

    const approvedNoRationale = await admin.from("gov_decision").insert({
      reference: `${FIXTURE}-003`, title: "Plain approval", request: "x",
      submitted_by: "A", outcome: "approved", decided_by: "B", decided_at: new Date().toISOString(),
    }).select("decision_id").limit(1);
    if (approvedNoRationale.data?.[0]?.decision_id) made.push(approvedNoRationale.data[0].decision_id);
    ok("M3", !approvedNoRationale.error,
      "control: a plain APPROVAL needs no rationale — M2 constrains adverse and conditional outcomes, not every decision");

    // ── E · the conditional lifecycle ──────────────────────────────────────
    const cond = await admin.from("gov_decision").insert({
      reference: `${FIXTURE}-004`, title: "Conditional approval", request: "Enable the new booking rule",
      submitted_by: "Product Director", outcome: "pending",
    }).select("decision_id").limit(1);
    const condId = cond.data?.[0]?.decision_id ?? null;
    if (condId) made.push(condId);
    ok("E1", !!condId, `a pending decision records — ${cond.error ? String(cond.error.message).slice(0, 50) : "created"}`);

    // conditional with NO conditions is refused
    const bareConditional = await admin.from("gov_decision")
      .update({ outcome: "conditional", decided_by: "Chief Executive", decided_at: new Date().toISOString(), rationale: "Subject to a test." })
      .eq("decision_id", condId);
    ok("E2", !!bareConditional.error,
      `⚠ §11: CONDITIONAL with no conditions recorded is refused — it is an approval described with a safer word — ${String(bareConditional.error?.message ?? "ACCEPTED").slice(0, 55)}`);

    // add a before-effect condition, then decide conditionally
    const c1 = await admin.from("gov_decision_condition").insert({
      decision_id: condId, requirement: "Penetration test passed", timing: "before_effect",
      owner_name: "Security",
    }).select("condition_id").limit(1);
    const conditionId = c1.data?.[0]?.condition_id ?? null;
    await admin.from("gov_decision_condition").insert({
      decision_id: condId, requirement: "Runbook updated", timing: "after_effect", owner_name: "Ops",
    });

    const decideCond = await admin.from("gov_decision")
      .update({ outcome: "conditional", decided_by: "Chief Executive", decided_at: new Date().toISOString(), rationale: "Approved subject to the security test." })
      .eq("decision_id", condId);
    ok("E2c", !decideCond.error,
      `control: with a condition recorded it DOES decide conditionally — ${String(decideCond.error?.message ?? "decided").slice(0, 45)}`);

    let v = await live(condId);
    ok("E3", v?.is_in_effect === false && v?.unmet_before_effect === 1,
      `⚠⚠ §11: a conditional approval with an unmet BEFORE-EFFECT condition is NOT in force — outcome is "${v?.outcome}" and in-effect is ${v?.is_in_effect}`);

    // meet it — and change NOTHING on the decision itself
    await admin.from("gov_decision_condition").update({
      is_met: true, met_at: new Date().toISOString(), met_by: "Security",
      evidence: "Report 2026-08-18",
    }).eq("condition_id", conditionId);

    v = await live(condId);
    ok("E4", v?.is_in_effect === true && v?.unmet_before_effect === 0,
      "⚠ CONTROL — meeting the last before-effect condition brings it into force, with NOTHING updated on the decision row itself");

    ok("E5", v?.unmet_after_effect === 1,
      "and the AFTER-effect condition is still outstanding without blocking effect — §11 separates the two timings for exactly this");

    // ── G · no silent rewrite ──────────────────────────────────────────────
    const flip = await admin.from("gov_decision").update({ outcome: "rejected" }).eq("decision_id", condId);
    ok("G1", !!flip.error,
      `⚠ §20: re-deciding a decided decision in place is refused — a reversal is a NEW decision naming the one it supersedes — ${String(flip.error?.message ?? "ACCEPTED").slice(0, 55)}`);

    const supersede = await admin.from("gov_decision").insert({
      reference: `${FIXTURE}-005`, title: "Reversal", request: "Withdraw the booking rule",
      submitted_by: "Product Director", outcome: "approved",
      decided_by: "Chief Executive", decided_at: new Date().toISOString(),
      supersedes_decision_id: condId,
    }).select("decision_id").limit(1);
    if (supersede.data?.[0]?.decision_id) made.push(supersede.data[0].decision_id);
    ok("G2", !supersede.error,
      `control: a superseding decision IS accepted — so the original decision and its rationale survive — ${String(supersede.error?.message ?? "created").slice(0, 45)}`);

    // ── R · emergency approvals ────────────────────────────────────────────
    const bareEmergency = await mustReject("gov_decision", {
      reference: `${FIXTURE}-006`, title: "Unexplained emergency", request: "x",
      submitted_by: "A", outcome: "approved", decided_by: "B", decided_at: new Date().toISOString(),
      is_emergency: true,
    }, "decision_id");
    ok("R1", bareEmergency.rejected,
      `§11: an emergency approval with no reason is refused — "clearly identified" means saying why — ${bareEmergency.message}`);

    const emergency = await admin.from("gov_decision").insert({
      reference: `${FIXTURE}-007`, title: "Emergency approval", request: "Disable the failing rule",
      submitted_by: "On-call", outcome: "approved",
      decided_by: "Chief Executive", decided_at: new Date().toISOString(),
      is_emergency: true, emergency_reason: "Live booking failures at three practices.",
      requires_retrospective_review: true,
    }).select("decision_id").limit(1);
    const emergencyId = emergency.data?.[0]?.decision_id ?? null;
    if (emergencyId) made.push(emergencyId);

    v = await live(emergencyId);
    ok("R2", v?.retrospective_review_outstanding === true,
      "⚠ §3: an emergency approval requiring retrospective review reads OUTSTANDING from the moment it is made — no invented deadline, because a threshold typed here would be the target §3 then measures against");

    await admin.from("gov_decision").update({
      retrospective_reviewed_at: new Date().toISOString(), retrospective_reviewed_by: "Governance Review",
      retrospective_outcome: "Upheld.",
    }).eq("decision_id", emergencyId);
    v = await live(emergencyId);
    ok("R3", v?.retrospective_review_outstanding === false,
      "control: recording the review clears it — R2 is not a constant");
  } finally {
    await cleanup();
  }

  // ── Z ────────────────────────────────────────────────────────────────────
  const left = await admin.from("gov_decision").select("decision_id", { count: "exact", head: true })
    .like("reference", `${FIXTURE}%`);
  ok("Z1", !left.error && (left.count ?? 0) === 0, `no fixture decision is left — ${left.count ?? "?"} found`);

  const leftConditions = await admin.from("gov_decision_condition").select("condition_id", { count: "exact", head: true });
  ok("Z2", !leftConditions.error && (leftConditions.count ?? 0) === 0,
    `and no condition survives the cascade — ${leftConditions.count ?? "?"} found`);

  const leftEvents = await admin.from("gov_decision_event").select("event_id", { count: "exact", head: true });
  ok("Z3", !leftEvents.error && (leftEvents.count ?? 0) === 0, `nor any trail event — ${leftEvents.count ?? "?"} found`);

  ok("Z4", cleanupError === null, `control: cleanup reported no error — ${cleanupError ?? "clean"}`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => { await cleanup(); console.error("\nHARNESS CRASHED (fixtures removed):", e); process.exit(1); });
