/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR INTEGRATED JOURNEY -- owner GO "FINAL ACCEPTANCE OF STAGES 4 & 5" (2026-10-25), the ONE focused journey:
 * Upload -> Teach Me -> Revision -> Clinical Case -> Feedback -> Learning History, as one student, in one sitting.
 * It connects what the stage harnesses prove apart (learn01, revision01, clinical01); it re-proves none of them.
 *
 *   J1  upload: two materials, analysed into cited sections (CFCA proposals where a programme has a catalogue)
 *   J2  Teach Me on the oxygen notes: cited to that step's own sections
 *   J3  Revision from the same material: questions from its sections, a missed answer's quote found word for word in
 *       its section, and what it practises (competency, outcome) where the section is linked
 *   J4  from that answer: Teach Me on the same section with the way back to the same revision session
 *   J5  from that answer: a clinical case written from the same section (its source is that section)
 *   J6  the case to the end: feedback on every decision, how it was marked, the debrief
 *   J7  Learning History: the Learn session, the revision session and the case are all kept and resume as left;
 *       Progress counts the answers
 *   J8  AI allowance enforced (synthetic quota rows for THIS fixture only): no new case, said as continuity; stored
 *       learning carries on without AI -- the revision session, Today's Revision from saved questions, the case replay
 *   J9  no catalogue: a second student with no programme uploads, revises and answers, with nothing claimed
 *   J10 private isolation: the second student reaches none of the first's material, sessions or case
 *   J11 approval and publication boundaries: with case_library OFF there is no library case, no candidacy and no
 *       offer, and Apply shows the governed "not available" state; nothing private is a candidate
 *   E   erase-all leaves none of it
 *
 * Metering OFF (the Individual quota applies). Real AI. Reads shared configuration and never writes it.
 * Fixtures: harness-journey-*, deleted at the start and the end.
 *
 * ⚠ STAGING ONLY: npx tsx scripts/privileged-harnesses.ts --staging --only scholar-journey
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
const ref = assertSafeTarget(url, "scholar-journey-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const note = (s: string) => console.log(`        ${s}`);

const FIX = { grantor: "harness-journey-grantor@competen.test", a: "harness-journey-a@competen.test", b: "harness-journey-b@competen.test" };
const PW = `journey-${Math.random().toString(36).slice(2)}-Aa1!`;
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
  let r = await send("POST", "/api/individual/scholar/clinical/cases", body, jar, { "x-request-id": `journey-${Math.random().toString(36).slice(2, 12)}` });
  for (let tries = 1; tries < 3 && (r.status === 422 || r.status === 502); tries++) {
    note(`case: ${r.status} (${r.json?.error ?? ""}) -- asking again`);
    r = await send("POST", "/api/individual/scholar/clinical/cases", body, jar, { "x-request-id": `journey-${Math.random().toString(36).slice(2, 12)}` });
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


/** A learning action, as learn01 asks it: a withheld answer is the grounding check working; asked again at most twice. A 502 is retried once and reported. */
async function act(jar: Jar, body: Record<string, unknown>) {
  let r = await send("POST", "/api/individual/scholar/learn/act", body, jar);
  if (r.status === 502) { note(`${String(body.action)}: provider failure 502 -- retrying once`); r = await send("POST", "/api/individual/scholar/learn/act", body, jar); }
  const shown = (x: any) => !!(x.json?.answer || x.json?.continuity);
  for (let tries = 1; tries < 3 && r.status === 200 && !shown(r) && !r.json?.notInNotes; tries++) {
    note(`${String(body.action)}: withheld (${r.json?.message ?? ""}) -- asking again`);
    r = await send("POST", "/api/individual/scholar/learn/act", body, jar);
  }
  return r;
}
async function startRevision(jar: Jar, body: Record<string, unknown>) {
  let r = await send("POST", "/api/individual/scholar/revision/sessions", body, jar, { "x-request-id": `journey-${Math.random().toString(36).slice(2, 12)}` });
  if (r.status === 502) { note(`revision ${String(body.mode)}: provider failure 502 -- retrying once`); r = await send("POST", "/api/individual/scholar/revision/sessions", body, jar); }
  return r;
}
const cites = (s: string) => /\[S\d+\]/.test(s ?? "");
const squash = (s: string) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

async function main() {
  console.log(`SCHOLAR INTEGRATED JOURNEY -- target ${ref}, server ${BASE}\n`);
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  if (!live) { console.log(`  PEND  no dev server at ${BASE}. Nothing created.`); return; }
  const libFlag = ((await admin.from("practice_platform_flags").select("enabled").eq("flag", "case_library").maybeSingle()).data as any)?.enabled === true;
  const metered = ((await admin.from("practice_platform_flags").select("enabled").eq("flag", "ai_fair_use").maybeSingle()).data as any)?.enabled === true;
  note(`case_library ${libFlag ? "ON" : "OFF"} · ai_fair_use ${metered ? "ON" : "OFF"}`);
  if (metered) { pend("J1-J11", "this journey runs with metering OFF (the Individual quota); metering is ON here"); return; }

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
  const consentA = await send("POST", "/api/individual/scholar/consent", { grant: true }, sa.jar);
  const consentB = await send("POST", "/api/individual/scholar/consent", { grant: true }, sb.jar);
  if (consentA.status !== 200 || consentB.status !== 200) { pend("J1-J11", `AI consent could not be given here (${consentA.status}/${consentB.status} ${consentA.json?.error ?? ""})`); return; }

  // ── J1: upload ──
  const pptxOn = rules.mimes.includes(PPTX_MIME as any);
  const oxygen = await upload(sa.jar, DOCX_MIME, await tinyDocx(OXYGEN), "Oxygen therapy notes.docx");
  const pneumonia = pptxOn ? await upload(sa.jar, PPTX_MIME, await tinyPptx(PNEUMONIA), "Pneumonia lecture.pptx")
    : await upload(sa.jar, TEXT_MIME, new TextEncoder().encode(PNEUMONIA.flatMap(s => s.text).join("\n")), "Pneumonia lecture.txt");
  for (const id of [oxygen, pneumonia]) if (id) await analyseAll(sa.jar, id);
  const chunks = ((await admin.from("individual_scholar_chunk").select("id, material_id, content").eq("user_id", a).in("material_id", [oxygen, pneumonia].filter(Boolean))).data ?? []) as any[];
  const chunkText = new Map(chunks.map(c => [c.id, c.content as string]));
  const oxygenChunks = new Set(chunks.filter(c => c.material_id === oxygen).map(c => c.id));
  const maps = (await admin.from("individual_scholar_competency_map").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0;
  ok("J1. upload: two materials are analysed into the student's own cited sections", !!oxygen && !!pneumonia && oxygenChunks.size > 0 && chunks.length > oxygenChunks.size,
    `oxygen ${!!oxygen} pneumonia ${!!pneumonia} · sections ${chunks.length} (oxygen ${oxygenChunks.size}) · CFCA proposals ${maps} (programme ${programme?.code ?? "none"})`);
  if (!oxygen || !oxygenChunks.size) return;

  // ── J2: Teach Me on the oxygen notes ──
  const ls = await send("POST", "/api/individual/scholar/learn/sessions", { scope: { kind: "document", materialId: oxygen } }, sa.jar);
  const lsession = ls.json?.session;
  const step0Ids: string[] = (lsession?.steps?.[0]?.sections ?? []).map((x: any) => x.chunkId);
  const teach = lsession ? await act(sa.jar, lsession.id ? { action: "teach", sessionId: lsession.id, step: 0 } : { action: "teach", step: 0, chunkIds: step0Ids }) : null;
  ok("J2. Teach Me on the uploaded notes: the explanation is cited to that step's own sections of this material",
    ls.status === 200 && !!lsession?.id && teach?.status === 200 && cites(teach.json?.answer) && (teach.json?.sources ?? []).length > 0
      && (teach.json.sources as any[]).every(s => step0Ids.includes(s.chunkId) && oxygenChunks.has(s.chunkId)),
    `session ${ls.status} ${lsession?.id ? "kept" : "not kept"} · teach ${teach?.status} ${teach?.json?.answer ? "answered" : teach?.json?.message ?? teach?.json?.error ?? ""} · sources ${(teach?.json?.sources ?? []).length}`);

  // ── J3: Revision from the same material ──
  const rv = await startRevision(sa.jar, { mode: "quick", scope: { kind: "documents", materialIds: [oxygen] }, quantity: 4, feedback: "immediate" });
  const sid = rv.json?.session?.id as string | undefined;
  const items = (rv.json?.items ?? []) as any[];
  const missable = items.find(i => ["mcq", "mrq", "match", "sequence"].includes(i.kind)) ?? null;
  const wrong = missable ? await wrongResponse(a, missable.id) : null;
  const miss = missable && wrong ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: missable.id, sessionId: sid, response: wrong }, sa.jar) : null;
  const fb = miss?.json?.feedback;
  const qComp = missable ? ((await admin.from("individual_scholar_question").select("competency_id").eq("user_id", a).eq("id", missable.id).maybeSingle()).data as any)?.competency_id ?? null : null;
  ok("J3. Revision from the same material: its questions come from that material's sections; a missed answer is marked by code, its quote is found word for word in its own section, and it says what it practises where the section is linked",
    rv.status === 200 && !!sid && items.length > 0 && items.every(i => oxygenChunks.has(i.chunkId)) && miss?.status === 200 && fb?.correct === false && fb?.marking === "deterministic"
      && squash(chunkText.get(fb.source.chunkId) ?? "").includes(squash(fb.source.quote)) && (qComp ? !!fb.practises?.competency && /not evidence of competence/.test(fb.practises.label) : fb.practises == null),
    `start ${rv.status} ${rv.json?.error ?? ""} · items ${items.length} (${[...new Set(items.map(i => i.kind))].join(",")}) · missed ${miss?.status} ${fb?.marking ?? ""} · practises ${fb?.practises ? `${fb.practises.competency}${fb.practises.outcome ? ` / ${fb.practises.outcome}` : ""}` : qComp ? "MISSING" : "none (no link)"}`);
  if (!fb) return;
  const section = fb.source.chunkId as string;

  // ── J4: Teach Me on the missed section, with the way back ──
  const back = await get(`/individual/scholar/study/learn?section=${section}&revision=${sid}`, sa.jar);
  const reteach = await act(sa.jar, { action: "explain", step: 0, chunkIds: [section] });
  ok("J4. from the missed answer, Teach Me opens on the same section with the way back to the same revision session, and explains from it",
    back.status === 200 && back.text.includes("Back to your revision") && back.text.includes(`study/revise?session=${sid}`) && reteach.status === 200 && cites(reteach.json?.answer)
      && (reteach.json?.sources ?? []).every((s: any) => s.chunkId === section),
    `${back.status} · explain ${reteach.status} ${reteach.json?.answer ? "answered" : reteach.json?.message ?? reteach.json?.error ?? ""}`);

  // ── J5: a clinical case from the same section ──
  // A one-section case may be withheld by the checks (a short section rarely carries a whole scenario). The student
  // is told to try more of their notes, and does: the same material. Both are reported; neither check is relaxed.
  let made = await makeCase(sa.jar, { entry: "revision", scope: { kind: "section", chunkId: section }, context: "medical", mode: "guided", generateAnyway: true });
  const fromSection = made.status === 200;
  if (!fromSection) {
    note(`case from the one section: ${made.status} (${made.json?.error ?? ""}) -- trying more of the notes, as the message says`);
    made = await makeCase(sa.jar, { entry: "notes", scope: { kind: "document", materialId: oxygen }, context: "medical", mode: "guided", generateAnyway: true });
  }
  const play = made.json?.play;
  const caseSrc = made.json?.caseId ? ((await admin.from("individual_scholar_case_source").select("chunk_id").eq("user_id", a).eq("case_id", made.json.caseId)).data ?? []) as any[] : [];
  for (const x of ((await admin.from("audit_log").select("new_value").eq("actor_id", a).eq("entity_type", "individual_scholar_case_blueprint").order("created_at")).data ?? []) as any[])
    note(`case draft: ${x.new_value.outcome} ${JSON.stringify(x.new_value.problems ?? [])}`);
  // The label is the case page view (viewPlay), which is what the student sees -- not the start response.
  const opened = play?.sessionId ? await send("GET", `/api/individual/scholar/clinical/sessions/private/${play.sessionId}`, undefined, sa.jar) : null;
  ok("J5. from the same answer, a private clinical case is written from the student's own notes -- that section, or (when the checks withhold a one-section case) the same material -- and starts, labelled practice",
    made.status === 200 && !!play?.sessionId && caseSrc.length > 0 && caseSrc.every(r => fromSection ? r.chunk_id === section : oxygenChunks.has(r.chunk_id)) && /not a clinically reviewed case/.test(opened?.json?.play?.label ?? ""),
    `${fromSection ? "from the section" : "from the material"} · ${made.status} ${made.json?.error ?? ""} · label ${opened?.json?.play?.label ? "shown" : "MISSING"} · sources ${caseSrc.length} ${caseSrc.every(r => oxygenChunks.has(r.chunk_id)) ? "(all this material)" : "(OTHER)"}`);
  if (!play) return;

  // ── J6: the case to the end, with feedback ──
  const bp = ((await admin.from("individual_scholar_case").select("blueprint").eq("user_id", a).eq("id", made.json.caseId).maybeSingle()).data as any)?.blueprint;
  const answerFor = (dp: any) => {
    const d = bp.decisionPoints.find((x: any) => x.prompt === dp.prompt);
    if (!d) return null;
    if (d.kind === "free_text") return { decisionToken: dp.token, text: d.expectedResponse ?? "I would check the prescription and the target range." };
    const pick = d.options.filter((o: any) => o.correct).slice(0, d.kind === "single" ? 1 : 2).map((o: any) => d.options.indexOf(o));
    return { decisionToken: dp.token, optionTokens: pick.map((i: number) => dp.options[i].token) };
  };
  let cur = play; const feedbacks: any[] = [];
  for (let step = 0; step < 12 && cur.status === "active"; step++) {
    const dp = cur.view.stages[cur.view.stages.length - 1].decisionPoints.find((d: any) => !cur.answered.includes(d.token));
    const body = dp ? answerFor(dp) : null;
    if (!body) break;
    const r = await send("POST", `/api/individual/scholar/clinical/sessions/private/${cur.sessionId}/answer`, body, sa.jar);
    if (r.status !== 200) { note(`case answer ${r.status} ${r.json?.error ?? ""}`); break; }
    feedbacks.push(r.json.feedback); cur = r.json.play;
  }
  ok("J6. the case is played to the end: every decision gets feedback saying how it was marked, and the debrief is labelled formative",
    cur.status === "completed" && feedbacks.length === bp.decisionPoints.length && feedbacks.every(f => typeof f.markingLabel === "string") && !!cur.debrief && /not an assessment/.test(cur.debrief.label ?? ""),
    `status ${cur.status} · feedback ${feedbacks.length}/${bp.decisionPoints.length} · markings ${[...new Set(feedbacks.map(f => f.marking))].join(",")}`);

  // ── J7: Learning History ──
  const lHist = await send("GET", "/api/individual/scholar/learn/sessions", undefined, sa.jar);
  const lBack = await send("GET", `/api/individual/scholar/learn/sessions/${lsession.id}`, undefined, sa.jar);
  const rHist = await send("GET", "/api/individual/scholar/revision/sessions", undefined, sa.jar);
  const rBack = await send("GET", `/api/individual/scholar/revision/sessions/${sid}`, undefined, sa.jar);
  const cBack = await send("GET", `/api/individual/scholar/clinical/sessions/private/${play.sessionId}`, undefined, sa.jar);
  const applyPage = await get("/individual/scholar/study/apply", sa.jar);
  const progress = await get("/individual/scholar/study/progress", sa.jar);
  ok("J7. Learning History keeps all of it as left: the Learn session, the revision session with its answer, and the finished case, listed and resumable; Progress counts the answers",
    (lHist.json?.sessions ?? []).some((s: any) => s.id === lsession.id) && lBack.status === 200 && (rHist.json?.sessions ?? []).some((s: any) => s.id === sid)
      && rBack.status === 200 && (rBack.json?.answered ?? []).some((x: any) => x.questionId === missable.id) && cBack.status === 200 && cBack.json?.play?.status === "completed"
      && applyPage.status === 200 && applyPage.text.includes("Your cases") && applyPage.text.includes(bp.title) && progress.status === 200 && progress.text.includes("Questions answered"),
    `learn ${lBack.status} · revision ${rBack.status} answered ${(rBack.json?.answered ?? []).length} · case ${cBack.status} ${cBack.json?.play?.status} · apply ${applyPage.status} · progress ${progress.status}`);

  // ── J8: AI allowance enforced; stored learning without AI (the Individual quota, THIS fixture only) ──
  const usage = Array.from({ length: 200 }, () => ({ actor_id: a, actor_name: "harness", action: "ai_assistant_query", entity_type: "harness_journey_continuity", new_value: { synthetic: true } }));
  await admin.from("audit_log").insert(usage);
  const ai0 = (await admin.from("plat_ai_requests").select("id", { count: "exact" }).eq("actor_id", a).limit(1)).count ?? 0;
  const newCase = await send("POST", "/api/individual/scholar/clinical/cases", { entry: "notes", scope: { kind: "document", materialId: oxygen }, generateAnyway: true }, sa.jar);
  const today = await startRevision(sa.jar, { mode: "today" });
  const tItem = (today.json?.items ?? []).find((i: any) => ["mcq", "mrq", "match", "sequence"].includes(i.kind));
  const tAns = tItem ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: tItem.id, sessionId: today.json.session?.id, response: await rightResponse(a, tItem.id) }, sa.jar) : null;
  const replay = await send("POST", "/api/individual/scholar/clinical/sessions", { caseId: made.json.caseId }, sa.jar);
  const rDp = replay.json?.play?.view?.stages?.[0]?.decisionPoints?.[0];
  const rAns = rDp ? await send("POST", `/api/individual/scholar/clinical/sessions/private/${replay.json.play.sessionId}/answer`, answerFor(rDp), sa.jar) : null;
  const ai1 = (await admin.from("plat_ai_requests").select("id", { count: "exact" }).eq("actor_id", a).limit(1)).count ?? 0;
  ok("J8. with the AI allowance used up, a new case is refused as Learning Continuity, and stored learning carries on with no AI call: Today's Revision from saved questions marked by code, the case replayed and marked by its key",
    (newCase.status === 429 || newCase.status === 409) && newCase.json?.continuity === true && today.status === 200 && (today.json.generated ?? 0) === 0 && tAns?.status === 200 && tAns.json?.feedback?.marking === "deterministic"
      && replay.status === 200 && rAns?.status === 200 && ai1 === ai0,
    `new case ${newCase.status} continuity ${newCase.json?.continuity} · today ${today.status} gen ${today.json?.generated} · answer ${tAns?.status} ${tAns?.json?.feedback?.marking ?? ""} · replay ${replay.status}/${rAns?.status} · ai ${ai0}->${ai1}`);
  await admin.from("audit_log").delete().eq("actor_id", a).eq("entity_type", "harness_journey_continuity");

  // ── J9: no catalogue ──
  const bDoc = await upload(sb.jar, DOCX_MIME, await tinyDocx(OXYGEN), "Oxygen therapy notes.docx");
  if (bDoc) await analyseAll(sb.jar, bDoc);
  const bRv = bDoc ? await startRevision(sb.jar, { mode: "quick", scope: { kind: "documents", materialIds: [bDoc] }, quantity: 3, feedback: "immediate" }) : null;
  const bItem = (bRv?.json?.items ?? []).find((i: any) => ["mcq", "mrq", "match", "sequence"].includes(i.kind));
  const bAns = bItem ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: bItem.id, sessionId: bRv!.json.session?.id, response: await rightResponse(b, bItem.id) }, sb.jar) : null;
  ok("J9. without a programme catalogue a student uploads, revises and is marked, and no competency is claimed",
    bRv?.status === 200 && bAns?.status === 200 && bAns.json?.feedback?.correct === true && bAns.json.feedback.practises == null, `${bRv?.status} ${bRv?.json?.error ?? ""} · answer ${bAns?.status}`);

  // ── J10: private isolation ──
  const iPaths = [
    await send("GET", `/api/individual/scholar/learn/sessions/${lsession.id}`, undefined, sb.jar),
    await send("GET", `/api/individual/scholar/revision/sessions/${sid}`, undefined, sb.jar),
    await send("GET", `/api/individual/scholar/clinical/sessions/private/${play.sessionId}`, undefined, sb.jar),
    await send("POST", "/api/individual/scholar/clinical/sessions", { caseId: made.json.caseId }, sb.jar),
    await send("POST", "/api/individual/scholar/revision/answer", { questionId: missable.id, response: wrong }, sb.jar),
  ];
  const iMat = await get(`/individual/scholar/study/${oxygen}`, sb.jar);
  ok("J10. ⚠ private isolation: the second student reaches none of the first's Learn session, revision session, case, questions or material",
    iPaths.every(r => r.status === 404) && !iMat.text.includes("Oxygen is a medicine"), `${iPaths.map(r => r.status).join("/")} · material ${iMat.status}`);

  // ── J11: approval and publication boundaries ──
  if (libFlag) pend("J11", "case_library is ON here: the boundary this journey confirms is the pilot's (library OFF)");
  else {
    const lib = await send("GET", "/api/individual/scholar/clinical/library", undefined, sa.jar);
    const grant = await send("POST", "/api/individual/scholar/clinical/candidacy", { attestation: "own_notes", attestationVersion: "case-attest/1" }, sa.jar);
    const offer = await send("POST", `/api/individual/scholar/clinical/cases/${made.json.caseId}/offer`, { kind: "case" }, sa.jar);
    const cand = (await admin.from("case_candidate").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0;
    const apply = await get("/individual/scholar/study/apply", sa.jar);
    ok("J11. approval and publication boundaries hold with the library OFF: no library case is offered, no candidacy or offer is accepted, nothing private became a candidate, and Apply shows the governed 'not available' state with no library control",
      lib.status === 200 && (lib.json?.offers ?? []).length === 0 && grant.status !== 200 && offer.status !== 200 && cand === 0
        && apply.text.includes("Not available yet") && !apply.text.includes("Choose an existing case") && !apply.text.includes("Offer this case") && !/library cases (are )?still playable/.test(apply.text),
      `library ${lib.status} offers ${(lib.json?.offers ?? []).length} · grant ${grant.status} · offer ${offer.status} · candidates ${cand}`);
  }

  // ── E: erase-all ──
  const erase = await send("POST", "/api/individual/scholar/erase", { confirm: "ERASE" }, sa.jar);
  const left = await Promise.all(["individual_scholar_material", "individual_scholar_learning_session", "individual_scholar_revision_session", "individual_scholar_case", "individual_scholar_question"]
    .map(async t => (await admin.from(t).select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0));
  ok("E. erase-all leaves none of the journey: materials, Learn sessions, revision sessions, cases and questions", erase.status === 200 && left.every(n => n === 0), `${erase.status} · left ${left.join("/")}`);
}

main()
  .catch(e => { fails.push(`crashed: ${e?.message ?? e}`); console.log(`  FAIL  crashed: ${e?.stack ?? e}`); })
  .finally(async () => {
    await cleanup().catch(() => {});
    const left = await Promise.all(Object.values(FIX).map(findUser));
    ok("Z1. fixture identities and their files are gone", left.every(x => !x));
    console.log(fails.length ? `
RED -- ${pass} passed, ${fails.length} failed` : `
ALL GREEN -- ${pass} passed, 0 failed`);
    process.exit(fails.length ? 1 : 0);
  });
