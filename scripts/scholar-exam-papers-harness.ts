/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR EXAM PAPERS HARNESS -- COMPETEN-SCHOLAR-EXAM-PAPERS-01 (migration 570), over HTTP, STAGING ONLY.
 *
 *   P  a pasted-text practice paper is prepared: the attestation is required, the structure is read as printed
 *      (instructions, sections, numbers, options, marks, parts), nothing is guessed (a numbering gap is flagged),
 *      and preparing again is idempotent
 *   I  isolation: another student cannot read the paper page, answer its questions, follow up, revise or delete
 *   A  with AI consent: attempt first, then a suggested answer citing the student's own notes (never the paper),
 *      exam context kept apart from current guidance, web research reported OFF (the default), the answer saved
 *      with the attempt beside it; a follow-up answered from the same evidence and not stored
 *   R  the answer becomes a flashcard in revision, once (idempotent)
 *   E  deleting an answer, then the paper, removes them and keeps the material and the revision card
 *   Z  fixtures removed
 *
 * Reads shared configuration and never writes it (policy, flags). Real AI for group A, when this environment has
 * a provider and the consent documents are published; otherwise group A is PEND with the reason.
 *
 * ⚠ STAGING ONLY: BASE_URL=<staging-pointed dev server> npx tsx scripts/scholar-exam-papers-harness.ts
 * ⚠ NEEDS migration 570 on that database (PEND without it).
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { BUCKET, TEXT_MIME } from "../src/lib/individual/scholar/config";

loadEnvConfig(process.cwd(), true);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-exam-papers-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.BASE_URL ?? "http://localhost:3117";

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);

const FIX = { grantor: "harness-exam-grantor@competen.test", a: "harness-exam-a@competen.test", b: "harness-exam-b@competen.test" };
const PW = `exam-${Math.random().toString(36).slice(2)}-Aa1!`;
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};

const PAPER = [
  "Diploma in Nursing: Practice Examination",
  "Instructions to candidates",
  "1. Answer ALL questions.",
  "Section A: Multiple choice",
  "1. Over what period should the adult respiratory rate be counted?",
  "A. 10 seconds",
  "B. 15 seconds",
  "C. A full minute",
  "D. 5 seconds",
  "2. Which finding shows hypoxaemia?",
  "A. A low oxygen saturation",
  "B. A raised temperature",
  "C. A slow pulse",
  "D. Warm hands",
  "Section B: Structured questions",
  "4. Describe how you would assess a breathless adult. [6 marks]",
  "(a) List what you would observe.",
  "(b) Explain why the oxygen saturation matters.",
].join("\n");
const NOTES = [
  "Respiratory assessment notes.",
  "Count the respiratory rate for a full minute.",
  "A low oxygen saturation shows hypoxaemia.",
  "Observe the work of breathing, colour and the use of accessory muscles.",
].join("\n");

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
    for (const t of ["individual_scholar_exam_answer", "individual_scholar_exam_question", "individual_scholar_exam_paper", "individual_scholar_revision_session", "individual_scholar_learning_session",
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
async function get(path: string, jar: Jar) {
  const res = await fetch(BASE + path, { redirect: "manual", headers: { Cookie: cookieHeader(jar) } });
  absorb(jar, res);
  return { status: res.status, text: res.status === 200 ? (await res.text()).replace(/<!-- -->/g, "").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&") : "" };
}
async function send(method: string, path: string, body: unknown, jar: Jar) {
  const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar) }, body: body === undefined ? undefined : JSON.stringify(body) });
  absorb(jar, res);
  return { status: res.status, json: await res.json().catch(() => ({})) as any };
}
async function signIn(email: string) { const jar: Jar = new Map(); const r = await send("POST", "/api/auth/login", { email, password: PW }, jar); return { jar, status: r.status }; }
async function uploadText(jar: Jar, text: string, fileName: string) {
  const bytes = new TextEncoder().encode(text);
  const slot = await send("POST", "/api/individual/scholar/uploads", { mime: TEXT_MIME, size: bytes.byteLength, piiAttested: true }, jar);
  if (slot.status !== 200) return { id: null, why: `slot ${slot.status} ${slot.json.error ?? ""}` };
  const put = await createClient(url!, anonKey!, { auth: { persistSession: false } }).storage.from(slot.json.bucket).uploadToSignedUrl(slot.json.path, slot.json.token, bytes, { contentType: TEXT_MIME });
  if (put.error) return { id: null, why: "storage" };
  const done = await send("POST", "/api/individual/scholar/materials", { uploadId: slot.json.uploadId, mime: TEXT_MIME, fileName, piiAttested: true }, jar);
  return done.status === 200 ? { id: done.json.id as string, why: "" } : { id: null, why: `materials ${done.status} ${done.json.error ?? ""}` };
}

