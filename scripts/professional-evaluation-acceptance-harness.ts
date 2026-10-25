/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MY PROFESSIONAL EVALUATION ACCEPTANCE -- COMPETEN-PROFESSIONAL-EVALUATION-01 Stage 6, owner GO s14, STAGING ONLY.
 *
 * The focused ECG Interpretation journey through the library the routes call (the same loader, engine, parsers, store,
 * policy and share code), against migration 530 on staging. The items are the GO's own numbering:
 *   1 open My Professional Evaluation   2 select a development goal   3 review linked learning, CPD and competency evidence
 *   4 the dimensions apart   5 the evidence behind each conclusion   6 strengths and limitations   7 recommendations
 *   8 follow one to its owning module   9 record a snapshot   10 add a note   11 more learning outside Stage 6
 *   12 a later evaluation, the first unchanged   13 compare them   14 read a verification decision, never modify it
 *   15 without a catalogue   16 without AI   17 private unless chosen   18 no unsupported claim of verified competence
 *
 * ⚠ FIXTURES are written by their OWN writers (needs-store, plan-store, Stage 5 competency-store) or, for the CPD entry,
 * the way the CPD log writes one. Stage 6 itself writes only 530. C5 (510-519) is read through Stage 5's adapter; where
 * the Studio is not on staging, step 14 registers an IN-PROCESS stand-in Studio with one verified decision and proves
 * Stage 6 only lists (never requests) and that no C5 table changes. STAGING ONLY (assertSafeTarget). PEND until 530 is
 * applied. Own harness-prof06-* identity, deleted after. Writes two policy rows for 15 and 16 and restores them exactly.
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only professional-evaluation-acceptance
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { loadCatalogueFor } from "../src/lib/individual/catalogue";
import { createNeed } from "../src/lib/individual/professional/needs-store";
import { createGoal, linkCpdToGoal, linkPlanCompetency, loadPlanWorkspace } from "../src/lib/individual/professional/plan-store";
import { parseEntry, parseEvidenceLink, parseSelfAssessment } from "../src/lib/individual/professional/competency-form";
import { addEntry, addSelfAssessment, linkEvidence, loadCompetencyWorkspace, loadScaleLevels } from "../src/lib/individual/professional/competency-store";
import { registerVerificationStudio } from "../src/lib/individual/professional/competency-verification";
import { mintShare, parseShare } from "../src/lib/individual/professional/share";
import { compareEvaluations, evaluate } from "../src/lib/individual/professional/evaluation";
import { loadEvaluationInput } from "../src/lib/individual/professional/evaluation-sources";
import { addAnnotation, currentConfigVersion, decideRecommendation, evaluationOf, loadEvaluationHistory, recordEvaluation } from "../src/lib/individual/professional/evaluation-store";
import { loadSharedEvaluations, saveShareEvaluations } from "../src/lib/individual/professional/share-evaluation";
import { DIMENSIONS } from "../src/lib/individual/professional/evaluation-vocabulary";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "professional-evaluation-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`); } else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); } };
const EMAIL = "harness-prof06-evaluation@competen.test";
const SCOPE = { scope_type: "platform", scope_ref: "individual" };
const ROWS = ["individual.policy.professional_catalogues", "individual.policy.professional_evaluation_ai"];
const C5_TABLES = ["competency_verification_request", "competency_verification_evidence", "competency_verification_event", "competency_verification_decision"];
const today = new Date().toISOString().slice(0, 10);
const NOTE = "Rate, rhythm, axis: I now read every 12-lead the same way.";
const PRIVATE = "Private: I froze on a broad complex rhythm on nights.";

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
  // 530's, 520's and 480's trails go only by cascade: remove the person, and every one of them goes with it.
  await admin.from("individual_professional_my_competency").delete().eq("user_id", u.id);
  await admin.from("individual_professional_activity").delete().eq("user_id", u.id);
  await admin.from("individual_professional_goal_need").delete().eq("user_id", u.id);
  await admin.from("individual_professional_goal").delete().eq("user_id", u.id);
  await admin.from("individual_professional_need").delete().eq("user_id", u.id);
  for (const t of ["individual_professional_cpd", "individual_professional_evidence", "individual_professional_reflection", "individual_professional_profile",
    "individual_entitlement", "individual_membership"]) await admin.from(t).delete().eq("user_id", u.id);
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
const ep = async () => (await loadIndividualPolicy(admin)).professionalEvaluation;
const cp = async () => (await loadIndividualPolicy(admin)).professionalCompetency;
const must = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r.value; };
const id = (w: { ok: boolean; id?: string | null; error?: string }) => { if (!w.ok || !w.id) throw new Error(w.error ?? "write failed"); return w.id; };
const c5Counts = async () => Promise.all(C5_TABLES.map(async t => { const r = await admin.from(t).select("id", { count: "exact", head: true }); return r.error ? `${t}:absent` : `${t}:${r.count}`; }));
const snap = async (me: string, scope: any, extra: Partial<Parameters<typeof recordEvaluation>[3]> = {}) => {
  const { input, context } = await loadEvaluationInput(admin, me, today);
  const ev = evaluate(input, scope, await ep());
  if (!ev) throw new Error("scope not found");
  const w = await recordEvaluation(admin, me, ev, { context, policy: await ep(), configVersion: await currentConfigVersion(admin), ai: null, supersedes: null, ...extra });
  return { ev, id: id(w) };
};

