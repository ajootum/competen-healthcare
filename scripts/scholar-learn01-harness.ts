/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR LEARN-01 HARNESS -- COMPETEN-SCHOLAR-LEARN-01 (owner GO 2026-10-24), over HTTP, STAGING ONLY.
 *
 * The owner's first acceptance journey, on the Stage 2 respiratory materials (an anatomy PDF, a pneumonia
 * PowerPoint, oxygen therapy notes), with REAL capabilities -- no mocked answer anywhere:
 *   J1  select several documents and start a session (suggested steps across them)
 *   J2  Teach Me                       J3  a coherent, source-grounded explanation (cited, labelled)
 *   J4  Simplify (same step, context kept)                J5  a contextual follow-up (Ask Scholar)
 *   J6  explore a related concept (a topic across the library)
 *   J7  an informal understanding check                   J8  a clarification with a verdict
 *   J9  continue to the next step                          J10 leave and resume the session
 *   J11 review the source references (each resolves to the student's own section)
 *   J12 the learning activity shown against the applicable CFCA competency, labelled not competence
 *   NC  the same journey works for a student with NO competency catalogue
 *   S   Start learning (Stage 2's ready page) opens Teach Me
 *   H   history is structure only, and a deleted material takes its steps with it
 *   I   isolation: another student reaches none of it        E  erase-all leaves nothing
 *   A   AI-FAIR-USE-01 s8: a reusable answer is saved (private formative, with its sources) and the same request
 *       returns it with no new AI; "a new way" replaces it; Saved learning lists it; it goes with its material
 *   C   s7 continuity: with the student's allowance used up (synthetic usage rows for THIS fixture only, never shared
 *       configuration), Learn says so plainly and returns what is saved; a stored question is still marked by its
 *       answer key; the saved page and progress still open
 *
 * ⚠ NEEDS a dev server pointed at STAGING (BASE_URL) with individual_app ON, the staging-test legal versions AND
 * URLs (AI consent), an AI provider, migrations 406-409 and 414, the viewing programme with its catalogues, and pptx
 * in scholar_upload_formats (else the pneumonia lecture is uploaded as text and that is said). It READS shared
 * configuration and never writes it. Fixtures: harness-learn01-* identities, deleted at the start and the end.
 *
 * ⚠ STAGING ONLY: npx tsx scripts/privileged-harnesses.ts --staging --only scholar-learn01
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { BUCKET, DOCX_MIME, PDF_MIME, PPTX_MIME, TEXT_MIME, uploadRules } from "../src/lib/individual/scholar/config";
import { loadJoinOptions } from "../src/lib/individual/scholar/context";
import { tinyDocx, tinyPdf, tinyPptx } from "../src/lib/individual/scholar/test-documents";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-learn01-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const note = (s: string) => console.log(`        ${s}`);

const FIX = { grantor: "harness-learn01-grantor@competen.test", a: "harness-learn01-a@competen.test", b: "harness-learn01-b@competen.test" };
const PW = `learn01-${Math.random().toString(36).slice(2)}-Aa1!`;
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};

