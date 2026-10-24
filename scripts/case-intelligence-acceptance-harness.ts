/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CASE INTELLIGENCE -- ACCEPTANCE on STAGING (COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s14 items 7-18, migrations 422-423).
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only case-intelligence-acceptance-harness
 *
 * The owner's journey, end to end, through the real triggers and the real modules:
 *   G0  the gate: with the case_library flag off, an offer is refused and a withdrawal still works. The run then sets
 *       the flag ON for itself and puts back exactly what it found (row and value) at the end
 *   P0  parity: staging's real case_identifier_kinds() finds exactly the structured kinds the application screen finds,
 *       on the shared corpus, and the application screen is at least as strict
 *   D1  the real 423 trigger refuses an offer without the permission, even written directly as the service role
 *   D2  the real backstop refuses an eligible offer carrying an identifier, written directly (a bypassed screen)
 *   D4  the queue view is closed to the browser's anon key
 *   D5  no session starts on a version that is not deliverable, written directly
 *   J1  a student grants candidacy, on the CURRENT permission text only
 *   J2  offers: a clean case is eligible, an identifiable one and an unchecked one are ineligible and keep no content
 *   J3  the educator queue (last 24 hours) lists only eligible cases, names no student, and spends no AI
 *   J4  take, promote, edit, submit: a library draft on the attested rights, put forward through 395
 *   J5  an author or material editor cannot approve, even holding an in-scope reviewer appointment
 *   J6  nothing publishes before approval, an independent scoped reviewer approves, a publisher publishes
 *   J7  another student finds it, works through it deterministically, finishes, and no AI is used
 *   J7d AI reasoning feedback and the debrief live on the same session (424): appended as AI evaluations naming their
 *       model, only on an answered decision, the debrief once at the end, and the finished play stays fixed
 *   J8  revoking the permission withdraws what was not promoted and keeps the promoted case
 *   J9  case intelligence counts the journey from stored records, and spend reads "not measured" with metering off
 *   Z   fixtures removed: the people (their permission, offers and sessions go with them), their appointments
 *
 * Fixtures: five throwaway staging accounts, labelled synthetic -- two students, a Clinical Case Educator, a Clinical
 * Content Reviewer (scope: framework CF-FOUND) and a Quality Council Member -- appointed to an existing HQ Quality
 * office as the service role, the way clinical-review-acceptance-harness does, and removed at the end. No password is
 * ever used. The case links one existing CF-FOUND competency and changes nothing about it.
 *
 * ⚠ ONE RECORD STAYS, BY DESIGN: the fixture case CASE-HARNESS-<stamp>, retired at the end. A submitted case version
 * and its clinical review are the record and cannot be deleted (422). PEND until 423.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { HQ_OFFICE_TYPE_PREFIX } from "../src/lib/hq/spaces";
import { grantCaseCandidacy, offerPrivateCase, revokeCaseCandidacy, withdrawCaseCandidate } from "../src/lib/cases/candidates";
import { CASE_LIBRARY_FLAG, CASE_LIBRARY_OFF, loadCasePolicy } from "../src/lib/cases/policy";
import { candidateQueue, promoteCandidate, publishCase, retireCase, saveDraft, submitCase, takeCandidate } from "../src/lib/cases/studio";
import { decideReview } from "../src/lib/competency/clinical-review";
import { answerInSession, findLibraryCases, loadLibraryCase, recordSessionDebrief, recordSessionFeedback, startCaseSession } from "../src/lib/cases/library";
import { caseIntelligence } from "../src/lib/cases/analytics";
import type { Blueprint } from "../src/lib/cases/blueprint";
import { CASE_SCREEN_CORPUS, screenText, structuredKinds } from "../src/lib/cases/screen";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "case-intelligence-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const EMAILS = { s1: "harness-ci-student1@competen.test", s2: "harness-ci-student2@competen.test", edu: "harness-ci-educator@competen.test", rev: "harness-ci-reviewer@competen.test", pub: "harness-ci-publisher@competen.test" };

