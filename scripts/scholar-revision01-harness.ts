/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR REVISION-01 HARNESS -- COMPETEN-SCHOLAR-REVISION-01 (owner GO 2026-10-24), over HTTP, STAGING ONLY.
 *
 * The owner's first Stage 4 acceptance journey, on the Stage 2-3 respiratory materials, with REAL capabilities --
 * no mocked answer anywhere:
 *   R1  open Revision                                   R2  start a recommended session (Today's Revision)
 *   R3  select the respiratory materials                R4  ten competency-linked questions (reuse first, then written)
 *   R5  answer them, with feedback that says how it was marked
 *   R6  source-grounded explanations (each quote is in the student's own section)
 *   R7  the difficult concepts identified (missed again and again)
 *   R8  Teach Me for clarification, with the way back   R9  return to the same session, same place
 *   R10 flashcards and spaced repetition (the 391 review log grows, the card is rescheduled)
 *   R11 recall history and progress                     R12 repeat saved questions with no new generation
 *   R13 continue revision after the AI allowance is exhausted (the Individual quota, synthetic usage rows for THIS
 *       fixture only; the metering-ON variant needs metering switched on for the run and is PEND otherwise)
 *   R14 complete revision without an assigned competency catalogue
 *   M   mock practice holds its feedback to the end      S  a short answer that matches nothing is never marked
 *       wrong by default: AI evaluation (labelled) or the student's own judgement
 *   I   isolation: another student reaches none of it    E  erase-all leaves no set or session
 *
 * ⚠ NEEDS a dev server pointed at STAGING (BASE_URL) with individual_app ON, the staging-test legal versions and URLs
 * (AI consent), an AI provider, migrations 406-409, 414-417, and the viewing programme with its catalogues. It READS
 * shared configuration and never writes it. Fixtures: harness-revision01-* identities, deleted at the start and end.
 *
 * ⚠ STAGING ONLY: npx tsx scripts/privileged-harnesses.ts --staging --only scholar-revision01
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { getAiStanding } from "../src/lib/ai/allowance";
import { BUCKET, DOCX_MIME, PDF_MIME, PPTX_MIME, TEXT_MIME, uploadRules } from "../src/lib/individual/scholar/config";
import { loadJoinOptions } from "../src/lib/individual/scholar/context";
import { tinyDocx, tinyPdf, tinyPptx } from "../src/lib/individual/scholar/test-documents";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-revision01-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const note = (s: string) => console.log(`        ${s}`);

const FIX = { grantor: "harness-revision01-grantor@competen.test", a: "harness-revision01-a@competen.test", b: "harness-revision01-b@competen.test" };
const PW = `revision01-${Math.random().toString(36).slice(2)}-Aa1!`;
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};

// The Stage 2 respiratory materials (as scholar-learn01-harness uses them).
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
    for (const t of ["individual_scholar_revision_session", "individual_scholar_revision_set", "individual_scholar_learning_session", "individual_scholar_learning_preference",
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
/** Start a revision session. A provider failure (502) is retried once and reported -- never counted as a pass. */
async function start(jar: Jar, body: Record<string, unknown>) {
  let r = await send("POST", "/api/individual/scholar/revision/sessions", body, jar, { "x-request-id": `rev01-${Math.random().toString(36).slice(2, 12)}` });
  if (r.status === 502) { note(`start ${String(body.mode)}: provider failure 502 -- retrying once`); r = await send("POST", "/api/individual/scholar/revision/sessions", body, jar); }
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

async function main() {
  console.log(`SCHOLAR REVISION-01 HARNESS -- target ${ref}, server ${BASE}\n`);
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  if (!live) { console.log(`  PEND  no dev server at ${BASE}. Nothing created.`); return; }
  const m416 = !(await admin.from("individual_scholar_question").select("answer").limit(0)).error;
  const m417 = !(await admin.from("individual_scholar_revision_session").select("id").limit(0)).error;
  note(`migrations here: 416 ${m416} · 417 ${m417}`);
  if (!m416 || !m417) { pend("R1-R14", "416 and 417 must be applied on this environment"); return; }

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
  note(`programme for A: ${programme?.code ?? "none"} · B has none · formats ${policy.scholarRevisionFormats.join(",")} · modes ${policy.scholarRevisionModes.join(",")} · generation ${policy.scholarRevisionGeneration}`);

  const consentA = await send("POST", "/api/individual/scholar/consent", { grant: true }, sa.jar);
  const consentB = await send("POST", "/api/individual/scholar/consent", { grant: true }, sb.jar);
  if (consentA.status !== 200 || consentB.status !== 200) { pend("R1-R14", `AI consent could not be given here (${consentA.status}/${consentB.status} ${consentA.json?.error ?? ""})`); return; }
  const pptxOn = rules.mimes.includes(PPTX_MIME as any);
  const ids = {
    anatomy: await upload(sa.jar, PDF_MIME, tinyPdf(ANATOMY as any), "Respiratory anatomy notes.pdf"),
    pneumonia: pptxOn ? await upload(sa.jar, PPTX_MIME, await tinyPptx(PNEUMONIA), "Pneumonia lecture.pptx")
      : await upload(sa.jar, TEXT_MIME, new TextEncoder().encode(PNEUMONIA.flatMap(s => s.text).join("\n")), "Pneumonia lecture.txt"),
    oxygen: await upload(sa.jar, DOCX_MIME, await tinyDocx(OXYGEN), "Oxygen therapy notes.docx"),
  };
  const docs = Object.values(ids).filter((x): x is string => !!x);
  for (const id of docs) await analyseAll(sa.jar, id);
  const linked = (await admin.from("individual_scholar_competency_map").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0;
  note(`materials: ${docs.length} uploaded and analysed · competency links proposed: ${linked}`);

  // ── R1: open Revision ──
  const page = await get("/individual/scholar/study/revise", sa.jar);
  ok("R1. Revision opens: Start Today's Revision, the modes, saved sets, the cards due and how revision is going",
    page.status === 200 && ["Start Today's Revision", "Quick practice", "Weak areas", "Mock practice", "Saved revision sets", "Review cards due", "How your revision is going"].every(s => page.text.includes(s)),
    `${page.status}`);

  // ── R3/R4: the respiratory materials, ten questions ──
  const genBefore = (await admin.from("audit_log").select("id", { count: "exact" }).eq("actor_id", a).eq("entity_type", "individual_scholar_revision_generate").limit(1)).count ?? 0;
  const quick = await start(sa.jar, { mode: "quick", scope: { kind: "documents", materialIds: docs }, quantity: 10, formats: policy.scholarRevisionFormats });
  const sid = quick.json?.session?.id as string | undefined;
  const items: any[] = quick.json?.items ?? [];
  ok("R3. the respiratory materials start one revision session, kept for resuming", quick.status === 200 && !!sid, `${quick.status} ${quick.json?.error ?? quick.json?.note ?? ""}`);
  const qRows = items.length ? ((await admin.from("individual_scholar_question").select("id, kind, chunk_id, competency_id, review_status, source_quote, material_id").eq("user_id", a).in("id", items.map(i => i.id))).data ?? []) as any[] : [];
  const kinds = new Set(qRows.map(q => q.kind));
  ok("R4. ten questions from the notes, in several formats, written for the shortfall and stored private formative, linked to a competency where the section is",
    items.length === 10 && kinds.size >= 3 && qRows.every(q => q.review_status === "private_formative") && new Set(items.map(i => i.materialId)).size >= 2,
    `${items.length} items · kinds ${[...kinds].join(",")} · generated ${quick.json?.generated} · linked ${qRows.filter(q => q.competency_id).length}`);
  note(`competency-linked: ${qRows.filter(q => q.competency_id).length} of ${qRows.length} (the rest have no accepted or proposed link on their section)`);
  const gens = ((await admin.from("audit_log").select("new_value").eq("actor_id", a).eq("entity_type", "individual_scholar_revision_generate").order("created_at")).data ?? []) as any[];
  note(`generation calls: ${gens.map(g => `${g.new_value.kind}x${g.new_value.asked}=>${g.new_value.outcome}`).join(" · ")}`);
  ok("R4b. ⚠ no question reaches the browser with its key, rationale or source quote", items.every(i => !("answer" in i) && !("rationale" in i) && !("sourceQuote" in i) && !("correctIndex" in i)));

  // ── R5/R6: answer, with feedback; the explanations are grounded ──
  const fbs: any[] = [];
  const wrongIds: string[] = [];
  for (const [n, item] of items.entries()) {
    const wrong = n < 2 ? await wrongResponse(a, item.id) : null;
    const response = wrong ?? await rightResponse(a, item.id);
    if (item.kind === "flashcard") await send("POST", "/api/individual/scholar/revision/answer", { questionId: item.id, sessionId: sid, reveal: true }, sa.jar);
    const r = await send("POST", "/api/individual/scholar/revision/answer", { questionId: item.id, sessionId: sid, response }, sa.jar);
    if (wrong) wrongIds.push(item.id);
    fbs.push({ item, r });
  }
  const answered = fbs.filter(f => f.r.status === 200 && f.r.json?.feedback);
  ok("R5. every answer is recorded with immediate feedback that says how it was marked", answered.length === items.length && answered.every(f => typeof f.r.json.feedback.markingLabel === "string"),
    `${answered.length}/${items.length} ${fbs.filter(f => f.r.status !== 200).map(f => `${f.item.kind}:${f.r.status}:${f.r.json?.error ?? ""}`).join(" ")}`);
  const quotes = await Promise.all(answered.map(async f => {
    const c = ((await admin.from("individual_scholar_chunk").select("content").eq("user_id", a).eq("id", f.r.json.feedback.source.chunkId).maybeSingle()).data) as any;
    return !!c && c.content.replace(/\s+/g, " ").toLowerCase().includes(f.r.json.feedback.source.quote.replace(/\s+/g, " ").toLowerCase());
  }));
  ok("R6. each explanation is source-grounded: a rationale, and a quote found word for word in the student's own section", quotes.length > 0 && quotes.every(Boolean) && answered.every(f => f.r.json.feedback.rationale));
  ok("R5b. the two wrong answers are marked wrong by code and become review cards", wrongIds.length === 2 && fbs.filter(f => wrongIds.includes(f.item.id)).every(f => f.r.json?.feedback?.correct === false && ["created", "reset", "reviewed"].includes(f.r.json?.feedback?.card)),
    JSON.stringify(fbs.filter(f => wrongIds.includes(f.item.id)).map(f => f.r.json?.feedback?.card)));

  // ── R9: return to the same session ──
  const resumed = sid ? await send("GET", `/api/individual/scholar/revision/sessions/${sid}`, undefined, sa.jar) : null;
  ok("R9. the session comes back the same: its questions in order, every answer kept, the position where it was left",
    resumed?.status === 200 && resumed.json.items.map((i: any) => i.id).join() === items.map(i => i.id).join() && resumed.json.answered.length === answered.length && resumed.json.session.position === answered.length,
    `${resumed?.status} pos ${resumed?.json?.session?.position}`);

  // ── R7/R8: difficult concepts, Teach Me, and the way back ──
  const weak = await start(sa.jar, { mode: "weak" });
  const weakIds = (weak.json?.items ?? []).map((i: any) => i.id);
  ok("R7a. Weak areas offers exactly what was missed, with no new questions written", weak.status === 200 && wrongIds.every(id => weakIds.includes(id)) && weak.json?.generated === 0, `${weak.status} ${weakIds.length}`);
  for (const id of wrongIds) { const resp = await wrongResponse(a, id); await send("POST", "/api/individual/scholar/revision/answer", { questionId: id, sessionId: weak.json?.session?.id, response: resp }, sa.jar); }
  const page2 = await get("/individual/scholar/study/revise", sa.jar);
  const hard = items.find(i => i.id === wrongIds[0]);
  ok("R7. the difficult concepts are identified: what was missed twice is listed, with Teach me this", page2.status === 200 && page2.text.includes("What you keep missing") && page2.text.includes("missed 2 times") && !!hard && page2.text.includes(`study/learn?section=${hard.chunkId}`));
  const learn = hard ? await get(`/individual/scholar/study/learn?section=${hard.chunkId}&revision=${sid}`, sa.jar) : null;
  const teach = hard ? await send("POST", "/api/individual/scholar/learn/act", { action: "teach", step: 0, chunkIds: [hard.chunkId] }, sa.jar) : null;
  ok("R8. Teach Me opens on the missed concept's own section, with the way back to the same revision session, and teaches from the notes",
    learn?.status === 200 && learn.text.includes("Back to your revision") && learn.text.includes(`study/revise?session=${sid}`) && teach?.status === 200 && (/\[S\d+\]/.test(teach.json?.answer ?? "") || !!teach.json?.withheld || !!teach.json?.continuity),
    `${learn?.status} · teach ${teach?.status} ${teach?.json?.answer ? "answered" : teach?.json?.message ?? teach?.json?.error ?? ""}`);

  // ── R10: flashcards and spaced repetition ──
  const reviewsBefore = (await admin.from("individual_scholar_review").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0;
  const fl = await start(sa.jar, { mode: "flashcards", scope: { kind: "documents", materialIds: docs }, quantity: 3 });
  const card = (fl.json?.items ?? [])[0];
  const reveal = card ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: card.id, sessionId: fl.json?.session?.id, reveal: true }, sa.jar) : null;
  const graded = card ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: card.id, sessionId: fl.json?.session?.id, response: { quality: 4 } }, sa.jar) : null;
  const reviewsAfter = (await admin.from("individual_scholar_review").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0;
  ok("R10. flashcards: the back is shown on request, the student grades their recall, the card is rescheduled by SM-2 and the review is logged (391)",
    fl.status === 200 && card?.kind === "flashcard" && !!reveal?.json?.back && graded?.status === 200 && graded.json?.feedback?.card === "reviewed" && !!graded.json?.feedback?.nextReviewAt && reviewsAfter > reviewsBefore && graded.json.feedback.marking === "self_graded",
    `${fl.status} ${card?.kind} · graded ${graded?.status} ${graded?.json?.feedback?.card} · reviews ${reviewsBefore}->${reviewsAfter}`);
  const spaced = await start(sa.jar, { mode: "spaced" });
  ok("R10b. spaced revision offers the cards due, writes nothing new", spaced.status === 200 ? spaced.json.generated === 0 && spaced.json.items.length > 0 : spaced.status === 404, `${spaced.status} ${spaced.json?.items?.length ?? spaced.json?.error}`);

  // ── R11: recall history and progress ──
  const page3 = await get("/individual/scholar/study/revise", sa.jar);
  const prog = await get("/individual/scholar/study/progress", sa.jar);
  ok("R11. recall history and progress: reviews counted, recall measured or said why not, materials revised, how answers were marked; Progress opens",
    page3.status === 200 && /Reviews, last \d+ days/.test(page3.text) && page3.text.includes("Recall over six weeks") && /Materials revised/.test(page3.text) && page3.text.includes("by AI evaluation") && prog.status === 200);

  // ── R12: saved questions again, no new generation ──
  const saveSet = sid ? await send("POST", "/api/individual/scholar/revision/sets", { sessionId: sid, title: "Respiratory, week one" }, sa.jar) : null;
  const genMid = (await admin.from("audit_log").select("id", { count: "exact" }).eq("actor_id", a).eq("entity_type", "individual_scholar_revision_generate").limit(1)).count ?? 0;
  const aiMid = (await admin.from("plat_ai_requests").select("id", { count: "exact" }).eq("actor_id", a).limit(1)).count ?? 0;
  const replay = saveSet?.status === 200 ? await start(sa.jar, { mode: "custom", setId: saveSet.json.id }) : null;
  const genAfter = (await admin.from("audit_log").select("id", { count: "exact" }).eq("actor_id", a).eq("entity_type", "individual_scholar_revision_generate").limit(1)).count ?? 0;
  const aiAfter = (await admin.from("plat_ai_requests").select("id", { count: "exact" }).eq("actor_id", a).limit(1)).count ?? 0;
  ok("R12. a saved set replays its stored questions in order with no new generation and no AI call",
    saveSet?.status === 200 && replay?.status === 200 && replay.json.items.map((i: any) => i.id).join() === items.map(i => i.id).join() && replay.json.generated === 0 && genAfter === genMid && aiAfter === aiMid,
    `save ${saveSet?.status} · replay ${replay?.status} · generations ${genBefore}/${genMid}/${genAfter} · ai rows ${aiMid}/${aiAfter}`);
  const again = await start(sa.jar, { mode: "quick", scope: { kind: "documents", materialIds: docs }, quantity: 10, formats: policy.scholarRevisionFormats });
  ok("R12b. the same request again is filled from saved questions: nothing identical is written twice", again.status === 200 && (again.json.generated ?? 0) <= Math.max(0, 10 - items.length), `${again.status} generated ${again.json?.generated}`);

  // ── M: mock practice holds feedback; S: a short answer is never wrong by default ──
  const mock = await start(sa.jar, { mode: "mock", scope: { kind: "documents", materialIds: docs }, quantity: 4 });
  const mItem = (mock.json?.items ?? []).find((i: any) => i.kind !== "short" && i.kind !== "flashcard");
  const mAns = mItem ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: mItem.id, sessionId: mock.json.session.id, response: await rightResponse(a, mItem.id) }, sa.jar) : null;
  const mDone = mock.json?.session?.id ? await send("PATCH", `/api/individual/scholar/revision/sessions/${mock.json.session.id}`, { complete: true }, sa.jar) : null;
  ok("M1. mock practice is labelled practice, holds its feedback until the end, then gives it all", mock.status === 200 && /not an assessment/.test(mock.json?.label ?? "") && mAns?.json?.held === true && !mAns?.json?.feedback
    && mDone?.status === 200 && (mDone.json.answered ?? []).some((x: any) => x.questionId === mItem?.id && x.feedback), `${mock.status} ${mAns?.status} ${mDone?.status}`);
  const shortQ = ((await admin.from("individual_scholar_question").select("id").eq("user_id", a).eq("kind", "short").limit(1)).data ?? [])[0] as any;
  if (shortQ) {
    const s1 = await send("POST", "/api/individual/scholar/revision/answer", { questionId: shortQ.id, response: { text: "something the notes put another way" } }, sa.jar);
    const evaluated = s1.status === 200 && s1.json?.feedback?.marking === "ai_evaluation";
    const s2 = s1.json?.needsSelfGrade ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: shortQ.id, response: { text: "something the notes put another way" }, selfGrade: false }, sa.jar) : null;
    ok("S1. ⚠ a short answer that matches no stored answer is never marked wrong by code: AI evaluation (labelled) or the student's own judgement",
      evaluated ? /^AI evaluation/.test(s1.json.feedback.markingLabel) : (s1.json?.needsSelfGrade === true && (s1.json.accepted ?? []).length > 0 && s2?.json?.feedback?.marking === "self_graded"),
      `${s1.status} ${evaluated ? "ai_evaluation" : s1.json?.needsSelfGrade ? `self-grade (${s1.json.reason})` : JSON.stringify(s1.json)}`);
  } else pend("S1", "no short-answer question was written in this run");

  // ── R13: continuity with the allowance exhausted (the Individual quota, for THIS fixture only) ──
  const usage = Array.from({ length: 200 }, () => ({ actor_id: a, actor_name: "harness", action: "ai_assistant_query", entity_type: "harness_revision01_continuity", new_value: { synthetic: true } }));
  await admin.from("audit_log").insert(usage);
  const cToday = await start(sa.jar, { mode: "today" });
  const cItem = (cToday.json?.items ?? []).find((i: any) => i.kind === "mcq" || i.kind === "case" || i.kind === "match" || i.kind === "sequence" || i.kind === "mrq");
  const cAns = cItem ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: cItem.id, sessionId: cToday.json.session?.id, response: await rightResponse(a, cItem.id) }, sa.jar) : null;
  const cReplay = saveSet?.status === 200 ? await start(sa.jar, { mode: "custom", setId: saveSet.json.id }) : null;
  const cPages = await Promise.all(["/individual/scholar/study/revise", "/individual/scholar/study/saved", "/individual/scholar/study/progress", `/individual/scholar/study/${docs[0]}`].map(p => get(p, sa.jar)));
  ok("R13. with the AI allowance used up, revision carries on: Today's Revision from saved questions (saying so), deterministic marking, saved sets, history, progress and the materials all open",
    cToday.status === 200 && (cToday.json.generated ?? 0) === 0 && !!cAns && cAns.status === 200 && cAns.json?.feedback?.marking === "deterministic" && cReplay?.status === 200 && cPages.every(p => p.status === 200),
    `${cToday.status} ${cToday.json?.note ?? cToday.json?.error ?? ""} · answer ${cAns?.status} · replay ${cReplay?.status} · pages ${cPages.map(p => p.status)}`);
  await admin.from("audit_log").delete().eq("actor_id", a).eq("entity_type", "harness_revision01_continuity");
  // ── R13m: the same with the Holdings allowance ON (the owner switches it: scripts/staging-ai-fair-use-switch.ts) ──
  if (process.env.METERED !== "1") pend("R13-metered", "the metering-ON variant needs metering switched on for the run: the owner's --on, then this harness with METERED=1, then --off");
  else {
    const standing = await getAiStanding(admin, { userId: a, product: "scholar" });
    note(`metered standing: metered ${standing.metered} · level ${standing.level} · questions ${JSON.stringify(standing.activities?.questions ?? null)} · evaluate ${JSON.stringify(standing.activities?.evaluate ?? null)}`);
    const mToday = await start(sa.jar, { mode: "today" });
    const mShort = shortQ ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: shortQ.id, response: { text: "said another way entirely" } }, sa.jar) : null;
    const mItem = (mToday.json?.items ?? []).find((i: any) => ["mcq", "case", "mrq", "match", "sequence"].includes(i.kind));
    const mAns = mItem ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: mItem.id, sessionId: mToday.json.session?.id, response: await rightResponse(a, mItem.id) }, sa.jar) : null;
    const mReplay = saveSet?.status === 200 ? await start(sa.jar, { mode: "custom", setId: saveSet.json.id }) : null;
    const questionsOpen = standing.activities?.questions?.available === true;
    ok("R13m. with metering ON, revision carries on from what is stored: Today's Revision from saved questions (new questions only if the allowance allows them), code marking, a short answer falling back to the student's own judgement when AI evaluation is refused, saved sets",
      standing.metered === true && mToday.status === 200 && (questionsOpen || (mToday.json.generated ?? 0) === 0) && mAns?.status === 200 && mAns.json?.feedback?.marking === "deterministic"
        && (!mShort || mShort.json?.needsSelfGrade === true || mShort.json?.feedback?.marking === "ai_evaluation") && mReplay?.status === 200,
      `metered ${standing.metered} · today ${mToday.status} gen ${mToday.json?.generated} ${mToday.json?.note ?? ""} · short ${mShort?.status} ${mShort?.json?.reason ?? mShort?.json?.feedback?.marking ?? ""} · answer ${mAns?.status} · replay ${mReplay?.status}`);
  }

  // ── R14: no competency catalogue ──
  const bDoc = await upload(sb.jar, DOCX_MIME, await tinyDocx(OXYGEN), "Oxygen therapy notes.docx");
  const bStart = bDoc ? await start(sb.jar, { mode: "quick", scope: { kind: "document", materialId: bDoc }, quantity: 4 }) : null;
  const bItem = (bStart?.json?.items ?? []).find((i: any) => i.kind !== "short");
  const bAns = bItem ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: bItem.id, sessionId: bStart!.json.session?.id, response: await rightResponse(b, bItem.id) }, sb.jar) : null;
  const bPage = await get("/individual/scholar/study/revise", sb.jar);
  ok("R14. without a competency catalogue revision works end to end: questions written from the notes, answered and marked, and the workspace says competency activity is not measured",
    bStart?.status === 200 && (bStart.json.items ?? []).length > 0 && bAns?.status === 200 && bPage.status === 200 && bPage.text.includes("Revision works without a catalogue"),
    `${bStart?.status} ${bStart?.json?.error ?? ""} · ${bAns?.status}`);

  // ── I: isolation ──
  const iGet = sid ? await send("GET", `/api/individual/scholar/revision/sessions/${sid}`, undefined, sb.jar) : { status: 404 };
  const iAns = items[2] ? await send("POST", "/api/individual/scholar/revision/answer", { questionId: items[2].id, response: { index: 0 } }, sb.jar) : { status: 404 };
  const iSet = saveSet?.status === 200 ? await start(sb.jar, { mode: "custom", setId: saveSet.json.id }) : { status: 404 };
  const iPage = sid ? await get(`/individual/scholar/study/revise?session=${sid}`, sb.jar) : { status: 200, text: "could not be found" };
  ok("I1. ⚠ another student reaches none of it: the session, a question, a saved set, the session page -- all not found",
    iGet.status === 404 && iAns.status === 404 && iSet.status === 404 && iPage.text.includes("could not be found"), `${iGet.status}/${iAns.status}/${iSet.status}`);

  // ── E: erase-all ──
  const erase = await send("POST", "/api/individual/scholar/erase", { confirm: "ERASE" }, sa.jar);
  const left = {
    sets: (await admin.from("individual_scholar_revision_set").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0,
    sessions: (await admin.from("individual_scholar_revision_session").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0,
    questions: (await admin.from("individual_scholar_question").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? 0,
  };
  ok("E1. erase-all leaves no revision set, session or question", erase.status === 200 && left.sets === 0 && left.sessions === 0 && left.questions === 0, `${erase.status} ${JSON.stringify(left)}`);
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
