/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * INDIVIDUAL PROFESSIONAL ACCEPTANCE HARNESS -- COMPETEN-IND-007 against a real database, STAGING ONLY.
 *
 *   A. Direct entry: a Professional-only person (no Scholar row ever written) holds Professional live, and
 *      every step of the journey writes and reads back: profile, need, goal, CPD, evidence, Passport,
 *      progress, share.
 *   B. Evidence classes are the database's: no document gives self_declared, a document gives
 *      source_linked, a writer cannot store a class, and nothing can be stored as verified.
 *   C. Cross-person links are unrepresentable: a goal on another person's need, and a document path under
 *      another person's id, are refused by the schema.
 *   D. RLS (D6): own rows readable from a browser session, another person's not, and no writes at all.
 *   E. Reminders: an expiring credential is reminded once, recorded on the person's own row, and a second
 *      run sends nothing. No cdp_reminders and no notifications row is written.
 *   F. Share: a Professional link carries the person's own records; an estate-minted link for the same
 *      person does not; revoke works on the person's own link only.
 *   G. Shared frameworks only: the framework list has no hospital framework, and a hospital framework is
 *      refused as a reference.
 *   R. Release gate: the reminder job is silent while `individual_app` is OFF. The run switches it ON and
 *      restores the row it found (Z2), as individual-acceptance-harness does. Never production.
 *   M. Employer visibility (D1): no fixture row in cpd_logs, professional_credentials, evidence,
 *      cdp_reminders or notifications.
 *
 * ⚠ IT IMPORTS THE RULES IT TESTS. ⚠ MIGRATIONS 370 AND 373 FIRST: until 373 is applied every group
 * reports PEND, the run exits 0 and nothing is created. ⚠ STAGING ONLY -- assertSafeTarget refuses
 * production before any client is built:
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only individual-professional-acceptance
 *
 * ⚠ WALK-THROUGH IDENTITY. With IND007_PILOT_CREDENTIALS=<file> set, the run finishes by creating ONE
 * Professional-only pilot identity (harness-ind007-pilot@competen.test, granted through the foundation's
 * grant service, no Scholar row) and writes its generated password to that file -- never to the output.
 * A later run removes it first. Without the variable nothing is left behind.
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { readIndividualAccess, isNotProvisioned } from "../src/lib/individual/access";
import { grantIndividualAccess, validateGrant, isGrantRefusal, endIndividualExperience } from "../src/lib/individual/grants";
import { loadReminderPrefs } from "../src/lib/individual/professional/preferences";
import { loadIndividualPassport } from "../src/lib/individual/passport";
import { loadProfessionalRecord } from "../src/lib/individual/professional/record";
import { evidenceCoverage, goalActivity, planProgress, cpdHoursByYear } from "../src/lib/individual/professional/progress";
import { mintShare, listShares, revokeShare, shareCarriesOwnRecords } from "../src/lib/individual/professional/share";
import { scanProfessionalReminders, type ReminderSender } from "../src/lib/individual/professional/reminders";
import { loadSharedFrameworks, loadSharedCompetencies, checkSharedReference } from "../src/lib/individual/professional/frameworks";
import { DOCUMENT_BUCKET } from "../src/lib/individual/professional/vocabulary";
import { individualAppEnabled, INDIVIDUAL_APP_FLAG } from "../src/lib/individual/gate";
import { loadCatalogueFor } from "../src/lib/individual/catalogue";
import { MAPPING_PROMPT_VERSION } from "../src/lib/competency/mapping";
import { addPersonMapping, decideMapping, linksFor, listMappings, loadMappingView, professionalProgress, PROFESSIONAL_COVERAGE_REASONS } from "../src/lib/individual/professional/mapping-store";
import { loadOwnRecords } from "../src/lib/individual/professional/passport-records";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "individual-professional-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const FIX = {
  grantor: "harness-ind007-grantor@competen.test",
  pro: "harness-ind007-pro@competen.test",
  other: "harness-ind007-other@competen.test",
  pilot: "harness-ind007-pilot@competen.test",
};
const FIX_PASSWORD = `ind007-${Math.random().toString(36).slice(2)}-Aa1!`;
const PRO_TABLES = ["individual_professional_share", "individual_professional_cpd", "individual_professional_evidence",
  "individual_professional_goal", "individual_professional_need", "individual_professional_profile"];

async function findUser(email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}

async function removeUser(email: string) {
  const u = await findUser(email);
  if (!u) return;
  for (const t of PRO_TABLES) await admin.from(t).delete().eq("user_id", u.id);
  const { data: objs } = await admin.storage.from(DOCUMENT_BUCKET).list(u.id);
  if (objs?.length) await admin.storage.from(DOCUMENT_BUCKET).remove(objs.map((o: any) => `${u.id}/${o.name}`));
  await admin.from("passport_share_tokens").delete().eq("nurse_id", u.id);
  await admin.from("individual_entitlement").delete().eq("user_id", u.id);
  await admin.from("individual_membership").delete().eq("user_id", u.id);
  await admin.from("audit_log").delete().eq("actor_id", u.id);
  await admin.from("profiles").delete().eq("id", u.id);
  await admin.auth.admin.deleteUser(u.id);
}
const cleanup = async () => { for (const e of Object.values(FIX)) await removeUser(e); };

/** The release flag's row before this run, or null when there was none. Restored by restoreFlag(). Staging
 *  only -- assertSafeTarget above has already refused production. */
let priorFlag: { flag: string; enabled: boolean; note: string | null } | null = null;
let flagTouched = false;
async function restoreFlag() {
  if (!flagTouched) return;
  if (priorFlag) await admin.from("practice_platform_flags").upsert(priorFlag);
  else await admin.from("practice_platform_flags").delete().eq("flag", INDIVIDUAL_APP_FLAG);
}

