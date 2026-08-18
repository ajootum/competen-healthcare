/**
 * CPR-PD-010 §7/§8/§9 — PRIVACY, SECURITY AND CLINICAL SAFETY GOVERNANCE, ACCEPTANCE.
 *
 *   P  no table here can name a patient, an encounter or an outcome
 *   R  §8's restricted detail is SEPARATE, so a default read cannot carry it
 *   C  each constraint that encodes a rule is proved by a write that fails
 *   Z  nothing this run created survives
 *
 * ⚠ P1 IS THE ONE §9 TURNS ON, AND IT IS TESTED AGAINST THE MIGRATION RATHER THAN AGAINST A ROW.
 * Free text cannot be constrained by a database — somebody can always type a patient's name into a
 * hazard description. What CAN be guaranteed is that there is nowhere structured for one to go, so a
 * join, an export or a report can never assemble patient data out of this schema. That is the same
 * position PD-009 took on the five support record types.
 *
 * ⚠ R2 IS THE ONE §19 TURNS ON. A `select *` on the review table must not return exploit detail — not
 * "must return it flagged". Tested by reading every column name the review table exposes.
 *
 *   npx --yes tsx scripts/gov-psc-harness.ts
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

const FIXTURE = "PD010-PSC";
const madeReviews: string[] = [];
const madeHazards: string[] = [];
const madeClasses: string[] = [];
let cleanupError: string | null = null;

async function cleanup() {
  for (const id of madeHazards) {
    const d = await admin.from("gov_safety_hazard").delete().eq("hazard_id", id);
    if (d.error) cleanupError = `hazard: ${String(d.error.message).slice(0, 60)}`;
  }
  for (const id of madeReviews) {
    const d = await admin.from("gov_security_review").delete().eq("review_id", id);
    if (d.error) cleanupError = `review: ${String(d.error.message).slice(0, 60)}`;
  }
  for (const id of madeClasses) {
    const d = await admin.from("gov_data_class").delete().eq("data_class_id", id);
    if (d.error) cleanupError = `data class: ${String(d.error.message).slice(0, 60)}`;
  }
  madeHazards.length = 0; madeReviews.length = 0; madeClasses.length = 0;
}

async function mustReject(table: string, row: Record<string, unknown>, pk: string) {
  const res = await admin.from(table).insert(row).select(pk).limit(1);
  if (res.error) return { rejected: true, message: String(res.error.message).slice(0, 70) };
  if (res.data?.[0]?.[pk]) await admin.from(table).delete().eq(pk, res.data[0][pk]);
  return { rejected: false, message: "the write was ACCEPTED" };
}

async function main() {
  console.log("\nCPR-PD-010 §7/§8/§9 — PRIVACY, SECURITY, CLINICAL SAFETY\n");

  const probe = await admin.from("gov_safety_hazard").select("hazard_id").limit(1);
  if (probe.error) {
    console.log(`  ---- MIGRATION 327 IS NOT APPLIED ---- (${String(probe.error.message).slice(0, 60)})\n`);
    console.log("NOT READY  0 passed, 0 failed\n");
    process.exit(2);
  }

  const rawSql = readdirSync("supabase/migrations").filter(f => f.startsWith("327-"))
    .map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");
  const sql = rawSql.split("\n").filter(l => !l.trim().startsWith("--")).join("\n");

  // ── P · nothing here can name a person ───────────────────────────────────
  const forbidden = [...sql.matchAll(/^\s+(patient[a-z_]*|encounter_id|appointment_id|mrn|nhs_number|date_of_birth|dob|outcome_id)\s+/gm)]
    .map(m => m[1]);
  ok("P1", forbidden.length === 0,
    `⚠⚠ §9: not one of these tables has a patient, encounter, appointment or outcome column — there is nowhere for a person to go, so no join or export can assemble one — ${forbidden.join(", ") || "none"}`);

  ok("P2", /category\s+text not null/.test(sql) && /'patient_related'/.test(sql),
    "control: the privacy inventory DOES carry a 'patient_related' class — P1 is about instances, not about the product being unable to say it holds clinical data");

  // ── R · restricted detail is structurally separate ───────────────────────
  const reviewDdl = sql.slice(sql.indexOf("create table if not exists gov_security_review ("),
    sql.indexOf("comment on table gov_security_review "));
  ok("R1", /create table if not exists gov_security_restricted_detail/.test(sql),
    "§8: restricted detail has its own table");
  ok("R2", !/\bdetail\s+text/.test(reviewDdl) && !/exploit/.test(reviewDdl),
    "⚠⚠ §19: the REVIEW table carries no detail column — a `select *` on it cannot return exploit detail, so search, exports and payload logs physically cannot carry it");
  ok("R3", /has_restricted_detail\s+boolean/.test(reviewDdl),
    "it carries only a POINTER saying whether to go looking — which is a flag doing the job a flag can actually do");

  try {
    // ── the flag stays honest ──────────────────────────────────────────────
    const rev = await admin.from("gov_security_review").insert({
      reference: `${FIXTURE}-SEC1`, domain: "tenancy_isolation",
      title: "Practice tenancy isolation review", posture: "gaps_identified",
      summary: "Two service-role reads bypass RLS.",
      reviewed_by: "Security", reviewed_at: new Date().toISOString(),
    }).select("review_id, has_restricted_detail").limit(1);
    const reviewId = rev.data?.[0]?.review_id ?? null;
    if (reviewId) madeReviews.push(reviewId);
    ok("R4", !!reviewId && rev.data[0].has_restricted_detail === false,
      `a review records with no restricted detail — ${rev.error ? String(rev.error.message).slice(0, 50) : "created, flag false"}`);

    await admin.from("gov_security_restricted_detail").insert({
      review_id: reviewId, detail: "Specific bypass path.", detail_kind: "exploit_path",
      recorded_by: "Security",
    });
    const after = (await admin.from("gov_security_review").select("has_restricted_detail").eq("review_id", reviewId).limit(1)).data?.[0];
    ok("R5", after?.has_restricted_detail === true,
      "⚠ recording restricted detail flips the pointer automatically — the flag cannot claim detail that does not exist, nor miss detail that does");

    // and the review row STILL carries no detail
    const plainRead = (await admin.from("gov_security_review").select("*").eq("review_id", reviewId).limit(1)).data?.[0];
    const leaked = Object.entries(plainRead ?? {}).filter(([, v]) => typeof v === "string" && v.includes("bypass path"));
    ok("R6", leaked.length === 0,
      `⚠⚠ and a live \`select *\` on the review returns NO exploit text — checked across every column, not just the ones I expected — ${leaked.map(([k]) => k).join(", ") || "clean"}`);

    // ── C · the constraints ────────────────────────────────────────────────
    const adverseNoSummary = await mustReject("gov_security_review", {
      reference: `${FIXTURE}-SEC2`, domain: "encryption", title: "x", posture: "ineffective",
      reviewed_by: "S", reviewed_at: new Date().toISOString(),
    }, "review_id");
    ok("C1", adverseNoSummary.rejected,
      `§8: an adverse posture with no summary is refused — ${adverseNoSummary.message}`);

    const assessedNoReviewer = await mustReject("gov_security_review", {
      reference: `${FIXTURE}-SEC3`, domain: "secrets", title: "x", posture: "effective",
    }, "review_id");
    ok("C2", assessedNoReviewer.rejected,
      `⚠ §8: a posture of "effective" with no reviewer or date is refused — an assurance nobody performed — ${assessedNoReviewer.message}`);

    const notAssessed = await admin.from("gov_security_review").insert({
      reference: `${FIXTURE}-SEC4`, domain: "backup_continuity", title: "Not looked at yet",
      posture: "not_assessed",
    }).select("review_id").limit(1);
    if (notAssessed.data?.[0]?.review_id) madeReviews.push(notAssessed.data[0].review_id);
    ok("C3", !notAssessed.error,
      "control: NOT ASSESSED needs no reviewer — C2 constrains claims of assurance, not the admission of its absence");

    // §7
    const specialNotPersonal = await mustReject("gov_data_class", {
      code: `${FIXTURE}-dc1`, label: "x", category: "patient_related", purpose: "y",
      contains_personal_data: false, contains_special_category: true,
    }, "data_class_id");
    ok("C4", specialNotPersonal.rejected,
      `⚠ §7: special-category data that is not personal data is refused — the misclassification would quietly lower the protection the class attracts — ${specialNotPersonal.message}`);

    // §9
    const verifiedNoEvidence = await mustReject("gov_safety_hazard", {
      reference: `${FIXTURE}-HZ1`, title: "x", feature_area: "Medication warnings",
      hazard: "Warning does not fire", potential_harm: "Missed interaction", state: "verified",
    }, "hazard_id");
    ok("C5", verifiedNoEvidence.rejected,
      `⚠⚠ §9: a hazard cannot be VERIFIED without verification evidence — safety verified on assertion alone is the failure mode this whole section exists for — ${verifiedNoEvidence.message}`);

    const hz = await admin.from("gov_safety_hazard").insert({
      reference: `${FIXTURE}-HZ2`, title: "Warning suppressed on renamed drug",
      feature_area: "Medication warnings", journey_key: "patient_booking",
      hazard: "The interaction warning does not fire when a drug is recorded under a brand name",
      cause: "Exact-match lookup", potential_harm: "A prescriber does not see a known interaction",
      mitigation: "Normalise before lookup", state: "mitigated", owner_name: "Product Director",
      requires_pre_release_approval: true,
    }).select("hazard_id").limit(1);
    const hazardId = hz.data?.[0]?.hazard_id ?? null;
    if (hazardId) madeHazards.push(hazardId);
    ok("C6", !!hazardId,
      `control: a hazard about a FEATURE records normally — ${hz.error ? String(hz.error.message).slice(0, 50) : "created"}`);

    const acceptedNoResidual = await admin.from("gov_safety_hazard")
      .update({ state: "accepted" }).eq("hazard_id", hazardId);
    ok("C7", !!acceptedNoResidual.error,
      `§9: accepting a residual safety risk without stating it is refused — ${String(acceptedNoResidual.error?.message ?? "ACCEPTED").slice(0, 50)}`);
  } finally {
    await cleanup();
  }

  // ── Z ────────────────────────────────────────────────────────────────────
  const leftDetail = await admin.from("gov_security_restricted_detail").select("detail_id", { count: "exact", head: true });
  ok("Z1", !leftDetail.error && (leftDetail.count ?? 0) === 0,
    `⚠ no restricted detail survives — it cascades with its review, so a deleted review cannot leave exploit text behind — ${leftDetail.count ?? "?"} found`);

  const leftReviews = await admin.from("gov_security_review").select("review_id", { count: "exact", head: true })
    .like("reference", `${FIXTURE}%`);
  ok("Z2", !leftReviews.error && (leftReviews.count ?? 0) === 0, `no fixture review is left — ${leftReviews.count ?? "?"} found`);

  const leftHazards = await admin.from("gov_safety_hazard").select("hazard_id", { count: "exact", head: true })
    .like("reference", `${FIXTURE}%`);
  ok("Z3", !leftHazards.error && (leftHazards.count ?? 0) === 0, `nor any hazard — ${leftHazards.count ?? "?"} found`);

  ok("Z4", cleanupError === null, `control: cleanup reported no error — ${cleanupError ?? "clean"}`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => { await cleanup(); console.error("\nHARNESS CRASHED (fixtures removed):", e); process.exit(1); });