async function findUser(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
async function cleanup() {
  for (const e of Object.values(EMAILS)) {
    const u = await findUser(e);
    if (!u) continue;
    await admin.from("ogs_office_appointments").delete().eq("person_id", u.id);
    await admin.from("audit_log").delete().eq("actor_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}
async function person(email: string, name: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: `ci-${Math.random().toString(36).slice(2)}-Aa1!`, email_confirm: true, user_metadata: { full_name: name, synthetic: true } });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  await admin.from("profiles").update({ full_name: name }).eq("id", data.user.id);
  return data.user.id as string;
}
const aiRows = async (ids: string[]) => { const r = await admin.from("plat_ai_requests").select("id", { count: "exact", head: false }).in("actor_id", ids).limit(1); return r.error ? null : (r.count ?? 0); };

/** A complete library case on one competency: two stages, a branch, a request-only fact, a safety criterion. */
function libraryCase(competencyId: string, title: string): Blueprint {
  return {
    schema: "case-blueprint/1", title, summary: "Recognise and escalate a deteriorating adult on a surgical ward.", learnerIntro: "A patient on your ward looks unwell.",
    patient: { ageBand: "60-69", sex: "unspecified", setting: "Surgical ward", presentingComplaint: "Breathlessness", background: ["Day 2 after abdominal surgery"] },
    facts: [
      { id: "rr", kind: "observation", label: "Respiratory rate", value: "30", unit: "breaths/min", revealedAt: "start", safetyCritical: true },
      { id: "spo2", kind: "observation", label: "SpO2", value: "91", unit: "%", revealedAt: "request", safetyCritical: false },
    ],
    stages: [{ id: "s1", title: "On the ward", reveals: [], decisionPointIds: ["d1"] }, { id: "s2", title: "After escalation", reveals: [], decisionPointIds: ["d2"] }],
    decisionPoints: [
      { id: "d1", stageId: "s1", kind: "single", dimension: "escalation", prompt: "The respiratory rate is 30. What do you do first?", permittedReveals: ["spo2"],
        options: [{ id: "esc", text: "Escalate now using SBAR", correct: true, rationale: "A rate of 30 needs urgent review." }, { id: "wait", text: "Recheck in an hour", correct: false, rationale: "Waiting delays care." }] },
      { id: "d2", stageId: "s2", kind: "single", dimension: "reassessment", prompt: "What do you reassess while waiting?", permittedReveals: [],
        options: [{ id: "abcde", text: "A to E, repeating observations", correct: true, rationale: "Structured reassessment finds change early." }, { id: "notes", text: "Update the notes only", correct: false, rationale: "Notes do not treat the patient." }] },
    ],
    progression: [{ from: "s1", onOptions: ["esc"], to: "s2", consequenceFactIds: [] }, { from: "s1", isDefault: true, to: "s2", consequenceFactIds: ["spo2"] }],
    learningObjectives: [{ id: "lo1", text: "Recognise and escalate respiratory deterioration", competencyIds: [competencyId], outcomes: ["Escalates a rate of 30 using SBAR"] }],
    safetyCriteria: [{ id: "sc1", text: "Do not wait with a rate of 30", decisionPointId: "d1", mustNotSelect: ["wait"] }],
    feedback: { debrief: "A rising respiratory rate is an early sign of deterioration.", onSafetyEvent: "Waiting risks harm." },
    assessment: null, references: [{ citation: "Local early-warning escalation policy (educator to confirm)" }],
    variation: { rules: [] }, aiBoundary: { patientVoice: false, phraseReveals: false, explain: true },
    metadata: { level: "foundation", complexity: 2, risk: "standard", professionTermId: null, specialtyTermIds: [], cfcaDomainIds: [], cpuIds: [], provenance: { kind: "private", rights: "student_private" } },
  };
}

async function main() {
  console.log(`CASE INTELLIGENCE ACCEPTANCE (422-423) -- target ${ref}\n`);
  const probe = await admin.from("case_candidate").select("id").limit(0);
  if (probe.error) { pend("J-Z", `migration 423 is not applied here (${probe.error.message}). Nothing created.`); return; }
  await cleanup();
  const office = (await admin.from("ogs_offices").select("id, office_type, is_active, status").like("office_type", `${HQ_OFFICE_TYPE_PREFIX}%`).limit(50)).data
    ?.find((o: any) => o.is_active !== false && o.status !== "dissolved" && o.status !== "archived");
  const fw = (await admin.from("frameworks").select("id").eq("code", "CF-FOUND").is("hospital_id", null).maybeSingle()).data;
  const comp = fw ? (await admin.from("framework_competencies").select("id, code, framework_domains!inner(framework_id)").eq("framework_domains.framework_id", fw.id).eq("code", "CF-PS-001").maybeSingle()).data : null;
  if (!office || !fw || !comp) { pend("J-Z", "staging needs an active HQ office and CF-FOUND's CF-PS-001"); return; }
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 12);
  let caseId: string | null = null;
  const prior = (await admin.from("practice_platform_flags").select("flag, enabled, note").eq("flag", CASE_LIBRARY_FLAG).maybeSingle()).data;
  const setFlag = (enabled: boolean) => admin.from("practice_platform_flags").upsert({ flag: CASE_LIBRARY_FLAG, enabled, note: "case-intelligence-acceptance-harness: on for its own run, restored after" }, { onConflict: "flag" });

  try {
    const [s1, s2, edu, rev, pub] = [await person(EMAILS.s1, "CI Student 1 (synthetic)"), await person(EMAILS.s2, "CI Student 2 (synthetic)"),
      await person(EMAILS.edu, "CI Educator (synthetic)"), await person(EMAILS.rev, "CI Reviewer (synthetic, harness)"), await person(EMAILS.pub, "CI Publisher (synthetic)")];
    const appoint = async (p: string, role: string) => (await admin.from("ogs_office_appointments").insert({ office_id: office.id, person_id: p, role, status: "active" }).select("id").single()).data.id as string;
    await appoint(edu, "clinical_case_educator"); await appoint(pub, "quality_council_member");
    const revAppt = await appoint(rev, "clinical_content_reviewer");
    await admin.from("clinical_reviewer_scope").insert({ appointment_id: revAppt, scope_kind: "framework", scope_ref: fw.id });
    const people = [s1, s2, edu, rev, pub];
    const ai0 = await aiRows(people);

    // ── G0: the gate, off ──
    await setFlag(false);
    const offGrant = await grantCaseCandidacy(admin, { userId: s1, attestation: "own_notes", attestationVersion: (await loadCasePolicy(admin)).attestationVersion });
    const offWithdraw = await withdrawCaseCandidate(admin, { userId: s1, sourceKey: `harness:case:${stamp}:0`, reason: "student" });
    const offFind = await findLibraryCases(admin, {});
    ok("G0. with the case_library flag off, granting is refused, a search offers nothing, and a withdrawal still works", !offGrant.ok && (offGrant as any).error === CASE_LIBRARY_OFF
      && Array.isArray(offFind) && offFind.length === 0 && offWithdraw.ok, JSON.stringify({ offGrant, offWithdraw, n: offFind?.length }));
    await setFlag(true);

    // ── P0, D1, D2, D4: the real 423 on staging ──
    const parity = await Promise.all(CASE_SCREEN_CORPUS.map(async c => ({ c, db: (await admin.rpc("case_identifier_kinds", { p_text: c.text })).data, ts: structuredKinds(c.text), app: screenText(c.text) })));
    const off = parity.filter(x => JSON.stringify(x.db) !== JSON.stringify(x.ts) || JSON.stringify(x.ts) !== JSON.stringify(x.c.kinds) || !x.ts.every(k => (x.app as string[]).includes(k)));
    ok(`P0. staging's backstop and the application screen agree on all ${parity.length} corpus texts, and the application is at least as strict`, off.length === 0, JSON.stringify(off.map(x => ({ t: x.c.text, db: x.db, ts: x.ts }))));
    const direct = (u: string, k: string, snap: any) => admin.from("case_candidate").insert({ user_id: u, source_key: `harness:direct:${stamp}:${k}`, status: "eligible", snapshot: snap, screen_version: "direct" }).select("id");
    const d1 = await direct(s1, "nopermission", libraryCase(comp.id, `Direct ${stamp}`));
    ok("D1. the real trigger refuses an offer without the permission, even written directly", !!d1.error && /no candidacy permission/.test(d1.error.message), d1.error?.message ?? "accepted");

    // ── J1 ──
    const policy = await loadCasePolicy(admin);
    const stale = await grantCaseCandidacy(admin, { userId: s1, attestation: "own_notes", attestationVersion: "case-attest/0" });
    const granted = await grantCaseCandidacy(admin, { userId: s1, attestation: "own_notes", attestationVersion: policy.attestationVersion });
    ok("J1. candidacy is granted on the CURRENT permission text only", !stale.ok && granted.ok, JSON.stringify({ stale, granted }));
    const d2 = await direct(s1, "nhs", { ...libraryCase(comp.id, `Direct ${stamp}`), metadata: { ...libraryCase(comp.id, "x").metadata, provenance: { kind: "private", rights: "student_private", note: "AI screen says de-identified" } },
      facts: [{ id: "x", kind: "context", label: "Notes", value: "NHS 943 476 5919", revealedAt: "start", safetyCritical: false }] });
    ok("D2. the real backstop refuses an eligible offer with an identifier, written directly past the screen", !!d2.error && /identifiable content \(nhs_number\)/.test(d2.error.message), d2.error?.message ?? "accepted");
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anonKey) {
      const browser = createClient(url!, anonKey, { auth: { persistSession: false } }) as any;
      const [v, t] = await Promise.all([browser.from("case_candidate_queue").select("id").limit(1), browser.from("case_candidate").select("id").limit(1)]);
      ok("D4. the browser's anon key cannot read the queue view, and reads nothing from the candidate table", !!v.error && (t.error || (t.data ?? []).length === 0), JSON.stringify({ view: v.error?.message ?? v.data, table: t.error?.message ?? t.data }));
    } else pend("D4", "no anon key in this environment");

    // ── J2 ──
    const clean = { ...libraryCase(comp.id, `Harness case ${stamp}`), summary: null, patient: null };
    const leaky = { ...clean, title: `Harness leaky ${stamp}`, facts: [...clean.facts, { id: "n", kind: "context", label: "Notes", value: "MRN 1234567", revealedAt: "start", safetyCritical: false }] };
    const o1 = await offerPrivateCase(admin, { userId: s1, sourceKey: `harness:case:${stamp}:1`, snapshot: clean, verbatim: { passed: true, version: "verbatim/1" } });
    const o2 = await offerPrivateCase(admin, { userId: s1, sourceKey: `harness:case:${stamp}:2`, snapshot: leaky, verbatim: { passed: true, version: "verbatim/1" } });
    const o3 = await offerPrivateCase(admin, { userId: s1, sourceKey: `harness:case:${stamp}:3`, snapshot: { ...clean, title: `Harness unchecked ${stamp}` }, verbatim: null });
    const o4 = await offerPrivateCase(admin, { userId: s1, sourceKey: `harness:case:${stamp}:4`, snapshot: { ...clean, title: `Harness spare ${stamp}` }, verbatim: { passed: true, version: "verbatim/1" } });
    const leakRow = o2.ok ? (await admin.from("case_candidate").select("snapshot, reasons").eq("id", o2.candidateId).single()).data : null;
    ok("J2. a clean case is eligible, an identifiable or unchecked one is ineligible and keeps no content", o1.ok && o1.status === "eligible" && o2.ok && o2.status === "ineligible"
      && leakRow?.snapshot === null && (leakRow?.reasons ?? []).includes("hospital_number") && o3.ok && o3.status === "ineligible" && o4.ok && o4.status === "eligible", JSON.stringify({ o1, o2, o3, leakRow }));
    const noPermission = await offerPrivateCase(admin, { userId: s2, sourceKey: `harness:case:${stamp}:9`, snapshot: clean, verbatim: { passed: true, version: "verbatim/1" } });
    ok("J2b. without the permission nothing is offered", !noPermission.ok, JSON.stringify(noPermission));

    // ── J3 ──
    const q = await candidateQueue(admin, edu, { window: "24h" });
    const mine = (q ?? []).filter(i => [o1, o2, o3, o4].some(o => o.ok && o.candidateId === i.id));
    const raw = (await admin.from("case_candidate_queue").select("*").in("id", mine.map(i => i.id))).data ?? [];
    ok("J3. the 24-hour queue lists only the eligible offers and names no student", q !== null && mine.length === 2 && mine.every(i => i.status === "eligible")
      && raw.every((r: any) => !("user_id" in r) && !("source_key" in r)), JSON.stringify({ n: mine.length, keys: raw[0] ? Object.keys(raw[0]) : [] }));
    ok("J3b. offering and opening the queue made no AI request", ai0 !== null && (await aiRows(people)) === ai0);

    // ── J4 ──
    const take = o1.ok ? await takeCandidate(admin, edu, o1.candidateId) : { ok: false };
    const prom = o1.ok ? await promoteCandidate(admin, edu, o1.candidateId, { code: `CASE-HARNESS-${stamp}`, title: `Harness case ${stamp}` }) : { ok: false } as any;
    caseId = prom.ok ? prom.caseId : null;
    const draft = prom.ok ? (await admin.from("case_library_version").select("content, origin_kind").eq("id", prom.versionId).single()).data : null;
    const candAfter = o1.ok ? (await admin.from("case_candidate").select("status, promoted_version_id").eq("id", o1.candidateId).single()).data : null;
    ok("J4. take and promote: a library draft of candidate origin on the attested rights, the candidate promoted", take.ok && prom.ok && draft?.origin_kind === "candidate"
      && draft?.content?.metadata?.provenance?.rights === "own_notes" && candAfter?.status === "promoted" && candAfter?.promoted_version_id === prom.versionId, JSON.stringify({ take, prom, prov: draft?.content?.metadata?.provenance, candAfter }));
    const saved = prom.ok ? await saveDraft(admin, edu, prom.versionId, libraryCase(comp.id, `Harness case ${stamp}`)) : { ok: false } as any;
    const sub = prom.ok ? await submitCase(admin, edu, prom.versionId) : { ok: false } as any;
    ok("J4b. the educator edits it into a complete case and submits it through 395", saved.ok && saved.problems.length === 0 && sub.ok, JSON.stringify({ saved, sub }));

    // ── J5 ──
    const eduAppt = await appoint(edu, "clinical_content_reviewer");
    await admin.from("clinical_reviewer_scope").insert({ appointment_id: eduAppt, scope_kind: "framework", scope_ref: fw.id });
    const selfApprove = sub.ok ? await decideReview(admin, sub.reviewVersionId, edu, eduAppt, "approved", null) : { ok: true };
    ok("J5. the educator who authored and edited it cannot approve it, even holding an in-scope reviewer appointment", !selfApprove.ok && /cannot review it/.test((selfApprove as any).error ?? ""), JSON.stringify(selfApprove));
    await admin.from("ogs_office_appointments").delete().eq("id", eduAppt);

    // ── J6 ──
    const earlySession = prom.ok ? await admin.from("case_library_session").insert({ user_id: s2, version_id: prom.versionId }).select("id") : { error: { message: "no case" } };
    ok("D5. the real trigger refuses a session on a submitted, unapproved version, written directly", !!earlySession.error && /only a published case approved/.test(earlySession.error.message), earlySession.error?.message ?? "accepted");
    const early = prom.ok ? await publishCase(admin, pub, prom.versionId) : { ok: true };
    const approve = sub.ok ? await decideReview(admin, sub.reviewVersionId, rev, revAppt, "approved", "harness-ci: case content checked") : { ok: false };
    const published = prom.ok ? await publishCase(admin, pub, prom.versionId) : { ok: false };
    const deliverable = prom.ok ? (await admin.rpc("case_library_deliverable", { p_version: prom.versionId })).data : false;
    ok("J6. nothing publishes before approval, an independent scoped reviewer approves, then a publisher publishes", !early.ok && approve.ok && published.ok && deliverable === true, JSON.stringify({ early, approve, published, deliverable }));

    // ── J7 ──
    const found = await findLibraryCases(admin, { competencyIds: [comp.id], topic: "respiratory deterioration" });
    const offered = (found ?? []).find(f => prom.ok && f.versionId === prom.versionId);
    const server = prom.ok ? await loadLibraryCase(admin, prom.versionId) : null;
    const start = prom.ok ? await startCaseSession(admin, s2, prom.versionId) : { error: "no case" };
    const view = "view" in start ? start.view : null;
    const leak = JSON.stringify(view ?? {});
    ok("J7. another student finds the approved case, and the server keeps the full case while the browser gets a learner view", !!offered && !!server?.blueprint && !!view
      && ["\"correct\"", "rationale", "\"rr\"", "\"d1\"", "summary", "After escalation", "Structured reassessment"].every(s => !leak.includes(s)), JSON.stringify({ offered: !!offered, view: leak.slice(0, 300) }));
    let done = false;
    if (view && "sessionId" in start) {
      const d1 = view.stages[0].decisionPoints[0];
      const a1 = await answerInSession(admin, s2, start.sessionId, { decisionToken: d1.token, optionTokens: [d1.options[0].token] });
      const v2 = "session" in a1 ? a1.session.view : null;
      const d2 = v2?.stages[1]?.decisionPoints[0];
      const a2 = d2 ? await answerInSession(admin, s2, start.sessionId, { decisionToken: d2.token, optionTokens: [d2.options[0].token] }) : { error: "no second stage" };
      done = "session" in a2 && a2.session.status === "completed" && "answered" in a1 && a1.answered?.options[0].correct === true;
    }
    ok("J7b. the case runs deterministically to the end, by its own key and progression", done);
    if (view && "sessionId" in start) {
      const ai = (n: number) => ({ provider: "anthropic", model: "harness-no-call", requestId: `harness.case.fb:${stamp}:${n}`, text: `Harness AI evaluation ${n} (no model was called).` });
      const d1 = view.stages[0].decisionPoints[0].token;
      const fb = await recordSessionFeedback(admin, s2, start.sessionId, d1, ai(1));
      const bogus = await recordSessionFeedback(admin, s2, start.sessionId, "not-a-decision", ai(2));
      const deb = await recordSessionDebrief(admin, s2, start.sessionId, ai(3));
      const deb2 = await recordSessionDebrief(admin, s2, start.sessionId, ai(4));
      const row = (await admin.from("case_library_session").select("feedback, debrief, answers").eq("id", start.sessionId).single()).data;
      const rewrite = await admin.from("case_library_session").update({ feedback: [] }).eq("id", start.sessionId).select("id");
      const replay = await admin.from("case_library_session").update({ answers: [] }).eq("id", start.sessionId).select("id");
      const approval = await admin.from("case_library_session").update({ feedback: [...(row?.feedback ?? []), { ...ai(5), kind: "approval", decisionPointId: row?.feedback?.[0]?.decisionPointId, at: new Date().toISOString() }] }).eq("id", start.sessionId).select("id");
      ok("J7d. AI feedback and the debrief sit on the one session, as labelled AI evaluations, append-only, and the finished play stays fixed",
        "sessionId" in fb && fb.feedback.length === 1 && fb.feedback[0].label === "AI evaluation" && fb.feedback[0].model === "harness-no-call" && "error" in bogus
        && "sessionId" in deb && deb.debrief?.label === "AI evaluation" && "error" in deb2 && row?.feedback?.[0]?.kind === "ai_evaluation"
        && !!rewrite.error && !!replay.error && !!approval.error && (row?.answers ?? []).length === 2,
        JSON.stringify({ fb: "error" in fb ? fb : fb.feedback, bogus, deb: "error" in deb ? deb : deb.debrief, deb2, rewrite: rewrite.error?.message, replay: replay.error?.message, approval: approval.error?.message }));
    } else ok("J7d. AI feedback and the debrief on the one session", false, "no session");
    ok("J7c. delivering and working through a stored case made no AI request", ai0 !== null && (await aiRows(people)) === ai0);

    // ── J8 ──
    const revoke = await revokeCaseCandidacy(admin, { userId: s1 });
    const left = (await admin.from("case_candidate").select("status, snapshot").eq("user_id", s1)).data ?? [];
    ok("J8. revoking withdraws and purges what was not promoted, and keeps the promoted case", revoke.ok && revoke.withdrawn === 3
      && left.filter((c: any) => c.status === "promoted").length === 1 && left.filter((c: any) => c.status === "withdrawn" && c.snapshot === null).length === 3, JSON.stringify({ revoke, left: left.map((c: any) => c.status) }));

    // ── J9 ──
    const ci = await caseIntelligence(admin, { from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date(Date.now() + 60_000).toISOString() });
    ok("J9. case intelligence counts the journey from stored records, and keeps estimates apart", !!ci && (ci.candidates.promoted ?? 0) >= 1 && ci.library.published >= 1 && ci.reuse.sessionsCompleted >= 1
      && (ci.meteringOn || (!ci.spendByOwner.platform.measured && !ci.estimatedAvoided.estimated)), JSON.stringify(ci && { c: ci.candidates, l: ci.library, r: ci.reuse, m: ci.meteringOn }));
  } finally {
    if (caseId) await retireCase(admin, caseId);
    if (prior) await admin.from("practice_platform_flags").update({ enabled: prior.enabled, note: prior.note }).eq("flag", CASE_LIBRARY_FLAG);
    else await admin.from("practice_platform_flags").delete().eq("flag", CASE_LIBRARY_FLAG);
    const after = (await admin.from("practice_platform_flags").select("enabled, note").eq("flag", CASE_LIBRARY_FLAG).maybeSingle()).data;
    ok("Z0. the case_library flag is back exactly as the run found it", JSON.stringify(after ?? null) === JSON.stringify(prior ? { enabled: prior.enabled, note: prior.note } : null), JSON.stringify({ prior, after }));
    await cleanup();
    const gone = (await Promise.all(Object.values(EMAILS).map(findUser))).every(u => !u);
    ok("Z1. fixtures removed: the five people, their appointments and scopes, their permission, offers and sessions (the retired fixture case stays as the record)", gone);
  }
  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed: ${fails.join(", ")}` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  if (fails.length) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exit(1); });
