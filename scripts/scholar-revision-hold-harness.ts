/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR REVISION -- HOLD SELF-GRADING UNTIL THE END (REVISION-01 R4, owner decision 2026-10-25), focused live check
 * of that one change over HTTP. In Mock and in end-of-session feedback, a short answer that code cannot mark and no AI
 * evaluation judged (the Individual quota is used up for THIS fixture, so AI evaluation is not available):
 *
 *   H1  is held, unmarked, on its session item (425): no attempt, and no accepted answer, explanation or grading prompt
 *   H2  cannot be graded, nor answered again, before the end
 *   H3  survives leaving and coming back
 *   H4  at the end: the student's answer, the accepted answers, the explanation and the source, to grade themselves
 *   H5  graded: the answer the student WROTE is recorded once, self_graded, and the hold is cleared
 *   H6  cannot be graded twice
 *   H7  immediate feedback is unchanged (the self-grade at once)
 *   H8  with no quota block, a short answer is never AI-evaluated by an ineligible model (D5-v2, #99): self-graded
 *   E   erase-all removes held answers with their sessions
 *
 * Real AI writes the short-answer questions. Metering OFF. Reads shared configuration only.
 * Fixtures: harness-revhold-*, deleted at the start and the end.
 *
 * ⚠ STAGING ONLY: npx tsx scripts/privileged-harnesses.ts --staging --only scholar-revision-hold
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { BUCKET, DOCX_MIME } from "../src/lib/individual/scholar/config";
import { tinyDocx } from "../src/lib/individual/scholar/test-documents";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-revision-hold-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const note = (s: string) => console.log(`        ${s}`);

const FIX = { grantor: "harness-revhold-grantor@competen.test", a: "harness-revhold-a@competen.test", b: "harness-revhold-b@competen.test" };
const PW = `revhold-${Math.random().toString(36).slice(2)}-Aa1!`;
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};