async function makeUser(email: string, name: string, password = FIX_PASSWORD) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  await admin.from("profiles").update({ full_name: name }).eq("id", data.user.id);
  return data.user.id as string;
}

async function grantProfessional(target: string, by: string) {
  const req = validateGrant({ targetUserId: target, experiences: ["professional"], note: "IND-007 acceptance" });
  if (isGrantRefusal(req)) throw new Error(`grant refused: ${req.message}`);
  const out = await grantIndividualAccess(admin, req, by);
  if (!out.ok) throw new Error(`grant failed: ${out.message}`);
}

// ── K. COMPETENCY MAPPING (migration 393, COMPETEN-HOLDINGS-SHARED-ENGINES-01) ──────────────────────────
// Run inside G's allowlist window (one published shared framework allowlisted, restored after). The AI is
// not called: an AI proposal is written as the engine's result would be stored, because what is under
// test is the store, the schema and what counts -- the engine is the Holdings one and has its own harness.
type KCtx = { pro: string; other: string; goalId: string; cpdPlain: string; cpdDoc: string; today: string };

async function mappingDefault(pro: string, cpdDoc: string) {
  const view = await loadMappingView(admin, pro);
  const cat = await loadCatalogueFor(admin, "professional");
  const anyComp = (await admin.from("framework_competencies").select("id").limit(1).maybeSingle()).data?.id;
  const add = anyComp ? await addPersonMapping(admin, pro, "cpd", cpdDoc, anyComp, cat ?? []) : "no competency";
  const prog = professionalProgress(view, await loadProfessionalRecord(admin, pro));
  ok("K0. ⚠ default: nothing offered, a link is refused as not offered, and coverage is Not measured with the reason",
    view.provisioned && view.offered?.length === 0 && add === "not_offered" && prog.coverage.state === "not_measured" && prog.coverage.reason === PROFESSIONAL_COVERAGE_REASONS.noCatalogue,
    JSON.stringify({ provisioned: view.provisioned, offered: view.offered?.length, add, coverage: prog.coverage }));
}

