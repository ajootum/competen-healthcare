/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR EVALUATION-01 (Stage 6) -- the owner's first acceptance journey, ONE focused run over HTTP on the
 * respiratory materials (owner GO 2026-10-25, section 14, steps 1 to 15):
 *
 *   1   the student learns (Teach Me and a check), revises and reasons in a clinical case
 *   2   Scholar retrieves the existing evidence          3   continuous evaluation interprets it (no AI, no exam)
 *   4   the student asks for a Respiratory Assessment    5   coverage, knowledge, retention and reasoning kept apart
 *   6   a fresh knowledge check                          7   deterministic questions marked without AI
 *   8   free text by an eligible AI model, else held     9   evidence confidence and limitations displayed
 *   10  CFCA learning outcomes where available           11  recommendations to Teach Me, Revision, Clinical Reasoning
 *   12  history preserved (a later one follows; the earlier is unchanged and cannot be rewritten)
 *   13  existing evaluations available without AI        14  no competency catalogue
 *   15  never verified clinical competence               I   private      E   erase-all
 *
 * Real AI where the journey writes (questions, a case, Teach Me). Metering as configured (OFF on staging): step 13
 * uses the Individual quota, synthetic rows for THIS fixture only. Needs 426 (PEND without). Reads shared
 * configuration and never writes it. Fixtures: harness-eval01-*, deleted at the start and the end.
 *
 * ⚠ STAGING ONLY: npx tsx scripts/privileged-harnesses.ts --staging --only scholar-evaluation01
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { BUCKET, DOCX_MIME, PPTX_MIME, TEXT_MIME, uploadRules } from "../src/lib/individual/scholar/config";
import { loadJoinOptions } from "../src/lib/individual/scholar/context";
import { tinyDocx, tinyPptx } from "../src/lib/individual/scholar/test-documents";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-evaluation01-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const note = (s: string) => console.log(`        ${s}`);

const FIX = { grantor: "harness-eval01-grantor@competen.test", a: "harness-eval01-a@competen.test", b: "harness-eval01-b@competen.test" };
const PW = `eval01-${Math.random().toString(36).slice(2)}-Aa1!`;
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};

// The Stage 2 respiratory materials (as scholar-learn01-harness uses them).
const PNEUMONIA = [
  { text: ["Community-acquired pneumonia", "Pneumonia is an infection of the lung tissue that fills the alveoli with fluid, which reduces gas exchange."], notes: ["Ask about cough, fever and breathlessness."] },
  { text: ["Assessment", "Measure the respiratory rate and the oxygen saturation.", "A low oxygen saturation shows hypoxaemia."], notes: ["Count the respiratory rate for a full minute."] },
  { text: ["Management", "Give oxygen to reach the target saturation range.", "Antibiotics are prescribed according to local guidance."] },
];
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
/** Start a case from notes. A withheld draft (422: the checks refused it) is the checks working; the student may ask again (once). A 502 is retried once and reported. */
async function makeCase(jar: Jar, body: Record<string, unknown>) {
  let r = await send("POST", "/api/individual/scholar/clinical/cases", body, jar, { "x-request-id": `eval01-${Math.random().toString(36).slice(2, 12)}` });
  for (let tries = 1; tries < 3 && (r.status === 422 || r.status === 502); tries++) {
    note(`case: ${r.status} (${r.json?.error ?? ""}) -- asking again`);
    r = await send("POST", "/api/individual/scholar/clinical/cases", body, jar, { "x-request-id": `eval01-${Math.random().toString(36).slice(2, 12)}` });
  }
  return r;
}
/** The right answer for a stored question, read from the database the way only the server can -- to answer it. */
async function rightResponse(userId: string, qid: string): Promise<any> {
  const q = ((await admin.from("individual_scholar_question").select("kind, options, correct_index, answer").eq("user_id", userId).eq("id", qid).maybeSingle()).data) as any;
  if (!q) return null;
  switch (q.kind) {
    case "mcq": case "case": return { index: q.correct_index };
    case "mrq": return { indexes: q.answer.correct };
    case "short": return { text: q.answer.accepted[0] };
    case "flashcard": return { quality: 4 };
    case "match": return { matches: q.answer.matches };
    case "sequence": return { order: q.answer.order };
  }
  return null;
}
async function wrongResponse(userId: string, qid: string): Promise<any> {
  const q = ((await admin.from("individual_scholar_question").select("kind, options, correct_index, answer").eq("user_id", userId).eq("id", qid).maybeSingle()).data) as any;
  if (!q) return null;
  switch (q.kind) {
    case "mcq": case "case": return { index: (q.correct_index + 1) % q.options.length };
    case "mrq": return { indexes: q.options.map((_: string, i: number) => i).filter((i: number) => !q.answer.correct.includes(i)).slice(0, 1) };
    case "short": return null; // a wrong short answer needs judgement, exercised in S
    case "flashcard": return { quality: 1 };
    case "match": return { matches: [...q.answer.matches].reverse() };
    case "sequence": return { order: [...q.answer.order].reverse() };
  }
  return null;
}


