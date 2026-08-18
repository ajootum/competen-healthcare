/**
 * CPR-PD-010 — THE PRODUCT RISK REGISTER, ACCEPTANCE.
 *
 *   S  structural: the risk row carries no score, so an action cannot reduce risk by writing one
 *   M  a risk cannot be scored under an unpublished methodology, and today none is published
 *   A  assessments are append only and methodology-stamped
 *   C  each constraint that encodes a RULE is proved by a write that fails
 *   Z  the fixture methodology is GONE afterwards
 *
 * ⚠ Z IS THE ONE TO READ FIRST. To exercise the assessment chain this harness must publish a
 * methodology, and a published methodology is exactly what makes the live overview stop saying "Not Yet
 * Determined" and start rendering a posture. Leaving one behind would not fail a test - it would quietly
 * switch on a governed-looking figure across the workspace, derived from a scale invented by a test.
 *
 *   npx --yes tsx scripts/gov-risk-register-harness.ts
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

const FIXTURE = "PD010-ACCEPTANCE";
let methodologyId: string | null = null;
let riskId: string | null = null;
let cleanupError: string | null = null;

async function cleanup() {
  if (riskId) {
    const d = await admin.from("gov_product_risk").delete().eq("risk_id", riskId);
    if (d.error) cleanupError = `risk: ${String(d.error.message).slice(0, 70)}`; else riskId = null;
  }
  if (methodologyId) {
    const d = await admin.from("gov_risk_methodology").delete().eq("methodology_id", methodologyId);
    if (d.error) cleanupError = `methodology: ${String(d.error.message).slice(0, 70)}`; else methodologyId = null;
  }
}

async function mustReject(table: string, row: Record<string, unknown>, pk: string) {
  const res = await admin.from(table).insert(row).select(pk).limit(1);
  if (res.error) return { rejected: true, message: String(res.error.message).slice(0, 66) };
  if (res.data?.[0]?.[pk]) await admin.from(table).delete().eq(pk, res.data[0][pk]);
  return { rejected: false, message: "the write was ACCEPTED" };
}

async function main() {
  console.log("\nCPR-PD-010 — THE PRODUCT RISK REGISTER\n");

  const probe = await admin.from("gov_product_risk").select("risk_id").limit(1);
  if (probe.error) {
    console.log(`  ---- MIGRATION 321 IS NOT APPLIED ---- (${String(probe.error.message).slice(0, 60)})\n`);
    console.log("NOT READY  0 passed, 0 failed\n");
    process.exit(2);
  }

  // ── S · the structural claim the whole design rests on ───────────────────
  const sql = readdirSync("supabase/migrations").filter(f => f.startsWith("321-"))
    .map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
  const riskDdl = sql.slice(sql.indexOf("create table if not exists gov_product_risk"),
    sql.indexOf("comment on table gov_product_risk"));
  ok("S1", !/\b(likelihood|impact|score|inherent_|residual_)\w*\s+(int|numeric|text)/.test(riskDdl),
    "⚠ gov_product_risk declares NO score column — so completing an action has nothing to write, and s15's rule is unexpressible rather than merely forbidden");
  ok("S2", /likelihood_ordinal\s+int not null/.test(sql) && /methodology_id uuid not null/.test(sql),
    "control: the SCORE columns do exist — on the append-only assessment, stamped with its methodology");

  // ── M · nothing can be scored without a published methodology ────────────
  const live = await admin.from("gov_risk_methodology").select("methodology_id, status");
  ok("M1", !live.error && (live.data as { status: string }[]).filter(r => r.status === "published").length === 0,
    "⚠ LIVE: no methodology is published, so the overview reads Not Yet Determined and NO risk in this estate can carry a score");

  const r = await admin.from("gov_product_risk").insert({
    reference: `${FIXTURE}-001`, title: "Acceptance risk", category_code: "operational",
    cause: "A cause", event: "An event", consequence: "A consequence",
    owner_name: "Product Director", subject_type: "product",
  }).select("risk_id").limit(1);
  riskId = r.data?.[0]?.risk_id ?? null;
  ok("M2", !!riskId,
    `⚠ a risk REGISTERS without a score — recording that something is a risk must never wait on a methodology — ${r.error ? String(r.error.message).slice(0, 50) : "registered"}`);

  // ── C · the constraints that encode rules ────────────────────────────────
  const trendNoReason = await mustReject("gov_product_risk", {
    reference: `${FIXTURE}-002`, title: "x", category_code: "operational", trend: "improving",
  }, "risk_id");
  ok("C1", trendNoReason.rejected,
    `⚠ s4: a trend of "improving" without a rationale is refused — a stated direction is a claim — ${trendNoReason.message}`);

  const trendUnknown = await admin.from("gov_product_risk").insert({
    reference: `${FIXTURE}-003`, title: "control risk", category_code: "operational", trend: "unknown",
  }).select("risk_id").limit(1);
  ok("C2", !trendUnknown.error, "control: trend 'unknown' needs no rationale — C1 constrains CLAIMS, not the absence of one");
  if (trendUnknown.data?.[0]?.risk_id) await admin.from("gov_product_risk").delete().eq("risk_id", trendUnknown.data[0].risk_id);

  const escNoDest = await mustReject("gov_product_risk", {
    reference: `${FIXTURE}-004`, title: "x", category_code: "operational", escalation_state: "escalated",
  }, "risk_id");
  ok("C3", escNoDest.rejected, `s4: escalating names where it went, or it is not an escalation — ${escNoDest.message}`);

  // ── M3 · the headline refusal, proved against the live estate ────────────
  const draft = await admin.from("gov_risk_methodology").insert({
    version: 9001, name: `${FIXTURE} methodology`, status: "draft",
    aggregation_rule: "Highest residual score.",
  }).select("methodology_id").limit(1);
  methodologyId = draft.data?.[0]?.methodology_id ?? null;
  ok("M3", !!methodologyId, `a DRAFT methodology is accepted — ${draft.error ? String(draft.error.message).slice(0, 50) : "created"}`);

  if (methodologyId && riskId) {
    const scales: Record<string, string> = {};
    for (const [dim, ord, code] of [["likelihood", 1, "rare"], ["likelihood", 2, "likely"],
      ["impact", 1, "minor"], ["impact", 2, "major"]] as const) {
      const s = await admin.from("gov_risk_scale").insert({
        methodology_id: methodologyId, dimension: dim, ordinal: ord, code,
        label: code, definition: `Published definition of ${code}.`,
      }).select("scale_id").limit(1);
      scales[`${dim}:${ord}`] = s.data?.[0]?.scale_id;
    }

    const noDef = await mustReject("gov_risk_scale", {
      methodology_id: methodologyId, dimension: "impact", ordinal: 9, code: "nodef", label: "No definition",
    }, "scale_id");
    ok("C4", noDef.rejected,
      `⚠ s5: a scale point without a published DEFINITION is refused — "4" meaning two things to two assessors is the hidden arbitrary number — ${noDef.message}`);

    // publishing before there is a band must fail: s3's posture would be undeterminable after publishing
    const earlyPublish = await admin.from("gov_risk_methodology")
      .update({ status: "published", published_at: new Date().toISOString(), published_by: "harness", effective_from: new Date().toISOString() })
      .eq("methodology_id", methodologyId);
    ok("C5", !!earlyPublish.error,
      `⚠ s3: publishing is refused while the methodology has no posture band — ${String(earlyPublish.error?.message ?? "ACCEPTED").slice(0, 60)}`);

    // an assessment under a DRAFT methodology is refused
    const draftScore = await mustReject("gov_risk_assessment", {
      risk_id: riskId, methodology_id: methodologyId, basis: "inherent",
      likelihood_scale_id: scales["likelihood:2"], impact_scale_id: scales["impact:2"],
      likelihood_ordinal: 2, impact_ordinal: 2, score: 4,
    }, "assessment_id");
    ok("M4", draftScore.rejected,
      `⚠ s4: a risk cannot be scored under an UNPUBLISHED methodology — ${draftScore.message}`);

    // now give it a band and publish, so the chain can be exercised
    await admin.from("gov_posture_band").insert({
      methodology_id: methodologyId, code: "moderate", label: "Moderate",
      definition: "At least one residual score of 4.",
    });
    const publish = await admin.from("gov_risk_methodology")
      .update({ status: "published", published_at: new Date().toISOString(), published_by: "harness", effective_from: new Date().toISOString() })
      .eq("methodology_id", methodologyId);
    ok("C6", !publish.error,
      `control: with scales AND a band it publishes — C5 is about readiness, not a ban on publishing — ${String(publish.error?.message ?? "published").slice(0, 50)}`);

    const a = await admin.from("gov_risk_assessment").insert({
      risk_id: riskId, methodology_id: methodologyId, basis: "inherent",
      likelihood_scale_id: scales["likelihood:2"], impact_scale_id: scales["impact:2"],
      likelihood_ordinal: 2, impact_ordinal: 2, score: 4, assessed_by: "harness",
    }).select("assessment_id").limit(1);
    const assessmentId = a.data?.[0]?.assessment_id ?? null;
    ok("A1", !!assessmentId, `an assessment records under a PUBLISHED methodology — ${a.error ? String(a.error.message).slice(0, 50) : "recorded"}`);

    const upd = await admin.from("gov_risk_assessment").update({ score: 1 }).eq("assessment_id", assessmentId);
    ok("A2", !!upd.error, `⚠ s20: an UPDATE on an assessment is refused — a correction is a reassessment, not an edit — ${String(upd.error?.message ?? "ACCEPTED").slice(0, 55)}`);

    const del = await admin.from("gov_risk_assessment").delete().eq("assessment_id", assessmentId);
    ok("A3", !!del.error, `and a direct DELETE is refused — ${String(del.error?.message ?? "ACCEPTED").slice(0, 55)}`);

    // a second methodology cannot be effective over the same window
    const clash = await mustReject("gov_risk_methodology", {
      version: 9002, name: `${FIXTURE} clash`, status: "published",
      published_at: new Date().toISOString(), published_by: "harness", effective_from: new Date().toISOString(),
    }, "methodology_id");
    ok("C7", clash.rejected,
      `⚠ s5: two methodologies cannot be effective at once — a risk would have two scores and no answer — ${clash.message}`);

    // an action may not claim a verification without being done
    const badAction = await mustReject("gov_risk_action", {
      risk_id: riskId, action: "x", owner_name: "Someone", state: "open",
      verified_by_assessment_id: assessmentId,
    }, "action_id");
    ok("C8", badAction.rejected, `s15: an action cannot cite a verifying reassessment while still open — ${badAction.message}`);
  }

  await cleanup();

  // ── Z · the fixture is GONE ──────────────────────────────────────────────
  const leftMethod = await admin.from("gov_risk_methodology").select("methodology_id", { count: "exact", head: true })
    .eq("name", `${FIXTURE} methodology`);
  ok("Z1", !leftMethod.error && (leftMethod.count ?? 0) === 0,
    `⚠ the fixture methodology is gone — ${leftMethod.count ?? "?"} left`);

  const anyPublished = await admin.from("gov_risk_methodology").select("methodology_id", { count: "exact", head: true })
    .eq("status", "published");
  ok("Z2", !anyPublished.error && (anyPublished.count ?? 0) === 0,
    `⚠⚠ NO published methodology remains in the estate — a leftover one would silently switch a posture on across the workspace — ${anyPublished.count ?? "?"} found`);

  const leftRisk = await admin.from("gov_product_risk").select("risk_id", { count: "exact", head: true })
    .like("reference", `${FIXTURE}%`);
  ok("Z3", !leftRisk.error && (leftRisk.count ?? 0) === 0, `no fixture risk is left — ${leftRisk.count ?? "?"} found`);

  const leftAssessment = await admin.from("gov_risk_assessment").select("assessment_id", { count: "exact", head: true });
  ok("Z4", !leftAssessment.error && (leftAssessment.count ?? 0) === 0,
    `and no assessment survives the cascade — ${leftAssessment.count ?? "?"} found (append-only refuses a DIRECT delete, so this proves the cascade allowance works)`);

  ok("Z5", cleanupError === null, `control: cleanup reported no error — ${cleanupError ?? "clean"}`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => { await cleanup(); console.error("\nHARNESS CRASHED (fixtures removed):", e); process.exit(1); });