async function main() {
  console.log(`SCHOLAR EXAM PAPERS -- target ${ref}, server ${BASE}\n`);
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  if (!live) { console.log(`  PEND  no dev server at ${BASE}. Nothing created.`); return; }
  const probe = await admin.from("individual_scholar_exam_paper").select("material_id").limit(1);
  if (probe.error) { pend("P-Z", "migration 570 is not applied on this database"); return; }

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
  const sa = await signIn(FIX.a), sb = await signIn(FIX.b);
  ok("0. two fixture students sign in", sa.status === 200 && sb.status === 200, `${sa.status}/${sb.status}`);

  // ── P. preparing a paper ──
  const paper = await uploadText(sa.jar, PAPER, "Practice paper.txt");
  const notes = await uploadText(sa.jar, NOTES, "Respiratory notes.txt");
  ok("P0. the paper and the student's notes are uploaded as ordinary materials", !!paper.id && !!notes.id, `${paper.why} ${notes.why}`);
  if (!paper.id || !notes.id) { await cleanup(); return finish(); }
  const unattested = await send("POST", "/api/individual/scholar/papers", { materialId: paper.id, attested: false }, sa.jar);
  ok("P1. preparing without the practice-paper attestation is refused", unattested.status === 400, `${unattested.status}`);
  const prep = await send("POST", "/api/individual/scholar/papers", { materialId: paper.id, attested: true }, sa.jar);
  ok("P2. preparing with it reads the paper's questions (no AI)", prep.status === 201 && prep.json.questions >= 5, `${prep.status} ${JSON.stringify(prep.json).slice(0, 200)}`);
  const qs = ((await admin.from("individual_scholar_exam_question").select("id, number, section, options, marks, flags, chunk_id, source").eq("user_id", a).eq("material_id", paper.id).order("ordinal")).data ?? []) as any[];
  const byNo = new Map(qs.map(q => [q.number, q]));
  ok("P3. numbers, sections, options and marks are kept as printed",
    byNo.get("1")?.options?.length === 4 && byNo.get("1")?.section === "Section A: Multiple choice" && byNo.get("4")?.marks === 6 && byNo.has("4(a)") && byNo.has("4(b)") && byNo.get("1")?.chunk_id && byNo.get("1")?.source === "text_layer",
    [...byNo.keys()].join(","));
  const flags = ((await admin.from("individual_scholar_exam_paper").select("flags, attestation_version").eq("user_id", a).eq("material_id", paper.id).maybeSingle()).data as any);
  ok("P4. nothing is guessed: the missing question 3 is flagged, and the attestation is kept by version",
    (flags?.flags ?? []).some((f: any) => f.kind === "numbering_gap" && f.missing === "3") && flags?.attestation_version === "exam-practice-v1", JSON.stringify(flags));
  const again = await send("POST", "/api/individual/scholar/papers", { materialId: paper.id, attested: true }, sa.jar);
  ok("P5. preparing again is idempotent", again.status === 200 && again.json.existing === true, `${again.status}`);
  const pg = await get(`/individual/scholar/study/apply/papers/${paper.id}`, sa.jar);
  ok("P6. the paper page shows its questions, what was flagged, and the formative and live-examination notices",
    pg.status === 200 && pg.text.includes("Over what period should the adult respiratory rate be counted?") && pg.text.includes("No question 3 was found")
      && pg.text.includes("not an answer key") && pg.text.includes("Do not use it during a live examination"), `${pg.status}`);

  // ── I. isolation ──
  const q1 = byNo.get("1");
  const other = await get(`/individual/scholar/study/apply/papers/${paper.id}`, sb.jar);
  const otherAnswer = await send("POST", "/api/individual/scholar/papers/answer", { questionId: q1?.id }, sb.jar);
  const otherDelete = await send("DELETE", `/api/individual/scholar/papers/${paper.id}`, undefined, sb.jar);
  const stillThere = ((await admin.from("individual_scholar_exam_paper").select("material_id").eq("user_id", a).eq("material_id", paper.id)).data ?? []).length === 1;
  ok("I1. another student gets 404 for the paper page and its questions, and cannot delete it",
    other.status === 404 && otherAnswer.status === 404 && otherDelete.status === 404 && stillThere, `page ${other.status}, answer ${otherAnswer.status}, delete ${otherDelete.status}, kept ${stillThere}`);

  // ── A. a suggested answer ──
  const consent = await send("POST", "/api/individual/scholar/consent", { grant: true }, sa.jar);
  let answerId: string | null = null;
  if (consent.status !== 200) pend("A1-A4", `AI consent could not be given here (${consent.status} ${consent.json.error ?? ""}) -- the consent documents are not published on this server`);
  else {
    const r = await send("POST", "/api/individual/scholar/papers/answer", { questionId: q1.id, attempt: { option: "C", text: "You count for a whole minute." } }, sa.jar);
    if (r.status !== 200 || (!r.json.content && !r.json.withheld && !r.json.noEvidence)) pend("A1-A4", `no answer here (${r.status} ${r.json.error ?? ""})`);
    else if (r.json.withheld) { ok("A1. an answer that fails its check is withheld with the reason, and its evidence shown", !!r.json.message && Array.isArray(r.json.evidence), r.json.reason); pend("A2-A4", `withheld this run (${r.json.reason})`); }
    else {
      const ev = (r.json.evidence ?? []) as any[];
      ok("A1. the suggested answer cites the student's own notes, never the paper itself",
        ev.some(e => e.kind === "notes" && e.materialId === notes.id) && !ev.some(e => e.materialId === paper.id) && (r.json.content.cited ?? []).length > 0, JSON.stringify(ev.map(e => [e.tag, e.kind, e.materialId])));
      ok("A2. exam context is kept apart from current guidance, and web research is reported off by default",
        typeof r.json.content.examAnswer === "string" && ["agrees", "differs", "no_current_source", "not_applicable"].includes(r.json.content.guidanceStatus) && r.json.research?.web?.state === "off",
        `${r.json.content.guidanceStatus} / ${r.json.research?.web?.state}`);
      answerId = r.json.id;
      const row = ((await admin.from("individual_scholar_exam_answer").select("attempt, review_status, kind").eq("user_id", a).eq("id", answerId).maybeSingle()).data as any);
      ok("A3. it is saved, private formative, with the student's attempt beside it", row?.review_status === "private_formative" && row?.attempt?.option === "C" && row?.kind === "answer", JSON.stringify(row));
      const fu = await send("POST", "/api/individual/scholar/papers/follow-up", { answerId, ask: "Why not 15 seconds?" }, sa.jar);
      const otherFu = await send("POST", "/api/individual/scholar/papers/follow-up", { answerId, ask: "Why?" }, sb.jar);
      ok("A4. a follow-up is answered from the same evidence (or withheld with the reason); another student gets 404",
        fu.status === 200 && (typeof fu.json.text === "string" || !!fu.json.message) && otherFu.status === 404, `${fu.status} / ${otherFu.status}`);
    }
  }

  // ── R. into revision ──
  if (answerId) {
    const r1 = await send("POST", `/api/individual/scholar/papers/answers/${answerId}`, undefined, sa.jar);
    const r2 = await send("POST", `/api/individual/scholar/papers/answers/${answerId}`, undefined, sa.jar);
    const card = ((await admin.from("individual_scholar_card").select("id").eq("user_id", a).eq("question_id", r1.json.revisionQuestionId)).data ?? []).length;
    const otherRev = await send("POST", `/api/individual/scholar/papers/answers/${answerId}`, undefined, sb.jar);
    ok("R1. the answer becomes one flashcard due on the revision schedule, once; another student gets 404",
      r1.status === 201 && r2.status === 200 && r2.json.existing === true && card === 1 && otherRev.status === 404, `${r1.status}/${r2.status}/${card}/${otherRev.status}`);
  } else pend("R1", "no saved answer this run");

  // ── E. deleting ──
  if (answerId) {
    const del = await send("DELETE", `/api/individual/scholar/papers/answers/${answerId}`, undefined, sa.jar);
    ok("E1. the student deletes a saved answer", del.status === 200, `${del.status}`);
  }
  const rm = await send("DELETE", `/api/individual/scholar/papers/${paper.id}`, undefined, sa.jar);
  const left = ((await admin.from("individual_scholar_exam_question").select("id").eq("user_id", a).eq("material_id", paper.id)).data ?? []).length;
  const material = ((await admin.from("individual_scholar_material").select("id").eq("user_id", a).eq("id", paper.id)).data ?? []).length;
  const cards = ((await admin.from("individual_scholar_question").select("id").eq("user_id", a).eq("kind", "flashcard")).data ?? []).length;
  ok("E2. stopping studying it as a paper removes its questions and answers, and keeps the material and any revision card",
    rm.status === 200 && left === 0 && material === 1 && (answerId ? cards === 1 : true), `${rm.status} q:${left} m:${material} cards:${cards}`);

  await cleanup();
  const gone = await Promise.all(Object.values(FIX).map(findUser));
  ok("Z1. fixture identities, their files and their papers are gone", gone.every(u => !u));
  finish();
}

function finish() {
  console.log(`\n${fails.length ? `FAILED -- ${pass} passed, ${fails.length} failed` : `ALL GREEN -- ${pass} passed, 0 failed`}`);
  if (fails.length) process.exitCode = 1;
}

main().catch(async e => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });
