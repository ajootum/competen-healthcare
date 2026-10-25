/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PROFESSIONAL DEVELOPMENT PLANNING ACCEPTANCE -- COMPETEN-PROFESSIONAL-PLAN-01 Stage 3, owner GO s15, STAGING ONLY.
 *
 * The focused journey for one goal, "ECG Interpretation", through the library the routes call (the same parsers, the
 * same store, the same policy), against migration 480 on staging. The items are the GO's own numbering:
 *   1 create a goal from a need, or directly   2 save it with only a description   3 link CFCA outcomes
 *   4 add a Competen or external learning item   5 add independent study and mentorship   6 milestones and review dates
 *   7 record learning or link CPD (the Stage 3/4 contract)   8 review progress and evidence   9 revise without losing versions
 *   10 mark addressed without claiming verified competence   11 reopen or defer   12 all of it without a catalogue
 *   13 all of it without AI   14 plans and reflections are not shared
 *
 * ⚠ The CPD entry here is a FIXTURE written the way the CPD log writes one (Stage 4 owns that writer). The plan only
 * references it. The AI call itself is the existing Holdings gateway, unchanged, and is not exercised: step 13 turns AI
 * off and shows nothing depends on it.
 * ⚠ STAGING ONLY (assertSafeTarget). PEND until 480 is applied. Own harness-prof03-* identity, deleted after. Writes
 * three policy rows for steps 11 to 13 and restores them exactly.
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only professional-plan-acceptance
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { loadCatalogueFor } from "../src/lib/individual/catalogue";
import { loadIndividualPassport } from "../src/lib/individual/passport";
import { loadProfessionalRecord } from "../src/lib/individual/professional/record";
import { professionalContext } from "../src/lib/individual/professional/assistant";
import { profileContext } from "../src/lib/individual/professional/profile-ai";
import { loadProfessionalProfile } from "../src/lib/individual/professional/profile-store";
import { createNeed, saveReflection } from "../src/lib/individual/professional/needs-store";
import { checkGoalStatusChange, parseActivityForm, parseGoalForm, parseGoalSource, parseMilestone, parseReview, planReminders } from "../src/lib/individual/professional/plan-form";
import {
  addMilestone, addReview, attachRecordToActivity, createActivity, createGoal, goalsForRecord, linkCpdToGoal, linkGoalEvidence, linkPlanCompetency,
  loadPlanWorkspace, moveActivity, setGoalStatus, updateActivity, updateGoal,
} from "../src/lib/individual/professional/plan-store";
import { mintShare, parseShare } from "../src/lib/individual/professional/share";
import { loadSharedProfile } from "../src/lib/individual/professional/share-profile";
import { publishedCatalogue } from "../src/lib/learning/catalogue";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "professional-plan-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); } };
const EMAIL = "harness-prof03-ecg@competen.test";
const SCOPE = { scope_type: "platform", scope_ref: "individual" };
const ROWS = ["individual.policy.professional_catalogues", "individual.policy.professional_plan_ai", "individual.policy.professional_goal_reopen"];
const today = new Date().toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const REFLECTION = "I froze reading a broad complex rhythm on nights. I want to read 12-lead ECGs systematically.";
const REVIEW_TEXT = "Rate, rhythm and axis first, every time.";

async function findUser(email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
async function cleanup() {
  const u = await findUser(EMAIL);
  if (!u) return;
  const { data: links } = await admin.from("individual_professional_share").select("share_token_id").eq("user_id", u.id);
  await admin.from("individual_professional_share").delete().eq("user_id", u.id);
  if (links?.length) await admin.from("passport_share_tokens").delete().in("id", links.map((l: any) => l.share_token_id));
  // 480's trails and links are deleted only by cascade: remove their parents, and the rows go with them.
  await admin.from("individual_professional_activity").delete().eq("user_id", u.id);
  await admin.from("individual_professional_goal_need").delete().eq("user_id", u.id);
  await admin.from("individual_professional_goal").delete().eq("user_id", u.id);
  await admin.from("individual_professional_need").delete().eq("user_id", u.id);
  for (const t of ["individual_professional_cpd", "individual_professional_reflection", "individual_professional_profile_item", "individual_professional_profile_context",
    "individual_professional_profile", "individual_entitlement", "individual_membership"]) await admin.from(t).delete().eq("user_id", u.id);
  await admin.from("audit_log").delete().eq("actor_id", u.id);
  await admin.from("profiles").delete().eq("id", u.id);
  await admin.auth.admin.deleteUser(u.id);
}
let prior: any[] = [];
async function restore() {
  for (const path of ROWS) {
    const was = prior.find(r => r.config_path === path);
    if (was) await admin.from("workspace_config_overrides").upsert(was, { onConflict: "scope_type,scope_ref,config_path" });
    else await admin.from("workspace_config_overrides").delete().eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).eq("config_path", path);
  }
}
const publish = (path: string, settings: unknown) => admin.from("workspace_config_overrides").upsert({ ...SCOPE, config_path: path, draft: settings, published: settings }, { onConflict: "scope_type,scope_ref,config_path" });
const pp = async () => (await loadIndividualPolicy(admin)).professionalPlan;
const must = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r.value; };
async function goal(userId: string, body: Record<string, unknown>) {
  const out = await createGoal(admin, userId, must(parseGoalForm(body, await pp())), must(parseGoalSource(body)));
  if (!out.ok) throw new Error(out.error);
  return out.id as string;
}
async function activity(userId: string, body: Record<string, unknown>, goalId: string | null) {
  const out = await createActivity(admin, userId, must(parseActivityForm(body, await pp())), goalId);
  if (!out.ok) throw new Error(out.error);
  return out.id as string;
}