async function act(jar: Jar, body: Record<string, unknown>) {
  let r = await send("POST", "/api/individual/scholar/learn/act", body, jar);
  if (r.status === 502) { note(`${String(body.action)}: provider failure 502 -- retrying once`); r = await send("POST", "/api/individual/scholar/learn/act", body, jar); }
  const shown = (x: any) => !!(x.json?.answer || x.json?.checkQuestion || x.json?.continuity);
  for (let tries = 1; tries < 3 && r.status === 200 && !shown(r) && !r.json?.notInNotes; tries++) {
    note(`${String(body.action)}: withheld (${r.json?.message ?? ""}) -- asking again`);
    r = await send("POST", "/api/individual/scholar/learn/act", body, jar);
  }
  return r;
}
async function startRevision(jar: Jar, body: Record<string, unknown>) {
  let r = await send("POST", "/api/individual/scholar/revision/sessions", body, jar, { "x-request-id": `eval01-${Math.random().toString(36).slice(2, 12)}` });
  if (r.status === 502) { note(`revision ${String(body.mode)}: provider failure 502 -- retrying once`); r = await send("POST", "/api/individual/scholar/revision/sessions", body, jar); }
  return r;
}
const EVALUATE = "/individual/scholar/study/evaluate";
const aiRows = async (u: string) => (await admin.from("plat_ai_requests").select("id", { count: "exact" }).eq("actor_id", u).limit(1)).count ?? 0;

