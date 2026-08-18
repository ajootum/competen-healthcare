/**
 * CPR-PD-010 §18 — HQ GOVERNANCE ESCALATION, ACCEPTANCE. Owner policy, 2026-08-18.
 *
 *   U  the uncertainty rule: an undetermined matter reads ESCALATION REVIEW REQUIRED
 *   N  no score, no severity, no threshold decides escalation anywhere
 *   T  escalation is trigger-based, and an escalation names its triggers
 *   L  the product record is the source — the escalation links, never duplicates
 *   Z  nothing this run created survives
 *
 * ⚠ U1 IS THE OWNER'S RULE, VERBATIM: "If the system cannot determine whether a matter crosses an
 * escalation boundary, it must not silently classify it as 'No escalation required'." A risk nobody has
 * assessed must read review_required — not because a default says so, but because there is no
 * determination and the view says what that means.
 *
 * ⚠ N1 IS THE OTHER HALF: "Risk classification and escalation authority are related but SEPARATE
 * concepts." A severe risk can sit wholly within Product authority; a small one can need HQ for setting
 * a regulatory precedent. So no column in this migration derives one from the other, and N1 reads the
 * DDL to prove it rather than trusting that I did not write it.
 *
 *   npx --yes tsx scripts/gov-hq-escalation-harness.ts
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

const FIXTURE = "PD010-ESC";
const madeEscalations: string[] = [];
const madeRisks: string[] = [];
let cleanupError: string | null = null;

async function cleanup() {
  for (const id of madeEscalations) {
    const d = await admin.from("gov_hq_escalation").delete().eq("escalation_id", id);
    if (d.error) cleanupError = `escalation: ${String(d.error.message).slice(0, 60)}`;
  }
  for (const id of madeRisks) {
    const d = await admin.from("gov_product_risk").delete().eq("risk_id", id);
    if (d.error) cleanupError = `risk: ${String(d.error.message).slice(0, 60)}`;
  }
  madeEscalations.length = 0; madeRisks.length = 0;
}

async function mustReject(table: string, row: Record<string, unknown>, pk: string) {
  const res = await admin.from(table).insert(row).select(pk).limit(1);
  if (res.error) return { rejected: true, message: String(res.error.message).slice(0, 70) };
  if (res.data?.[0]?.[pk]) await admin.from(table).delete().eq(pk, res.data[0][pk]);
  return { rejected: false, message: "the write was ACCEPTED" };
}

async function main() {
  console.log("\nCPR-PD-010 §18 — HQ GOVERNANCE ESCALATION\n");

  const probe = await admin.from("gov_escalation_trigger").select("trigger_code").limit(1);
  if (probe.error) {
    console.log(`  ---- MIGRATION 330 IS NOT APPLIED ---- (${String(probe.error.message).slice(0, 60)})\n`);
    console.log("NOT READY  0 passed, 0 failed\n");
    process.exit(2);
  }

  const rawSql = readdirSync("supabase/migrations").filter(f => f.startsWith("330-"))
    .map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
  const sql = rawSql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");

  // ── N · no score decides anything ────────────────────────────────────────
  ok("N1", !/risk_score|severity|threshold_value|score\s+(int|numeric)/.test(sql),
    "⚠⚠ owner policy: NO score, severity or threshold column appears anywhere in this migration — escalation authority is not a function of severity");
  ok("N1c", /threshold/.test(rawSql) && !/threshold/.test(sql),
    "control: the word appears in the migration's PROSE explaining its absence, and the stripper removed it — so N1 read DDL");

  // ── T · the eleven triggers, as policy configuration ─────────────────────
  const triggers = (await admin.from("gov_escalation_trigger").select("*").order("sort_order")).data as Record<string, unknown>[];
  ok("T1", triggers.length === 11 && triggers.every(t => t.is_baseline === true),
    `owner's eleven mandatory triggers are seeded as BASELINE policy — ${triggers.length} of them, all flagged baseline pending the published matrix`);
  ok("T2", triggers.every(t => String(t.description).trim().length > 20),
    "each carries the owner's wording rather than a code, so a determiner reads the test they are applying");

  const matrix = await admin.from("gov_delegation_matrix").select("matrix_id", { count: "exact", head: true });
  ok("T3", !matrix.error && (matrix.count ?? 0) === 0,
    `⚠ the Delegation and Escalation Matrix is EMPTY — "until that matrix is formally populated, the mandatory triggers above are the baseline policy", and seeding an authority map nobody approved is the same error as seeding a risk methodology — ${matrix.count ?? "?"} rows`);

  try {
    // ── U · the uncertainty rule ───────────────────────────────────────────
    const risk = await admin.from("gov_product_risk").insert({
      reference: `${FIXTURE}-RSK1`, title: "Undetermined risk", category_code: "operational",
      owner_name: "Product Director",
    }).select("risk_id").limit(1);
    const riskId = risk.data?.[0]?.risk_id ?? null;
    if (riskId) madeRisks.push(riskId);

    const st = (await admin.from("gov_risk_escalation_state")
      .select("escalation_state, never_determined").eq("risk_id", riskId).limit(1)).data?.[0];
    ok("U1", st?.escalation_state === "review_required" && st?.never_determined === true,
      `⚠⚠ OWNER RULE: a risk nobody has determined reads "${st?.escalation_state}" — NEVER "no escalation required". A boolean defaulting to false would silently classify every undetermined matter, for ever`);

    const silentNo = await mustReject("gov_escalation_determination", {
      risk_id: riskId, outcome: "no_escalation_required",
      determined_by: "Product Director", determined_at: new Date().toISOString(),
    }, "determination_id");
    ok("U2", silentNo.rejected,
      `⚠ and "no escalation required" WITHOUT a rationale is refused — it is a judgement, not a default — ${silentNo.message}`);

    const reasonedNo = await admin.from("gov_escalation_determination").insert({
      risk_id: riskId, outcome: "no_escalation_required",
      determined_by: "Product Director", determined_at: new Date().toISOString(),
      rationale: "Single product, within delegated authority, no regulatory or safety dimension.",
    }).select("determination_id").limit(1);
    ok("U3", !reasonedNo.error,
      `⚠ CONTROL — a REASONED "no escalation required" is accepted. Staying at product level is the default outcome, but it is a stated one — ${String(reasonedNo.error?.message ?? "recorded").slice(0, 40)}`);

    const st2 = (await admin.from("gov_risk_escalation_state")
      .select("escalation_state, rationale").eq("risk_id", riskId).limit(1)).data?.[0];
    ok("U4", st2?.escalation_state === "no_escalation_required" && !!st2?.rationale,
      "and the state moves, carrying its rationale — so the resolver is not a constant");

    // review_required needs no attribution: it is the UNCONCLUDED state
    const uncertain = await admin.from("gov_escalation_determination").insert({
      risk_id: riskId, outcome: "review_required",
      review_note: "Possible second-product impact, unclear. Routing for determination.",
    }).select("determination_id").limit(1);
    ok("U5", !uncertain.error,
      "⚠ and a matter can be explicitly routed as REVIEW REQUIRED with no determiner — the owner's third state is reachable, not just a default");

    // ── T · escalation names its triggers ──────────────────────────────────
    const risk2 = await admin.from("gov_product_risk").insert({
      reference: `${FIXTURE}-RSK2`, title: "Cross-product risk", category_code: "security",
      owner_name: "Product Director",
    }).select("risk_id").limit(1);
    const risk2Id = risk2.data?.[0]?.risk_id ?? null;
    if (risk2Id) madeRisks.push(risk2Id);

    const esc = await admin.from("gov_hq_escalation").insert({
      reference: `${FIXTURE}-E1`, risk_id: risk2Id,
      reason: "Shared identity service affected, and the regulator has been notified by another product.",
      originating_owner: "Product Director",
      hq_receiving_authority: "Chief Executive",
      requested_action: "Confirm corporate position and authorise the notification wording.",
    }).select("escalation_id").limit(1);
    const escId = esc.data?.[0]?.escalation_id ?? null;
    if (escId) madeEscalations.push(escId);
    ok("T4", !!escId, `an escalation records — ${esc.error ? String(esc.error.message).slice(0, 50) : "created"}`);

    const advanceBare = await admin.from("gov_hq_escalation")
      .update({ status: "acknowledged" }).eq("escalation_id", escId);
    ok("T5", !!advanceBare.error,
      `⚠ §18: an escalation that names NO corporate-impact trigger cannot advance — escalation is trigger-based, and without one there is no stated reason it left product governance — ${String(advanceBare.error?.message ?? "ACCEPTED").slice(0, 55)}`);

    await admin.from("gov_hq_escalation_trigger").insert([
      { escalation_id: escId, trigger_code: "multi_product_impact" },
      { escalation_id: escId, trigger_code: "legal_regulatory_exposure" },
    ]);
    const advanceLinked = await admin.from("gov_hq_escalation")
      .update({ status: "acknowledged" }).eq("escalation_id", escId);
    ok("T6", !advanceLinked.error,
      "⚠ CONTROL — with its triggers named it advances. A matter usually crosses more than one, which is why this is many-to-many");

    const decidedNoOutcome = await admin.from("gov_hq_escalation").update({
      status: "decided", decided_by: "Chief Executive", decided_at: new Date().toISOString(),
    }).eq("escalation_id", escId);
    ok("T7", !!decidedNoOutcome.error,
      `HQ deciding without stating an outcome is refused — ${String(decidedNoOutcome.error?.message ?? "ACCEPTED").slice(0, 50)}`);

    // ── L · link, never duplicate ──────────────────────────────────────────
    const escDdl = sql.slice(sql.indexOf("create table if not exists gov_hq_escalation ("),
      sql.indexOf("comment on table gov_hq_escalation "));
    ok("L1", !/\btitle\s+text|\brisk_statement|\bdescription\s+text/.test(escDdl),
      "⚠ owner: the escalation holds NO copy of the risk statement — it links, so the product record stays the source and the two cannot drift");
    ok("L2", /gov_hq_escalation_one_origin/.test(sql),
      "and it originates in exactly one product record, typed rather than polymorphic");

    const noOrigin = await mustReject("gov_hq_escalation", {
      reference: `${FIXTURE}-E2`, reason: "x", originating_owner: "y",
      hq_receiving_authority: "z", requested_action: "w",
    }, "escalation_id");
    ok("L3", noOrigin.rejected, `an escalation with no originating record is refused — ${noOrigin.message}`);
  } finally {
    await cleanup();
  }

  // ── Z ────────────────────────────────────────────────────────────────────
  const leftEsc = await admin.from("gov_hq_escalation").select("escalation_id", { count: "exact", head: true });
  ok("Z1", !leftEsc.error && (leftEsc.count ?? 0) === 0, `no escalation is left — ${leftEsc.count ?? "?"} found`);

  const leftDet = await admin.from("gov_escalation_determination").select("determination_id", { count: "exact", head: true });
  ok("Z2", !leftDet.error && (leftDet.count ?? 0) === 0,
    `⚠ and no determination survives — append-only refuses a direct delete, so this proves the cascade allowance carried into 330 — ${leftDet.count ?? "?"} found`);

  const triggersIntact = await admin.from("gov_escalation_trigger").select("trigger_code", { count: "exact", head: true });
  ok("Z3", (triggersIntact.count ?? 0) === 11,
    `⚠ control: the eleven POLICY triggers are untouched — they are configuration, not fixtures, and a harness must not consume them — ${triggersIntact.count ?? "?"} present`);

  ok("Z4", cleanupError === null, `control: cleanup reported no error — ${cleanupError ?? "clean"}`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => { await cleanup(); console.error("\nHARNESS CRASHED (fixtures removed):", e); process.exit(1); });