async function mappingGroup(k: KCtx) {
  const cat = await loadCatalogueFor(admin, "professional");
  if (!cat || cat.length < 2) { console.log(`  PEND  K1-K12: the allowlisted framework offers ${cat?.length ?? "unreadable"} competencies (need 2)`); return; }
  const [A, B] = cat;
  const notOffered = (await admin.from("framework_competencies").select("id").not("id", "in", `(${cat.map(c => c.competencyId).join(",")})`).limit(1).maybeSingle()).data?.id;

  // K1-K3: the person links; only offered competencies, only their own entries.
  const addA = await addPersonMapping(admin, k.pro, "cpd", k.cpdDoc, A.competencyId, cat);
  const addGoal = await addPersonMapping(admin, k.pro, "goal", k.goalId, B.competencyId, cat);
  const again = await addPersonMapping(admin, k.pro, "cpd", k.cpdDoc, A.competencyId, cat);
  let m = await listMappings(admin, k.pro);
  ok("K1. the person links a CPD entry and a goal: source person, accepted at once; a second identical link is 'exists'",
    addA === "ok" && addGoal === "ok" && again === "exists" && m?.length === 2 && m.every(x => x.source === "person" && x.state === "accepted"), JSON.stringify({ addA, addGoal, again, m }));
  ok("K2. ⚠ a competency Professional does not offer is refused", notOffered ? (await addPersonMapping(admin, k.pro, "cpd", k.cpdDoc, notOffered, cat)) === "not_offered" : false, notOffered ? "" : "no competency outside the catalogue to try");
  const otherCpd = await admin.from("individual_professional_cpd").insert({ user_id: k.other, experience_code: "professional", activity_type: "course", title: "Harness OTHER course", hours: 1, activity_date: k.today }).select("id").single();
  const viaStore = await addPersonMapping(admin, k.pro, "cpd", otherCpd.data?.id, A.competencyId, cat);
  const viaSchema = await admin.from("individual_professional_competency_map").insert({ user_id: k.pro, cpd_id: otherCpd.data?.id, competency_id: A.competencyId, source: "person" });
  ok("K3. ⚠ another person's entry cannot be linked: the store says not found, and the schema refuses it (composite FK)",
    viaStore === "not_found" && !!viaSchema.error, `${viaStore} / ${viaSchema.error?.message ?? "insert succeeded"}`);

  // K4: provenance is the schema's.
  const aiBare = await admin.from("individual_professional_competency_map").insert({ user_id: k.pro, cpd_id: k.cpdPlain, competency_id: B.competencyId, source: "ai" });
  const personWithModel = await admin.from("individual_professional_competency_map").insert({ user_id: k.pro, cpd_id: k.cpdPlain, competency_id: B.competencyId, source: "person", model: "x", prompt_version: "y", confidence: 0.5 });
  const twoSubjects = await admin.from("individual_professional_competency_map").insert({ user_id: k.pro, cpd_id: k.cpdPlain, goal_id: k.goalId, competency_id: A.competencyId, source: "person" });
  ok("K4. ⚠ the schema refuses an AI row without model, prompt and confidence, a person row with them, and two subjects",
    !!aiBare.error && !!personWithModel.error && !!twoSubjects.error);

  // K5-K7: a proposal is not evidence until the person accepts it.
  const proposal = await admin.from("individual_professional_competency_map").insert({ user_id: k.pro, cpd_id: k.cpdPlain, competency_id: B.competencyId, source: "ai",
    confidence: 0.72, rationale: "Harness rationale", model: "harness-model", prompt_version: MAPPING_PROMPT_VERSION }).select("id").single();
  let view = await loadMappingView(admin, k.pro);
  let record = await loadProfessionalRecord(admin, k.pro);
  let prog = professionalProgress(view, record);
  let own = await loadOwnRecords(admin, k.pro);
  const linksOn = (id: string, title: string) => (own ?? []).find(o => o.kind === "cpd" && o.title === title)?.competencies ?? [];
  ok("K5. a proposal is shown as proposed and counts for nothing: coverage 1 (document-backed), the goal's competency is a gap, the Passport omits it",
    !proposal.error && linksFor(view, "cpd", k.cpdPlain)[0]?.state === "proposed"
      && prog.coverage.state === "measured" && prog.coverage.covered === 1 && prog.coverage.coveredPositive === 1
      && prog.goalGaps?.[0]?.competencies.map(c => c.id).join() === B.competencyId
      && linksOn(k.cpdDoc, "Harness workshop").join() === A.title && linksOn(k.cpdPlain, "Harness ALS course").length === 0,
    JSON.stringify({ err: proposal.error?.message, coverage: prog.coverage, gaps: prog.goalGaps, own: own?.map(o => [o.title, o.competencies]) }));
  const accepted = await decideMapping(admin, k.pro, proposal.data?.id, "accepted");
  view = await loadMappingView(admin, k.pro); record = await loadProfessionalRecord(admin, k.pro);
  prog = professionalProgress(view, record); own = await loadOwnRecords(admin, k.pro);
  ok("K6. once accepted it counts: coverage 2 (one with a document), no goal gap, and the Passport names it",
    accepted === "ok" && prog.coverage.state === "measured" && prog.coverage.covered === 2 && prog.coverage.coveredPositive === 1 && prog.goalGaps?.length === 0
      && linksOn(k.cpdPlain, "Harness ALS course").join() === B.title, JSON.stringify({ accepted, coverage: prog.coverage, gaps: prog.goalGaps }));
  ok("K7. ⚠ another person cannot decide on it", (await decideMapping(admin, k.other, proposal.data?.id, "rejected")) === "not_found");

  // K8: append-only, and a correction is a new row.
  const ds = await admin.from("individual_professional_competency_decision").select("id").eq("map_id", proposal.data?.id);
  const upd = await admin.from("individual_professional_competency_decision").update({ decision: "rejected" }).eq("id", ds.data?.[0]?.id);
  const del = await admin.from("individual_professional_competency_decision").delete().eq("id", ds.data?.[0]?.id);
  const aiDecider = await admin.from("individual_professional_competency_decision").insert({ user_id: k.pro, map_id: proposal.data?.id, decision: "accepted", decided_by: "ai" });
  await decideMapping(admin, k.pro, proposal.data?.id, "rejected");
  m = await listMappings(admin, k.pro);
  ok("K8. ⚠ decisions are append-only (update and delete refused, only the person decides); a rejection is a new row and wins",
    !!upd.error && !!del.error && !!aiDecider.error && m?.find(x => x.mapId === proposal.data?.id)?.state === "rejected", JSON.stringify({ upd: upd.error?.message, del: del.error?.message }));
  const relink = await addPersonMapping(admin, k.pro, "cpd", k.cpdPlain, B.competencyId, cat);
  m = await listMappings(admin, k.pro);
  ok("K9. linking again after a rejection is a new 'accepted' decision on the same row", relink === "ok" && m?.find(x => x.mapId === proposal.data?.id)?.state === "accepted", relink);

  // K10: erasing the entry still works -- the cascade path through the append-only trigger.
  const tmp = await admin.from("individual_professional_cpd").insert({ user_id: k.pro, experience_code: "professional", activity_type: "course", title: "Harness cascade", hours: 1, activity_date: k.today }).select("id").single();
  await addPersonMapping(admin, k.pro, "cpd", tmp.data?.id, A.competencyId, cat);
  const gone = await admin.from("individual_professional_cpd").delete().eq("id", tmp.data?.id);
  const leftMap = await admin.from("individual_professional_competency_map").select("id").eq("cpd_id", tmp.data?.id);
  ok("K10. deleting a CPD entry removes its links and their decisions (cascade through the append-only trigger)", !gone.error && (leftMap.data ?? []).length === 0, gone.error?.message ?? "");

  // K11: RLS -- own rows from a browser session, nobody else's, no writes.
  await addPersonMapping(admin, k.other, "cpd", otherCpd.data?.id, A.competencyId, cat);
  const user = createClient(url!, anonKey!, { auth: { persistSession: false } }) as any;
  const signIn = await user.auth.signInWithPassword({ email: FIX.pro, password: FIX_PASSWORD });
  if (signIn.error) ok("K11. the fixture can sign in for the mapping RLS check", false, signIn.error.message);
  else {
    const rows = await user.from("individual_professional_competency_map").select("user_id");
    const dec = await user.from("individual_professional_competency_decision").select("user_id");
    const w1 = await user.from("individual_professional_competency_map").insert({ user_id: k.pro, cpd_id: k.cpdDoc, competency_id: B.competencyId, source: "person" });
    const w2 = await user.from("individual_professional_competency_decision").insert({ user_id: k.pro, map_id: proposal.data?.id, decision: "rejected", decided_by: "person" });
    ok("K11. ⚠ RLS: a browser session reads only its own links and decisions and can write neither",
      (rows.data ?? []).length >= 3 && rows.data.every((r: any) => r.user_id === k.pro) && (dec.data ?? []).length > 0 && dec.data.every((r: any) => r.user_id === k.pro) && !!w1.error && !!w2.error,
      JSON.stringify({ rows: rows.data?.length, dec: dec.data?.length, w1: w1.error?.message, w2: w2.error?.message }));
    await user.auth.signOut();
  }
  return { A, B };
}

/** After G6 restored the allowlist: existing links stay, named, and nothing is measured. */
async function mappingAfterRestore(pro: string, names: { A: { title: string }; B: { title: string } } | undefined) {
  if (!names) return;
  const view = await loadMappingView(admin, pro);
  const prog = professionalProgress(view, await loadProfessionalRecord(admin, pro));
  const titles = new Set((view.mappings ?? []).map(x => view.names.get(x.competencyId)));
  ok("K12. with the allowlist restored (empty), the person's links remain and keep their names, and coverage is Not measured again",
    view.offered?.length === 0 && titles.has(names.A.title) && titles.has(names.B.title) && prog.coverage.state === "not_measured",
    JSON.stringify({ offered: view.offered?.length, titles: [...titles], coverage: prog.coverage }));
}