async function main() {
  console.log(`MY PROFESSIONAL EVALUATION ACCEPTANCE (Stage 6, ECG Interpretation) against ${ref}\n`);
  const probe = await admin.from("individual_professional_evaluation").select("id").limit(0);
  if (probe.error) { console.log(`PEND -- migration 530 is not applied here (${probe.error.code}). Nothing created.`); return; }
  prior = (await admin.from("workspace_config_overrides").select("*").eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).in("config_path", ROWS)).data ?? [];
  await cleanup();
  try {
    const { data: created } = await admin.auth.admin.createUser({ email: EMAIL, password: `p6-${Math.random().toString(36).slice(2)}-Aa1!`, email_confirm: true, user_metadata: { full_name: "Harness ECG Evaluator" } });
    const me = created.user.id as string;
    await admin.from("profiles").update({ full_name: "Harness ECG Evaluator", role: null }).eq("id", me);
    const g = validateGrant({ targetUserId: me, experiences: ["professional"], note: "PROF-EVALUATION-01 acceptance" });
    if (isGrantRefusal(g)) throw new Error(g.message);
    await grantIndividualAccess(admin, g, me);
    await admin.from("individual_professional_profile").insert({ user_id: me, experience_code: "professional", self_declared_profession: "Clinician", registration_completed_at: new Date().toISOString() });

    // ── FIXTURES, each by its owning writer: a need and a goal (Stage 2/3), a CPD entry linked to the goal (Stage 4 via
    // Stage 3's linkCpdToGoal), a private reflection, and, where staging offers a catalogue competency, a Stage 5 entry
    // with a self-assessment and two evidence links, and the goal linked to the competency (Stage 3).
    const need = id(await createNeed(admin, me, { title: "Reading 12-lead ECGs with confidence", origin: "self_identified" }));
    const goal = id(await createGoal(admin, me, { title: "ECG Interpretation" }, { createdFrom: "need", needId: need, competencyId: null, offeringId: null, aspirationItemId: null, reflectionId: null }));
    const cpd1 = (await admin.from("individual_professional_cpd").insert({ user_id: me, experience_code: "professional", activity_type: "course", title: "ECG interpretation workshop",
      provider: "Regional training centre", hours: 3, activity_date: today, reflection: PRIVATE,
      document_path: `${me}/harness-certificate.pdf`, document_name: "certificate.pdf", document_mime: "application/pdf", document_bytes: 1024 }).select("id").single()).data.id;
    await linkCpdToGoal(admin, me, goal, { cpdId: cpd1 });
    const offered = await loadCatalogueFor(admin, "professional");
    const c = offered?.find(o => /ecg|electrocardio|cardi|rhythm/i.test(o.title)) ?? offered?.[0] ?? null;
    let entryId: string | null = null;
    if (c) {
      await linkPlanCompetency(admin, me, { goalId: goal }, c.competencyId, offered!, c.outcomes[0] ?? null);
      entryId = id(await addEntry(admin, me, must(parseEntry({ competencyId: c.competencyId }, await cp(), offered!))));
      const levels = await loadScaleLevels(admin, c.expectedLevel?.id ?? null);
      const fv = (await loadCompetencyWorkspace(admin, me)).entries?.[0]?.framework_version ?? null;
      if (levels?.length) await addSelfAssessment(admin, me, entryId, must(parseSelfAssessment({ levelId: levels[0].id, confidence: "unsure", reflection: PRIVATE }, { levels, outcomes: c.outcomes, frameworkVersion: fv, policy: await cp() })));
      await linkEvidence(admin, me, { id: entryId, framework_version: fv }, must(parseEvidenceLink({ kind: "cpd", sourceId: cpd1, relation: "knowledge" }, { outcomes: c.outcomes, policy: await cp() })));
      await linkEvidence(admin, me, { id: entryId, framework_version: fv }, must(parseEvidenceLink({ kind: "cpd", sourceId: cpd1, relation: "application" }, { outcomes: c.outcomes, policy: await cp() })));
    }

    // 1
    const hist0 = await loadEvaluationHistory(admin, me);
    const { input: in1 } = await loadEvaluationInput(admin, me, today);
    ok("1. My Professional Evaluation opens: its store is provisioned and empty, and every source module reads", hist0.provisioned && hist0.evaluations?.length === 0
      && in1.cpd !== null && in1.goals !== null && in1.needs !== null, `catalogue competency ${c ? c.title : "none offered"}, Stage 5 ${in1.stage5.available ? "on" : "off"}, C5 ${in1.verification.available ? "on" : "off"}`);

    // 2-3
    const ev1 = evaluate(in1, { kind: "goal", ref: goal }, await ep())!;
    ok("2. the ECG Interpretation goal is selected as the scope", !!ev1 && ev1.scope.label === "ECG Interpretation");
    const kinds = new Set(ev1.sources.map(s => s.kind));
    ok("3. its linked CPD (with the plan activity Stage 3 made for it) is reviewed in scope, and an unrelated record is not", kinds.has("cpd") && kinds.has("activity"),
      [...kinds].join(", "));
    ok("3b. the competency evidence (Stage 5) is in scope where a catalogue is offered", !c || (kinds.has("self_assessment") && ev1.findings.competency_evidence.sourceKeys.length >= 1), [...kinds].join(", "));

    // 4-6
    const dims = Object.keys(ev1.findings).filter(k => DIMENSIONS.some(([d]) => d === k));
    ok("4. activity, knowledge, application, competency evidence, verification and confidence are six separate findings, no score",
      dims.length === 6 && !/"score"|percent|overall/i.test(JSON.stringify(ev1)), DIMENSIONS.map(([d]) => `${d}=${ev1.findings[d].state}`).join(" "));
    const keys = new Set(ev1.sources.map(s => s.key));
    ok("5. every conclusion cites its records, each with provenance and date", DIMENSIONS.every(([d]) => ev1.findings[d].sourceKeys.every(k => keys.has(k)))
      && ev1.sources.every(s => !!s.provenance && s.date !== undefined) && ev1.sources.find(s => s.id === cpd1)?.provenance === "document_supported");
    ok("6. strengths come from document-supported records and limitations are stated", ev1.strengths.length >= 1 && ev1.limitations.length >= 2, `${ev1.strengths.length} strength(s), ${ev1.limitations.length} limitation(s)`);

    // 7-8
    ok("7. actionable recommendations, each with its basis", ev1.recommendations.length >= 1 && ev1.recommendations.every(r => r.basis.startsWith("Offered") && (r.href || r.creates)),
      ev1.recommendations.map(r => r.rule).join(", "));
    const first = await snap(me, { kind: "goal", ref: goal });
    const firstRow0 = await evaluationOf(admin, me, first.id);
    const follow = first.ev.recommendations.find(r => r.creates?.kind === "activity") ?? first.ev.recommendations.find(r => r.creates);
    const acts0 = (await loadPlanWorkspace(admin, me)).activities?.length ?? 0;
    const dec = follow ? await decideRecommendation(admin, me, { id: first.id, recommendations: first.ev.recommendations }, follow.key, { decision: "accepted", editedTitle: "Read 20 rhythm strips with a mentor", deferredUntil: null, note: null }) : null;
    const ws8 = await loadPlanWorkspace(admin, me);
    const hrefs = first.ev.recommendations.filter(r => r.href).map(r => r.href!);
    ok("8. a recommendation is followed to its owning module: its link opens that module, and accepting creates the record through Stage 3's writer",
      !!dec?.ok && (ws8.activities?.length ?? 0) === acts0 + 1 && ws8.activities!.some(a => a.title === "Read 20 rhythm strips with a mentor")
      && hrefs.every(h => /^\/individual\/(professional\/(cpd|development|competencies|progress)|learning)/.test(h)), `${follow?.rule}; links ${[...new Set(hrefs)].join(" ")}`);

    // 9-10
    const rewrite = await admin.from("individual_professional_evaluation").update({ scope_label: "changed" }).eq("id", first.id);
    const del = await admin.from("individual_professional_evaluation").delete().eq("id", first.id);
    ok("9. the snapshot is recorded with references, criteria and configuration version, and cannot be rewritten or deleted",
      !!firstRow0 && firstRow0.sources.length === first.ev.sources.length && !JSON.stringify(firstRow0).includes(PRIVATE) && !!rewrite.error && !!del.error
      && firstRow0.interpretation === "deterministic", `config ${firstRow0?.config_version ?? "defaults"}`);
    const n1 = await addAnnotation(admin, me, first.id, { body: NOTE, template_code: null, template_label: null, supersedesId: null });
    const editNote = await admin.from("individual_professional_evaluation_annotation").update({ body: "x x x" }).eq("evaluation_id", first.id);
    ok("10. a private note is added, and it is append-only", n1.ok && !!editNote.error);

    // 11-13
    const cpd2 = (await admin.from("individual_professional_cpd").insert({ user_id: me, experience_code: "professional", activity_type: "reading", title: "ECG rhythm strip practice",
      hours: 1, activity_date: today }).select("id").single()).data.id;
    await linkCpdToGoal(admin, me, goal, { cpdId: cpd2 });
    ok("11. more learning is recorded outside Stage 6 (the CPD log, linked through Stage 3)", !!cpd2);
    const second = await snap(me, { kind: "goal", ref: goal });
    const firstRow1 = await evaluationOf(admin, me, first.id);
    const hist = await loadEvaluationHistory(admin, me);
    ok("12. a later evaluation is a new snapshot and the first is unchanged", second.id !== first.id && JSON.stringify(firstRow1) === JSON.stringify(firstRow0) && hist.evaluations?.length === 2);
    const cmp = compareEvaluations(firstRow1!, (await evaluationOf(admin, me, second.id))!);
    ok("13. the two are compared by state and records, never by score", cmp.sameScope && cmp.added.some(s => s.id === cpd2) && cmp.earlier.id === first.id,
      cmp.dimensions.filter(d => d.changed).map(d => d.dimension).join(", "));

    // 14
    const before = await c5Counts();
    let standIn = false, requested = 0;
    if (!in1.verification.available && c) {
      standIn = true;
      registerVerificationStudio({
        listVerifications: async () => ({ provisioned: true, items: [{ requestId: "00000000-0000-4000-8000-00000000c5c5", status: "decided", method: "Direct observation", requestedAt: today, evidence: [],
          competency: { frameworkId: c.catalogue.id, frameworkCompetencyId: c.competencyId, frameworkVersion: null, title: c.title, learningOutcomes: [] },
          decisions: [{ outcomeCode: "verified_at_level", outcomeClass: "verified", outcomeLabel: "Verified at level", level: "Proficient", assessorName: "Stand-in assessor", authority: "C5", criteriaVersion: "v1", decidedAt: `${today}T09:00:00Z`, validUntil: null, revokedAt: null, supersededBy: null } as any] }] }),
        requestVerification: async () => { requested++; return { ok: false, status: 409, error: "stand-in" }; },
      });
    }
    const { input: in14 } = await loadEvaluationInput(admin, me, today);
    const ev14 = evaluate(in14, { kind: "goal", ref: goal }, await ep())!;
    const after = await c5Counts();
    const vsrc = ev14.sources.find(s => s.kind === "verification");
    ok("14. an independent verification decision is read and shown as it is, and nothing is written to C5", !c ? false : (!!vsrc && vsrc.provenance === "independent_decision"
      && ev14.findings.independent_verification.state === "supported" && requested === 0 && JSON.stringify(before) === JSON.stringify(after)),
      `${standIn ? "C5 not on staging: in-process stand-in Studio through Stage 5's adapter" : "C5 on staging"}; C5 rows ${after.join(" ")}`);

    // 15-16
    await publish(ROWS[0], { ids: [] });
    const { input: in15, catalogueOffered } = await loadEvaluationInput(admin, me, today);
    const ev15 = evaluate(in15, { kind: "goal", ref: goal }, await ep());
    const topic = evaluate(in15, { kind: "topic", ref: "ECG" }, await ep());
    ok("15. evaluation works with no catalogue offered: a goal and a topic", !catalogueOffered && !!ev15 && ev15.findings.development_activity.state !== "not_recorded"
      && !!topic && topic.sources.some(s => s.id === cpd2));
    await publish(ROWS[1], { value: "off" });
    const p16 = await ep();
    const third = await snap(me, { kind: "topic", ref: "ECG" });
    const row16 = await evaluationOf(admin, me, third.id);
    ok("16. with AI off, existing-evidence evaluation still works and is recorded as deterministic only", p16.ai === "off" && row16?.interpretation === "deterministic" && !row16.ai_text);
    await restore();

    // 17
    const shareA = await mintShare(admin, me, parseShare({ scope: "full", days: "7" }), { overview: false, itemIds: [] }, []);
    const none = shareA ? await loadSharedEvaluations(admin, shareA.id, me, (await ep()).sharing) : null;
    const shareB = await mintShare(admin, me, parseShare({ scope: "full", days: "7" }), { overview: false, itemIds: [] }, []);
    const saved = shareB ? await saveShareEvaluations(admin, me, shareB.id, [first.id]) : false;
    const one = shareB ? await loadSharedEvaluations(admin, shareB.id, me, (await ep()).sharing) : null;
    const shown = JSON.stringify(one);
    ok("17. a link carries no evaluation unless the person ticks it; a ticked one is formative, without notes or private words",
      none?.length === 0 && saved && one?.length === 1 && /formative/i.test(shown) && !shown.includes(NOTE) && !shown.includes(PRIVATE) && one[0].findings.length === 6);

    // 18
    // Before any decision existed (ev1) nothing was verified. Wherever verification reads "supported", a decision backs it.
    // Only a decision is ever "independently verified", and no text claims competence or its absence.
    const CLAIM = /verified competen|competence (is )?verified|you are (not )?competent|\bincompetent\b|deficien/i;
    const stored = (await loadEvaluationHistory(admin, me)).evaluations ?? [];
    const everything = [ev1, ev15!, topic!, ev14];
    const all = JSON.stringify([everything, stored]).replace(/not a finding of incompetence/gi, "");
    const decidedOnly = (srcs: any[]) => srcs.every(s => s.provenance !== "independent_decision" || s.kind === "verification" || s.kind === "passport_assessment");
    const backed = (e: { findings: any; sources: any[] }) => e.findings.independent_verification.state !== "supported" || e.sources.some(s => s.kind === "verification" && s.provenance === "independent_decision");
    ok("18. no unsupported claim of verified clinical competence: only a decision is 'independently verified', and no text claims competence or its absence",
      ev1.findings.independent_verification.state !== "supported" && everything.every(backed) && stored.every(r => backed(r))
      && everything.every(e => decidedOnly(e.sources)) && stored.every(r => decidedOnly(r.sources)) && !CLAIM.test(all),
      `ev1 verification ${ev1.findings.independent_verification.state}; claim text ${(all.match(CLAIM) ?? ["none"])[0]}`);
  } finally {
    await restore();
    await cleanup();
  }
  const leftover = await findUser(EMAIL);
  ok("cleanup: the harness identity and its records are gone, and policy rows are restored", !leftover);
  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed${fails.length ? `: ${fails.join("; ")}` : ""}`);
  process.exit(fails.length ? 1 : 0);
}

main().catch(async e => { console.error(e); try { await restore(); await cleanup(); } catch { /* best effort */ } process.exit(1); });