// The Stage 2 respiratory materials.
const ANATOMY = [
  ["Respiratory anatomy.", "The upper airway includes the nose, the pharynx and the larynx.", "The trachea divides into the right and left main bronchi, which branch into bronchioles."],
  ["Gas exchange happens in the alveoli.", "Oxygen diffuses from the alveoli into the pulmonary capillaries.", "Hypoxaemia means a low level of oxygen in the blood."],
];
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
    for (const t of ["individual_scholar_learning_session", "individual_scholar_learning_preference", "individual_scholar_material", "individual_scholar_collection", "individual_scholar_consent", "individual_scholar_learner", "individual_scholar_learner_context", "individual_entitlement", "individual_membership", "plat_ai_requests", "audit_log"])
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
async function send(method: string, path: string, body: unknown, jar?: Jar) {
  const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(jar ? { Cookie: cookieHeader(jar) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
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
/** A learning action. A withheld answer is the grounding check doing its job; the student may ask again (once). */
async function act(jar: Jar, body: Record<string, unknown>) {
  // A student may ask again more than once; every try is checked, and the harness reports how many it took.
  let r = await send("POST", "/api/individual/scholar/learn/act", body, jar);
  // A provider failure (502) is retried ONCE and reported with its detail -- never counted as a pass.
  if (r.status === 502) {
    note(`${String(body.action)}: provider failure 502 (${r.json?.error ?? ""}) -- retrying once`);
    r = await send("POST", "/api/individual/scholar/learn/act", body, jar);
    if (r.status === 502) note(`${String(body.action)}: provider failure persisted: 502 ${JSON.stringify(r.json)}`);
  }
  const shown = (x: any) => !!(x.json?.answer || x.json?.checkQuestion || x.json?.continuity);
  for (let tries = 1; tries < 3 && r.status === 200 && !shown(r) && !r.json?.notInNotes; tries++) {
    note(`${String(body.action)}: withheld (${r.json?.message ?? ""}) -- asking again`);
    r = await send("POST", "/api/individual/scholar/learn/act", body, jar);
  }
  return r;
}
const cites = (s: string) => /\[S\d+\]/.test(s ?? "");

async function main() {
  console.log(`SCHOLAR LEARN-01 HARNESS -- target ${ref}, server ${BASE}\n`);
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  if (!live) { console.log(`  PEND  no dev server at ${BASE}. Nothing created.`); return; }
  const m414 = !(await admin.from("individual_scholar_learning_session").select("id").limit(0)).error;
  note(`migration 414 here: ${m414}`);

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
  note(`programme for A: ${programme?.code ?? "none"} · B has none (no catalogue) · actions ${policy.scholarLearningActions.join(", ")} · history ${policy.scholarLearningHistory}`);

  // ── the Stage 2 respiratory materials, with AI help on and topics found ──
  const consentA = await send("POST", "/api/individual/scholar/consent", { grant: true }, sa.jar);
  const consentB = await send("POST", "/api/individual/scholar/consent", { grant: true }, sb.jar);
  if (consentA.status !== 200 || consentB.status !== 200) { pend("J1-J12", `AI consent could not be given here (${consentA.status}/${consentB.status} ${consentA.json?.error ?? ""})`); return; }
  const pptxOn = rules.mimes.includes(PPTX_MIME as any);
  const ids = {
    anatomy: await upload(sa.jar, PDF_MIME, tinyPdf(ANATOMY as any), "Respiratory anatomy notes.pdf"),
    pneumonia: pptxOn ? await upload(sa.jar, PPTX_MIME, await tinyPptx(PNEUMONIA), "Pneumonia lecture.pptx")
      : await upload(sa.jar, TEXT_MIME, new TextEncoder().encode(PNEUMONIA.flatMap(s => s.text).join("\n")), "Pneumonia lecture.txt"),
    oxygen: await upload(sa.jar, DOCX_MIME, await tinyDocx(OXYGEN), "Oxygen therapy notes.docx"),
  };
  if (!pptxOn) note("pptx is off in the policy here: the pneumonia lecture went in as text");
  const docs = Object.values(ids).filter((x): x is string => !!x);
  for (const id of docs) await analyseAll(sa.jar, id);
  note(`materials: ${docs.length} uploaded and analysed`);

  // ── S: Stage 2's Start learning opens Teach Me ──
  const ready = await get(`/individual/scholar/study/ready?ids=${docs.join(",")}`, sa.jar);
  ok("S1. Start learning on 'Your notes are ready' opens the Learn workspace (Teach Me), for each material and for all of them",
    ready.status === 200 && docs.every(id => ready.text.includes(`/individual/scholar/study/learn?material=${id}`)) && ready.text.includes(`/individual/scholar/study/learn?materials=${docs.join(",")}`));

  // ── J1: select several documents ──
  const start = await send("POST", "/api/individual/scholar/learn/sessions", { scope: { kind: "documents", materialIds: docs } }, sa.jar);
  const session = start.json?.session;
  const materialsInSteps = new Set((session?.steps ?? []).flatMap((s: any) => s.sections.map((x: any) => x.materialId)));
  ok("J1. several documents start one session whose suggested steps span them, recorded for resume",
    start.status === 200 && (session?.steps?.length ?? 0) >= 2 && materialsInSteps.size === docs.length && (!m414 || (session?.recorded && !!session?.id)),
    `${start.status} steps ${session?.steps?.length} materials ${materialsInSteps.size} recorded ${session?.recorded} ${start.json?.note ?? start.json?.error ?? ""}`);
  if (!session) return;
  const sid = session.id as string | null;
  const step0 = session.steps[0], step0Ids = step0.sections.map((x: any) => x.chunkId);
  const where = (step: number) => (sid ? { sessionId: sid, step } : { step, chunkIds: session.steps[step].sections.map((x: any) => x.chunkId) });

  // ── J2/J3: Teach Me, source-grounded ──
  const teach = await act(sa.jar, { action: "teach", ...where(0) });
  ok("J2. Teach Me answers the first step", teach.status === 200 && !!teach.json?.answer, `${teach.status} ${teach.json?.message ?? teach.json?.error ?? ""}`);
  ok("J3. the explanation is source-grounded: cited to the step's own sections, each source named, labelled AI-generated and not clinically reviewed",
    cites(teach.json?.answer) && (teach.json?.sources ?? []).every((s: any) => step0Ids.includes(s.chunkId) && s.materialTitle && s.citation) && /not clinically reviewed/.test(teach.json?.label ?? ""));
  note(`teach: background ${teach.json?.background ? (teach.json.background.text ? "shown apart" : "withheld") : "none"} · flags ${teach.json?.flags?.length ?? 0} · references ${teach.json?.references?.length ?? 0}`);

  // ── J4: Simplify, same step ──
  const simple = await act(sa.jar, { action: "simplify", ...where(0) });
  ok("J4. Simplify on the same step keeps its context: the same sections, cited, notes only",
    simple.status === 200 && cites(simple.json?.answer) && (simple.json?.passageIds ?? []).every((c: string) => step0Ids.includes(c)) && !simple.json?.background?.text,
    `${simple.status} ${simple.json?.message ?? ""}`);

  // ── J5: a contextual follow-up ──
  const scopeIds = new Set(session.steps.flatMap((s: any) => s.sections.map((x: any) => x.chunkId)));
  const ask = await act(sa.jar, { action: "ask", question: "Why is oxygen given to a target saturation range?", history: [{ speaker: "tutor", text: teach.json?.answer ?? "" }], ...where(0) });
  ok("J5. a follow-up question (Ask Scholar) is answered from the session's own notes, cited",
    ask.status === 200 && cites(ask.json?.answer) && (ask.json?.passageIds ?? []).every((c: string) => scopeIds.has(c)), `${ask.status} ${ask.json?.message ?? ""}`);

  // ── J6: explore a related concept across the library ──
  const topic = await send("POST", "/api/individual/scholar/learn/sessions", { scope: { kind: "topic", topic: "hypoxaemia" } }, sa.jar);
  const tsec = (topic.json?.session?.steps ?? []).flatMap((s: any) => s.sections);
  const explore = topic.status === 200 ? await act(sa.jar, { action: "explain", ...(topic.json.session.id ? { sessionId: topic.json.session.id, step: 0 } : { step: 0, chunkIds: topic.json.session.steps[0].sections.map((x: any) => x.chunkId) }) }) : null;
  ok("J6. a related concept (hypoxaemia) is explored across the library: sections from more than one material, explained and cited",
    topic.status === 200 && new Set(tsec.map((x: any) => x.materialId)).size >= 2 && !!explore && cites(explore.json?.answer), `${topic.status} ${tsec.length} sections · ${explore?.status} ${explore?.json?.message ?? ""}`);

  // ── J7/J8: the informal check and the clarification ──
  const check = await act(sa.jar, { action: "check", ...where(0) });
  ok("J7. an informal understanding check: one open question from the step's notes, labelled as not an assessment",
    check.status === 200 && /\?$/.test(check.json?.checkQuestion ?? "") && /not an assessment/.test(check.json?.informal ?? ""), `${check.status} ${check.json?.message ?? ""}`);
  const clar = check.json?.checkQuestion ? await act(sa.jar, { action: "clarify", checkQuestion: check.json.checkQuestion, answer: "It is about oxygen in the lungs.", ...where(0) }) : null;
  ok("J8. the answer gets a clarification: a verdict (understood, partly or not yet), corrected from the notes and cited, labelled informal",
    !!clar && clar.status === 200 && ["understood", "partly", "not_yet"].includes(clar.json?.verdict?.value) && cites(clar.json?.answer) && /not an assessment/.test(clar.json?.verdict?.informal ?? ""),
    `${clar?.status} ${clar?.json?.verdict?.value ?? ""} ${clar?.json?.message ?? ""}`);
  const qRows = (await admin.from("individual_scholar_question").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0;
  ok("J8b. ⚠ the check never became a practice question (Assess is untouched)", qRows === 0, `${qRows} question rows`);

  // ── J9: continue ──
  if (sid) await send("PATCH", `/api/individual/scholar/learn/sessions/${sid}`, { currentStep: 1 }, sa.jar);
  const next = await act(sa.jar, { action: "teach", ...where(1) });
  ok("J9. Continue: the next step is taught from its own sections", next.status === 200 && cites(next.json?.answer)
    && (next.json?.passageIds ?? []).every((c: string) => session.steps[1].sections.some((x: any) => x.chunkId === c)), `${next.status} ${next.json?.message ?? ""}`);

  // ── J10: leave and resume ──
  if (!sid) pend("J10. leave and resume", m414 ? "the session was not recorded" : "414 not applied here: sessions are not kept");
  else {
    const fresh = await signIn(FIX.a);
    const back = await send("GET", `/api/individual/scholar/learn/sessions/${sid}`, undefined, fresh.jar);
    const page = await get(`/individual/scholar/study/learn?session=${sid}`, fresh.jar);
    const p0 = back.json?.progress?.["0"] ?? back.json?.progress?.[0];
    ok("J10. leaving and signing in again resumes the session where it was: step two, with step one's actions and check outcome kept",
      back.status === 200 && back.json?.session?.currentStep === 1 && ["teach", "simplify", "ask", "check", "clarify"].every(x => p0?.actions?.includes(x)) && !!p0?.verdict
      && page.status === 200 && page.text.includes(session.title.slice(0, 20)), `${back.status} step ${back.json?.session?.currentStep} ${JSON.stringify(p0)}`);
  }

  // ── J11: the source references ──
  const src = teach.json?.sources?.[0];
  const srcPage = src ? await get(`/individual/scholar/study/${src.materialId}`, sa.jar) : null;
  ok("J11. each source reference resolves to the student's own section on its material page", !!srcPage && srcPage.status === 200 && srcPage.text.includes(`id="c-${src.chunkId}"`));

  // ── J12: the CFCA ──
  if (!programme) pend("J12. learning activity against CFCA outcomes", "no viewing programme here");
  else if (!m414) pend("J12. learning activity against CFCA outcomes", "414 not applied here");
  else {
    const progressPage = await get("/individual/scholar/study/progress", sa.jar);
    const refs = [teach, simple, ask, next].flatMap(r => r.json?.references ?? []);
    ok("J12. Progress shows the learning activity against the competencies the sections support, labelled as not evidence of competence; answers name their governed references",
      progressPage.status === 200 && /Learning activity:/.test(progressPage.text) && /not evidence of competence/.test(progressPage.text) && /Learn this competency/.test(progressPage.text),
      `${progressPage.status} references named: ${refs.length}`);
  }

  // ── A: the artefact library (s8) ──
  const m415 = !(await admin.from("individual_scholar_artefact").select("id").limit(0)).error;
  if (!m415) pend("A1-A3. saved explanations", "415 not applied here");
  else {
    const again = await send("POST", "/api/individual/scholar/learn/act", { action: "teach", ...where(0) }, sa.jar);
    const rows = ((await admin.from("individual_scholar_artefact").select("id, review_status, action").eq("user_id", a).eq("action", "teach")).data ?? []) as any[];
    const src = rows[0] ? ((await admin.from("individual_scholar_artefact_source").select("chunk_id").eq("artefact_id", rows[0].id)).data ?? []) as any[] : [];
    ok("A1. Teach Me's answer was saved (private formative, with its sources) and the same request returns it with no new AI call",
      teach.json?.savedForLater === true && again.status === 200 && !!again.json?.saved && again.json?.answer === teach.json?.answer
      && rows.every(r => r.review_status === "private_formative") && src.length === step0Ids.length, `${again.status} saved ${!!again.json?.saved} rows ${rows.length} sources ${src.length}`);
    const fresh = await act(sa.jar, { action: "teach", fresh: true, ...where(0) });
    const after = ((await admin.from("individual_scholar_artefact").select("id").eq("user_id", a).eq("action", "teach").eq("material_id", step0.sections[0].materialId)).data ?? []).length;
    ok("A2. 'Explain it a new way' makes a new AI answer and replaces the saved one (one kept per request)", fresh.status === 200 && !fresh.json?.saved && !!fresh.json?.answer && after === rows.filter(() => true).length,
      `${fresh.status} kept ${after}`);
    const savedPage = await get("/individual/scholar/study/saved", sa.jar);
    ok("A3. Saved learning lists the saved explanations by material, labelled private and formative, beside the questions, cases, cards and sessions",
      savedPage.status === 200 && /Saved explanations and summaries/.test(savedPage.text) && /never evidence of competence/.test(savedPage.text) && /Learning sessions/.test(savedPage.text));
  }

  // ── C: continuity (s7) ──
  const qChunk = step0Ids[0];
  const made = await send("POST", "/api/individual/scholar/questions", { chunkId: qChunk, kind: "mcq" }, sa.jar);
  const storedQ = ((await admin.from("individual_scholar_question").select("id, correct_index").eq("user_id", a).limit(1)).data ?? [])[0] as any;
  const usage = Array.from({ length: 200 }, () => ({ actor_id: a, actor_name: "harness", action: "ai_assistant_query", entity_type: "harness_learn01_continuity", new_value: { synthetic: true } }));
  await admin.from("audit_log").insert(usage);
  const cont = await send("POST", "/api/individual/scholar/learn/act", { action: "deeper", ...where(0) }, sa.jar);
  const savedTeach = await send("POST", "/api/individual/scholar/learn/act", { action: "teach", ...where(0) }, sa.jar);
  const marked = storedQ ? await send("POST", "/api/individual/scholar/attempts", { questionId: storedQ.id, chosenIndex: storedQ.correct_index }, sa.jar) : null;
  const pages = await Promise.all(["/individual/scholar/study/saved", "/individual/scholar/study/progress", `/individual/scholar/study/${step0.sections[0].materialId}`].map(p => get(p, sa.jar)));
  ok("C1. with the allowance used up, Learn says so plainly, makes no new AI answer, and returns what is saved for the step",
    cont.status === 200 && !!cont.json?.continuity?.message && !cont.json?.answer && (!m415 || (cont.json?.saved ?? []).length > 0), `${cont.status} ${JSON.stringify(cont.json?.continuity ?? cont.json?.error)}`);
  ok("C2. a saved answer still opens with no AI, a stored question is still marked by its answer key, and saved learning, progress and the material still open",
    (!m415 || (savedTeach.status === 200 && !!savedTeach.json?.saved)) && (!storedQ || (marked?.status === 200 && marked.json?.correct === true)) && pages.every(p => p.status === 200),
    `saved ${savedTeach.status} · question ${made.status}/${marked?.status} ${JSON.stringify(marked?.json ?? {})} · pages ${pages.map(p => p.status)}`);
  await admin.from("audit_log").delete().eq("actor_id", a).eq("entity_type", "harness_learn01_continuity");

  // ── NC: no competency catalogue ──
  const bDoc = await upload(sb.jar, DOCX_MIME, await tinyDocx(OXYGEN), "Oxygen therapy notes.docx");
  const bStart = bDoc ? await send("POST", "/api/individual/scholar/learn/sessions", { scope: { kind: "document", materialId: bDoc } }, sb.jar) : null;
  const bTeach = bStart?.status === 200 ? await act(sb.jar, { action: "teach", ...(bStart.json.session.id ? { sessionId: bStart.json.session.id, step: 0 } : { step: 0, chunkIds: bStart.json.session.steps[0].sections.map((x: any) => x.chunkId) }) }) : null;
  const bPage = bDoc ? await get(`/individual/scholar/study/learn?material=${bDoc}`, sb.jar) : null;
  ok("NC1. without a competency catalogue the journey works: a session starts, Teach Me answers from the notes, cited, with no governed reference, and the workspace renders",
    !!bTeach && bTeach.status === 200 && cites(bTeach.json?.answer) && (bTeach.json?.references ?? []).length === 0 && bPage?.status === 200,
    `${bStart?.status} ${bTeach?.status} ${bTeach?.status === 502 ? `PROVIDER FAILURE: ${JSON.stringify(bTeach?.json)}` : bTeach?.json?.message ?? ""}`);

  // ── I: isolation ──
  const iGet = sid ? await send("GET", `/api/individual/scholar/learn/sessions/${sid}`, undefined, sb.jar) : { status: 404 };
  const iAct = sid ? await send("POST", "/api/individual/scholar/learn/act", { action: "teach", sessionId: sid, step: 0 }, sb.jar) : { status: 404 };
  const iChunks = await send("POST", "/api/individual/scholar/learn/act", { action: "teach", step: 0, chunkIds: step0Ids }, sb.jar);
  const iScope = await send("POST", "/api/individual/scholar/learn/sessions", { scope: { kind: "documents", materialIds: docs } }, sb.jar);
  ok("I1. ⚠ another student reaches none of it: the session, an action on it, its sections, a session over its materials -- all not found",
    iGet.status === 404 && iAct.status === 404 && iChunks.status === 404 && iScope.status === 404, `${iGet.status}/${iAct.status}/${iChunks.status}/${iScope.status}`);

  // ── H: structure only; a deleted material takes its steps ──
  if (m414 && sid) {
    const ev = ((await admin.from("individual_scholar_learning_event").select("*").eq("user_id", a)).data ?? []) as any[];
    const keys = new Set(ev.flatMap(e => Object.keys(e)));
    ok("H1. the history is structure only: events hold the action, the step and a verdict -- no text column exists to hold what was said",
      ev.length >= 6 && [...keys].every(k => ["id", "session_id", "user_id", "step", "action", "verdict", "created_at"].includes(k)), `${ev.length} events, columns ${[...keys].join(",")}`);
    const stepsBefore = ((await admin.from("individual_scholar_learning_step").select("material_id").eq("session_id", sid)).data ?? []).length;
    await send("DELETE", `/api/individual/scholar/materials/${ids.anatomy}`, undefined, sa.jar);
    const after = ((await admin.from("individual_scholar_learning_step").select("material_id").eq("session_id", sid)).data ?? []) as any[];
    const artefactsLeft = m415 ? ((await admin.from("individual_scholar_artefact").select("id").eq("user_id", a).eq("material_id", ids.anatomy!)).data ?? []).length : 0;
    ok("H2. deleting a material removes the steps, sources and saved explanations that used it; the session keeps the rest", after.length < stepsBefore && after.every(r => r.material_id !== ids.anatomy) && after.length > 0 && artefactsLeft === 0,
      `${stepsBefore} -> ${after.length}, artefacts left ${artefactsLeft}`);
  } else pend("H1/H2. structure-only history and material deletion", "414 not applied here");

  // ── E: erase-all ──
  const erase = await send("POST", "/api/individual/scholar/erase", { confirm: "ERASE" }, sa.jar);
  const left = m414 ? {
    sessions: (await admin.from("individual_scholar_learning_session").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count,
    events: (await admin.from("individual_scholar_learning_event").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count,
    artefacts: (await admin.from("individual_scholar_artefact").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0,
  } : { sessions: 0, events: 0, artefacts: 0 };
  ok("E1. erase-all leaves no learning history and no saved explanation", erase.status === 200 && left.sessions === 0 && left.events === 0 && left.artefacts === 0, `${erase.status} ${JSON.stringify(left)}`);
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
