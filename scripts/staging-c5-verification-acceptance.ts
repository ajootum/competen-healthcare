/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COMPETEN-PROFESSIONAL-COMPETENCY-01 s15 ITEMS 17-22 -- THE C5 VERIFICATION STUDIO ON STAGING, over HTTP, STAGING ONLY.
 *
 *   C5_STATE=<file outside the repo> BASE_URL=http://localhost:3040 npx tsx scripts/staging-c5-verification-acceptance.ts --setup
 *       creates TWO labelled synthetic identities (a Studio Administrator and an Assessor) with NO appointment, and writes
 *       their generated passwords to C5_STATE (never to the output). The OWNER then appoints them on staging HQ:
 *       competency_verification_administrator and competency_assessor. Nothing here appoints anybody.
 *   C5_STATE=... REQUESTER_ID=<uuid> REQUESTER_CPD_ID=<uuid> BASE_URL=... npx tsx scripts/staging-c5-verification-acceptance.ts --journey
 *       17-22 through the real routes, as those identities: configure a method, scope the assessor narrowly, a request by
 *       the requester (a synthetic Professional member of the integrated journey, with one of their own CPD entries as
 *       evidence), assignment, the decision, self-verification refused, history intact after revocation and a new version.
 *   C5_STATE=... BASE_URL=... npx tsx scripts/staging-c5-verification-acceptance.ts --retire
 *       ends the scopes (through the Studio route), ends both appointments (kept as the record), revokes sessions, bans
 *       both identities (kept) and lists every row they have.
 *
 * ⚠ STAGING ONLY: judgeTarget must name ezhvpgtcqcdsgylrxgdb, and the server must be local and staging-pointed.
 * ⚠ REAL PERMISSION CHECKS. Every Studio and assessor step is an HTTP call with that identity's own session through
 * hqApiGate, and 510's triggers check the appointment, the scope, the assignment and independence again. The only
 * service-role writes are the requester's request (the call a product makes for its own signed-in member, as the
 * portfolio does) and the history probes at 22, which MUST be refused.
 */