async function main() {
  console.log(`SCHOLAR EVALUATION-01 ACCEPTANCE -- target ${ref}, server ${BASE}\n`);
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  if (!live) { console.log(`  PEND  no dev server at ${BASE}. Nothing created.`); return; }
  const m426 = !(await admin.from("individual_scholar_evaluation").select("id").limit(0)).error;
  const metered = ((await admin.from("practice_platform_flags").select("enabled").eq("flag", "ai_fair_use").maybeSingle()).data as any)?.enabled === true;
  note(`426 here: ${m426} · ai_fair_use ${metered ? "ON" : "OFF"}`);
  if (!m426) { pend("1-15", "426 must be applied on this environment"); return; }

  await cleanup();
  const mk = async (email: string) => { const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true }); if (error) throw error; return data.user.id as string; };
  const grantor = await mk(FIX.grantor), a = await mk(FIX.a), b = await mk(FIX.b);
  const now = new Date().toISOString();
  for (const u of [a, b]) {
    const req = validateGrant({ targetUserId: u, experiences: ["scholar"], adultConfirmed: true });
    if (isGrantRefusal(req)) throw new Error(req.message);
    const g = await grantIndividualAccess(admin, req, grantor); if (!g.ok) throw new Error(g.message);
    await admin.from("individual_membership").update({ onboarded_at: now, primary_experience: "scholar",
      foundation_terms_version: LEGAL.h.terms, foundation_privacy_version: LEGAL.h.privacy, foundation_accepted_at: now }).eq("user_id", u);
    await admin.from("individual_entitlement").update({ terms_version: LEGAL.s.terms, privacy_version: LEGAL.s.privacy, terms_accepted_at: now }).eq("user_id", u);
  }
  const policy = await loadIndividualPolicy(admin);
  const rules = uploadRules(policy);
  const sa = await signIn(FIX.a), sb = await signIn(FIX.b);
  ok("0. two fixture students sign in", sa.status === 200 && sb.status === 200, `${sa.status}/${sb.status}`);
  const opts = await loadJoinOptions(admin, policy);
  const programme = opts.ok ? opts.options.programmes.find(p => p.code === "nursing-ug-diploma") ?? null : null;
  if (programme) await send("PUT", "/api/individual/scholar/programme", { code: programme.code, level: programme.levels[0]?.code ?? null }, sa.jar);
  const ca = await send("POST", "/api/individual/scholar/consent", { grant: true }, sa.jar), cb = await send("POST", "/api/individual/scholar/consent", { grant: true }, sb.jar);
  if (ca.status !== 200 || cb.status !== 200) { pend("1-15", `AI consent could not be given here (${ca.status}/${cb.status})`); return; }

  // ── 1: the student learns, revises and reasons on the respiratory materials ──
  const pptxOn = rules.mimes.includes(PPTX_MIME as any);
  const oxygen = await upload(sa.jar, DOCX_MIME, await tinyDocx(OXYGEN), "Oxygen therapy notes.docx");
  const pneumonia = pptxOn ? await upload(sa.jar, PPTX_MIME, await tinyPptx(PNEUMONIA), "Pneumonia lecture.pptx")
    : await upload(sa.jar, TEXT_MIME, new TextEncoder().encode(PNEUMONIA.flatMap(s => s.text).join("\n")), "Pneumonia lecture.txt");
  const docs = [oxygen, pneumonia].filter((x): x is string => !!x);
  for (const id of docs) await analyseAll(sa.jar, id);
  const ls = await send("POST", "/api/individual/scholar/learn/sessions", { scope: { kind: "document", materialId: oxygen } }, sa.jar);
  const where = { sessionId: ls.json?.session?.id, step: 0 };
  const teach = await act(sa.jar, { action: "teach", ...where });
  const check = await act(sa.jar, { action: "check", ...where });
  const clar = check.json?.checkQuestion ? await act(sa.jar, { action: "clarify", checkQuestion: check.json.checkQuestion, answer: "Oxygen is a medicine given to a target saturation range.", ...where }) : null;
  const rv = await startRevision(sa.jar, { mode: "quick", scope: { kind: "documents", materialIds: docs }, quantity: 8, feedback: "immediate" });
  const items = (rv.json?.items ?? []) as any[];
  const marked = items.filter(i => ["mcq", "mrq", "match", "sequence"].includes(i.kind));
  // Two wrong in one section, the rest right: a learning gap the evaluation should find.
  const bySection = new Map<string, any[]>(); for (const i of marked) bySection.set(i.chunkId, [...(bySection.get(i.chunkId) ?? []), i]);
  const gapSection = [...bySection.entries()].sort((x, y) => y[1].length - x[1].length)[0]?.[0] ?? null;
  let answered = 0;
  for (const i of marked) {
    const wrong = i.chunkId === gapSection;
    const r = await send("POST", "/api/individual/scholar/revision/answer", { questionId: i.id, sessionId: rv.json.session?.id, response: wrong ? await wrongResponse(a, i.id) : await rightResponse(a, i.id) }, sa.jar);
    if (r.status === 200) answered++;
  }
  const made = await makeCase(sa.jar, { entry: "notes", scope: { kind: "document", materialId: oxygen }, context: "medical", mode: "independent", generateAnyway: true });
  let decided = 0;
  if (made.json?.play) {
    const bp = ((await admin.from("individual_scholar_case").select("blueprint").eq("user_id", a).eq("id", made.json.caseId).maybeSingle()).data as any)?.blueprint;
    let cur = made.json.play;
    for (let step = 0; step < 12 && cur.status === "active"; step++) {
      const dp = cur.view.stages[cur.view.stages.length - 1].decisionPoints.find((d: any) => !cur.answered.includes(d.token));
      const d = dp ? bp.decisionPoints.find((x: any) => x.prompt === dp.prompt) : null;
      if (!dp || !d) break;
      // Wrong choices on purpose: a reasoning weakness the evaluation should find.
      const body = d.kind === "free_text" ? { decisionToken: dp.token, text: "I am not sure." }
        : { decisionToken: dp.token, optionTokens: d.options.map((o: any, k: number) => (!o.correct ? dp.options[k].token : null)).filter(Boolean).slice(0, 1) };
      const r = await send("POST", `/api/individual/scholar/clinical/sessions/private/${cur.sessionId}/answer`, body, sa.jar);
      if (r.status !== 200) break;
      decided++; cur = r.json.play;
    }
  }
  ok("1. the student learns (Teach Me and a check), revises and reasons in a clinical case on the respiratory materials",
    docs.length === 2 && teach.status === 200 && !!clar?.json?.verdict && answered >= 3 && decided >= 2,
    `docs ${docs.length} · teach ${teach.status} · check ${clar?.json?.verdict?.value ?? check.json?.message ?? "none"} · revision answers ${answered}/${marked.length} · case ${made.status} decisions ${decided}`);

  // ── 2-3: the existing evidence, retrieved and interpreted continuously ──
  const ai0 = await aiRows(a);
  const page = await get(EVALUATE, sa.jar);
  const ai1 = await aiRows(a);
  ok("2. Scholar retrieves the existing evidence: questions, case decisions and Teach Me checks are counted on Evaluate",
    page.status === 200 && page.text.includes("Review existing evidence") && /questions answered/.test(page.text) && /clinical case decisions/.test(page.text) && /Teach Me checks/.test(page.text), `${page.status}`);
  ok("3. continuous evaluation interprets it with no examination and no AI call: the six dimensions, each on its own",
    ["Knowledge", "Retention", "Application", "Clinical reasoning", "Coverage", "Evidence confidence"].every(t => page.text.includes(t)) && ai1 === ai0, `ai ${ai0}->${ai1}`);

  // ── 4-5: a Respiratory Assessment evaluation, distinguishing the dimensions ──
  const resp = await send("POST", "/api/individual/scholar/evaluations", { scope: { kind: "documents", materialIds: docs }, method: "existing" }, sa.jar);
  const rec = resp.json?.id ? await send("GET", `/api/individual/scholar/evaluations/${resp.json.id}`, undefined, sa.jar) : null;
  const res = rec?.json?.evaluation?.results;
  ok("4. the student asks for a Respiratory Assessment evaluation over their respiratory materials: kept as a record",
    resp.status === 200 && rec?.status === 200 && rec.json.evaluation.method === "existing" && rec.json.evaluation.kind === "student", `${resp.status} ${resp.json?.error ?? ""}`);
  ok("5. it distinguishes coverage, knowledge, retention and reasoning: each its own measure state, coverage never counted as knowledge",
    !!res && ["knowledge", "retention", "reasoning", "coverage", "application"].every(k => ["measured", "insufficient", "not_measured"].includes(res[k]?.state)) && res.coverage.state === "measured"
      && (res.knowledge.state !== "measured" || res.knowledge.independent <= answered),
    res ? `knowledge ${res.knowledge.state} · retention ${res.retention.state} · reasoning ${res.reasoning.state} · coverage ${res.coverage.sections?.worked}/${res.coverage.sections?.total}` : "");

  // ── 6-8: a fresh knowledge check, deterministic marking without AI, free text by an eligible model or held ──
  const fresh = await startRevision(sa.jar, { mode: "mock", scope: { kind: "documents", materialIds: docs }, quantity: policy.scholarEvaluationFreshQuantity });
  const fItems = (fresh.json?.items ?? []) as any[];
  const fs = fresh.json?.session?.id as string | undefined;
  const fAi0 = await aiRows(a);
  let detOk = 0;
  for (const i of fItems.filter(x => ["mcq", "mrq", "match", "sequence"].includes(x.kind))) {
    const r = await send("POST", "/api/individual/scholar/revision/answer", { questionId: i.id, sessionId: fs, response: await rightResponse(a, i.id) }, sa.jar);
    if (r.status === 200 && r.json?.held === true) detOk++;
  }
  const fAi1 = await aiRows(a);
  const short = fItems.find(x => x.kind === "short");
  const sAns = short ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: short.id, sessionId: fs, response: { text: "something the notes put another way" } }, sa.jar) : null;
  const done = fs ? await send("PATCH", `/api/individual/scholar/revision/sessions/${fs}`, { complete: true }, sa.jar) : null;
  const fAttempts = fs ? ((await admin.from("individual_scholar_attempt").select("question_id, marking, evaluator_model").eq("user_id", a).eq("revision_session_id", fs)).data ?? []) as any[] : [];
  const shortMark = short ? fAttempts.find(x => x.question_id === short.id) : null;
  const heldShort = short ? (done?.json?.answered ?? []).find((x: any) => x.questionId === short.id && x.selfGrade) : null;
  ok("6. the student completes a fresh knowledge check over the same scope (Mock, feedback held to the end)", fresh.status === 200 && !!fs && fItems.length > 0 && done?.status === 200,
    `${fresh.status} ${fresh.json?.error ?? ""} · items ${fItems.map(x => x.kind).join(",")}`);
  ok("7. deterministic questions are marked without AI: every structured answer recorded and marked by its key, no AI call",
    detOk > 0 && fAi1 === fAi0 && fAttempts.filter(x => x.question_id !== short?.id).every(x => x.marking === "deterministic"), `${detOk} marked · ai ${fAi0}->${fAi1}`);
  note(`step 8 path: ${!short ? "no short answer" : shortMark ? `${shortMark.marking} ${shortMark.evaluator_model ?? ""}` : heldShort ? "held for self-grading (no eligible evaluate model)" : "neither"}`);
  if (!short) pend("8", "no short-answer question in this knowledge check");
  else ok("8. free text uses an eligible AI model where available -- else it is held, unmarked, for the student's own grading at the end, never marked wrong by code",
    sAns?.status === 200 && ((shortMark?.marking === "ai_evaluation" && !!shortMark.evaluator_model) || (!shortMark && !!heldShort)),
    `${sAns?.status} · ${shortMark ? `${shortMark.marking} ${shortMark.evaluator_model ?? ""}` : heldShort ? "held for self-grading (no eligible model)" : "neither"}`);
  const comb = fs ? await send("POST", "/api/individual/scholar/evaluations", { scope: { kind: "documents", materialIds: docs }, method: "combined", freshSessionId: fs }, sa.jar) : null;
  const combRec = comb?.json?.id ? await send("GET", `/api/individual/scholar/evaluations/${comb.json.id}`, undefined, sa.jar) : null;
  const cr = combRec?.json?.evaluation;
  const recPage = comb?.json?.id ? await get(`${EVALUATE}/${comb.json.id}`, sa.jar) : { status: 0, text: "" };

  // ── 9-11: confidence and limitations, CFCA, recommendations ──
  ok("9. evidence confidence and limitations are displayed: a confidence class with its reasons, and what the evaluation cannot say",
    !!cr && ["strong", "moderate", "limited", "insufficient"].includes(cr.confidence) && (cr.results.confidenceDetail?.reasons ?? []).length > 0 && cr.limitations.length > 1
      && recPage.text.includes("Evidence confidence") && recPage.text.includes("What this evaluation cannot say") && (cr.evidenceRefs?.counts?.fresh ?? 0) > 0,
    cr ? `${cr.confidence} · reasons ${(cr.results.confidenceDetail?.reasons ?? []).length} · limitations ${cr.limitations.length} · fresh answers ${cr.evidenceRefs?.counts?.fresh}` : `${comb?.status} ${comb?.json?.error ?? ""}`);
  const linked = (await admin.from("individual_scholar_competency_map").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0;
  if (!programme || !linked) pend("10", `no CFCA links here (programme ${programme?.code ?? "none"}, links ${linked})`);
  else ok("10. results connect to CFCA learning outcomes where available: outcomes covered, and the domain › practice unit › competency › outcome view",
    !!cr && (cr.results.coverage.outcomes !== null || !!cr.cfca) && [...cr.results.strengths, ...cr.results.gaps, ...cr.results.insufficientAreas].some((x: any) => x.kind === "outcome" || x.kind === "competency"),
    cr ? `outcomes ${JSON.stringify(cr.results.coverage.outcomes)} · cfca ${cr.cfca ? "yes" : "no"}` : "");
  note(`step 10: programme ${programme?.code ?? "none"} · links ${linked} · outcomes ${JSON.stringify(cr?.results?.coverage?.outcomes ?? null)} · cfca ${cr?.cfca ? "tree" : "none"} · confidence ${cr?.confidence}`);
  const hrefs = ["study/learn?section=", "study/revise", "study/apply"];
  ok("11. recommendations link to Teach Me, Revision and Clinical Reasoning, each from a finding",
    !!cr && (cr.results.recommendations ?? []).length > 0 && hrefs.every(h => recPage.text.includes(h)),
    cr ? `${(cr.results.recommendations ?? []).map((x: any) => x.kind).join(",")} · links ${hrefs.map(h => recPage.text.includes(h) ? "y" : "n").join("")}` : "");

  // ── 12-13: history preserved; available without AI ──
  const again = resp.json?.id ? await send("POST", "/api/individual/scholar/evaluations", { scope: { kind: "documents", materialIds: docs }, method: "existing", supersedesId: resp.json.id }, sa.jar) : null;
  const orig2 = resp.json?.id ? await send("GET", `/api/individual/scholar/evaluations/${resp.json.id}`, undefined, sa.jar) : null;
  const rewrite = resp.json?.id ? await admin.from("individual_scholar_evaluation").update({ confidence: "strong" }).eq("id", resp.json.id) : { error: null };
  const list = await send("GET", "/api/individual/scholar/evaluations", undefined, sa.jar);
  ok("12. evaluation history is preserved: a later evaluation follows the earlier one, which is unchanged and cannot be rewritten",
    again?.status === 200 && orig2?.status === 200 && JSON.stringify(orig2.json.evaluation.results) === JSON.stringify(rec?.json?.evaluation?.results) && !!rewrite.error
      && (list.json?.evaluations ?? []).length >= 3 && (list.json.evaluations as any[]).some(x => x.id === again.json.id && x.supersedesId === resp.json.id),
    `again ${again?.status} · unchanged ${JSON.stringify(orig2?.json?.evaluation?.results) === JSON.stringify(rec?.json?.evaluation?.results)} · rewrite refused ${!!rewrite.error} · listed ${(list.json?.evaluations ?? []).length}`);
  await admin.from("audit_log").insert(Array.from({ length: 200 }, () => ({ actor_id: a, actor_name: "harness", action: "ai_assistant_query", entity_type: "harness_eval01_quota", new_value: { synthetic: true } })));
  const q0 = await aiRows(a);
  const offline = await Promise.all([get(EVALUATE, sa.jar), get(`${EVALUATE}/${resp.json?.id}`, sa.jar)]);
  const offlineNew = await send("POST", "/api/individual/scholar/evaluations", { scope: { kind: "all" }, method: "existing", continuous: true }, sa.jar);
  const q1 = await aiRows(a);
  ok("13. with the AI allowance used up, existing evaluations stay available and a new one from existing evidence is still made: no AI is involved",
    offline.every(p => p.status === 200) && offline[1].text.includes("Evidence confidence") && offlineNew.status === 200 && q1 === q0, `${offline.map(p => p.status)} · new ${offlineNew.status} · ai ${q0}->${q1}`);
  await admin.from("audit_log").delete().eq("actor_id", a).eq("entity_type", "harness_eval01_quota");

  // ── 14: no catalogue ──
  const bDoc = await upload(sb.jar, DOCX_MIME, await tinyDocx(OXYGEN), "Oxygen therapy notes.docx");
  if (bDoc) await analyseAll(sb.jar, bDoc);
  const bRv = bDoc ? await startRevision(sb.jar, { mode: "quick", scope: { kind: "document", materialId: bDoc }, quantity: 4, feedback: "immediate" }) : null;
  for (const i of ((bRv?.json?.items ?? []) as any[]).filter(x => ["mcq", "mrq", "match", "sequence"].includes(x.kind)))
    await send("POST", "/api/individual/scholar/revision/answer", { questionId: i.id, sessionId: bRv!.json.session?.id, response: await rightResponse(b, i.id) }, sb.jar);
  const bEv = await send("POST", "/api/individual/scholar/evaluations", { scope: { kind: "all" }, method: "existing" }, sb.jar);
  const bRec = bEv.json?.id ? (await send("GET", `/api/individual/scholar/evaluations/${bEv.json.id}`, undefined, sb.jar)).json?.evaluation : null;
  const bPage = await get(EVALUATE, sb.jar);
  ok("14. it works without an assigned competency catalogue: by section of the student's notes, saying so",
    bEv.status === 200 && !!bRec && bRec.cfca === null && bRec.limitations.some((l: string) => /No competency catalogue/.test(l)) && bPage.status === 200
      && [...bRec.results.strengths, ...bRec.results.gaps, ...bRec.results.insufficientAreas].every((x: any) => x.kind === "section"),
    `${bEv.status} ${bEv.json?.error ?? ""} · page ${bPage.status}`);

  // ── 15: never verified competence; private ──
  const all = [rec?.json?.evaluation, cr, bRec].filter(Boolean);
  // What the evaluation itself asserts: its results with the catalogue's own words (area labels, contexts, expected
  // levels -- a learning outcome may say "competent") taken out. A claim would be in what is left.
  const asserted = (x: any) => JSON.stringify(x.results, (k, v) => (["label", "context", "expected"].includes(k) ? undefined : v));
  const claim = all.map(asserted).find(s => /\b(competent|certified|passed|verified competence)\b/i.test(s.replace(/not assessed/gi, "")));
  ok("15. no result is represented as verified clinical competence: every record says not assessed, and the pages say so",
    all.length === 3 && all.every((x: any) => x.results.verified?.state === "not_assessed") && recPage.text.includes("Verified clinical competence") && recPage.text.includes("Not assessed here") && !claim,
    `records ${all.length} · verified ${all.map((x: any) => x.results.verified?.state).join(",")} · page ${recPage.text.includes("Not assessed here")} · claim ${claim ? claim.match(/.{0,60}\b(competent|certified|passed|verified competence)\b.{0,30}/i)?.[0] : "none"}`);
  const iGet = resp.json?.id ? await send("GET", `/api/individual/scholar/evaluations/${resp.json.id}`, undefined, sb.jar) : { status: 404 };
  const iDel = resp.json?.id ? await send("DELETE", `/api/individual/scholar/evaluations/${resp.json.id}`, undefined, sb.jar) : { status: 404 };
  const iPage = resp.json?.id ? await get(`${EVALUATE}/${resp.json.id}`, sb.jar) : { status: 200, text: "could not be found" };
  ok("I. ⚠ private: another student can neither read, remove nor open the first student's evaluation", iGet.status === 404 && iDel.status === 404 && iPage.text.includes("could not be found"), `${iGet.status}/${iDel.status}`);

  // ── E: erase-all ──
  const erase = await send("POST", "/api/individual/scholar/erase", { confirm: "ERASE" }, sa.jar);
  const left = (await admin.from("individual_scholar_evaluation").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0;
  ok("E. erase-all removes the student's evaluations", erase.status === 200 && left === 0, `${erase.status} · left ${left}`);
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
