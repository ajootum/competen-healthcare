/**
 * CPR-PI-001 v2 P0 harness -- the rebuilt intelligence screens and the metrics beneath them.
 *
 * WHAT IT PROVES:
 *   1. The three pi-v2 extras compute what their registry entries claim, against live fixtures:
 *      recency buckets that SUM to their denominator, a visits-per-patient ratio carried as both
 *      halves, and a median that keeps early completions negative.
 *   2. Every pi.* metric id resolves in the registry; every one that renders as a percentage
 *      declares numerator AND denominator (v2 s14).
 *   3. THE FROZEN CONTENT (owner, 2026-08-15): the strip is v2 s3's order verbatim; the labels are
 *      the frozen labels; the five areas each carry a trust footer; every percentage on the rebuilt
 *      screens is born in ofPct() beside its own counts; care gaps ROUTE (s17) instead of acting.
 *      A change to any of this arrives holding a document, or this file goes red.
 *   4. Off-strip keys (brief, cohorts, pathways) stay VALID -- removed from the strip is not deleted.
 *
 *   npx --yes tsx scripts/practice-pi-v2-harness.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter } from "../src/lib/practice/encounters";
import { createFollowUp, closeFollowUp } from "../src/lib/practice/follow-ups";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { piV2Extras, medianOf } from "../src/lib/practice/pi-v2";
import { intelRange, locationIntelligence } from "../src/lib/practice/intelligence";
import { METRIC_REGISTRY, metricById } from "../src/lib/practice/intelligence-registry";
import { INTELLIGENCE_TAB_STRIP, INTELLIGENCE_TABS, isIntelligenceTab } from "../src/lib/practice/intelligence-constants";
import { practiceToday } from "../src/lib/practice/practice-time";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000a1b20";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

async function cleanup() { await purgeWorkspacesOwnedBy(admin, [OWNER]); }

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nCPR-PI-001 v2 P0 harness\n");
  await cleanup();

  // ── 1. Pure arithmetic ─────────────────────────────────────────────────────
  ok("P-1. medianOf: odd, even (kept as .5), empty",
    medianOf([7, 3, 5]) === 5 && medianOf([3, 7]) === 5 && medianOf([2, 3, 5, 8]) === 4 && medianOf([]) === null);

  // ── 2. The registry contract ───────────────────────────────────────────────
  const piIds = METRIC_REGISTRY.filter(m => m.metricId.startsWith("pi.")).map(m => m.metricId);
  ok("2-1. the P0 metric set is registered", piIds.length >= 7, piIds.join(", "));
  const rateBearing = ["pi.followup_completion", "pi.recency_last_visit", "pi.avg_visits_per_patient",
    "pi.top_conditions_by_patients", "pi.top_conditions_by_encounters", "pi.day_of_week",
    "pi.encounters_by_location"];
  ok("2-2. ⚠ v2 s14: every percentage-capable metric declares BOTH numerator and denominator",
    rateBearing.every(id => !!metricById(id)?.numerator && !!metricById(id)?.denominator),
    rateBearing.filter(id => !metricById(id)?.numerator || !metricById(id)?.denominator).join(", "));

  // ── 3. Live: the three extras against controlled fixtures ─────────────────
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-piv2-${Date.now()}`, request_type: "pilot",
    actor_user_id: OWNER, target_user_id: OWNER, payload_hash: "harness", correlation_id: "harness-piv2",
  }).select("id").single();
  const payload: IndividualRequest = {
    displayName: "HARNESS PIv2 (synthetic)", countryCode: "UG", timezone: "Africa/Kampala",
    professionCode: "medical_doctor", defaultPracticeType: "clinic", locale: "en-UG",
    termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
  };
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: OWNER, correlation_id: "harness-piv2", workspace_id: null }, payload);
  if (!run.ok || !run.workspaceId) { ok("fixture provisions", false, String(run.errorCode)); return report(); }
  const ws = run.workspaceId;
  const ctxRes = await resolveWorkspaceContext(admin, OWNER, ws);
  if (!ctxRes.ok) { ok("context resolves", false); return report(); }
  const ctx = ctxRes.ctx;
  const base = { actorId: OWNER, correlationId: "harness-piv2" };
  const today = practiceToday("Africa/Kampala");
  const dayShift = (days: number) => new Date(Date.parse(today + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);

  const p1 = await registerPatient(admin, { workspaceId: ws, displayName: "Seen Twice", sex: "female", birthDate: "1980-01-01", phone: "0772 000 001", ...base });
  const p2 = await registerPatient(admin, { workspaceId: ws, displayName: "Seen Once", sex: "male", birthDate: "1985-01-01", phone: "0772 000 002", ...base });
  const p3 = await registerPatient(admin, { workspaceId: ws, displayName: "Never Seen", sex: "female", birthDate: "1990-01-01", phone: "0772 000 003", ...base });
  if (!p1.ok || !p2.ok || !p3.ok) { ok("patients register", false); return report(); }
  const e1 = await launchEncounter(admin, { workspaceId: ws, patientId: p1.data.id, pathway: "new_walk_in", ...base });
  const e2 = await launchEncounter(admin, { workspaceId: ws, patientId: p1.data.id, pathway: "walk_in_followup", ...base });
  const e3 = await launchEncounter(admin, { workspaceId: ws, patientId: p2.data.id, pathway: "new_walk_in", ...base });
  if (!e1.ok || !e2.ok || !e3.ok) { ok("encounters launch", false); return report(); }

  // Two completed follow-ups with CONTROLLED due dates: closed today, due 7 and 3 days ago -> late by
  // 7 and 3 -> median 5. A third completed EARLY (due tomorrow) makes the negative-keeping visible.
  for (const [dueOffset] of [[-7], [-3], [1]] as const) {
    const fu = await createFollowUp(admin, {
      workspaceId: ws, patientId: p1.data.id, reason: "harness pair", dueOn: dayShift(dueOffset), ...base,
    });
    if (!fu.ok) { ok("follow-up fixture", false, (fu as any).message); return report(); }
    const closed = await closeFollowUp(admin, { workspaceId: ws, followUpId: fu.data.id, to: "COMPLETED", outcome: "harness", ...base });
    if (!closed.ok) { ok("follow-up closes", false, (closed as any).message); return report(); }
  }

  const extras = await piV2Extras(admin, ctx, { fromDay: dayShift(-30), toDay: today, todayDate: today });
  ok("3-1. the extras compute", extras.available, extras.unavailableReason ?? "");
  if (!extras.available || !extras.data) return report();
  const rec = extras.data.recency;
  ok("3-2. recency buckets SUM to their denominator, with never-seen its own visible group",
    rec.buckets.reduce((n, b) => n + b.count, 0) + rec.neverSeen === rec.denominator
      && rec.denominator === 3 && rec.neverSeen === 1
      && rec.buckets.find(b => b.key === "d0_30")?.count === 2,
    JSON.stringify({ d: rec.denominator, never: rec.neverSeen, b: rec.buckets.map(b => [b.key, b.count]) }));
  // ⚠ TWO encounters, not three: launching a second encounter for a patient who already has one
  // ACTIVE returns the existing one (the one-active-encounter invariant) -- the first draft of this
  // assertion expected 3 and the PRODUCT was right. The invariant is asserted alongside the ratio.
  ok("3-3. visits per patient is BOTH HALVES, and the one-active-encounter invariant held",
    extras.data.avgVisitsPerPatient.encounters === 2 && extras.data.avgVisitsPerPatient.patients === 2
      && e1.data.id === e2.data.id,
    JSON.stringify({ ...extras.data.avgVisitsPerPatient, sameEncounter: e1.data.id === e2.data.id }));
  ok("3-4. ⚠ the median keeps the EARLY completion negative: (-1, 3, 7) -> 3, over 3 pairs",
    extras.data.medianDaysToFollowUp.medianDays === 3 && extras.data.medianDaysToFollowUp.pairs === 3,
    JSON.stringify(extras.data.medianDaysToFollowUp));

  // v2 s10's By location card (consolidated 2026-08-15): these encounters ran outside any located
  // session, so every one must land in `unattributed` -- DISCLOSED, never dropped or redistributed.
  const liRange = await intelRange(admin, ws, { fromDay: dayShift(-30), toDay: today });
  const li = await locationIntelligence(admin, ctx, liRange);
  const liEnc: any = li.available ? (li.data as any).encounters : null;
  ok("3-5. locations: sessionless encounters are DISCLOSED as unattributed, and the denominator includes them",
    li.available && liEnc.status === "ok" && liEnc.rows.length === 0
      && liEnc.unattributed === 2 && liEnc.of === 2,
    JSON.stringify(liEnc ?? li));

  // ── 4. THE FROZEN CONTENT (owner, 2026-08-15) ──────────────────────────────
  ok("4-1. ⚠ FROZEN: the strip is CPR-PI-001 v2 s3's order, verbatim -- a change arrives with a document",
    INTELLIGENCE_TAB_STRIP.join() ===
      "overview,patients,clinical,followups,patterns,financial,performance,reports,assistant",
    INTELLIGENCE_TAB_STRIP.join(","));
  const labelOf = (k: string) => INTELLIGENCE_TABS.find(t => t.key === k)?.label;
  ok("4-2. FROZEN: the v2 destination labels",
    labelOf("patients") === "Patient Intelligence" && labelOf("clinical") === "Clinical Intelligence"
      && labelOf("followups") === "Follow-up & Outcomes" && labelOf("patterns") === "Practice Patterns"
      && labelOf("performance") === "Professional Portfolio" && labelOf("assistant") === "Ask Practice",
    INTELLIGENCE_TAB_STRIP.map(k => labelOf(k)).join(" | "));
  ok("4-3. removed from the strip is NOT deleted: brief, cohorts and pathways keys stay valid",
    isIntelligenceTab("brief") && isIntelligenceTab("cohorts") && isIntelligenceTab("pathways")
      && !INTELLIGENCE_TAB_STRIP.includes("brief" as any) && !INTELLIGENCE_TAB_STRIP.includes("cohorts" as any)
      && !INTELLIGENCE_TAB_STRIP.includes("pathways" as any));

  const areasSrc = readFileSync(join(process.cwd(), "src", "app", "practice", "(shell)", "intelligence", "AreasV2.tsx"), "utf8");
  const pageSrc = readFileSync(join(process.cwd(), "src", "app", "practice", "(shell)", "intelligence", "page.tsx"), "utf8");
  ok("4-4. ⚠ every percentage on the rebuilt screens is born in ofPct, beside its own counts",
    areasSrc.includes("function ofPct")
      && (areasSrc.match(/Math\.round\(\(numerator \/ denominator\) \* 100\)/g) ?? []).length === 1
      && !/\d+%/.test(areasSrc.replace(/72 of 96 \(75%\)|75%/g, "")),
    "a second percent factory or a literal percentage appeared outside ofPct");
  ok("4-5. all five rebuilt areas carry the trust footer",
    (areasSrc.match(/<TrustFooter ids=/g) ?? []).length === 5,
    `${(areasSrc.match(/<TrustFooter ids=/g) ?? []).length} footers`);
  ok("4-6. s17: care gaps ROUTE to the owning workspace",
    areasSrc.includes("/practice/follow-ups?filter=overdue") && areasSrc.includes('href="/practice/patients"'));
  ok("4-7. the page renders the strip FROM the strip constant, so declaration order cannot reorder it",
    pageSrc.includes("INTELLIGENCE_TAB_STRIP.map(k => INTELLIGENCE_TABS.find(t => t.key === k)!)"));
  ok("4-8. the falsified NO-RATES header is gone and the v2 doctrine stands in its place",
    !pageSrc.includes("NO RATES. All three comps") && pageSrc.includes("RATES ARE GOVERNED NOW"));
  ok("4-9. s10: the By location card renders the module's own rows -- the deferral paragraph is gone,"
    + " the unplaceable are a visible row, and the patterns footer names the registry entry",
    !areasSrc.includes("Consolidating them into this screen is part of the remaining P0 work")
      && areasSrc.includes("No location recorded")
      && areasSrc.includes('"pi.encounters_by_location"'));

  return report();
}

function report() {
  console.log(`\n${fails.length === 0 ? "PASSED" : "FAILED"}  ${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exitCode = 1; }
}

main()
  .then(cleanup)
  .catch(async e => { console.error(e); await cleanup(); process.exitCode = 1; });