// The Stage 2 oxygen notes (as scholar-learn01-harness uses them).
const OXYGEN = [
  "Oxygen therapy notes.",
  "Oxygen is a medicine and must be prescribed with a target saturation range.",
  "A target range is used because too little oxygen causes hypoxaemia and too much oxygen can also cause harm.",
  "Check the prescription, the delivery device and the flow before starting oxygen therapy.",
  "A Venturi mask delivers a fixed concentration of oxygen.",
  "Monitor the oxygen saturation and escalate to the nurse in charge if hypoxaemia worsens.",
];

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
  for (const email of Object.values(FIX)) {
    const u = await findUser(email);
    if (!u) continue;
    const listed = await admin.storage.from(BUCKET).list(u.id, { limit: 1000 });
    if (listed.data?.length) await admin.storage.from(BUCKET).remove(listed.data.map((o: any) => `${u.id}/${o.name}`));
    for (const t of ["case_candidate", "case_candidacy", "case_library_session", "individual_scholar_case_session", "individual_scholar_case", "individual_scholar_revision_session", "individual_scholar_revision_set", "individual_scholar_learning_session", "individual_scholar_learning_preference",
      "individual_scholar_material", "individual_scholar_collection", "individual_scholar_consent", "individual_scholar_learner", "individual_scholar_learner_context",
      "individual_entitlement", "individual_membership", "plat_ai_requests", "audit_log"])
      await admin.from(t).delete().eq(t === "audit_log" || t === "plat_ai_requests" ? "actor_id" : "user_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}

type Jar = Map<string, string>;
const cookieHeader = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(jar: Jar, res: Response) {
  for (const c of (res.headers as any).getSetCookie?.() ?? []) {
    const [pair] = c.split(";"); const i = pair.indexOf("=");
    const name = pair.slice(0, i), value = pair.slice(i + 1);
    if (!value || /max-age=0/i.test(c)) jar.delete(name); else jar.set(name, value);
  }
}
async function get(path: string, jar?: Jar) {
  const res = await fetch(BASE + path, { redirect: "manual", headers: jar ? { Cookie: cookieHeader(jar) } : {} });
  if (jar) absorb(jar, res);
  return { status: res.status, text: res.status === 200 ? (await res.text()).replace(/<!-- -->/g, "").replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&") : "" };
}
async function send(method: string, path: string, body: unknown, jar?: Jar, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...headers, ...(jar ? { Cookie: cookieHeader(jar) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (jar) absorb(jar, res);
  return { status: res.status, json: await res.json().catch(() => ({})) as any };
}
async function signIn(email: string) {
  const jar: Jar = new Map();
  const r = await send("POST", "/api/auth/login", { email, password: PW }, jar);
  return { jar, status: r.status };
}
async function upload(jar: Jar, mime: string, bytes: Uint8Array, fileName: string) {
  const slot = await send("POST", "/api/individual/scholar/uploads", { mime, size: bytes.byteLength, piiAttested: true }, jar);
  if (slot.status !== 200) return null;
  const browser = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const put = await browser.storage.from(slot.json.bucket).uploadToSignedUrl(slot.json.path, slot.json.token, bytes, { contentType: mime });
  if (put.error) return null;
  const done = await send("POST", "/api/individual/scholar/materials", { uploadId: slot.json.uploadId, mime, fileName, piiAttested: true }, jar);
  return done.status === 200 ? done.json.id as string : null;
}
async function analyseAll(jar: Jar, id: string) {
  for (let rounds = 0, left = 99; left > 0 && rounds < 8; rounds++) {
    const r = await send("POST", `/api/individual/scholar/materials/${id}/analyse`, {}, jar);
    if (r.status !== 200) break;
    left = r.json.remaining ?? 0;
  }
}

async function startRevision(jar: Jar, body: Record<string, unknown>) {
  let r = await send("POST", "/api/individual/scholar/revision/sessions", body, jar, { "x-request-id": `revhold-${Math.random().toString(36).slice(2, 12)}` });
  if (r.status === 502) { note(`revision ${String(body.mode)}: provider failure 502 -- retrying once`); r = await send("POST", "/api/individual/scholar/revision/sessions", body, jar); }
  return r;
}
const UNMATCHED = "something the notes put quite another way";

/** One session's held-answer path, end to end: H1-H6 for the given mode. */
async function heldPath(label: string, jar: Jar, userId: string, sessionId: string, qid: string) {
  const ans = await send("POST", "/api/individual/scholar/revision/answer", { questionId: qid, sessionId, response: { text: UNMATCHED } }, jar);
  const raw = JSON.stringify(ans.json);
  const accepted = ((await admin.from("individual_scholar_question").select("answer").eq("user_id", userId).eq("id", qid).maybeSingle()).data as any)?.answer?.accepted ?? [];
  const item = ((await admin.from("individual_scholar_revision_session_item").select("held_response").eq("user_id", userId).eq("session_id", sessionId).eq("question_id", qid).maybeSingle()).data as any);
  const attempts0 = (await admin.from("individual_scholar_attempt").select("id", { count: "exact" }).eq("user_id", userId).eq("revision_session_id", sessionId).eq("question_id", qid).limit(1)).count ?? 0;
  ok(`H1 ${label}. an unmarkable short answer is held, unmarked: kept on its session item, no attempt yet, and nothing revealed -- no accepted answer, explanation or grading prompt`,
    ans.status === 200 && ans.json?.held === true && !ans.json?.needsSelfGrade && !ans.json?.feedback && !accepted.some((a: string) => raw.includes(a)) && item?.held_response?.text === UNMATCHED && attempts0 === 0,
    `${ans.status} ${raw.slice(0, 120)} · held ${JSON.stringify(item?.held_response ?? null)} · attempts ${attempts0}`);
  const early = await send("POST", "/api/individual/scholar/revision/answer", { questionId: qid, sessionId, response: { text: UNMATCHED }, selfGrade: true }, jar);
  const again = await send("POST", "/api/individual/scholar/revision/answer", { questionId: qid, sessionId, response: { text: "a second go" } }, jar);
  ok(`H2 ${label}. before the end it cannot be graded, nor answered again`, early.status === 409 && again.status === 409, `${early.status} ${early.json?.error ?? ""} · ${again.status}`);
  const resumed = await send("GET", `/api/individual/scholar/revision/sessions/${sessionId}`, undefined, jar);
  const page = await get(`/individual/scholar/study/revise?session=${sessionId}`, jar);
  const rAns = (resumed.json?.answered ?? []).find((a: any) => a.questionId === qid);
  ok(`H3 ${label}. it survives leaving and coming back: answered, held, and still revealing nothing`,
    resumed.status === 200 && rAns?.held === true && !rAns.selfGrade && !rAns.feedback && page.status === 200 && !accepted.some((a: string) => page.text.includes(a)),
    `${resumed.status} ${JSON.stringify(rAns ?? null)} · page ${page.status}`);
  const done = await send("PATCH", `/api/individual/scholar/revision/sessions/${sessionId}`, { complete: true }, jar);
  const dAns = (done.json?.answered ?? []).find((a: any) => a.questionId === qid);
  ok(`H4 ${label}. at the end: the student's own answer beside the accepted answers, the explanation and the source, to grade themselves`,
    done.status === 200 && dAns?.selfGrade?.response === UNMATCHED && (dAns.selfGrade.accepted ?? []).length > 0 && !!dAns.selfGrade.rationale && !!dAns.selfGrade.source?.quote && (done.json?.summary?.toGrade ?? 0) >= 1,
    `${done.status} · ${JSON.stringify(dAns?.selfGrade ? { accepted: dAns.selfGrade.accepted.length, rationale: !!dAns.selfGrade.rationale } : dAns ?? null)} · toGrade ${done.json?.summary?.toGrade}`);
  const graded = await send("POST", "/api/individual/scholar/revision/answer", { questionId: qid, sessionId, response: { text: "a different answer" }, selfGrade: true }, jar);
  const att = ((await admin.from("individual_scholar_attempt").select("marking, correct, response").eq("user_id", userId).eq("revision_session_id", sessionId).eq("question_id", qid)).data ?? []) as any[];
  const cleared = ((await admin.from("individual_scholar_revision_session_item").select("held_response").eq("user_id", userId).eq("session_id", sessionId).eq("question_id", qid).maybeSingle()).data as any)?.held_response ?? null;
  ok(`H5 ${label}. graded at the end: the answer the student WROTE is recorded once, as self-graded (not code, not AI), and is held no longer`,
    graded.status === 200 && graded.json?.feedback?.marking === "self_graded" && att.length === 1 && att[0].marking === "self_graded" && att[0].correct === true && att[0].response?.text === UNMATCHED && cleared === null,
    `${graded.status} ${graded.json?.feedback?.marking ?? graded.json?.error ?? ""} · attempts ${att.length} ${JSON.stringify(att[0] ?? null)} · held ${JSON.stringify(cleared)}`);
  const twice = await send("POST", "/api/individual/scholar/revision/answer", { questionId: qid, sessionId, response: { text: UNMATCHED }, selfGrade: false }, jar);
  ok(`H6 ${label}. it cannot be graded twice`, twice.status === 409, `${twice.status}`);
}

/**
 * H8: with NO quota block, only model eligibility (and the short-answer policy) stands between a short answer and the
 * AI. evaluate has no eligible model (D5-v2), so it is never AI-evaluated -- by Sonnet or anything else: the student
 * grades it, and no AI request is made (owner Stage 7 closure, step 2: confirm #99 refuses it). Where no model may
 * write questions either, one short question is SEEDED for this fixture (the columns the store writes, quoting the
 * fixture's own section), so the evaluate path is still exercised.
 */
async function eligibilityCheck(jar: Jar, userId: string, doc: string | null) {
  await admin.from("audit_log").delete().eq("actor_id", userId).eq("entity_type", "harness_revhold_quota");
  let seeded = false;
  const have = ((await admin.from("individual_scholar_question").select("id").eq("user_id", userId).eq("kind", "short").limit(1)).data ?? []) as any[];
  if (!have.length && doc) {
    const chunk = ((await admin.from("individual_scholar_chunk").select("id, material_id, content").eq("user_id", userId).eq("material_id", doc).order("ordinal").limit(1)).data ?? [])[0] as any;
    if (chunk) {
      const quote = String(chunk.content).split(/(?<=\.)\s/)[0].slice(0, 300);
      const ins = await admin.from("individual_scholar_question").insert({
        user_id: userId, material_id: chunk.material_id, chunk_id: chunk.id, kind: "short", stem: "What does this section of your notes say?", options: [], correct_index: null,
        answer: { accepted: [quote] }, difficulty: 2, review_status: "private_formative", rationale: quote, source_quote: quote, model: "harness-seed", provider: "harness", prompt_version: "seed/1",
      });
      seeded = !ins.error;
      if (ins.error) note(`H8 seed refused: ${ins.error.message}`);
    }
  }
  const elig = await startRevision(jar, { mode: "quick", scope: { kind: "documents", materialIds: [doc] }, formats: ["short"], quantity: 1, feedback: "immediate" });
  const eShort = (elig.json?.items ?? []).find((i: any) => i.kind === "short");
  const before = (await admin.from("plat_ai_requests").select("id", { count: "exact" }).eq("actor_id", userId).limit(1)).count ?? 0;
  const eAns = eShort ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: eShort.id, sessionId: elig.json.session?.id, response: { text: UNMATCHED } }, jar) : null;
  const after = (await admin.from("plat_ai_requests").select("id", { count: "exact" }).eq("actor_id", userId).limit(1)).count ?? 0;
  const aiMarked = ((await admin.from("individual_scholar_attempt").select("marking, evaluator_model").eq("user_id", userId).eq("marking", "ai_evaluation")).data ?? []) as any[];
  note(`H8${seeded ? " (seeded question)" : ""}: ${eAns?.json?.needsSelfGrade ? `self-grade (${eAns.json.reason ?? ""})` : JSON.stringify(eAns?.json ?? null).slice(0, 100)} · ai requests ${before}->${after} · ai-marked attempts ${aiMarked.map(x => x.evaluator_model).join(",") || "none"}`);
  if (!eShort) pend("H8", `no short-answer question to answer (${elig.status} ${elig.json?.error ?? ""})`);
  else ok("H8. with no quota block, an unmarkable short answer is never AI-evaluated by an ineligible model: the student grades it, and no AI request is made",
    eAns?.status === 200 && eAns.json?.needsSelfGrade === true && after === before && aiMarked.length === 0,
    `${eAns?.status} · ai ${before}->${after} · ai-marked ${aiMarked.length}`);
}

async function main() {
  console.log(`SCHOLAR REVISION HOLD-TO-END -- target ${ref}, server ${BASE}\n`);
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  if (!live) { console.log(`  PEND  no dev server at ${BASE}. Nothing created.`); return; }
  const m425 = !(await admin.from("individual_scholar_revision_session_item").select("held_response").limit(0)).error;
  note(`425 here: ${m425}`);
  if (!m425) { pend("H1-H7", "425 must be applied on this environment"); return; }

  await cleanup();
  const mk = async (email: string) => { const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true }); if (error) throw error; return data.user.id as string; };
  const grantor = await mk(FIX.grantor), a = await mk(FIX.a);
  await mk(FIX.b);
  const now = new Date().toISOString();
  const req = validateGrant({ targetUserId: a, experiences: ["scholar"], adultConfirmed: true });
  if (isGrantRefusal(req)) throw new Error(req.message);
  const g = await grantIndividualAccess(admin, req, grantor); if (!g.ok) throw new Error(g.message);
  await admin.from("individual_membership").update({ onboarded_at: now, primary_experience: "scholar",
    foundation_terms_version: LEGAL.h.terms, foundation_privacy_version: LEGAL.h.privacy, foundation_accepted_at: now }).eq("user_id", a);
  await admin.from("individual_entitlement").update({ terms_version: LEGAL.s.terms, privacy_version: LEGAL.s.privacy, terms_accepted_at: now }).eq("user_id", a);
  const policy = await loadIndividualPolicy(admin);
  const sa = await signIn(FIX.a);
  ok("0. the fixture student signs in", sa.status === 200, `${sa.status}`);
  const consent = await send("POST", "/api/individual/scholar/consent", { grant: true }, sa.jar);
  if (consent.status !== 200) { pend("H1-H7", `AI consent could not be given here (${consent.status} ${consent.json?.error ?? ""})`); return; }
  if (!policy.scholarRevisionFormats.includes("short")) { pend("H1-H7", "short answers are not an offered revision format here"); return; }
  const doc = await upload(sa.jar, DOCX_MIME, await tinyDocx(OXYGEN), "Oxygen therapy notes.docx");
  if (doc) await analyseAll(sa.jar, doc);

  // Short-answer questions, written once (real AI), then reused by both sessions.
  const mock = await startRevision(sa.jar, { mode: "mock", scope: { kind: "documents", materialIds: [doc] }, formats: ["short"], quantity: 2 });
  const mockShort = (mock.json?.items ?? []).find((i: any) => i.kind === "short");
  note(`mock: ${mock.status} ${mock.json?.error ?? ""} · items ${(mock.json?.items ?? []).map((i: any) => i.kind).join(",")} · generated ${mock.json?.generated}`);
  if (!mockShort) {
    pend("H1-H7", `no short-answer question could be written from these notes in this run (${mock.json?.error ?? mock.status})`);
    await eligibilityCheck(sa.jar, a, doc);
    return;
  }
  // AI evaluation would judge the answer (a marking, not a self-grade): the Individual quota is used up for THIS fixture
  // only, so the unmarkable answer takes the self-grade path, as it does whenever AI evaluation is not available.
  await admin.from("audit_log").insert(Array.from({ length: 200 }, () => ({ actor_id: a, actor_name: "harness", action: "ai_assistant_query", entity_type: "harness_revhold_quota", new_value: { synthetic: true } })));
  await heldPath("Mock", sa.jar, a, mock.json.session.id, mockShort.id);

  const end = await startRevision(sa.jar, { mode: "quick", scope: { kind: "documents", materialIds: [doc] }, formats: ["short"], quantity: 2, feedback: "end" });
  const endShort = (end.json?.items ?? []).find((i: any) => i.kind === "short" && i.id !== mockShort.id) ?? (end.json?.items ?? []).find((i: any) => i.kind === "short");
  if (!end.json?.session?.id || !endShort) pend("H end", `no end-of-session short answer session (${end.status} ${end.json?.error ?? ""})`);
  else await heldPath("end of session", sa.jar, a, end.json.session.id, endShort.id);

  // ── H7: immediate feedback is unchanged -- the accepted answer and the self-grade at once ──
  const imm = await startRevision(sa.jar, { mode: "quick", scope: { kind: "documents", materialIds: [doc] }, formats: ["short"], quantity: 1, feedback: "immediate" });
  const immShort = (imm.json?.items ?? []).find((i: any) => i.kind === "short");
  const immAns = immShort ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: immShort.id, sessionId: imm.json.session?.id, response: { text: UNMATCHED } }, sa.jar) : null;
  ok("H7. immediate feedback is unchanged: the accepted answers and the self-grade come at once", immAns?.json?.needsSelfGrade === true && (immAns.json.accepted ?? []).length > 0,
    `${imm.status} · ${immAns?.status} ${immAns?.json?.needsSelfGrade ? "self-grade now" : JSON.stringify(immAns?.json ?? null).slice(0, 80)}`);
  await admin.from("audit_log").delete().eq("actor_id", a).eq("entity_type", "harness_revhold_quota");

  await eligibilityCheck(sa.jar, a, doc);

  // ── E: erase-all removes the held answers with their sessions ──
  const erase = await send("POST", "/api/individual/scholar/erase", { confirm: "ERASE" }, sa.jar);
  const left = (await admin.from("individual_scholar_revision_session_item").select("session_id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0;
  ok("E. erase-all leaves no session item, held or not", erase.status === 200 && left === 0, `${erase.status} · items ${left}`);
}

main()
  .catch(e => { fails.push(`crashed: ${e?.message ?? e}`); console.log(`  FAIL  crashed: ${e?.stack ?? e}`); })
  .finally(async () => {
    await cleanup().catch(() => {});
    const left = await Promise.all(Object.values(FIX).map(findUser));
    ok("Z1. fixture identities and their files are gone", left.every(x => !x));
    console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
    process.exit(fails.length ? 1 : 0);
  });