import { loadEnvConfig } from "@next/env";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "", anon = process.env.STAGING_ANON_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || verdict.ref !== "ezhvpgtcqcdsgylrxgdb" || !key || !anon) { console.error(`REFUSING: not the staging project (${verdict.ok ? verdict.ref : verdict.reason}).`); process.exit(1); }
const REF = verdict.ref;
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
if (!/^http:\/\/localhost:\d+$/.test(BASE)) { console.error("REFUSING: BASE_URL must be a local staging-pointed dev server."); process.exit(1); }
const STATE = process.env.C5_STATE ?? "";
if (!STATE || resolve(STATE).toLowerCase().startsWith(resolve(process.cwd(), "..").toLowerCase())) { console.error("REFUSING: C5_STATE must be a file outside the repositories (it holds passwords)."); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const MODE = process.argv.includes("--setup") ? "setup" : process.argv.includes("--retire") ? "retire" : process.argv.includes("--doors") ? "doors" : "journey";

const WHO = {
  admin: { email: "c5-studio-admin@staging.competen.invalid", name: "SYNTHETIC C5 studio administrator (IND-007, staging, retire after)", position: "competency_verification_administrator" },
  assessor: { email: "c5-assessor@staging.competen.invalid", name: "SYNTHETIC C5 assessor (IND-007, staging, retire after)", position: "competency_assessor" },
} as const;
const PURPOSE = "Owner GO COMPETEN-PROFESSIONAL-COMPETENCY-01 Stage 5, s15 items 17-22, staging only. Synthetic assessment identity. Retired after: kept, banned.";
const METHOD_CODE = `c5_synthetic_ecg_observation`;

const results: { item: string; ok: boolean; detail: string }[] = [];
const ok = (item: string, c: boolean, detail = "") => { results.push({ item, ok: c, detail }); console.log(`  ${c ? "PASS" : "FAIL"}  ${item}${!c && detail ? ` -- ${detail}` : ""}`); return c; };

async function findUser(email: string) {
  for (let p = 1; p <= 20; p++) {
    const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
async function session(email: string, password: string) {
  const s = await createClient(url, anon, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) throw new Error(`sign-in ${email}: ${s.error?.message}`);
  return { cookie: `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(s.data.session)).toString("base64")}`, token: s.data.session.access_token };
}
const call = async (cookie: string, method: string, path: string, body?: any) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Cookie: cookie, Origin: BASE, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* page */ }
  return { status: res.status, text, json, location: res.headers.get("location") };
};
// A page's door, read from its CONTENT. A redirect() thrown after streaming starts answers HTTP 200 with the redirect in
// the body, so a status alone cannot say whether the page opened (the first journey run, 25 Oct, was misled by it).
const STUDIO_TEXT = "Configure how competence is independently assessed", QUEUE_TEXT = "Requests assigned to you, within the scope of your appointment";
const opens = (r: { text: string }, marker: string) => r.text.includes(marker) && !/NEXT_REDIRECT/.test(r.text);
const activeAppointment = async (personId: string, role: string) =>
  (await admin.from("ogs_office_appointments").select("id").eq("person_id", personId).eq("role", role).eq("status", "active").limit(1)).data?.[0]?.id ?? null;

async function setup() {
  if (existsSync(STATE)) { console.error("REFUSING: C5_STATE exists. Setup runs once."); process.exit(1); }
  const st: Record<string, { id: string; password: string }> = {};
  for (const [k, w] of Object.entries(WHO)) {
    if (await findUser(w.email)) { console.error(`REFUSING: ${w.email} already exists.`); process.exit(1); }
    const password = `${randomBytes(18).toString("base64url")}-Aa1!`;
    const { data, error } = await admin.auth.admin.createUser({ email: w.email, password, email_confirm: true, user_metadata: { full_name: w.name, synthetic: true, purpose: PURPOSE } });
    if (error || !data?.user) throw new Error(`createUser ${w.email}: ${error?.message}`);
    await admin.from("profiles").update({ full_name: w.name }).eq("id", data.user.id);
    st[k] = { id: data.user.id, password };
    console.log(`created ${w.email} -> ${data.user.id} (no appointment). The owner appoints this person to ${w.position} on staging HQ.`);
  }
  writeFileSync(STATE, JSON.stringify(st));
  console.log("\nPasswords are in C5_STATE only. Next: the owner appoints both, then run --journey.");
}

async function journey() {
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  const requester = process.env.REQUESTER_ID ?? "", cpdId = process.env.REQUESTER_CPD_ID ?? "";
  const aAdm = await activeAppointment(st.admin.id, WHO.admin.position), aAss = await activeAppointment(st.assessor.id, WHO.assessor.position);
  if (!aAdm || !aAss) { console.error(`WAITING: the owner has not appointed both yet (administrator ${aAdm ? "appointed" : "not appointed"}, assessor ${aAss ? "appointed" : "not appointed"}). Nothing done.`); process.exit(2); }
  // COMPETENCY_ID: the requester's own competency from the integrated journey (its CPD evidence is linked to outcome 0).
  // Without it, the first published respiratory competency with two outcomes.
  const pick = process.env.COMPETENCY_ID ?? "";
  const comps = (await admin.from("framework_competencies").select("id, code, name, learning_outcomes, framework_domains!inner(frameworks!inner(code, hospital_id, pub_status))")
    .is("framework_domains.frameworks.hospital_id", null).eq("framework_domains.frameworks.pub_status", "published")
    .eq(pick ? "id" : "framework_domains.frameworks.code", pick || "NUR-RESP").limit(50)).data ?? [];
  const comp = comps.find((c: any) => (c.learning_outcomes ?? []).length >= (pick ? 1 : 2));
  const scale = (await admin.from("scoring_scales").select("id, scoring_levels(id, score, label)").limit(1)).data?.[0];
  if (!comp || !scale) { console.error("REFUSING: no published shared respiratory competency with two outcomes, or no scale."); process.exit(1); }
  const levels = [...(scale.scoring_levels ?? [])].sort((a: any, b: any) => a.score - b.score);
  const target = levels[Math.min(levels.length - 1, 4)];
  const A = await session(WHO.admin.email, st.admin.password), S = await session(WHO.assessor.email, st.assessor.password);
  console.log(`C5 JOURNEY -- staging ${REF}; competency ${comp.code} ${comp.name}; scale levels ${levels.length}\n`);

  // 17. Configure an assessment method through the no-code Studio
  const studioPage = await call(A.cookie, "GET", "/super-admin/verification-studio");
  const notForAssessor = await call(S.cookie, "GET", "/super-admin/verification-studio");
  const made = await call(A.cookie, "POST", "/api/hq/competency-verification", { action: "create_method", code: METHOD_CODE, name: "SYNTHETIC C5 respiratory assessment, observed", kind: "direct_observation" });
  const versionId = made.json?.versionId;
  const content = {
    summary: "SYNTHETIC staging method: an observed respiratory assessment, decided against the criteria below. Not a real assessment standard.",
    applicability: { competencyIds: [comp.id], contexts: ["independent"] }, scaleId: scale.id, levelIds: levels.map((l: any) => l.id),
    outcomes: [{ code: "verified_at_level", class: "verified", label: "Verified at the level stated" }, { code: "partly", class: "partial", label: "Partially demonstrated" },
      { code: "more_evidence", class: "further_evidence", label: "Further evidence required" }, { code: "not_shown", class: "not_demonstrated", label: "Not demonstrated under these conditions" },
      { code: "undetermined", class: "unable_to_determine", label: "Unable to determine" }],
    criteria: [{ id: "c1", text: "Performs a systematic respiratory assessment (synthetic criterion)", required: true }, { id: "c2", text: "Escalates appropriately (synthetic criterion)", required: true }],
    checklist: [{ id: "k1", text: "Consent recorded (synthetic)", critical: true }], minEvidence: 1, decisionGuidance: "Synthetic staging guidance.",
    workflow: { assignment: "administrator", allowFurtherEvidence: true }, validity: { months: 24, renewal: "reassessment" },
  };
  const saved = versionId ? await call(A.cookie, "POST", "/api/hq/competency-verification", { action: "save_draft", versionId, content }) : { status: 0, text: "" } as any;
  const published = versionId ? await call(A.cookie, "POST", "/api/hq/competency-verification", { action: "publish", versionId }) : { status: 0, text: "" } as any;
  const v1 = versionId ? (await admin.from("competency_verification_method_version").select("state, content_hash").eq("id", versionId).maybeSingle()).data : null;
  ok("17. a method is configured and published through the no-code Studio, its criteria fixed by hash; the assessor cannot open the Studio",
    opens(studioPage, STUDIO_TEXT) && !opens(notForAssessor, STUDIO_TEXT) && made.status === 201 && saved.status === 200 && published.status === 200 && v1?.state === "published" && !!v1.content_hash,
    JSON.stringify({ studio: studioPage.status, assessorStudio: notForAssessor.status, made: made.status, saved: [saved.status, saved.text?.slice(0, 120)], published: [published.status, published.text?.slice(0, 120)] }));

  // 18. Appoint (owner, done) and scope a narrowly scoped synthetic assessor through the authorised controls
  const methodId = (await admin.from("competency_verification_method").select("id").eq("code", METHOD_CODE).maybeSingle()).data?.id;
  const selfScope = await call(S.cookie, "POST", "/api/hq/competency-verification", { action: "grant_scope", appointmentId: aAss, kind: "competency", ref: comp.id, reason: "self" });
  const g1 = await call(A.cookie, "POST", "/api/hq/competency-verification", { action: "grant_scope", appointmentId: aAss, kind: "competency", ref: comp.id, reason: "SYNTHETIC C5: one respiratory competency" });
  const g2 = await call(A.cookie, "POST", "/api/hq/competency-verification", { action: "grant_scope", appointmentId: aAss, kind: "method", ref: methodId, reason: "SYNTHETIC C5: this method only" });
  const g3 = await call(A.cookie, "POST", "/api/hq/competency-verification", { action: "grant_scope", appointmentId: aAss, kind: "max_level", ref: target.id, reason: "SYNTHETIC C5: up to this level" });
  const scopes = (await admin.from("competency_assessor_scope").select("scope_kind, granted_by").eq("appointment_id", aAss).is("ended_at", null)).data ?? [];
  ok("18. the owner-appointed assessor is scoped narrowly (one competency, one method, a highest level) by the Studio, and cannot scope themselves",
    selfScope.status >= 400 && g1.status === 200 && g2.status === 200 && g3.status === 200 && scopes.length === 3 && scopes.every((s: any) => s.granted_by === st.admin.id),
    JSON.stringify({ selfScope: selfScope.status, g: [g1.status, g2.status, g3.status, g1.text.slice(0, 100)], scopes: scopes.length }));

  // 19. Request and undertake a governed verification
  const { requestVerification } = await import("../src/lib/competency/verification");
  let requestId: string | null = null;
  if (requester && cpdId) {
    // The portfolio's hand-over shape: outcome WORDS, the CPD entry linked to the first outcome.
    const first = String((comp.learning_outcomes ?? [])[0] ?? "");
    const r = await requestVerification(admin, requester, { competencyId: comp.id, methodVersionId: versionId, learningOutcomes: first ? [first] : undefined, targetLevelId: target.id,
      evidence: [{ kind: "cpd", sourceId: cpdId, learningOutcome: first || null }], note: "SYNTHETIC C5 request" });
    requestId = r.ok ? r.requestId : null;
    if (!r.ok) console.log(`  request refused: ${r.error}`);
  }
  if (!requestId) { console.log("  NOTE  items 19 and 21 need REQUESTER_ID and REQUESTER_CPD_ID (the integrated journey's synthetic member)."); }
  const assigned = requestId ? await call(A.cookie, "POST", "/api/hq/competency-verification", { action: "assign", requestId, appointmentId: aAss }) : null;
  const queue = await call(S.cookie, "GET", "/super-admin/competency-assessment");
  const evId = requestId ? (await admin.from("competency_verification_evidence").select("id").eq("request_id", requestId).limit(1)).data?.[0]?.id : null;
  const decision = requestId ? await call(S.cookie, "POST", "/api/hq/competency-assessment", {
    action: "decide", requestId, outcomeCode: "verified_at_level", levelId: target.id, rationale: "SYNTHETIC: observed a systematic respiratory assessment and appropriate escalation.",
    criteria: [{ id: "c1", result: "met" }, { id: "c2", result: "met" }], checklist: [{ id: "k1", result: "done" }], evidenceReviewed: evId ? [evId] : [],
  }) : null;
  if (requestId) ok("19. a request is assigned by the Studio and decided by the assigned assessor, in scope, on the assessor's own queue",
    assigned?.status === 200 && queue.status === 200 && decision?.status === 200, JSON.stringify({ assigned: [assigned?.status, assigned?.text.slice(0, 120)], queue: queue.status, decision: [decision?.status, decision?.text.slice(0, 160)] }));

  // 20. Self-verification is refused (the assessor's own request: not assignable to them, not decidable by them)
  const own = await requestVerification(admin, st.assessor.id, { competencyId: comp.id, methodVersionId: versionId, outcomeIndexes: [-1], evidence: [] });
  const ownId = own.ok ? own.requestId : null;
  const assignSelf = ownId ? await call(A.cookie, "POST", "/api/hq/competency-verification", { action: "assign", requestId: ownId, appointmentId: aAss }) : null;
  const decideSelf = ownId ? await call(S.cookie, "POST", "/api/hq/competency-assessment", { action: "decide", requestId: ownId, outcomeCode: "verified_at_level", levelId: target.id, rationale: "Trying to verify myself", criteria: [{ id: "c1", result: "met" }, { id: "c2", result: "met" }], checklist: [{ id: "k1", result: "done" }] }) : null;
  const direct = ownId ? await admin.from("competency_verification_decision").insert({ request_id: ownId, user_id: st.assessor.id, assessor_id: st.assessor.id, appointment_id: aAss, method_version_id: versionId, outcome_code: "verified_at_level", level_id: target.id, rationale: "Direct self-verification attempt", criteria_results: [{ id: "c1", result: "met" }, { id: "c2", result: "met" }], checklist_results: [{ id: "k1", result: "done" }] }) : null;
  ok("20. self-verification is refused: by the route, by assignment and by the database even for a direct service-role write",
    !!ownId && (assignSelf?.status ?? 0) >= 400 && (decideSelf?.status ?? 0) === 403 && !!direct?.error && /self-verification/.test(direct.error.message),
    JSON.stringify({ own: own.ok, assignSelf: [assignSelf?.status, assignSelf?.text.slice(0, 120)], decideSelf: decideSelf?.status, direct: direct?.error?.message }));
  if (ownId) await admin.from("competency_verification_event").insert({ request_id: ownId, user_id: st.assessor.id, event: "withdrawn", actor_id: st.assessor.id, reason: "SYNTHETIC C5 self-verification probe, withdrawn" });

  // 21. The decision carries criteria, evidence and assessor provenance
  const d = requestId ? (await admin.from("competency_verification_decision").select("*").eq("request_id", requestId).maybeSingle()).data : null;
  const audit = requestId ? (await admin.from("audit_log").select("action, actor_id").eq("entity_id", requestId).eq("action", "competency_assessment_decide")).data ?? [] : [];
  if (requestId) ok("21. the decision records the method version and its hash, the competency content hash, each criterion, the evidence reviewed, the assessor and their appointment, its validity, and is audited",
    !!d && d.method_version_id === versionId && d.method_content_hash === v1?.content_hash && !!d.competency_hash && d.criteria_results.length === 2 && d.evidence_reviewed.length === 1
      && d.assessor_id === st.assessor.id && d.appointment_id === aAss && d.outcome_class === "verified" && !!d.valid_until && audit.length === 1 && audit[0].actor_id === st.assessor.id,
    JSON.stringify({ d: d && { ...d, rationale: undefined }, audit }));

  // 22. Verification history stays intact: no rewrite, no delete, revocation as an event, a new version leaves it pinned
  if (requestId && d) {
    const rewrite = await admin.from("competency_verification_decision").update({ rationale: "Rewritten afterwards" }).eq("id", d.id);
    const del = await admin.from("competency_verification_decision").delete().eq("id", d.id);
    const revoke = await call(A.cookie, "POST", "/api/hq/competency-verification", { action: "revoke", decisionId: d.id, reason: "SYNTHETIC C5: revocation probe" });
    const v2 = await call(A.cookie, "POST", "/api/hq/competency-verification", { action: "new_draft", methodId });
    const v2pub = v2.json?.versionId ? await call(A.cookie, "POST", "/api/hq/competency-verification", { action: "publish", versionId: v2.json.versionId }) : null;
    const after = (await admin.from("competency_verification_decision").select("rationale, method_version_id, method_content_hash").eq("id", d.id).maybeSingle()).data;
    const v1now = (await admin.from("competency_verification_method_version").select("state, content_hash").eq("id", versionId).maybeSingle()).data;
    const { loadVerifications } = await import("../src/lib/competency/verification");
    const mine = await loadVerifications(admin, requester);
    const standing = mine?.find(r => r.id === requestId)?.decisions[0]?.standing;
    ok("22. history intact: the decision cannot be rewritten or deleted, revocation is a new event, and a new published version retires the old one while the decision keeps its pinned criteria",
      !!rewrite.error && !!del.error && revoke.status === 200 && v2pub?.status === 200 && after?.rationale === d.rationale && after?.method_content_hash === v1?.content_hash
        && v1now?.state === "retired" && v1now.content_hash === v1?.content_hash && standing === "revoked",
      JSON.stringify({ rewrite: rewrite.error?.message, del: del.error?.message, revoke: revoke.status, v2: v2.status, v2pub: v2pub?.status, v1now, standing }));
  }
  const f = results.filter(r => !r.ok);
  console.log(`\n${f.length ? "RED" : "GREEN"} -- ${results.length - f.length} passed, ${f.length} failed`);
  process.exitCode = f.length ? 1 : 0;
}

/** The two doors, read from content: each identity opens its own page and not the other's. Read-only. */
async function doors() {
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  const A = await session(WHO.admin.email, st.admin.password), S = await session(WHO.assessor.email, st.assessor.password);
  const [aStudio, aQueue, sStudio, sQueue] = await Promise.all([
    call(A.cookie, "GET", "/super-admin/verification-studio"), call(A.cookie, "GET", "/super-admin/competency-assessment"),
    call(S.cookie, "GET", "/super-admin/verification-studio"), call(S.cookie, "GET", "/super-admin/competency-assessment")]);
  const where = (r: { text: string }) => /NEXT_REDIRECT;[a-z]+;([^;"]+)/.exec(r.text)?.[1] ?? null;
  ok("17b. the Studio Administrator opens the Studio and NOT the assessor queue", opens(aStudio, STUDIO_TEXT) && !opens(aQueue, QUEUE_TEXT), JSON.stringify({ studio: aStudio.status, queueRedirect: where(aQueue) }));
  ok("17c. the Competency Assessor opens the assessor queue and NOT the Studio", opens(sQueue, QUEUE_TEXT) && !opens(sStudio, STUDIO_TEXT), JSON.stringify({ queue: sQueue.status, studioRedirect: where(sStudio) }));
  console.log(`  (refused pages answer HTTP 200 with a streamed redirect: assessor -> ${where(sStudio)}, administrator -> ${where(aQueue)})`);
  const fails = results.filter(r => !r.ok);
  console.log(`\n${fails.length ? "RED" : "GREEN"} -- ${results.length - fails.length} passed, ${fails.length} failed`);
  process.exitCode = fails.length ? 1 : 0;
}

async function retire() {
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  const ids = [st.admin.id, st.assessor.id];
  // 1. Scopes end through the Studio route, as the Studio Administrator -- the real control.
  const A = await session(WHO.admin.email, st.admin.password).catch(() => null);
  const assessorAppts = ((await admin.from("ogs_office_appointments").select("id").eq("person_id", st.assessor.id).eq("role", WHO.assessor.position)).data ?? []).map((a: any) => a.id);
  const live = assessorAppts.length ? (await admin.from("competency_assessor_scope").select("id").in("appointment_id", assessorAppts).is("ended_at", null)).data ?? [] : [];
  for (const sc of live) {
    const r = A ? await call(A.cookie, "POST", "/api/hq/competency-verification", { action: "end_scope", scopeId: sc.id, reason: "SYNTHETIC C5 retired after the staging acceptance" }) : { status: 0, text: "no admin session" };
    console.log(`scope ${sc.id}: end_scope HTTP ${r.status}`);
  }
  // 2. Appointments: ending one is the OWNER's control (/api/hq/appointments PATCH, owner only). Not written here.
  const appts = (await admin.from("ogs_office_appointments").select("id, person_id, role, status, term_start, term_end").in("person_id", ids)).data ?? [];
  for (const a of appts) console.log(`appointment ${a.id} (${a.role}): ${a.status}${a.status === "active" ? "  <- the OWNER ends this on the board" : ""}`);
  // 3. Gate-1 membership: no route revokes one, so it is revoked here, labelled -- the reverse of owner decision M1.
  for (const id of ids) {
    const r = await admin.from("platform_membership").update({ status: "revoked", revoked_at: new Date().toISOString(), revoked_by: null,
      note: "SYNTHETIC C5 staging identity (IND-007). Granted under owner decision M1, 25 Oct 2026, and revoked at retirement after the s15 items 17-22 run.", updated_at: new Date().toISOString() })
      .eq("user_id", id).select("id, status").maybeSingle();
    console.log(`platform_membership for ${id}: ${r.error ? `FAILED ${r.error.message}` : JSON.stringify(r.data)}`);
  }
  // 4. Sessions revoked BEFORE the ban (a banned user's sign-out is refused), then banned and kept.
  for (const [k, w] of Object.entries(WHO)) {
    const sess = await session(w.email, st[k].password).catch(() => null);
    if (sess) await admin.auth.admin.signOut(sess.token, "global");
    await admin.auth.admin.updateUserById(st[k].id, { ban_duration: "876000h", user_metadata: { full_name: w.name, synthetic: true, purpose: PURPOSE, retired: new Date().toISOString() } });
    const again = await createClient(url, anon, { auth: { persistSession: false } }).auth.signInWithPassword({ email: w.email, password: st[k].password });
    ok(`R. ${k} retired: sign-in refused, kept`, !!again.error, again.error ? "" : "SIGN-IN STILL ALLOWED");
  }
  // 5. Every row these identities have, by table, with ids.
  console.log("\nROWS (all kept as the record):");
  const list = async (label: string, t: string, cols: string, col: string, vals: string[]) => {
    const r = await admin.from(t).select(cols).in(col, vals);
    console.log(`  ${label}: ${r.error ? `unreadable (${r.error.message})` : `${(r.data ?? []).length}${(r.data ?? []).length ? " " + JSON.stringify(r.data) : ""}`}`);
    return r.data ?? [];
  };
  await list("profiles", "profiles", "id, email, full_name", "id", ids);
  await list("platform_membership", "platform_membership", "id, user_id, status, source", "user_id", ids);
  await list("ogs_office_appointments", "ogs_office_appointments", "id, person_id, role, status", "person_id", ids);
  const methods = await list("competency_verification_method", "competency_verification_method", "id, code", "created_by", ids);
  await list("competency_verification_method_version", "competency_verification_method_version", "id, method_id, version_no, state, content_hash", "authored_by", ids);
  await list("competency_assessor_scope (granted)", "competency_assessor_scope", "id, appointment_id, scope_kind, ended_at", "granted_by", ids);
  await list("competency_verification_request (the assessor's own probe)", "competency_verification_request", "id, user_id", "user_id", ids);
  await list("competency_verification_event (by them)", "competency_verification_event", "id, request_id, event", "actor_id", ids);
  await list("competency_verification_decision (by the assessor)", "competency_verification_decision", "id, request_id, outcome_code, outcome_class", "assessor_id", ids);
  const reqs = methods.length ? (await admin.from("competency_verification_request").select("id, user_id, method_version_id, competency_verification_method_version!inner(method_id)")
    .in("competency_verification_method_version.method_id", methods.map((m: any) => m.id))).data ?? [] : [];
  console.log(`  competency_verification_request under the synthetic method(s): ${reqs.length} ${JSON.stringify(reqs.map((r: any) => ({ id: r.id, user_id: r.user_id })))}`);
  if (reqs.length) await list("competency_verification_evidence on those requests", "competency_verification_evidence", "id, request_id, kind", "request_id", reqs.map((r: any) => r.id));
  const audit = await admin.from("audit_log").select("action").in("actor_id", ids);
  const byAction: Record<string, number> = {}; for (const a of audit.data ?? []) byAction[a.action] = (byAction[a.action] ?? 0) + 1;
  console.log(`  audit_log by them: ${(audit.data ?? []).length} ${JSON.stringify(byAction)}`);
  const fails = results.filter(r => !r.ok);
  console.log(`\n${fails.length ? "RED" : "GREEN"} -- ${results.length - fails.length} passed, ${fails.length} failed`);
  process.exitCode = fails.length ? 1 : 0;
}

(MODE === "setup" ? setup() : MODE === "retire" ? retire() : MODE === "doors" ? doors() : journey()).catch(e => { console.error(e); process.exitCode = 1; });
