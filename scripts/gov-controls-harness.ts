/**
 * CPR-PD-010 §6 — CONTROLS AND ASSURANCE, ACCEPTANCE.
 *
 *   S  structural: the control row carries no effectiveness column
 *   D  effectiveness DERIVES from tests, and absence resolves to Not Assessed / Not Tested
 *   C  each constraint that encodes a rule is proved by a write that fails
 *   Z  nothing this run created survives
 *
 * ⚠ THE ASSERTION THAT MATTERS MOST IS D2. §24: "Not Tested is never represented as Effective." It is
 * easy to write a harness where that passes because nothing was tested at all — so D2 tests a control
 * for DESIGN, leaves it untested for OPERATING, and asserts the two resolve differently. A control that
 * is designed well and has never once run is the exact case the rule exists for, and the exact case a
 * single "unknown" state would hide.
 *
 *   npx --yes tsx scripts/gov-controls-harness.ts
 */
import { readFileSync, readdirSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { loadControls } from "../src/lib/hq/gov-control";

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

const FIXTURE = "PD010-CTL";
const made: string[] = [];
let cleanupError: string | null = null;

async function cleanup() {
  for (const id of made) {
    const d = await admin.from("gov_control").delete().eq("control_id", id);
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

async function main() {
  console.log("\nCPR-PD-010 §6 — CONTROLS AND ASSURANCE\n");

  const probe = await admin.from("gov_control").select("control_id").limit(1);
  if (probe.error) {
    console.log(`  ---- MIGRATION 322 IS NOT APPLIED ---- (${String(probe.error.message).slice(0, 60)})\n`);
    console.log("NOT READY  0 passed, 0 failed\n");
    process.exit(2);
  }

  // ── S · structural ───────────────────────────────────────────────────────
  const sql = readdirSync("supabase/migrations").filter(f => f.startsWith("322-"))
    .map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
  const controlDdl = sql.slice(sql.indexOf("create table if not exists gov_control ("),
    sql.indexOf("comment on table gov_control "));
  ok("S1", !/effectiveness\s+text/.test(controlDdl),
    "⚠ §6/§24: gov_control declares NO effectiveness column — claiming a control works requires inserting a TEST");
  ok("S2", /result\s+text not null check \(result in \('effective', 'partial', 'ineffective'\)\)/.test(sql),
    "control: the RESULT vocabulary exists on the test — and holds no absence value, so 'nobody looked' cannot be stored as an outcome");

  try {
    // ── D · derivation ─────────────────────────────────────────────────────
    const c = await admin.from("gov_control").insert({
      reference: `${FIXTURE}-001`, name: "Acceptance control",
      objective: "Prove derivation", control_type: "preventive", execution: "manual",
      frequency: "quarterly", owner_name: "Product Director",
      evidence_requirement: "A sample of ten records.",
    }).select("control_id").limit(1);
    const controlId = c.data?.[0]?.control_id ?? null;
    if (controlId) made.push(controlId);
    ok("D1", !!controlId, `a control registers — ${c.error ? String(c.error.message).slice(0, 50) : "created"}`);

    let read = await loadControls(admin);
    let mine = read?.rows.find(r => r.controlId === controlId);
    ok("D2a", mine?.designEffectiveness === "not_assessed" && mine?.operatingEffectiveness === "not_tested",
      `⚠ a brand-new control is Not Assessed AND Not Tested — never Effective — got ${mine?.designEffectiveness} / ${mine?.operatingEffectiveness}`);

    // test the DESIGN only, and leave operating untested
    const dt = await admin.from("gov_control_test").insert({
      control_id: controlId, basis: "design", result: "effective",
      method: "Walkthrough", tested_by: "Assurance",
    }).select("test_id").limit(1);
    ok("D2b", !dt.error, `a design test records — ${dt.error ? String(dt.error.message).slice(0, 50) : "recorded"}`);

    read = await loadControls(admin);
    mine = read?.rows.find(r => r.controlId === controlId);
    ok("D2", mine?.designEffectiveness === "effective" && mine?.operatingEffectiveness === "not_tested",
      `⚠⚠ §24: a well-DESIGNED control that has never RUN reads Effective by design and Not Tested by operation — ${mine?.designEffectiveness} / ${mine?.operatingEffectiveness}`);

    ok("D3", read?.assurance.assessed === 0 && (read?.assurance.notTested ?? 0) >= 1,
      `and it counts as NOT assessed — assurance is ${read?.assurance.assessed} of ${read?.assurance.total}, ${read?.assurance.notTested} not tested`);

    ok("D4", read?.assurance.aggregateEffectivenessPct === null,
      "no aggregate effectiveness percentage is produced, even with a real control and a real test");

    // now test operating, adversely
    const ot = await admin.from("gov_control_test").insert({
      control_id: controlId, basis: "operating", result: "partial",
      finding: "Two of ten records lacked the check.", tested_by: "Assurance",
    }).select("test_id").limit(1);
    ok("D5", !ot.error, `an operating test records — ${ot.error ? String(ot.error.message).slice(0, 50) : "recorded"}`);

    read = await loadControls(admin);
    mine = read?.rows.find(r => r.controlId === controlId);
    ok("D6", mine?.operatingEffectiveness === "partial" && mine?.adverse === true,
      `⚠ CONTROL — the derivation MOVES when evidence arrives: operating is now ${mine?.operatingEffectiveness} and flagged adverse. A resolver that only ever said "not tested" would be a constant`);

    // ── C · the constraints ────────────────────────────────────────────────
    const noFinding = await mustReject("gov_control_test", {
      control_id: controlId, basis: "operating", result: "ineffective", tested_by: "Assurance",
    }, "test_id");
    ok("C1", noFinding.rejected,
      `⚠ §6: an ineffective result with no finding is refused — it would say something went wrong and nothing about what — ${noFinding.message}`);

    const okEffective = await admin.from("gov_control_test").insert({
      control_id: controlId, basis: "design", result: "effective", tested_by: "Assurance",
    }).select("test_id").limit(1);
    ok("C2", !okEffective.error,
      "control: an EFFECTIVE result needs no finding — C1 constrains adverse results, not every test");

    // independence, configured per control
    const strict = await admin.from("gov_control").insert({
      reference: `${FIXTURE}-002`, name: "Independent-only control",
      requires_independent_test: true, requires_approval: true, owner_name: "Product Director",
    }).select("control_id").limit(1);
    const strictId = strict.data?.[0]?.control_id ?? null;
    if (strictId) made.push(strictId);

    const notIndependent = await mustReject("gov_control_test", {
      control_id: strictId, basis: "operating", result: "effective",
      tested_by: "The owner", tester_independent: false,
    }, "test_id");
    ok("C3", notIndependent.rejected,
      `⚠ §6: a control requiring an INDEPENDENT tester refuses a self-test — a configurable rule nothing checks is documentation — ${notIndependent.message}`);

    const noApprover = await mustReject("gov_control_test", {
      control_id: strictId, basis: "operating", result: "effective",
      tested_by: "Auditor", tester_independent: true,
    }, "test_id");
    ok("C4", noApprover.rejected,
      `and one requiring approval refuses a test naming no approver — ${noApprover.message}`);

    const compliant = await admin.from("gov_control_test").insert({
      control_id: strictId, basis: "operating", result: "effective",
      tested_by: "Auditor", tester_independent: true,
      approved_by: "Chief Executive", approved_at: new Date().toISOString(),
    }).select("test_id").limit(1);
    ok("C5", !compliant.error,
      `control: an independent, approved test IS accepted on the same control — ${String(compliant.error?.message ?? "accepted").slice(0, 50)}`);

    // append-only
    const anyTest = await admin.from("gov_control_test").select("test_id").eq("control_id", controlId).limit(1);
    const testId = anyTest.data?.[0]?.test_id;
    const upd = await admin.from("gov_control_test").update({ result: "effective" }).eq("test_id", testId);
    ok("C6", !!upd.error, `⚠ §20: an UPDATE on a test result is refused — a retest is evidence, an edit is not — ${String(upd.error?.message ?? "ACCEPTED").slice(0, 50)}`);
    const del = await admin.from("gov_control_test").delete().eq("test_id", testId);
    ok("C7", !!del.error, `and a direct DELETE is refused — ${String(del.error?.message ?? "ACCEPTED").slice(0, 50)}`);
  } finally {
    await cleanup();
  }

  // ── Z ────────────────────────────────────────────────────────────────────
  const leftControl = await admin.from("gov_control").select("control_id", { count: "exact", head: true })
    .like("reference", `${FIXTURE}%`);
  ok("Z1", !leftControl.error && (leftControl.count ?? 0) === 0, `no fixture control is left — ${leftControl.count ?? "?"} found`);

  const leftTest = await admin.from("gov_control_test").select("test_id", { count: "exact", head: true });
  ok("Z2", !leftTest.error && (leftTest.count ?? 0) === 0,
    `⚠ and no test survives — reachable ONLY through the cascade, since a direct delete is refused, so this proves the depth allowance was carried into 322 — ${leftTest.count ?? "?"} found`);

  ok("Z3", cleanupError === null, `control: cleanup reported no error — ${cleanupError ?? "clean"}`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => { await cleanup(); console.error("\nHARNESS CRASHED (fixtures removed):", e); process.exit(1); });