async function main() {
  console.log(`PROFESSIONAL DEVELOPMENT PLANNING ACCEPTANCE (Stage 3) against ${ref}\n`);
  const probe = await admin.from("individual_professional_goal_review").select("id").limit(0);
  if (probe.error) { console.log(`PEND -- migration 480 is not applied here (${probe.error.code}). Nothing created.`); return; }
  prior = (await admin.from("workspace_config_overrides").select("*").eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).in("config_path", ROWS)).data ?? [];
  await cleanup();
  try {
    const { data: created } = await admin.auth.admin.createUser({ email: EMAIL, password: `p3-${Math.random().toString(36).slice(2)}-Aa1!`, email_confirm: true, user_metadata: { full_name: "Harness ECG Learner" } });
    const me = created.user.id as string;
    await admin.from("profiles").update({ full_name: "Harness ECG Learner", role: null }).eq("id", me);
    const g = validateGrant({ targetUserId: me, experiences: ["professional"], note: "PROF-PLAN-01 acceptance" });
    if (isGrantRefusal(g)) throw new Error(g.message);
    await grantIndividualAccess(admin, g, me);
    await admin.from("individual_professional_profile").insert({ user_id: me, experience_code: "professional", self_declared_profession: "Clinician", registration_completed_at: new Date().toISOString() });

    // 1-2
    const need = await createNeed(admin, me, { title: "Reading 12-lead ECGs with confidence" });
    if (!need.ok) throw new Error(need.error);
    const ws0 = await loadPlanWorkspace(admin, me);
    const gEcg = await goal(me, { title: "ECG Interpretation", needId: need.id });
    const gDirect = await goal(me, { title: "Teach ECG basics to new starters" });
    const ws1 = await loadPlanWorkspace(admin, me);
    const row = ws1.goals?.find(x => x.id === gEcg);
    const joined = await admin.from("individual_professional_goal_need").select("goal_id").eq("goal_id", gEcg).eq("need_id", need.id);
    ok("1. a goal is created from a need (linked many to many) and another directly",
      ws0.provisioned && ws0.goals?.length === 0 && row?.created_from === "need" && (joined.data ?? []).length === 1 && ws1.goals?.find(x => x.id === gDirect)?.created_from === "direct");
    ok("2. it is saved with only its description: no target date, type, priority, template or dates needed",
      row?.status === "planned" && row.target_date === null && row.goal_type_code === null && row.priority_code === null && row.template_code === null && row.start_date === null
      && (ws1.history ?? []).filter(h => h.goal_id === gEcg).length === 1, JSON.stringify(row));

    // 3
    const offered = await loadCatalogueFor(admin, "professional");
    let compOk = false, compDetail = "no catalogue offered on staging";
    if (offered?.length) {
      const c = offered.find(x => /ecg|cardi|rhythm/i.test(x.title)) ?? offered[0];
      const l = await linkPlanCompetency(admin, me, { goalId: gEcg }, c.competencyId, offered, c.outcomes[0] ?? null);
      const notOffered = await linkPlanCompetency(admin, me, { goalId: gEcg }, "00000000-0000-4000-8000-000000000000", offered, null);
      const link = (await loadPlanWorkspace(admin, me)).competencies?.find(x => x.goal_id === gEcg);
      compOk = l.ok && !notOffered.ok && !!link?.framework_version && link.learning_outcome === (c.outcomes[0] ?? null);
      compDetail = `${c.title} ${link?.framework_version} outcome ${link?.learning_outcome ?? "none"}`;
    }
    ok("3. CFCA outcomes link with the framework version kept; a competency not offered is refused", compOk, compDetail);

    // 4
    const items = await publishedCatalogue(admin, offered?.length ? { competencyId: offered[0].competencyId } : {});
    const course = items?.[0] ?? null;
    const aCourse = course ? await activity(me, { title: course.title.slice(0, 200), type: course.delivery === "external" ? "external-course" : course.source === "competen" ? "competen-course" : "partner-course", offeringId: course.offeringId }, gEcg) : null;
    const aExternal = await activity(me, { title: "Online ECG rhythm course", type: "external-course", url: "https://example.org/ecg-course", provider: "An external provider" }, gEcg);
    const ws4 = await loadPlanWorkspace(admin, me);
    const enrolled = await admin.from("learning_record").select("id").eq("user_id", me);
    ok("4. a Competen catalogue course (where one is published) and an external course are added to the plan, with no enrolment and no purchase",
      (!course || ws4.activities?.find(a => a.id === aCourse)?.learning_offering_id === course.offeringId) && ws4.activities?.find(a => a.id === aExternal)?.external_url === "https://example.org/ecg-course"
      && (enrolled.data ?? []).length === 0, `catalogue item ${course ? course.title : "none published"}`);

    // 5
    const aStudy = await activity(me, { title: "Work through an ECG workbook", type: "independent-study", plannedStart: day(1), plannedEnd: day(30) }, gEcg);
    const aMentor = await activity(me, { title: "Monthly ECG review with a cardiology mentor", type: "mentorship", dependsOn: aStudy }, gEcg);
    await moveActivity(admin, me, gEcg, aMentor, "up");
    const ws5 = await loadPlanWorkspace(admin, me);
    const order = (ws5.activityGoals ?? []).filter(l => l.goal_id === gEcg).sort((a, b) => a.position - b.position).map(l => l.activity_id);
    ok("5. independent study and mentorship are added, ordered, and one depends on the other",
      order.indexOf(aMentor) < order.indexOf(aStudy) && ws5.activities?.find(a => a.id === aMentor)?.depends_on_activity_id === aStudy, JSON.stringify(order));

    // 6
    await updateGoal(admin, me, gEcg, must(parseGoalForm({ startDate: today, targetDate: day(90), reviewDate: day(10) }, await pp(), true)));
    const m1 = await addMilestone(admin, me, gEcg, must(parseMilestone({ title: "Read 50 rhythm strips", type: "checkpoint", dueOn: day(5) }, await pp())));
    const ws6 = await loadPlanWorkspace(admin, me);
    const rem = planReminders({ goals: ws6.goals!, milestones: ws6.milestones ?? [], today, leadDays: (await pp()).reminderDays, reviewDays: (await pp()).reviewDays });
    ok("6. milestones and review dates are set, and the in-app reminders show them",
      m1.ok && rem.some(r => r.goalId === gEcg && r.kind === "milestone") && rem.some(r => r.goalId === gEcg && r.kind === "review"), JSON.stringify(rem.map(r => r.kind)));

    // 7 the Stage 3/4 contract
    const byHand = await updateActivity(admin, me, aMentor, { status: "completed" } as any);
    const cpd = await admin.from("individual_professional_cpd").insert({ user_id: me, experience_code: "professional", activity_type: "other", title: "ECG mentor session one", hours: 1.5, activity_date: today }).select("id").single();
    const att = await attachRecordToActivity(admin, me, aMentor, { cpdId: cpd.data.id });
    const retro = await linkCpdToGoal(admin, me, gDirect, { cpdId: cpd.data.id });
    const again = await linkCpdToGoal(admin, me, gDirect, { cpdId: cpd.data.id });
    const serves = await goalsForRecord(admin, me, { cpdId: cpd.data.id });
    const ws7 = await loadPlanWorkspace(admin, me);
    const mentor = ws7.activities?.find(a => a.id === aMentor);
    const actCols = Object.keys(mentor ?? {});
    ok("7. learning is recorded as CPD and the activity references it: completed only with that record, one activity serving two goals, nothing copied",
      !byHand.ok && att.ok && mentor?.status === "completed" && mentor.cpd_id === cpd.data.id && retro.ok && retro.activityId === aMentor && again.ok
      && serves?.length === 2 && !actCols.some(c => /hours|credit|evidence|actual/.test(c)), JSON.stringify({ byHand: byHand.ok, serves: serves?.map(s => s.title) }));

    // 8
    const refl = await saveReflection(admin, me, null, { body: REFLECTION, template_code: null, template_label: null });
    const ev = await linkGoalEvidence(admin, me, gEcg, { reflectionId: (refl as any).id });
    const rv = await addReview(admin, me, { id: gEcg, status: "planned" }, must(parseReview({ decision: "continue", learned: REVIEW_TEXT, evidence: "One mentor session logged" }, "planned", await pp())));
    const cls = await admin.from("individual_professional_cpd").select("evidence_class").eq("id", cpd.data.id).single();
    const ws8 = await loadPlanWorkspace(admin, me);
    ok("8. progress and evidence are reviewed: CPD (self-reported, its own class), a private reflection linked, a review kept",
      refl.ok && ev.ok && rv.ok && cls.data?.evidence_class === "self_declared" && (ws8.reviews ?? []).some(r => r.goal_id === gEcg && r.learned === REVIEW_TEXT && r.decision === "continue"));

    // 9
    await updateGoal(admin, me, gEcg, { ...must(parseGoalForm({ title: "ECG Interpretation: 12-lead, systematically", outcome: "Interpret common arrhythmias without prompting" }, await pp(), true)), reviewed: true });
    const ws9 = await loadPlanWorkspace(admin, me);
    const hist = (ws9.history ?? []).filter(h => h.goal_id === gEcg);
    const rewrite = await admin.from("individual_professional_goal_history").update({ title: "forged" }).eq("goal_id", gEcg);
    const reviewRewrite = await admin.from("individual_professional_goal_review").update({ learned: "forged" }).eq("goal_id", gEcg);
    ok("9. revising keeps every earlier version, and neither the history nor a review can be rewritten",
      ws9.goals?.find(x => x.id === gEcg)?.title.startsWith("ECG Interpretation:") === true && hist.some(h => h.title === "ECG Interpretation") && hist.length >= 3 && !!rewrite.error && !!reviewRewrite.error,
      `${hist.length} snapshots`);

    // 10
    const passBefore = JSON.stringify((await loadIndividualPassport(admin, me, today)).competencies ?? null);
    const addr = await addReview(admin, me, { id: gEcg, status: "planned" }, must(parseReview({ decision: "addressed", changed: "I read strips systematically now" }, "planned", await pp())));
    const g10 = (await loadPlanWorkspace(admin, me)).goals?.find(x => x.id === gEcg);
    const passAfter = JSON.stringify((await loadIndividualPassport(admin, me, today)).competencies ?? null);
    const decisions = await admin.from("individual_professional_competency_decision").select("id").eq("user_id", me);
    ok("10. marked addressed by the person: the goal is done, and no competence is verified, decided or added to the Passport",
      addr.ok && g10?.status === "done" && !!g10.completed_at && passBefore === passAfter && (decisions.data ?? []).length === 0);

    // 11
    const reopen = await addReview(admin, me, { id: gEcg, status: "done" }, must(parseReview({ decision: "reopened" }, "done", await pp())));
    const deferred = await setGoalStatus(admin, me, gDirect, "deferred");
    await setGoalStatus(admin, me, gEcg, "done");
    await publish(ROWS[2], { value: "off" });
    const blocked = checkGoalStatusChange("done", "in_progress", await pp());
    const ws11 = await loadPlanWorkspace(admin, me);
    ok("11. it is reopened (and deferred) in any order; with reopening turned off, a closed goal stays closed",
      reopen.ok && deferred.ok && ws11.goals?.find(x => x.id === gDirect)?.status === "deferred" && !blocked.ok && (ws11.reviews ?? []).some(r => r.decision === "reopened"));

    // 12
    await publish(ROWS[0], { ids: [] });
    const none = await loadCatalogueFor(admin, "professional");
    const g12 = await goal(me, { title: "ECG Interpretation without a catalogue", targetDate: day(60) });
    const a12 = await activity(me, { title: "Shadow the cardiac physiologist", type: "workplace-learning" }, g12);
    const m12 = await addMilestone(admin, me, g12, must(parseMilestone({ title: "First supervised read" }, await pp())));
    const noLink = await linkPlanCompetency(admin, me, { goalId: g12 }, offered?.[0]?.competencyId ?? "00000000-0000-4000-8000-000000000000", none ?? [], null);
    ok("12. with no competency catalogue offered, goals, activities and milestones work the same; a link is simply not offered",
      Array.isArray(none) && none.length === 0 && !!a12 && m12.ok && !noLink.ok);

    // 13
    await publish(ROWS[1], { value: "off" });
    const off = (await pp()).ai;
    const g13 = await goal(me, { title: "ECG Interpretation without AI" });
    const a13 = await activity(me, { title: "Reflective practice on ECG cases", type: "reflective-practice" }, g13);
    const r13 = await addReview(admin, me, { id: g13, status: "planned" }, must(parseReview({ decision: "deferred" }, "planned", await pp())));
    ok("13. with AI off, the whole plan works: goal, activity, review, defer", off === "off" && !!a13 && r13.ok && (await loadPlanWorkspace(admin, me)).goals?.find(x => x.id === g13)?.status === "deferred");

    // 14
    const record = await loadProfessionalRecord(admin, me);
    const grounding = `${professionalContext(record, today)}\n${profileContext(await loadProfessionalProfile(admin, me))}`;
    const passport = JSON.stringify(await loadIndividualPassport(admin, me, today));
    const link = await mintShare(admin, me, parseShare({ scope: "full", days: 7 }), { overview: true, itemIds: [] });
    const shared = link ? JSON.stringify(await loadSharedProfile(admin, link.id, me, (await loadIndividualPolicy(admin)).professionalProfile.shareSections, today)) : "";
    const privateText = [REFLECTION.slice(0, 30), REVIEW_TEXT, "I read strips systematically now"];
    const inShare = [passport, shared].some(t => privateText.some(p => t.includes(p)) || t.includes("ECG Interpretation"));
    const inGrounding = privateText.some(p => grounding.includes(p));
    ok("14. the plan, its reviews and the reflection reach no Passport and no share link; reviews and the reflection reach no AI grounding",
      !inShare && !inGrounding && !!link, `share ${inShare}, grounding ${inGrounding}`);
  } finally {
    await restore();
    await cleanup();
    const pol = (await admin.from("workspace_config_overrides").select("*").eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).in("config_path", ROWS)).data ?? [];
    const sort = (x: any[]) => JSON.stringify([...x].sort((a, b) => a.config_path.localeCompare(b.config_path)));
    ok("Z1. cleanup: no harness identity left, and the three policy rows exactly as they were", !(await findUser(EMAIL)) && sort(pol) === sort(prior));
  }
  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); try { await restore(); await cleanup(); } catch { /* best effort */ } process.exit(1); });