async function main() {
  console.log(`\nIndividual Professional acceptance harness -- COMPETEN-IND-007 -- target ${ref}\n`);
  if (process.env.IND007_RESTORE_GATE_FROM) return restoreHeldGate(process.env.IND007_RESTORE_GATE_FROM);
  const probe = await admin.from("individual_professional_cpd").select("id").limit(1);
  const pilotFile = process.env.IND007_PILOT_CREDENTIALS ?? null;
  if (probe.error && isNotProvisioned(probe.error)) {
    console.log("  PEND  A-M: migration 373 is not applied on this project. No Professional row was created.");
    if (pilotFile) await makePilot(pilotFile);
    console.log("\nPENDING -- 0 passed, 8 groups pending (apply 373, then re-run)");
    process.exit(0);
  }
  if (probe.error) { console.error(`store unreadable: ${probe.error.message}`); process.exit(1); }

  await cleanup();
  // ── R. the release gate (src/lib/individual/gate.ts): saved, OFF phase, ON for the run, restored in Z2 ──
  const flagRead = await admin.from("practice_platform_flags").select("flag, enabled, note").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle();
  if (flagRead.error) { console.error(`release flag unreadable: ${flagRead.error.message}`); process.exit(1); }
  priorFlag = flagRead.data ?? null;
  // ⚠ ANOTHER SESSION MAY BE HOLDING THE GATE ON (an owner viewing session, another experience's run). The
  // flag is shared staging state, so a run that finds it ON never switches it OFF under them: the OFF phase
  // is skipped (R1 PEND) and the flag is left exactly as found.
  if (priorFlag?.enabled === true) {
    console.log("  PEND  R1. individual_app is already ON (held by another session) -- the OFF phase is not run, and the flag is not touched");
  } else {
    flagTouched = true;
    await admin.from("practice_platform_flags").upsert({ flag: INDIVIDUAL_APP_FLAG, enabled: false, note: "individual-professional-acceptance-harness: OFF phase" });
    const off = await scanProfessionalReminders(admin);
    ok("R1. gate OFF: the reminder job sends nothing -- Individual does not exist", off.disabled === true && off.sent === 0);
    await admin.from("practice_platform_flags").upsert({ flag: INDIVIDUAL_APP_FLAG, enabled: true, note: "individual-professional-acceptance-harness: ON phase (restored after run)" });
  }
  ok("R2. gate ON for the run", (await individualAppEnabled(admin)) === true);

  const today = new Date().toISOString().slice(0, 10);
  const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const grantor = await makeUser(FIX.grantor, "IND-007 Grantor");
  const pro = await makeUser(FIX.pro, "Harness Professional");
  const other = await makeUser(FIX.other, "Harness Other");
  await grantProfessional(pro, grantor);
  await grantProfessional(other, grantor);
  const ids = [grantor, pro, other];

  // ── A. direct entry and the journey ──
  const a: any = await readIndividualAccess(admin, pro);
  const scholarRows = await admin.from("individual_entitlement").select("id").eq("user_id", pro).eq("experience_code", "scholar");
  ok("A1. direct entry: Professional live with no Scholar row ever written", a.state === "member" && a.live.join() === "professional" && (scholarRows.data ?? []).length === 0, JSON.stringify(a.live));

  const prof = await admin.from("individual_professional_profile").insert({ user_id: pro, experience_code: "professional",
    self_declared_profession: "Registered nurse", self_declared_registration_body: "Harness Council", self_declared_registration_number: "H-1",
    self_declared_registration_country: "Uganda" }).select("id").single();
  const need = await admin.from("individual_professional_need").insert({ user_id: pro, experience_code: "professional", title: "Harness need: resuscitation", origin: "self_identified" }).select("id").single();
  const goal = await admin.from("individual_professional_goal").insert({ user_id: pro, experience_code: "professional", need_id: need.data?.id, title: "Harness goal: ALS", target_date: inDays(90) }).select("id").single();
  const cpdPlain = await admin.from("individual_professional_cpd").insert({ user_id: pro, experience_code: "professional", goal_id: goal.data?.id, activity_type: "course", title: "Harness ALS course", hours: 7.5, activity_date: today, reflection: "Harness private reflection" }).select("id, evidence_class").single();
  const docPath = `${pro}/harness-cert.pdf`;
  await admin.storage.from(DOCUMENT_BUCKET).upload(docPath, Buffer.from("%PDF-1.4 harness"), { contentType: "application/pdf" });
  const cpdDoc = await admin.from("individual_professional_cpd").insert({ user_id: pro, experience_code: "professional", activity_type: "workshop", title: "Harness workshop", hours: 2, activity_date: today,
    document_path: docPath, document_name: "harness-cert.pdf", document_mime: "application/pdf", document_bytes: 16 }).select("id, evidence_class").single();
  const cred = await admin.from("individual_professional_evidence").insert({ user_id: pro, experience_code: "professional", kind: "credential", need_id: need.data?.id, title: "Harness licence", issuing_body: "Harness Council", expires_on: inDays(10) }).select("id, evidence_class").single();
  ok("A2. every journey step writes: profile, need, goal, CPD, evidence", [prof, need, goal, cpdPlain, cpdDoc, cred].every(r => !r.error && r.data), [prof, need, goal, cpdPlain, cpdDoc, cred].map(r => r.error?.message).filter(Boolean).join("; "));

  const record = await loadProfessionalRecord(admin, pro);
  ok("A3. the record reads back by the person's own id", record.provisioned && record.needs?.length === 1 && record.goals?.length === 1 && record.cpd?.length === 2 && record.evidence?.length === 1);
  const passport = await loadIndividualPassport(admin, pro, today);
  const classes = (passport.own ?? []).map(o => `${o.kind}:${o.evidence}`).sort().join(",");
  ok("A4. the Passport shows the own records, each by provenance", classes === "cpd:self_declared,cpd:source_linked,credential:self_declared,registration:self_declared", classes);
  ok("A5. the Passport never carries the private reflection", !JSON.stringify(passport.own).includes("Harness private reflection"));
  const plan = planProgress(record.goals!, today), years = cpdHoursByYear(record.cpd!), cov = evidenceCoverage(record.needs!, record.goals!, record.cpd!, record.evidence!);
  // Only the plain CPD entry is linked to the goal; the workshop is not, so it adds hours but no coverage.
  ok("A6. progress: plan measured, hours by year (both entries), coverage through the goal (one linked entry) and the evidence link",
    plan.completion === 0 && years[0]?.hours === 9.5 && cov.ratio === 1 && cov.needs[0].cpd === 1 && cov.needs[0].evidence === 1, JSON.stringify({ plan, years, cov: cov.needs }));

  // ── B. evidence classes are the database's ──
  ok("B1. no document gives self_declared, a document gives source_linked -- computed by the schema", cpdPlain.data?.evidence_class === "self_declared" && cpdDoc.data?.evidence_class === "source_linked");
  const forced = await admin.from("individual_professional_cpd").insert({ user_id: pro, experience_code: "professional", activity_type: "course", title: "Harness forced", hours: 1, activity_date: today, evidence_class: "independently_verified" });
  ok("B2. ⚠ a writer cannot store a class", !!forced.error, forced.error?.message ?? "insert succeeded");
  const verifiedCol = await admin.from("individual_professional_evidence").insert({ user_id: pro, experience_code: "professional", kind: "credential", title: "Harness verified", verified: true });
  ok("B3. ⚠ nothing can be stored as verified -- there is no such column", !!verifiedCol.error, verifiedCol.error?.message ?? "insert succeeded");
  const noOrigin = await admin.from("individual_professional_need").insert({ user_id: pro, title: "Harness no origin", origin: "self_identified" });
  ok("B4. experience_code has no default: a writer that does not say where a record came from fails", !!noOrigin.error);

  // ── C. cross-person links ──
  const crossGoal = await admin.from("individual_professional_goal").insert({ user_id: other, experience_code: "professional", need_id: need.data?.id, title: "Harness cross goal", target_date: inDays(30) });
  ok("C1. ⚠ a goal cannot point at another person's need (composite foreign key)", !!crossGoal.error, crossGoal.error?.message ?? "insert succeeded");
  const crossDoc = await admin.from("individual_professional_evidence").insert({ user_id: other, experience_code: "professional", kind: "competency", title: "Harness cross doc",
    document_path: docPath, document_name: "x.pdf", document_mime: "application/pdf", document_bytes: 1 });
  ok("C2. ⚠ a row cannot name a document under another person's id", !!crossDoc.error, crossDoc.error?.message ?? "insert succeeded");
  const delNeed = await admin.from("individual_professional_need").insert({ user_id: pro, experience_code: "professional", title: "Harness need to delete", origin: "self_identified" }).select("id").single();
  const linked = await admin.from("individual_professional_goal").insert({ user_id: pro, experience_code: "professional", need_id: delNeed.data?.id, title: "Harness goal survives", target_date: inDays(30) }).select("id").single();
  await admin.from("individual_professional_need").delete().eq("id", delNeed.data?.id);
  const survived = await admin.from("individual_professional_goal").select("need_id, user_id").eq("id", linked.data?.id).single();
  ok("C3. deleting a need keeps its goal and clears only the link (set null on need_id alone)", survived.data?.need_id === null && survived.data?.user_id === pro, JSON.stringify(survived));

  // ── D. RLS ──
  const user = createClient(url!, anonKey!, { auth: { persistSession: false } }) as any;
  const signIn = await user.auth.signInWithPassword({ email: FIX.pro, password: FIX_PASSWORD });
  if (signIn.error) ok("D0. the fixture can sign in for the RLS group", false, signIn.error.message);
  else {
    const own = await user.from("individual_professional_cpd").select("user_id");
    ok("D1. a signed-in person reads their own CPD", (own.data ?? []).length === 2 && own.data.every((r: any) => r.user_id === pro), JSON.stringify(own.error ?? own.data?.length));
    await admin.from("individual_professional_need").insert({ user_id: other, experience_code: "professional", title: "Harness OTHER need", origin: "self_identified" });
    const theirs = await user.from("individual_professional_need").select("id").eq("user_id", other);
    ok("D2. ⚠ cross-user isolation: another person's needs return nothing", (theirs.data ?? []).length === 0);
    const write = await user.from("individual_professional_cpd").insert({ user_id: pro, experience_code: "professional", activity_type: "course", title: "Harness browser write", hours: 1, activity_date: today });
    const upd = await user.from("individual_professional_profile").update({ self_declared_profession: "Harness changed" }).eq("user_id", pro).select("id");
    ok("D3. ⚠ a browser session can write nothing -- no insert, no update", !!write.error && (!!upd.error || (upd.data ?? []).length === 0));
    await user.auth.signOut();
  }

  // ── N. reminder preferences (migration 374, owner continuation GO Option A) ──
  const prefsPro = await loadReminderPrefs(admin, pro);
  if (!prefsPro.configurable) {
    console.log("  PEND  N1-N5, E1-E3: migration 374 is not applied on this project (reminder preferences absent)");
  } else {
    ok("N1. defaults: in-app reminders ON, email reminders OFF, for a person who never set them", prefsPro.inApp === true && prefsPro.email === false, JSON.stringify(prefsPro));
    await admin.from("individual_professional_profile").update({ reminder_in_app: false }).eq("user_id", pro);
    const p1 = await loadReminderPrefs(admin, pro);
    await admin.from("individual_professional_profile").update({ reminder_email: true }).eq("user_id", pro);
    const p2 = await loadReminderPrefs(admin, pro);
    ok("N2. the two switches are independent: turning in-app off leaves email off, turning email on leaves in-app off",
      p1.inApp === false && p1.email === false && p2.inApp === false && p2.email === true, JSON.stringify({ p1, p2 }));
    await admin.from("individual_professional_profile").update({ reminder_in_app: true }).eq("user_id", pro);

    // `other` holds Professional, has an expiring credential, and never opted in to email.
    await admin.from("individual_professional_evidence").insert({ user_id: other, experience_code: "professional", kind: "credential", title: "Harness OTHER licence", expires_on: inDays(10) });

    // ── E. reminders ──
    // No real mail from a harness: with the provider unset, dispatch records the email as skipped. What is under
    // test is who is chosen and the once-only mark, not Resend.
    delete process.env.RESEND_API_KEY;
    // A provider that DELIVERS, injected: no real mail leaves a harness, and the real sender would report
    // "skipped" here, which -- correctly -- no longer consumes the reminder (owner review, E4 below).
    const delivered: ReminderSender = async () => ({ sent: true });
    const undelivered: ReminderSender = async () => ({ sent: false, error: "harness: provider refused" });
    const r1 = await scanProfessionalReminders(admin, new Date(), delivered);
    const marked = await admin.from("individual_professional_evidence").select("expiry_reminded_for, expires_on").eq("id", cred.data?.id).single();
    const r2 = await scanProfessionalReminders(admin, new Date(), delivered);
    ok("E1. an expiring credential of a person who opted in is emailed once, recorded on the person's own row",
      r1.recipients.includes(pro) && marked.data?.expiry_reminded_for === marked.data?.expires_on, JSON.stringify({ r1, marked: marked.data }));
    ok("N3. email only when opted in: the person who never opted in is not emailed", !r1.recipients.includes(other), JSON.stringify(r1.recipients));
    const again = await admin.from("individual_professional_evidence").select("expiry_reminded_for").eq("id", cred.data?.id).single();
    ok("E2. a second run does not remind the same date again", again.data?.expiry_reminded_for === marked.data?.expires_on && !r2.recipients.includes(pro), JSON.stringify(r2));
    const badMark = await admin.from("individual_professional_evidence").update({ expiry_reminded_for: inDays(400) }).eq("id", cred.data?.id);
    ok("E3. ⚠ a reminder mark can only name the expiry date it was for", !!badMark.error);

    // Owner review: a failed delivery must stay observable and must NOT consume the once-only reminder.
    const fresh = await admin.from("individual_professional_evidence").insert({ user_id: pro, experience_code: "professional", kind: "credential", title: "Harness second licence", expires_on: inDays(20) }).select("id").single();
    const failedRun = await scanProfessionalReminders(admin, new Date(), undelivered);
    const afterFail = await admin.from("individual_professional_evidence").select("expiry_reminded_for").eq("id", fresh.data?.id).single();
    const retry = await scanProfessionalReminders(admin, new Date(), delivered);
    const afterRetry = await admin.from("individual_professional_evidence").select("expiry_reminded_for, expires_on").eq("id", fresh.data?.id).single();
    ok("E4. ⚠ a failed send is reported, releases the reminder (marker unchanged), and the next run delivers and marks it once",
      failedRun.failed >= 1 && failedRun.failures.some(f => f.userId === pro && /provider refused/.test(f.error))
      && afterFail.data?.expiry_reminded_for === null
      && retry.recipients.includes(pro) && afterRetry.data?.expiry_reminded_for === afterRetry.data?.expires_on,
      JSON.stringify({ failedRun, afterFail: afterFail.data, retry: retry.recipients, afterRetry: afterRetry.data }));

    // Entitlement: `other` opts in, then their Professional period ends. Opting in is not enough.
    await admin.from("individual_professional_profile").insert({ user_id: other, experience_code: "professional", reminder_email: true });
    const ended = await endIndividualExperience(admin, other, "professional");
    const r3 = await scanProfessionalReminders(admin, new Date(), delivered);
    ok("N4. entitlement respected: an opted-in person whose Professional has ended is not emailed", ended.ok && !r3.recipients.includes(other), JSON.stringify({ ended, r3 }));
    const estatePrefs = await admin.from("notification_preferences").select("user_id", { count: "exact", head: true }).in("user_id", ids);
    ok("N5. ⚠ nothing was written to the estate notification_preferences for any fixture", !estatePrefs.error && (estatePrefs.count ?? 0) === 0, estatePrefs.error?.message ?? String(estatePrefs.count));
  }

  // ── F. share ──
  const link = await mintShare(admin, pro, { scope: "full", label: "Harness link", days: 7 });
  ok("F1. a Professional link is minted on passport_share_tokens with no hospital stamp", !!link && (await admin.from("passport_share_tokens").select("hospital_id").eq("id", link!.id).single()).data?.hospital_id === null);
  ok("F2. the Professional link carries the person's own records", !!link && await shareCarriesOwnRecords(admin, link!.id, pro));
  const estate = await admin.from("passport_share_tokens").insert({ token: `harness-ind007-${Date.now()}`, nurse_id: pro, scope: "full", consent: true, revoked: false }).select("id").single();
  ok("F3. ⚠ an estate-minted link for the same person does NOT carry them", !!estate.data && !(await shareCarriesOwnRecords(admin, estate.data.id, pro)));
  const listed = await listShares(admin, pro);
  ok("F4. the person's Professional links list excludes the estate link", (listed ?? []).length === 1 && listed![0].id === link?.id);
  ok("F5. ⚠ another person cannot revoke it", !(await revokeShare(admin, other, link!.id)));
  ok("F6. the person can revoke it", await revokeShare(admin, pro, link!.id));

  // ── G. shared, published AND allowlisted frameworks only ──
  // S1: the Professional allowlist (Individual policy). The run snapshots its row and restores it exactly.
  const ALLOW = { scope_type: "platform", scope_ref: "individual", config_path: "individual.policy.professional_catalogues" };
  const allowBefore = (await admin.from("workspace_config_overrides").select("*").match(ALLOW).maybeSingle()).data;
  const restoreAllow = async () => {
    await admin.from("workspace_config_overrides").delete().match(ALLOW);
    if (allowBefore) await admin.from("workspace_config_overrides").insert(allowBefore);
  };
  const fws = await loadSharedFrameworks(admin);
  const has393 = !(await admin.from("individual_professional_competency_map").select("id").limit(0)).error;
  if (!has393) console.log("  PEND  K0-K12: migration 393 is not applied on this project");
  let kNames: Awaited<ReturnType<typeof mappingGroup>> | undefined;
  // ⚠ THE EMPTY DEFAULT IS PROVEN EVERY RUN (owner decision D1: Professional must stay usable with no catalogue).
  // Staging may now offer CF-FOUND, so the run empties the allowlist for these checks and restores it exactly.
  await admin.from("workspace_config_overrides").delete().match(ALLOW);
  try {
    if (has393) await mappingDefault(pro, cpdDoc.data!.id);
    const none = await loadSharedFrameworks(admin);
    ok("G0. ⚠ S1: with no Professional allowlist, no framework is offered at all, published or not", none !== null && none.length === 0, `${none?.length} offered`);
    const rec = await loadProfessionalRecord(admin, pro);
    const acts = goalActivity(rec.goals ?? [], rec.cpd ?? [], today);
    const prog0 = has393 ? professionalProgress(await loadMappingView(admin, pro), rec) : null;
    const mine = acts.find(x => x.goalId === goal.data!.id);
    ok("OD0. ⚠ owner D1: with no catalogue Professional still works -- goals, CPD by goal and hours read back, coverage is Not measured with its reason",
      !!rec.goals?.length && mine?.entries === 1 && mine?.hours === 7.5 && (prog0 === null || (prog0.coverage.state === "not_measured" && prog0.coverage.reason === PROFESSIONAL_COVERAGE_REASONS.noCatalogue)),
      JSON.stringify({ goals: rec.goals?.length, acts, coverage: prog0?.coverage }));
  } finally { await restoreAllow(); }
  const fwIds = (fws ?? []).map(f => f.id);
  const leak = fwIds.length ? await admin.from("frameworks").select("id").in("id", fwIds).not("hospital_id", "is", null) : { data: [] };
  const unpublished = fwIds.length ? await admin.from("frameworks").select("id").in("id", fwIds).neq("pub_status", "published") : { data: [] };
  ok("G1. the framework list holds shared, PUBLISHED frameworks only (COMPETEN-CONFIG-002 P0)",
    fws !== null && (leak.data ?? []).length === 0 && (unpublished.data ?? []).length === 0, `${fwIds.length} shared and published`);
  const draftFw = await admin.from("frameworks").select("id").is("hospital_id", null).neq("pub_status", "published").limit(1).maybeSingle();
  if (draftFw.data) ok("G3. ⚠ a shared framework that is not published is refused as a reference", (await checkSharedReference(admin, draftFw.data.id, null)) !== null);
  else console.log("  PEND  G3. staging has no unpublished shared framework to refuse");
  // ⚠ THE POSITIVE PATH. G1 alone passes on an empty list, which proves exclusion and nothing about offering.
  // With a published shared framework present, it must be offered, and it and one of its competencies must
  // be accepted as a reference -- exactly what the Professional picker and the write check use.
  const pubFw = await admin.from("frameworks").select("id, name").is("hospital_id", null).eq("is_active", true).eq("pub_status", "published").limit(1).maybeSingle();
  if (pubFw.data) {
    // Allowlist exactly this framework (as HQ would publish it), test, then restore the prior row.
    try {
      await admin.from("workspace_config_overrides").delete().match(ALLOW);
      await admin.from("workspace_config_overrides").insert({ ...ALLOW, draft: { ids: [pubFw.data.id] }, published: { ids: [pubFw.data.id] } });
      const offered = ((await loadSharedFrameworks(admin)) ?? []).map(f => f.id);
      const comps = await loadSharedCompetencies(admin, pubFw.data.id);
      ok("G4. an ALLOWLISTED, shared, PUBLISHED framework is offered, and it and its competency are accepted as references",
        offered.length === 1 && offered[0] === pubFw.data.id && !!comps?.length
          && (await checkSharedReference(admin, pubFw.data.id, null)) === null
          && (await checkSharedReference(admin, pubFw.data.id, comps![0].id)) === null,
        `${pubFw.data.name}: offered ${JSON.stringify(offered)}, ${comps?.length ?? 0} competencies`);
      if (draftFw.data) ok("G5. ⚠ S1: a draft is still refused even while the allowlist names something", (await checkSharedReference(admin, draftFw.data.id, null)) !== null);
      if (has393) kNames = await mappingGroup({ pro, other, goalId: goal.data!.id, cpdPlain: cpdPlain.data!.id, cpdDoc: cpdDoc.data!.id, today });
    } finally { await restoreAllow(); }
    const back = (await admin.from("workspace_config_overrides").select("*").match(ALLOW).maybeSingle()).data;
    ok("G6. the Professional allowlist is restored exactly", JSON.stringify(back) === JSON.stringify(allowBefore));
    if (has393) {
      await admin.from("workspace_config_overrides").delete().match(ALLOW);
      try { await mappingAfterRestore(pro, kNames); } finally { await restoreAllow(); }
    }
    // D1: with the allowlist as staging holds it, every offered competency carries its real review state.
    const offeredNow = has393 ? (await loadMappingView(admin, pro)).offered : null;
    if (offeredNow?.length) {
      const cat = await loadCatalogueFor(admin, "professional");
      const truthful = (cat ?? []).every(c => (c.contentStatus === "approved") === (c.clinicalState === "approved"));
      ok("OD1. owner D1: every competency Professional offers shows its actual clinical review state, and none reads approved without a clinical approval",
        offeredNow.every(o => !!o.review) && truthful, JSON.stringify([...new Set(offeredNow.map(o => o.review))]));
    } else console.log("  PEND  OD1. Professional offers nothing on this project (allowlist empty)");
  } else console.log("  PEND  G4. staging has no published shared framework to offer");
  const hospFw = await admin.from("frameworks").select("id").not("hospital_id", "is", null).limit(1).maybeSingle();
  if (hospFw.data) ok("G2. ⚠ a hospital framework is refused as a reference", (await checkSharedReference(admin, hospFw.data.id, null)) !== null);
  else console.log("  PEND  G2. staging has no hospital-owned framework to refuse");

  // ── M. employer visibility ──
  const estateTables: [string, string][] = [["cpd_logs", "user_id"], ["professional_credentials", "nurse_id"], ["evidence", "owner_id"], ["cdp_reminders", "recipient_id"], ["notifications", "user_id"], ["notification_preferences", "user_id"]];
  const counts = await Promise.all(estateTables.map(([t, c]) => admin.from(t).select("*", { count: "exact", head: true }).in(c, ids)));
  const written = estateTables.filter((_, i) => !counts[i].error && (counts[i].count ?? 0) > 0).map(([t]) => t);
  const unread = estateTables.filter((_, i) => !!counts[i].error).map(([t]) => t);
  ok("M1. D1: no fixture row in cpd_logs, professional_credentials, evidence, cdp_reminders, notifications or notification_preferences", written.length === 0 && unread.length === 0, `written: ${written.join(",")} unreadable: ${unread.join(",")}`);

  await admin.from("passport_share_tokens").delete().eq("id", estate.data?.id);
  await cleanup();
  const left = await Promise.all(PRO_TABLES.map(t => admin.from(t).select("*", { count: "exact", head: true }).in("user_id", ids)));
  ok("Z1. fixtures removed -- no Professional row left for any fixture", left.every(r => !r.error && (r.count ?? 0) === 0));
  const leftMaps = await Promise.all(["individual_professional_competency_map", "individual_professional_competency_decision"].map(t => admin.from(t).select("*", { count: "exact", head: true }).in("user_id", ids)));
  if (!leftMaps[0].error) ok("Z3. no competency link or decision left for any fixture (393 cascade)", leftMaps.every(r => !r.error && (r.count ?? 0) === 0));
  await restoreFlag();
  const flagAfter = await admin.from("practice_platform_flags").select("enabled").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle();
  ok("Z2. the release flag is restored to its state before the run",
    priorFlag ? flagAfter.data?.enabled === priorFlag.enabled : flagAfter.data === null);

  if (pilotFile) await makePilot(pilotFile);
  await holdGateForWalkthrough();
  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
}

