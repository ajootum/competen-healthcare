/**
 * CPR-PI-001 v2 s6 harness -- the cohort engine: registered segments and saved populations.
 *
 * WHAT IT PROVES:
 *   1. The registry is the vocabulary: s6's five example segments registered by name; the one whose
 *      gate FAILED (long-term treatment -- nothing writes in_progress) is refused everywhere, never
 *      computed as a permanently-zero population.
 *   2. Segments compute what their definitions claim, against controlled fixtures: ages against the
 *      practice's today with no-birth-date patients DISCLOSED as unplaceable; no-recent-visit
 *      catches the never-seen; multiple-conditions needs DISTINCT labels (a duplicate label is one
 *      condition).
 *   3. The filtered list is permission-scoped: names under patient.view, unnamed rows without it,
 *      the count identical either way. Intersection means AND.
 *   4. Saved cohorts store the DEFINITION: unknown segment ids refused on save AND dropped on read;
 *      a duplicate active name refused by the engine and backstopped by the sentinel index; retiring
 *      frees the name; every save/retire/view leaves its audit row.
 *
 *   npx --yes tsx scripts/practice-cohort-harness.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, recordDiagnosis } from "../src/lib/practice/encounters";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import {
  computeSegments, cohortPatients, saveCohort, listCohorts, retireCohort,
} from "../src/lib/practice/cohort-engine";
import { SEGMENT_REGISTRY, segmentById } from "../src/lib/practice/segment-registry";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000a7e06";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

async function cleanup() { await purgeWorkspacesOwnedBy(admin, [OWNER]); }

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nCPR-PI-001 v2 s6 cohort harness\n");
  await cleanup();

  // ── 1. The registry ────────────────────────────────────────────────────────
  ok("1-1. s6's five example segments are registered by name",
    ["seg.paediatric", "seg.older_adult", "seg.no_recent_visit", "seg.multiple_conditions", "seg.long_term_treatment"]
      .every(id => !!segmentById(id)));
  ok("1-2. ⚠ the gate-failed segment names its missing writer, and it is the only one",
    SEGMENT_REGISTRY.filter(s => s.gateFailed).map(s => s.segmentId).join() === "seg.long_term_treatment"
      && /NOTHING writes it yet/.test(segmentById("seg.long_term_treatment")!.gateFailed ?? ""));
  ok("1-3. every definition is a human-readable sentence, not a filter expression",
    SEGMENT_REGISTRY.every(s => s.definition.length > 60 && !s.definition.includes("SELECT")));

  // ── 2. Fixtures ────────────────────────────────────────────────────────────
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-coh-${Date.now()}`, request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: "harness", correlation_id: "harness-coh",
  }).select("id").single();
  const payload: IndividualRequest = {
    displayName: "HARNESS COHORT (synthetic)", countryCode: "UG", timezone: "Africa/Kampala",
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: OWNER, correlation_id: "harness-coh", workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { ok("fixture provisions", false, String(run.errorCode)); return report(); }
  const ws = run.workspaceId;
  const ctxRes = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!ctxRes.ok) { ok("context resolves", false); return report(); }
  const ctx = ctxRes.ctx;
  const base = { actorId: OWNER, correlationId: "harness-coh" };

  // Child (2015), older adult (1950), adult with TWO distinct conditions and a recent visit (1990),
  // and an adult with NO date of birth -- the unplaceable disclosure.
  const child = await registerPatient(admin, { workspaceId: ws, displayName: "Child Segment", sex: "female", birthDate: "2015-03-01", phone: "0772 000 031", ...base });
  const older = await registerPatient(admin, { workspaceId: ws, displayName: "Older Segment", sex: "male", birthDate: "1950-06-01", phone: "0772 000 032", ...base });
  const adult = await registerPatient(admin, { workspaceId: ws, displayName: "Adult Twocond", sex: "female", birthDate: "1990-01-01", phone: "0772 000 033", ...base });
  // CPR-V2-005: birthDate OR ageEstimateYears. This one has only the estimate -- which the age
  // segments must honour, because the minimum dataset promises it places the patient.
  const noDob = await registerPatient(admin, { workspaceId: ws, displayName: "Estimated Forty", sex: "male", ageEstimateYears: 40, phone: "0772 000 034", ...base });
  if (!child.ok || !older.ok || !adult.ok || !noDob.ok) {
    ok("patients register", false, JSON.stringify([child, older, adult, noDob].filter(r => !r.ok)));
    return report();
  }
  // And one row written AROUND the engine with neither -- the schema allows it, the engine refuses
  // it, so the unplaceable disclosure needs a bypass fixture to be testable at all.
  const bareIns = await admin.from("practice_patient").insert({
    workspace_id: ws, display_name: "Neither Recorded", sex: "unknown", status: "active",
  }).select("id").maybeSingle();
  if (!bareIns.data?.id) { ok("bypass fixture inserts", false, bareIns.error?.message ?? "no id"); return report(); }
  const enc = await launchEncounter(admin, { workspaceId: ws, patientId: adult.data.id, pathway: "new_walk_in", ...base });
  if (!enc.ok) { ok("encounter launches", false); return report(); }
  const dx1 = await recordDiagnosis(admin, { workspaceId: ws, encounterId: enc.data.id, label: "Diabetes mellitus", certainty: "confirmed", ...base });
  const dx2 = await recordDiagnosis(admin, { workspaceId: ws, encounterId: enc.data.id, label: "Hypertension", certainty: "confirmed", ...base });
  // A DUPLICATE label -- distinct means distinct, so this must not create a second condition.
  const dx3 = await recordDiagnosis(admin, { workspaceId: ws, encounterId: enc.data.id, label: "Hypertension", certainty: "suspected", ...base });
  if (!dx1.ok || !dx2.ok || !dx3.ok) { ok("diagnoses record", false); return report(); }

  // ── 3. Segments compute their own definitions ──────────────────────────────
  const segs = await computeSegments(admin, ctx, {});
  if (!segs.ok) { ok("segments compute", false, segs.message); return report(); }
  const by = (id: string) => segs.results.find(r => r.segment.segmentId === id)!;
  ok("3-1. gate-failed segment is NOT among the computed results",
    !segs.results.some(r => r.segment.segmentId === "seg.long_term_treatment"));
  ok("3-2. paediatric: the child alone; the age ESTIMATE places a patient; only neither-recorded is unplaceable",
    by("seg.paediatric").count === 1 && by("seg.paediatric").unplaceable === 1
      && by("seg.paediatric").denominator === 5,
    JSON.stringify(by("seg.paediatric")));
  ok("3-3. older adult: one of five (the estimated-forty patient is placed, and placed OUT)",
    by("seg.older_adult").count === 1 && by("seg.older_adult").denominator === 5);
  ok("3-4. no recent visit: everyone but the adult seen today (never-seen counts as no-visit)",
    by("seg.no_recent_visit").count === 4 && by("seg.no_recent_visit").noVisitDays === 180,
    JSON.stringify(by("seg.no_recent_visit")));
  ok("3-5. ⚠ multiple conditions needs DISTINCT labels: two labels + one duplicate = ONE patient, not zero and not two",
    by("seg.multiple_conditions").count === 1,
    JSON.stringify(by("seg.multiple_conditions")));

  // ── 4. The filtered list: intersection, permission-scoped ─────────────────
  const list = await cohortPatients(admin, ctx, { segmentIds: ["seg.no_recent_visit", "seg.older_adult"] });
  ok("4-1. intersection means AND: older AND not recently seen = the 1950 patient alone, named under patient.view",
    list.ok && list.total === 1 && list.rows[0]?.label === "Older Segment" && list.identified,
    JSON.stringify(list.ok ? list.rows : list));
  const noNames = { ...ctx, capabilities: ctx.capabilities.filter(c => c !== "patient.view") };
  const unnamed = await cohortPatients(admin, noNames as any, { segmentIds: ["seg.older_adult"] });
  ok("4-2. without patient.view the COUNT is identical and the rows are deliberately unnamed",
    unnamed.ok && unnamed.total === 1 && !unnamed.identified
      && unnamed.rows[0]?.label.includes("patient.view"),
    JSON.stringify(unnamed.ok ? unnamed.rows : unnamed));
  const gateRefused = await cohortPatients(admin, ctx, { segmentIds: ["seg.long_term_treatment"] });
  ok("4-3. the gate-failed segment refuses a list, naming the missing writer",
    !gateRefused.ok && gateRefused.code === "SEGMENT_GATE_FAILED" && /NOTHING writes it/.test(gateRefused.message));

  // ── 5. Saved cohorts: the definition, never the members ───────────────────
  const saved = await saveCohort(admin, ctx, { name: "Older, not seen lately", segmentIds: ["seg.older_adult", "seg.no_recent_visit"], ...base });
  ok("5-1. a cohort saves under cohort.manage", saved.ok, JSON.stringify(saved));
  const dup = await saveCohort(admin, ctx, { name: "older, NOT seen lately", segmentIds: ["seg.older_adult"], ...base });
  ok("5-2. ⚠ a duplicate ACTIVE name is refused case-insensitively, by name",
    !dup.ok && dup.code === "COHORT_NAME_TAKEN");
  const junk = await saveCohort(admin, ctx, { name: "Free-form", segmentIds: ["age > 65"], ...base });
  ok("5-3. an unregistered segment id cannot be saved -- free-form filters do not exist on purpose",
    !junk.ok && junk.code === "UNREGISTERED_SEGMENT");
  const gateSave = await saveCohort(admin, ctx, { name: "Long term", segmentIds: ["seg.long_term_treatment"], ...base });
  ok("5-4. the gate-failed segment cannot be saved either",
    !gateSave.ok && gateSave.code === "SEGMENT_GATE_FAILED");
  const noManage = { ...ctx, capabilities: ctx.capabilities.filter(c => c !== "cohort.manage") };
  const denied = await saveCohort(admin, noManage as any, { name: "Denied", segmentIds: ["seg.older_adult"], ...base });
  ok("5-5. report.view alone cannot save -- cohort.manage is named in the refusal",
    !denied.ok && denied.status === 403 && /cohort\.manage/.test(denied.message));

  // A row written around the engine with a junk id: the READ validates too and drops it.
  await admin.from("practice_cohort").insert({
    workspace_id: ws, name: "Tampered", segment_ids: ["seg.older_adult", "seg.invented"], created_by: OWNER,
  });
  const listed = await listCohorts(admin, ctx);
  ok("5-6. ⚠ a stale or tampered segment id is DROPPED on read -- a saved row cannot widen a population",
    listed.ok && listed.cohorts.find(c => c.name === "Tampered")?.segmentIds.join() === "seg.older_adult",
    JSON.stringify(listed.ok ? listed.cohorts : listed));

  const retire = saved.ok ? await retireCohort(admin, ctx, { cohortId: saved.id, ...base }) : { ok: false as const, status: 0, code: "", message: "" };
  const renamed = await saveCohort(admin, ctx, { name: "Older, not seen lately", segmentIds: ["seg.older_adult"], ...base });
  ok("5-7. retiring frees the name (the sentinel index keys retired rows on their own id)",
    retire.ok && renamed.ok, JSON.stringify({ retire, renamed }));

  const { data: trail } = await admin.from("practice_audit_event")
    .select("event_type").eq("workspace_id", ws)
    .in("event_type", ["practice.cohort_saved", "practice.cohort_retired", "practice.cohort_viewed"]);
  const kinds = new Set(((trail ?? []) as any[]).map(r => r.event_type));
  ok("5-8. save, retire and view each left an audit row",
    kinds.has("practice.cohort_saved") && kinds.has("practice.cohort_retired") && kinds.has("practice.cohort_viewed"),
    [...kinds].join(", "));

  // ── 6. Source pins ─────────────────────────────────────────────────────────
  const areasSrc = readFileSync(join(process.cwd(), "src", "app", "practice", "(shell)", "intelligence", "AreasV2.tsx"), "utf8");
  const pageSrc = readFileSync(join(process.cwd(), "src", "app", "practice", "(shell)", "intelligence", "page.tsx"), "utf8");
  ok("6-1. the cohort controls are ON Patient Intelligence, filters not destinations",
    areasSrc.includes("All patients") && areasSrc.includes("not computable yet")
      && areasSrc.includes("stores its definition, never its members"));
  ok("6-2. the page validates segment and cohort params against the registry and the saved list",
    pageSrc.includes("isSegmentId(sp.segment)") && pageSrc.includes("savedCohorts.find(c => c.id === sp.cohort)"));

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
