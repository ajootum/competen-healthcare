/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR PROGRESS-01 (Progress, Stage 8 of 8) -- the owner's first acceptance journey, ONE focused run over HTTP on
 * the respiratory materials (owner GO 2026-10-25, section 13, steps 1 to 15):
 *
 *   1   upload and classify the respiratory materials      2   Teach Me, Revision and Clinical Reasoning
 *   3   evaluation results                                 4   open Progress
 *   5   separate coverage, understanding, retention, application indicators
 *   6   supporting evidence and confidence                 7   CFCA domains, CPUs, competencies, outcomes
 *   8   an area needing reinforcement                      9   a recommendation followed, context preserved
 *   10  development over time                              11  educational achievements in the Passport, three tiers
 *   12  history across an educational-context change       13  no competency catalogue
 *   14  existing progress with AI unavailable              15  no unsupported claim of verified competence
 *   I   private                                            E   erase-all
 *
 * Real AI where the journey writes (questions, a case, Teach Me). Metering as configured (OFF on staging): step 14
 * uses the Individual quota, synthetic rows for THIS fixture only. Needs 426 (PEND without); step 11 needs 427.
 * Reads shared configuration and never writes it. Fixtures: harness-prog01-*, deleted at the start and the end.
 *
 * ⚠ STAGING ONLY: npx tsx scripts/privileged-harnesses.ts --staging --only scholar-progress01
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
const ref = assertSafeTarget(url, "scholar-progress01-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const note = (s: string) => console.log(`        ${s}`);

const FIX = { grantor: "harness-prog01-grantor@competen.test", a: "harness-prog01-a@competen.test", b: "harness-prog01-b@competen.test" };
const PW = `prog01-${Math.random().toString(36).slice(2)}-Aa1!`;
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
  let r = await send("POST", "/api/individual/scholar/clinical/cases", body, jar, { "x-request-id": `prog01-${Math.random().toString(36).slice(2, 12)}` });
  for (let tries = 1; tries < 3 && (r.status === 422 || r.status === 502); tries++) {
    note(`case: ${r.status} (${r.json?.error ?? ""}) -- asking again`);
    r = await send("POST", "/api/individual/scholar/clinical/cases", body, jar, { "x-request-id": `prog01-${Math.random().toString(36).slice(2, 12)}` });
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
  let r = await send("POST", "/api/individual/scholar/revision/sessions", body, jar, { "x-request-id": `prog01-${Math.random().toString(36).slice(2, 12)}` });
  if (r.status === 502) { note(`revision ${String(body.mode)}: provider failure 502 -- retrying once`); r = await send("POST", "/api/individual/scholar/revision/sessions", body, jar); }
  return r;
}
const PROGRESS = "/individual/scholar/study/progress";
const aiRows = async (u: string) => (await admin.from("plat_ai_requests").select("id", { count: "exact" }).eq("actor_id", u).limit(1)).count ?? 0;


async function main() {
  console.log(`SCHOLAR PROGRESS-01 ACCEPTANCE -- target ${ref}, server ${BASE}\n`);
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  if (!live) { console.log(`  PEND  no dev server at ${BASE}. Nothing created.`); return; }
  const m426 = !(await admin.from("individual_scholar_evaluation").select("id").limit(0)).error;
  const m427 = !(await admin.from("individual_scholar_passport_evaluation").select("id").limit(0)).error;
  note(`426 here: ${m426} · 427 here: ${m427}`);
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

  // ── 1: upload and classify ──
  const pptxOn = rules.mimes.includes(PPTX_MIME as any);
  const oxygen = await upload(sa.jar, DOCX_MIME, await tinyDocx(OXYGEN), "Oxygen therapy notes.docx");
  const pneumonia = pptxOn ? await upload(sa.jar, PPTX_MIME, await tinyPptx(PNEUMONIA), "Pneumonia lecture.pptx")
    : await upload(sa.jar, TEXT_MIME, new TextEncoder().encode(PNEUMONIA.flatMap(s => s.text).join("\n")), "Pneumonia lecture.txt");
  const docs = [oxygen, pneumonia].filter((x): x is string => !!x);
  for (const id of docs) await analyseAll(sa.jar, id);
  const maps = (await admin.from("individual_scholar_competency_map").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0;
  const analysed = (await admin.from("individual_scholar_chunk_analysis").select("chunk_id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0;
  ok("1. the respiratory materials are uploaded and classified: sections analysed into topics, and linked to the CFCA where a programme applies",
    docs.length === 2 && analysed > 0 && (!programme || maps > 0), `docs ${docs.length} · analysed sections ${analysed} · CFCA links ${maps}`);

  // ── 2: Teach Me, Revision and Clinical Reasoning ──
  const ls = await send("POST", "/api/individual/scholar/learn/sessions", { scope: { kind: "document", materialId: oxygen } }, sa.jar);
  const teach = await act(sa.jar, { action: "teach", sessionId: ls.json?.session?.id, step: 0 });
  let rv = await startRevision(sa.jar, { mode: "quick", scope: { kind: "documents", materialIds: docs }, quantity: 8, feedback: "immediate" });
  // Where no model may write questions (staging after #99, until a model is eligible for clinical questions), the
  // journey SEEDS six structured questions for this fixture -- the columns the store writes, quoting its own sections,
  // linked to a section's competency where there is one -- and answers them through the real routes. Progress reads
  // evidence; how questions are written was proven by the stage harnesses and run 1 of this journey.
  let seeded = 0;
  if (!(rv.json?.items ?? []).length) {
    note(`revision: ${rv.status} ${rv.json?.error ?? ""} -- seeding questions for this fixture`);
    const chunks = ((await admin.from("individual_scholar_chunk").select("id, material_id, content").eq("user_id", a).in("material_id", docs).order("ordinal").limit(3)).data ?? []) as any[];
    const linkOf = new Map(((await admin.from("individual_scholar_competency_map").select("chunk_id, competency_id").eq("user_id", a).in("chunk_id", chunks.map(c => c.id))).data ?? []).map((m: any) => [m.chunk_id, m.competency_id]));
    // Two questions per section, so a section answered wrongly holds enough evidence to be a learning gap.
    for (const c of chunks.flatMap(x => [x, x])) {
      const quote = String(c.content).split(/(?<=\.)\s/)[0].slice(0, 300);
      const ins = await admin.from("individual_scholar_question").insert({
        user_id: a, material_id: c.material_id, chunk_id: c.id, kind: "mcq", stem: `Which statement is in this section of your notes? (${seeded + 1})`,
        options: [quote, "None of these", "Something the notes do not say", "Another thing the notes do not say"], correct_index: 0,
        rationale: quote, source_quote: quote, model: "harness-seed", provider: "harness", prompt_version: "seed/1", ...(linkOf.get(c.id) ? { competency_id: linkOf.get(c.id) } : {}),
      });
      if (!ins.error) seeded++; else note(`seed refused: ${ins.error.message}`);
    }
    rv = await startRevision(sa.jar, { mode: "quick", scope: { kind: "documents", materialIds: docs }, quantity: 8, feedback: "immediate" });
  }
  const marked = ((rv.json?.items ?? []) as any[]).filter(i => ["mcq", "mrq", "match", "sequence"].includes(i.kind));
  const bySection = new Map<string, any[]>(); for (const i of marked) bySection.set(i.chunkId, [...(bySection.get(i.chunkId) ?? []), i]);
  const gapSection = [...bySection.entries()].sort((x, y) => y[1].length - x[1].length)[0]?.[0] ?? null;
  let answered = 0;
  for (const i of marked) {
    const r = await send("POST", "/api/individual/scholar/revision/answer", { questionId: i.id, sessionId: rv.json.session?.id, response: i.chunkId === gapSection ? await wrongResponse(a, i.id) : await rightResponse(a, i.id) }, sa.jar);
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
      const body = d.kind === "free_text" ? { decisionToken: dp.token, text: "I am not sure." }
        : { decisionToken: dp.token, optionTokens: d.options.map((o: any, k: number) => (!o.correct ? dp.options[k].token : null)).filter(Boolean).slice(0, 1) };
      const r = await send("POST", `/api/individual/scholar/clinical/sessions/private/${cur.sessionId}/answer`, body, sa.jar);
      if (r.status !== 200) break;
      decided++; cur = r.json.play;
    }
  }
  // SCHOLAR-EDU-AI-01 s6: students now get plain words for "no eligible model", not the governance reason.
  const caseRefused = !made.json?.play && /approved for clinical content|AI help isn.t available for this yet/.test(String(made.json?.error ?? ""));
  if (caseRefused) note(`clinical case: refused (${made.json?.error}) -- no eligible model to write it; reasoning is not exercised in this run`);
  ok("2. the student completes Teach Me, Revision and Clinical Reasoning activities (a case where a model may write one)", teach.status === 200 && answered >= 3 && (decided >= 2 || caseRefused),
    `teach ${teach.status} · answers ${answered}${seeded ? ` (seeded ${seeded})` : ""} · decisions ${decided}${caseRefused ? " (case refused: no eligible model)" : ""}`);

  // ── 3: an evaluation ──
  const ev = await send("POST", "/api/individual/scholar/evaluations", { scope: { kind: "documents", materialIds: docs }, method: "existing" }, sa.jar);
  ok("3. the student receives evaluation results (a kept Respiratory Assessment)", ev.status === 200 && !!ev.json?.id, `${ev.status} ${ev.json?.error ?? ""}`);

  // ── 4-6: Progress, separate indicators, the evidence behind them ──
  const ai0 = await aiRows(a);
  const pg = await get(PROGRESS, sa.jar);
  ok("4. the student opens Progress: the learning command centre, next steps first", pg.status === 200 && pg.text.includes("My learning progress") && pg.text.includes("Recommended next steps"), `${pg.status}`);
  ok("5. coverage, understanding, retention and application are separate indicators, each on its own; engagement is labelled activity",
    ["Knowledge coverage", "Understanding", "Retention", "Application and clinical reasoning", "Learning engagement", "Evidence confidence"].every(t => pg.text.includes(t))
      && pg.text.includes("Activity, not understanding.") && pg.text.includes("Not what you know."));
  const exDoc = await get(`${PROGRESS}/explore?kind=document&id=${oxygen}`, sa.jar);
  ok("6. the student inspects the supporting evidence and its confidence: materials, sections, topics, how it was marked, the confidence and the limitations",
    exDoc.status === 200 && ["The evidence behind it", "Relevant materials", "Topics explored", "How it was marked", "Evidence confidence", "What this evaluation cannot say"].every(t => exDoc.text.includes(t)), `${exDoc.status}`);

  // ── 7: CFCA exploration ──
  const compLink = pg.text.match(/progress\/explore\?kind=competency&amp;id=([0-9a-f-]{36})|progress\/explore\?kind=competency&id=([0-9a-f-]{36})/);
  const outLink = pg.text.match(/progress\/explore\?kind=outcome&amp;id=([0-9a-f-]{36})&amp;outcome=([^"]+)|progress\/explore\?kind=outcome&id=([0-9a-f-]{36})&outcome=([^"]+)/);
  if (!programme || !maps) pend("7", `no CFCA here (programme ${programme?.code ?? "none"}, links ${maps})`);
  else {
    const compId = compLink?.[1] ?? compLink?.[2];
    const exC = compId ? await get(`${PROGRESS}/explore?kind=competency&id=${compId}`, sa.jar) : { status: 0, text: "" };
    const outQs = outLink ? `kind=outcome&id=${outLink[1] ?? outLink[3]}&outcome=${(outLink[2] ?? outLink[4]).replace(/&amp;/g, "&")}` : null;
    const exO = outQs ? await get(`${PROGRESS}/explore?${outQs}`, sa.jar) : { status: 0, text: "" };
    ok("7. the student explores the CFCA: domain › practice unit › competency › learning outcome on Progress, and a competency and an outcome open with their evidence",
      pg.text.includes("By your competency framework") && exC.status === 200 && exC.text.includes("The evidence behind it") && exO.status === 200 && exO.text.includes("The evidence behind it"),
      `competency ${exC.status} · outcome ${exO.status}`);
  }

  // ── 8-9: an area needing reinforcement, followed with its context ──
  const teachHref = pg.text.match(/href="([^"]*study\/learn\?section=[0-9a-f-]{36})"/)?.[1]?.replace(/&amp;/g, "&");
  const reviseHref = pg.text.match(/href="([^"]*study\/revise\?material=[0-9a-f-]{36}[^"]*)"/)?.[1]?.replace(/&amp;/g, "&");
  const caseHref = pg.text.match(/href="([^"]*study\/apply\?section=[0-9a-f-]{36}[^"]*)"/)?.[1]?.replace(/&amp;/g, "&");
  ok("8. Progress identifies an area needing reinforcement, from the recorded evidence: a next step names it and why",
    !!(teachHref || reviseHref || caseHref) && /A learning gap|Recall did not hold|Weaker in|safety point/.test(pg.text), `teach ${!!teachHref} · revise ${!!reviseHref} · case ${!!caseHref}`);
  const follow = teachHref ? await get(teachHref.replace(/^https?:\/\/[^/]+/, ""), sa.jar) : caseHref ? await get(caseHref.replace(/^https?:\/\/[^/]+/, ""), sa.jar) : { status: 0, text: "" };
  const fRev = reviseHref ? await get(reviseHref.replace(/^https?:\/\/[^/]+/, ""), sa.jar) : null;
  const sectionId = (teachHref ?? caseHref ?? "").match(/section=([0-9a-f-]{36})/)?.[1];
  ok("9. following a step opens Teach Me, Revision or Clinical Reasoning with its context: the section (or material) it names",
    follow.status === 200 && !!sectionId && (!fRev || (fRev.status === 200 && fRev.text.includes("Choose what and how to revise"))),
    `follow ${follow.status} section ${sectionId ? "kept" : "missing"} · revise ${fRev?.status ?? "n/a"}`);

  // ── 10: longitudinal ──
  const wk = await get(`${PROGRESS}?period=week`, sa.jar), mo = await get(`${PROGRESS}?period=month`, sa.jar);
  ok("10. the student reviews development over time, by week and by month, with new questions kept apart from practice",
    wk.status === 200 && mo.status === 200 && wk.text.includes("Development over time") && wk.text.includes("New questions (first try)") && wk.text.includes("Practised again") && mo.text.includes(new Date().toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })),
    `${wk.status}/${mo.status}`);

  // ── 11: Passport tiers ──
  if (!m427) pend("11", "427 must be applied on this environment for educational evaluations in the Passport");
  else {
    const study = await send("POST", "/api/individual/scholar/passport", { materialId: oxygen, achievement: "practice_questions", label: "Oxygen therapy practice" }, sa.jar);
    const shown = await send("POST", "/api/individual/scholar/passport-evaluations", { evaluationId: ev.json.id, label: "Respiratory self-evaluation" }, sa.jar);
    const pp = await get("/individual/scholar/passport", sa.jar);
    const iShow = await send("POST", "/api/individual/scholar/passport-evaluations", { evaluationId: ev.json.id, label: "Not mine" }, sb.jar);
    ok("11. the Passport shows appropriate educational achievements in three tiers kept apart: study activity, an educational evaluation (formative, not verified, no percentage), and verified competence on its own",
      study.status === 200 && shown.status === 200 && pp.status === 200 && pp.text.includes("Self-directed study") && pp.text.includes("Educational evaluations") && pp.text.includes("Respiratory self-evaluation")
        && pp.text.includes("Educational evaluation of own learning: formative, not verified") && pp.text.includes("Assessed competencies") && iShow.status === 404,
      `study ${study.status} · evaluation ${shown.status} ${shown.json?.error ?? ""} · page ${pp.status} · another student ${iShow.status}`);
  }

  // ── 12: history across an educational-context change ──
  const before = await send("GET", `/api/individual/scholar/evaluations/${ev.json?.id}`, undefined, sa.jar);
  // A change of educational context: the next level of the same programme, or (one level only) another programme.
  const level2 = programme?.levels[1]?.code ?? null;
  const other = opts.ok ? opts.options.programmes.find(p => p.code !== programme?.code) ?? null : null;
  const target = programme && level2 ? { code: programme.code, level: level2 } : other ? { code: other.code, level: other.levels[0]?.code ?? null } : null;
  note(`step 12 change: ${target ? `${target.code}${target.level ? ` / ${target.level}` : ""}` : "none available"}`);
  const change = target ? await send("PUT", "/api/individual/scholar/programme", target, sa.jar) : null;
  const byProg = await get(`${PROGRESS}?period=programme`, sa.jar);
  const after = await send("GET", `/api/individual/scholar/evaluations/${ev.json?.id}`, undefined, sa.jar);
  if (!change) pend("12", `no second level or programme offered here (${programme?.code ?? "none"}): no context change to make`);
  else ok("12. learning history is preserved across an educational-context change: Progress keeps a period per context, and the earlier evaluation is unchanged",
    change.status === 200 && byProg.status === 200 && byProg.text.includes("Each period is one educational context") && JSON.stringify(before.json?.evaluation?.results) === JSON.stringify(after.json?.evaluation?.results),
    `change ${change.status} · programme view ${byProg.status} · evaluation unchanged ${JSON.stringify(before.json?.evaluation?.results) === JSON.stringify(after.json?.evaluation?.results)}`);

  // ── 13: no catalogue ──
  const bDoc = await upload(sb.jar, DOCX_MIME, await tinyDocx(OXYGEN), "Oxygen therapy notes.docx");
  if (bDoc) await analyseAll(sb.jar, bDoc);
  const bRv = bDoc ? await startRevision(sb.jar, { mode: "quick", scope: { kind: "document", materialId: bDoc }, quantity: 3, feedback: "immediate" }) : null;
  for (const i of ((bRv?.json?.items ?? []) as any[]).filter(x => ["mcq", "mrq", "match", "sequence"].includes(x.kind)))
    await send("POST", "/api/individual/scholar/revision/answer", { questionId: i.id, sessionId: bRv!.json.session?.id, response: await rightResponse(b, i.id) }, sb.jar);
  const bPg = await get(PROGRESS, sb.jar);
  const bEx = bDoc ? await get(`${PROGRESS}/explore?kind=document&id=${bDoc}`, sb.jar) : { status: 0, text: "" };
  ok("13. Progress works without an assigned competency catalogue: by material, each opening its evidence",
    bPg.status === 200 && bPg.text.includes("My learning progress") && bPg.text.includes("By material") && bEx.status === 200 && bEx.text.includes("The evidence behind it"), `${bPg.status} · explore ${bEx.status}`);

  // ── 14: AI unavailable ──
  await admin.from("audit_log").insert(Array.from({ length: 200 }, () => ({ actor_id: a, actor_name: "harness", action: "ai_assistant_query", entity_type: "harness_prog01_quota", new_value: { synthetic: true } })));
  const q0 = await aiRows(a);
  const off = await Promise.all([get(PROGRESS, sa.jar), get(`${PROGRESS}/explore?kind=document&id=${oxygen}`, sa.jar), get("/individual/scholar/passport", sa.jar)]);
  const q1 = await aiRows(a);
  ok("14. with the AI allowance used up, existing progress, its evidence and the Passport stay available, and opening them uses no AI",
    off.every(p => p.status === 200) && off[0].text.includes("My learning progress") && q1 === q0 && q0 === ai0, `${off.map(p => p.status)} · ai ${q0}->${q1}`);
  await admin.from("audit_log").delete().eq("actor_id", a).eq("entity_type", "harness_prog01_quota");

  // ── 15: no unsupported claim of verified competence ──
  const surfaces = [pg.text, exDoc.text];
  ok("15. no unsupported claim of verified clinical competence: Progress and its evidence say observed practice, not verified competence",
    surfaces.every(t => /not verified competence|Not assessed here/.test(t)) && !surfaces.some(t => /\byou are competent\b|\bcertified\b|\bpassed\b/i.test(t)));

  // ── I and E ──
  // A session refresh may answer 307 once (the helper does not follow redirects): ask again with the refreshed cookies.
  let iEx = await get(`${PROGRESS}/explore?kind=document&id=${oxygen}`, sb.jar);
  if (iEx.status >= 300 && iEx.status < 400) iEx = await get(`${PROGRESS}/explore?kind=document&id=${oxygen}`, sb.jar);
  ok("I. ⚠ private: another student opening the first student's material in Progress sees none of it", iEx.status === 200 && iEx.text.includes("could not be opened") && !iEx.text.includes("The evidence behind it"), `${iEx.status}`);
  const erase = await send("POST", "/api/individual/scholar/erase", { confirm: "ERASE" }, sa.jar);
  const left = m427 ? (await admin.from("individual_scholar_passport_evaluation").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0 : 0;
  const leftEv = (await admin.from("individual_scholar_evaluation").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0;
  ok("E. erase-all removes the evaluations and their Passport choices", erase.status === 200 && left === 0 && leftEv === 0, `${erase.status} · ${leftEv}/${left}`);
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
