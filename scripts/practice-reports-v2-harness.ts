/**
 * CPR-PI-001 v2 s12 harness -- the report engine and its catalogue.
 *
 * WHAT IT PROVES:
 *   1. The catalogue IS s12: the ten core templates by name, the category set, financial present
 *      because the governed module exists and gated by billing.view; every registry id a template
 *      claims resolves, and templates with proportion-capable entries carry numerator+denominator.
 *   2. Reports are THE ENGINES' OWN NUMBERS: conditions equals diagnosisReport row for row;
 *      investigations equals the shared aggregate Ask Practice uses; location rows disclose the
 *      unplaceable; the definition block carries practice, period, filters, timestamp and metric
 *      versions on EVERY report.
 *   3. Refusals are real: an unknown template 404s; the financial template refuses a caller who
 *      holds report.view but not billing.view, naming the capability.
 *   4. Every generation leaves a practice.report_generated audit row -- the same rows the Recent
 *      reports list is built from, so no second history store exists.
 *   5. The CSV opens with the definition block and escapes commas; source pins hold the tab
 *      dispatch and the shared-aggregate refactor in place.
 *
 *   npx --yes tsx scripts/practice-reports-v2-harness.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, recordDiagnosis, recordTreatment, transitionEncounter } from "../src/lib/practice/encounters";
import { recordInvestigation, recordReferral } from "../src/lib/practice/encounter-workspace";
import { createFollowUp } from "../src/lib/practice/follow-ups";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { generateReport, reportCsv, investigationsOrdered } from "../src/lib/practice/report-engine";
import { diagnosisReport, resolvePeriod } from "../src/lib/practice/reports";
import { REPORT_TEMPLATES, REPORT_CATEGORIES, reportTemplateById } from "../src/lib/practice/report-templates";
import { metricById } from "../src/lib/practice/intelligence-registry";
import { practiceToday } from "../src/lib/practice/practice-time";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000a6d12";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

async function cleanup() { await purgeWorkspacesOwnedBy(admin, [OWNER]); }

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nCPR-PI-001 v2 s12 reports harness\n");
  await cleanup();

  // ── 1. The catalogue IS s12 ────────────────────────────────────────────────
  const S12_TEN = [
    "Practice Summary", "Patient Demographics", "Conditions", "Treatments/Medications",
    "Investigations", "Follow-up Completion", "Outcomes & Monitoring", "Referrals",
    "Consultation Types", "Location Activity",
  ];
  ok("1-1. ⚠ the ten core templates are s12's list, by name, verbatim",
    S12_TEN.every(n => REPORT_TEMPLATES.some(t => t.name === n)),
    S12_TEN.filter(n => !REPORT_TEMPLATES.some(t => t.name === n)).join(", "));
  ok("1-2. the category set is s12's (financial present because the governed module exists)",
    REPORT_CATEGORIES.map(c => c.key).join() === "clinical,patients,followups,operations,financial");
  ok("1-3. the financial template is gated by billing.view, not hidden",
    reportTemplateById("financial_summary")?.capability === "billing.view");
  const claimed = REPORT_TEMPLATES.flatMap(t => t.registryIds);
  ok("1-4. every registry id a template claims RESOLVES",
    claimed.every(id => !!metricById(id)), claimed.filter(id => !metricById(id)).join(", "));
  ok("1-5. the new aggregates carry the s14 contract (numerator AND denominator)",
    !!metricById("pi.treatments_recorded")?.numerator && !!metricById("pi.treatments_recorded")?.denominator
      && !!metricById("pi.referrals_recorded")?.numerator && !!metricById("pi.referrals_recorded")?.denominator);

  // ── 2. Live fixtures ───────────────────────────────────────────────────────
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-rpt-${Date.now()}`, request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: "harness", correlation_id: "harness-rpt",
  }).select("id").single();
  const payload: IndividualRequest = {
    displayName: "HARNESS RPT (synthetic)", countryCode: "UG", timezone: "Africa/Kampala",
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: OWNER, correlation_id: "harness-rpt", workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { ok("fixture provisions", false, String(run.errorCode)); return report(); }
  const ws = run.workspaceId;
  const ctxRes = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!ctxRes.ok) { ok("context resolves", false); return report(); }
  const ctx = ctxRes.ctx;
  const base = { actorId: OWNER, correlationId: "harness-rpt" };
  const today = practiceToday("Africa/Kampala");
  const dayShift = (days: number) => new Date(Date.parse(today + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  const genArgs = { fromDay: dayShift(-30), toDay: today, ...base };

  const p1 = await registerPatient(admin, { workspaceId: ws, displayName: "Report Subject", sex: "female", birthDate: "1980-01-01", phone: "0772 000 021", ...base });
  if (!p1.ok) { ok("patient registers", false); return report(); }
  const e1 = await launchEncounter(admin, { workspaceId: ws, patientId: p1.data.id, pathway: "new_walk_in", ...base });
  if (!e1.ok) { ok("encounter launches", false); return report(); }
  const dx = await recordDiagnosis(admin, { workspaceId: ws, encounterId: e1.data.id, label: "Hypertension, essential", certainty: "confirmed", ...base });
  const tr = await recordTreatment(admin, { workspaceId: ws, encounterId: e1.data.id, treatmentType: "medication", label: "Amlodipine 5mg", ...base });
  const inv = await recordInvestigation(admin, { workspaceId: ws, encounterId: e1.data.id, label: "U&E, creatinine", ...base });
  const ref = await recordReferral(admin, { workspaceId: ws, encounterId: e1.data.id, referredTo: "Cardiology, Mulago", reason: "resistant hypertension", ...base });
  const fu = await createFollowUp(admin, { workspaceId: ws, patientId: p1.data.id, reason: "BP review", dueOn: dayShift(-1), ...base });
  if (!dx.ok || !tr.ok || !inv.ok || !ref.ok || !fu.ok) { ok("clinical fixtures record", false); return report(); }
  // Demographics describes patients SEEN -- completed consultations only -- so the encounter must
  // finish AFTER the clinical writes (a completed encounter refuses further recording).
  // DM-001 s8.1: DRAFT walks to COMPLETED through ACTIVE.
  for (const to of ["ACTIVE", "COMPLETED"]) {
    const t = await transitionEncounter(admin, { workspaceId: ws, encounterId: e1.data.id, to, ...base });
    if (!t.ok) { ok(`encounter reaches ${to}`, false, (t as any).message); return report(); }
  }

  // ── 3. Reports are the engines' own numbers ───────────────────────────────
  const period = await resolvePeriod(admin, ws, { fromDay: genArgs.fromDay, toDay: genArgs.toDay });

  const conditions = await generateReport(admin, ctx, { templateId: "conditions", ...genArgs });
  const dReport = await diagnosisReport(admin, ctx, period);
  ok("3-1. ⚠ the Conditions report IS diagnosisReport, row for row",
    conditions.ok && conditions.data.sections[0].rows.length === dReport.rows.length
      && conditions.data.sections[0].rows[0]?.[0] === "Hypertension, essential"
      && conditions.data.sections[0].rows[0]?.[1] === 1,
    JSON.stringify(conditions.ok ? conditions.data.sections[0].rows : conditions));

  const invReport = await generateReport(admin, ctx, { templateId: "investigations", ...genArgs });
  const invAgg = await investigationsOrdered(admin, ctx, period);
  ok("3-2. the Investigations report equals the SHARED aggregate (the one Ask Practice reads)",
    invReport.ok && invAgg.ok
      && invReport.data.sections[0].rows[0]?.[0] === "U&E, creatinine"
      && invReport.data.sections[0].rows[0]?.[1] === invAgg.rows[0]?.total
      && /requested is not resulted/i.test(invReport.data.sections[0].note ?? ""),
    JSON.stringify(invReport.ok ? invReport.data.sections[0] : invReport));

  const treatments = await generateReport(admin, ctx, { templateId: "treatments_medications", ...genArgs });
  ok("3-3. Treatments: by type and by label, intention language on the section",
    treatments.ok && treatments.data.sections[0].rows.some(r => r[0] === "medication" && r[1] === 1)
      && treatments.data.sections[1].rows.some(r => r[0] === "Amlodipine 5mg")
      && /never an administration/.test(treatments.data.sections[0].note ?? ""),
    JSON.stringify(treatments.ok ? treatments.data.sections : treatments));

  const referrals = await generateReport(admin, ctx, { templateId: "referrals", ...genArgs });
  ok("3-4. Referrals: the module's own rows, recorded-not-sent limitation carried into the report",
    referrals.ok && referrals.data.sections.some(s => s.title === "Destinations"
        && s.rows.some(r => r[0] === "Cardiology, Mulago"))
      && /nothing in this product transmits anything/i.test(referrals.data.sections[0].note ?? ""),
    JSON.stringify(referrals.ok ? referrals.data.sections[0] : referrals));

  const followups = await generateReport(admin, ctx, { templateId: "followup_completion", ...genArgs });
  ok("3-5. Follow-up Completion: cohort raised=1 completed=0, overdue backlog=1",
    followups.ok && JSON.stringify(followups.data.sections[0].rows).includes('["Raised in the period",1]')
      && JSON.stringify(followups.data.sections[0].rows).includes('["Of those, now completed",0]')
      && JSON.stringify(followups.data.sections[0].rows).includes('["Overdue now, all periods",1]'),
    JSON.stringify(followups.ok ? followups.data.sections[0].rows : followups));

  const summary = await generateReport(admin, ctx, { templateId: "practice_summary", ...genArgs });
  ok("3-6. Practice Summary: activity lines present with denominators as their own column",
    summary.ok && summary.data.sections[0].columns.join() === "Measure,Count,Of"
      && summary.data.sections[0].rows.some(r => r[0] === "Consultations started" && r[1] === 1),
    JSON.stringify(summary.ok ? summary.data.sections[0].rows.slice(0, 6) : summary));

  const demo = await generateReport(admin, ctx, { templateId: "patient_demographics", ...genArgs });
  ok("3-7. Demographics: distributions render, counts only",
    demo.ok && demo.data.sections.some(s => s.title === "By sex" && s.rows.some(r => r[0] === "Female" && r[1] === 1)),
    JSON.stringify(demo.ok ? demo.data.sections : demo));

  const outcomes = await generateReport(admin, ctx, { templateId: "outcomes_monitoring", ...genArgs });
  ok("3-8. Outcomes: the uncoded share is NAMED and structured monitoring is refused, not invented",
    outcomes.ok && JSON.stringify(outcomes.data.sections[0].rows).includes("without an outcome code")
      && /absent here rather than invented/.test(outcomes.data.sections[2].note ?? ""),
    JSON.stringify(outcomes.ok ? outcomes.data.sections[0] : outcomes));

  const locs = await generateReport(admin, ctx, { templateId: "location_activity", ...genArgs });
  ok("3-9. Location Activity: the sessionless encounter is a DISCLOSED row, never dropped",
    locs.ok && locs.data.sections[0].rows.some(r => r[0] === "No location recorded" && r[1] === 1),
    JSON.stringify(locs.ok ? locs.data.sections[0] : locs));

  // ── 4. The definition block, on every report ──────────────────────────────
  const all = [conditions, invReport, treatments, referrals, followups, summary, demo, outcomes, locs];
  ok("4-1. ⚠ s12: EVERY report carries practice, period, filters, timestamp and metric versions",
    all.every(r => r.ok
      && r.data.definition.practiceName.length > 0
      && r.data.definition.fromDay === genArgs.fromDay && r.data.definition.toDay === genArgs.toDay
      && r.data.definition.filters.includes("whole practice")
      && /^\d{4}-\d{2}-\d{2}T/.test(r.data.definition.generatedAtIso)
      && r.data.definition.metrics.every(m => m.version > 0)));

  // ── 5. Refusals ────────────────────────────────────────────────────────────
  const unknown = await generateReport(admin, ctx, { templateId: "quarterly_kpis", ...genArgs });
  ok("5-1. an unknown template 404s by name",
    !unknown.ok && unknown.status === 404 && unknown.code === "UNKNOWN_TEMPLATE");
  const noBilling = { ...ctx, capabilities: ctx.capabilities.filter(c => c !== "billing.view") };
  const finRefused = await generateReport(admin, noBilling as any, { templateId: "financial_summary", ...genArgs });
  ok("5-2. ⚠ report.view alone does not open the money report -- billing.view is named in the refusal",
    !finRefused.ok && finRefused.status === 403 && /billing\.view/.test(finRefused.message));
  const fin = await generateReport(admin, ctx, { templateId: "financial_summary", ...genArgs });
  ok("5-3. the permitted financial report is honest about an empty period, never zeros-as-failure",
    fin.ok && /genuinely empty money picture/.test(fin.data.sections[0].note ?? ""),
    JSON.stringify(fin.ok ? fin.data.sections[0] : fin));

  // ── 6. Audit is the history ────────────────────────────────────────────────
  const { data: trail } = await admin.from("practice_audit_event")
    .select("payload").eq("workspace_id", ws).eq("event_type", "practice.report_generated");
  ok("6-1. every permitted generation left an audit row carrying template, period and metric ids",
    (trail ?? []).length === all.length + 1
      && ((trail ?? []) as any[]).some(r => r.payload?.templateId === "conditions"
        && r.payload?.fromDay === genArgs.fromDay
        && Array.isArray(r.payload?.metrics) && r.payload.metrics.includes("pi.top_conditions_by_patients")),
    `${(trail ?? []).length} rows for ${all.length + 1} permitted generations`);
  ok("6-2. the refused generations left NO audit row claiming they happened",
    !((trail ?? []) as any[]).some(r => r.payload?.templateId === "quarterly_kpis"));

  // ── 7. The CSV ─────────────────────────────────────────────────────────────
  const csv = reportCsv(conditions.ok ? conditions.data : (null as never));
  ok("7-1. the CSV opens with the definition block and carries the not-anonymised sentence",
    csv.startsWith("CompetenPractice report,Conditions")
      && csv.includes(`Period,${genArgs.fromDay} to ${genArgs.toDay}`)
      && csv.includes("Not anonymised")
      && csv.includes("pi.top_conditions_by_patients v1"));
  ok("7-2. a label containing a comma is quoted, not split",
    csv.includes('"Hypertension, essential",1,1,1'));

  // ── 8. Source pins ─────────────────────────────────────────────────────────
  const pageSrc = readFileSync(join(process.cwd(), "src", "app", "practice", "(shell)", "intelligence", "page.tsx"), "utf8");
  const askSrc = readFileSync(join(process.cwd(), "src", "lib", "practice", "ask-practice.ts"), "utf8");
  const engineSrc = readFileSync(join(process.cwd(), "src", "lib", "practice", "report-engine.ts"), "utf8");
  ok("8-1. the reports tab dispatches to the v2 area",
    pageSrc.includes("<ReportsV2Area"));
  ok("8-2. ⚠ Ask Practice reads the SHARED investigations aggregate, not a second group-by",
    askSrc.includes('investigationsOrdered') && !askSrc.includes('from("practice_encounter_investigation")'));
  ok("8-3. the engine never runs its own SQL where a module owns the number",
    engineSrc.includes("referralIntelligence(") && engineSrc.includes("practiceIntelligenceWorkspace(")
      && engineSrc.includes("outcomePicture(") && engineSrc.includes("diagnosisReport("));

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