/**
 * ⚠ THE BROWSER WALK-THROUGH NEEDS THE GATE ON, AND THE RESTORE MUST STILL BE EXPLICIT. With
 * IND007_HOLD_GATE_FILE=<file>, after Z2 has proved the restore works, the run writes the flag row it
 * found to that file and switches the gate ON again. A second invocation with
 * IND007_RESTORE_GATE_FROM=<file> puts that row back (or removes the flag when there was none) and exits.
 * Tell any other session using the flag before holding it.
 */
async function holdGateForWalkthrough() {
  const file = process.env.IND007_HOLD_GATE_FILE;
  if (!file) return;
  writeFileSync(file, JSON.stringify({ prior: priorFlag }));
  await admin.from("practice_platform_flags").upsert({ flag: INDIVIDUAL_APP_FLAG, enabled: true, note: "IND-007 walk-through hold (restore with IND007_RESTORE_GATE_FROM)" });
  console.log(`  HOLD  individual_app is ON for the walk-through. The prior state is in IND007_HOLD_GATE_FILE. Restore it afterwards.`);
}

async function restoreHeldGate(file: string) {
  const { prior } = JSON.parse(readFileSync(file, "utf8")) as { prior: typeof priorFlag };
  if (prior) await admin.from("practice_platform_flags").upsert(prior);
  else await admin.from("practice_platform_flags").delete().eq("flag", INDIVIDUAL_APP_FLAG);
  const after = await admin.from("practice_platform_flags").select("enabled").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle();
  const restored = prior ? after.data?.enabled === prior.enabled : after.data === null;
  console.log(`  ${restored ? "PASS" : "FAIL"}  the release flag is back to its state before the walk-through (${prior ? `enabled=${prior.enabled}` : "no row"})`);
  process.exit(restored ? 0 : 1);
}

/** The walk-through identity: Professional only, through the grant service. Password to a file only. */
async function makePilot(file: string) {
  await removeUser(FIX.pilot);
  let grantor = (await findUser(FIX.grantor))?.id as string | undefined;
  if (!grantor) grantor = await makeUser(FIX.grantor, "IND-007 Grantor", `ind007-${Math.random().toString(36).slice(2)}-Aa1!`);
  const password = `ind007-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}-Aa1!`;
  const pilot = await makeUser(FIX.pilot, "Amara Okello", password);
  await grantProfessional(pilot, grantor);
  writeFileSync(file, `${FIX.pilot}\n${password}\n`);
  console.log(`  pilot: ${FIX.pilot} created, Professional only. Password written to the IND007_PILOT_CREDENTIALS file.`);
}

main().catch(async e => { console.error(e); try { await cleanup(); await restoreFlag(); } catch { /* best effort */ } process.exit(1); });
