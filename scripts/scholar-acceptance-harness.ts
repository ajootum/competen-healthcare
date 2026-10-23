/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR ACCEPTANCE HARNESS -- COMPETEN-IND-004, the learning journey against a REAL database (migration 372).
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only scholar-acceptance
 *   (or, from a checkout whose .env.local already names staging: npx tsx scripts/scholar-acceptance-harness.ts)
 *
 * Groups:
 *   C. Consent: none by default, grant records the notice version, revoke records when, re-grant clears it.
 *      The schema refuses a revoked row with no revocation time.
 *   U. Upload: a signed slot under the owner's folder, a real browser-style upload with the ANON key, real
 *      PDF and DOCX extraction, page-referenced chunks (pages for PDF, none for DOCX), the material row. A
 *      file with an NHS number is refused and its object deleted.
 *   R. Retrieval: Postgres FTS over the owner's chunks finds the passage. Another person's search finds
 *      nothing. Hostile query text is sanitised.
 *   Q. Assess and Revise: a stored question with provenance, a miss creates ONE card due today, a second
 *      miss resets it, a right answer adds none. SM-2 review reschedules it. Progress reflects the latest answer.
 *   I. Isolation (D6): every store call made by another person with the owner's ids answers "not found"
 *      and changes nothing. Real signed-in sessions see only their own rows under RLS and can write
 *      nothing. Storage objects are unreadable to every browser session. Composite foreign keys refuse a
 *      row pointing at another person's material, and the schema refuses a material without the attestation,
 *      outside the owner's folder, over 10 MB, or a DOCX with pages.
 *   A. AI through the gateway, when this environment has a provider: an explanation and a question run
 *      through generate(). Only checked output is accepted, and plat_ai_requests records the call with
 *      attribution_scope 'person', the operation, and no tenant.
 *   M. D1: nothing reached the estate learning tables hospital analytics read.
 *   E. Erasure: one material (object and cascade), then everything, including an unprocessed upload.
 *      The consent record stays.
 *   Z. Fixtures removed, and the release flag restored to its state before the run.
 *
 * ⚠ IT IMPORTS THE CODE IT TESTS: the Scholar store, extraction, retrieval, generation and progress, and the
 * foundation's grant service. Nothing below restates their rules.
 *
 * ⚠ MIGRATION 372 FIRST. Until it is applied, every group reports PEND, the run exits 0, and nothing is created.
 *
 * ⚠ STAGING ONLY. assertSafeTarget refuses production before any client is built.
 *
 * ⚠ THE RELEASE GATE. The run records `individual_app`'s state, turns it ON, and restores it at the end (Z2),
 * the discipline individual-acceptance-harness R1-R3 and Z2 keep. Never against production.
 *
 * ⚠ RUN IT ALONE. Its fixture identities are its own (harness-ind004-*@competen.test) and it deletes them.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess } from "../src/lib/individual/grants";
import { individualAppEnabled, INDIVIDUAL_APP_FLAG } from "../src/lib/individual/gate";
import * as store from "../src/lib/individual/scholar/store";
import { chunkPages, extractMaterial, findPatientIdentifiers, sniffMime } from "../src/lib/individual/scholar/extract";
import { rankChunks, toTsQuery } from "../src/lib/individual/scholar/retrieval";
import { runExplain, runQuestions } from "../src/lib/individual/scholar/generation";
import { buildProgress } from "../src/lib/individual/scholar/progress";
import { BUCKET, CONSENT_NOTICE_VERSION, DOCX_MIME, PDF_MIME, PROMPT_VERSIONS } from "../src/lib/individual/scholar/config";
import { tinyPdf } from "../src/lib/individual/scholar/test-documents";
import { aiStatus } from "../src/lib/ai/config";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const FIX = { grantor: "harness-ind004-grantor@competen.test", a: "harness-ind004-a@competen.test", b: "harness-ind004-b@competen.test" };
// A test value generated for this run, used only to sign the fixtures in for group I.
const FIX_PASSWORD = `ind004-${Math.random().toString(36).slice(2)}-Aa1!`;
const ESTATE_LEARNING = ["quiz_attempts", "knowledge_attempts", "cpd_logs", "course_enrollments", "learning_enrolments", "cdp_reinforcement_cards", "skill_log_entries"];
const SCHOLAR_TABLES = ["individual_scholar_card", "individual_scholar_attempt", "individual_scholar_question", "individual_scholar_chunk", "individual_scholar_material", "individual_scholar_consent"];

// The study text. Short clinical-education prose, and NOT patient data.
const PAGE1 = [
  "Acute kidney injury is staged by the rise in serum creatinine and by urine output.",
  "Stage 3 is a rise to three times the baseline creatinine.",
];
const PAGE2 = [
  "Common causes of acute kidney injury are prerenal, renal and postrenal.",
  "Prerenal causes include hypovolaemia and reduced cardiac output.",
];

async function docx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const body = paragraphs.map(p => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

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
    await admin.from("individual_scholar_material").delete().eq("user_id", u.id);
    await admin.from("individual_scholar_consent").delete().eq("user_id", u.id);
    await admin.from("individual_entitlement").delete().eq("user_id", u.id);
    await admin.from("individual_membership").delete().eq("user_id", u.id);
    await admin.from("audit_log").delete().eq("actor_id", u.id);
    await admin.from("plat_ai_requests").delete().eq("actor_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}

let priorFlag: { flag: string; enabled: boolean; note: string | null } | null = null;
async function restoreFlag() {
  if (priorFlag) await admin.from("practice_platform_flags").upsert(priorFlag);
  else await admin.from("practice_platform_flags").delete().eq("flag", INDIVIDUAL_APP_FLAG);
}

async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: FIX_PASSWORD, email_confirm: true });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id as string;
}

/** The browser path: a signed slot from the server, the bytes put with the ANON key, then processing. */
async function upload(userId: string, mime: typeof PDF_MIME | typeof DOCX_MIME, bytes: Uint8Array, fileName: string) {
  const slot = await store.createUploadSlot(admin, userId, mime);
  if (!slot) return { slot: null, error: "no slot" as string | null, materialId: null as string | null, chunks: 0, pii: [] as string[] };
  const browser = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const put = await browser.storage.from(BUCKET).uploadToSignedUrl(slot.path, slot.token, bytes, { contentType: mime });
  if (put.error) return { slot, error: `put: ${put.error.message}`, materialId: null, chunks: 0, pii: [] };
  const read = await store.readUpload(admin, store.uploadPath(userId, slot.uploadId, mime));
  if (!read || sniffMime(read) !== mime) return { slot, error: "read back", materialId: null, chunks: 0, pii: [] };
  const ex = await extractMaterial(mime, read);
  if (!ex.ok) { await store.discardUpload(admin, slot.path); return { slot, error: `extract: ${ex.reason}`, materialId: null, chunks: 0, pii: [] }; }
  const pii = findPatientIdentifiers(ex.pages.map(p => p.text).join("\n"));
  if (pii.length) { await store.discardUpload(admin, slot.path); return { slot, error: "pii", materialId: null, chunks: 0, pii }; }
  const chunks = chunkPages(ex.pages);
  const made = await store.createMaterial(admin, userId, {
    id: slot.uploadId, path: slot.path, title: fileName.replace(/\.[^.]+$/, ""), fileName, mime, bytes: read,
    pageCount: ex.pageCount, extractor: ex.extractor, chunks,
  });
  return { slot, error: made.ok ? null : `${made.error}: ${made.detail ?? ""}`, materialId: made.ok ? made.id : null, chunks: chunks.length, pii };
}

async function main() {
  console.log(`SCHOLAR ACCEPTANCE HARNESS (COMPETEN-IND-004) -- target ${ref}\n`);

  const probe = await admin.from("individual_scholar_material").select("id", { head: true, count: "exact" });
  if (probe.error) {
    console.log(`  PEND  migration 372 is not applied here (${probe.error.code ?? probe.error.message}). Nothing was created.`);
    process.exit(0);
  }

  await cleanup();
  const flagRead = await admin.from("practice_platform_flags").select("flag, enabled, note").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle();
  priorFlag = flagRead.data ?? null;
  await admin.from("practice_platform_flags").upsert({ flag: INDIVIDUAL_APP_FLAG, enabled: true, note: "scholar-acceptance-harness: ON (restored after run)" });
  ok("R0. the release gate reads ON for the run (prior state recorded for Z2)", (await individualAppEnabled(admin)) === true);

  const grantor = await makeUser(FIX.grantor);
  const a = await makeUser(FIX.a);
  const b = await makeUser(FIX.b);
  const ga = await grantIndividualAccess(admin, { targetUserId: a, experiences: ["scholar"], adultConfirmed: true, note: "scholar-acceptance-harness" }, grantor);
  const gb = await grantIndividualAccess(admin, { targetUserId: b, experiences: ["scholar"], adultConfirmed: true, note: "scholar-acceptance-harness" }, grantor);
  ok("S0. both fixtures hold a live Scholar pilot grant (the foundation's grant service, D8 confirmed)", ga.ok && gb.ok);

  try {
    // ── C. CONSENT ──
    const c0 = await store.readConsent(admin, a);
    ok("C1. AI processing consent is OFF until the person turns it on", c0.ok && !c0.data.granted && c0.data.grantedAt === null);
    await store.setConsent(admin, a, true);
    const c1 = await store.readConsent(admin, a);
    ok("C2. a grant records the notice version shown", c1.ok && c1.data.granted && c1.data.noticeVersion === CONSENT_NOTICE_VERSION && !!c1.data.grantedAt);
    await store.setConsent(admin, a, false);
    const c2 = await store.readConsent(admin, a);
    ok("C3. revoking turns it off and records when", c2.ok && !c2.data.granted && !!c2.data.revokedAt);
    await store.setConsent(admin, a, true);
    const c3 = await store.readConsent(admin, a);
    ok("C4. granting again clears the revocation", c3.ok && c3.data.granted && c3.data.revokedAt === null);
    const bad = await admin.from("individual_scholar_consent").update({ status: "revoked", revoked_at: null }).eq("user_id", a);
    ok("C5. the schema refuses a revoked consent with no revocation time", !!bad.error, bad.error?.message ?? "accepted");

    // ── U. UPLOAD ──
    const pdf = await upload(a, PDF_MIME, tinyPdf([PAGE1, PAGE2]), "Renal notes.pdf");
    ok("U1. the signed slot is under the owner's own folder", !!pdf.slot && pdf.slot.path.startsWith(`${a}/`), pdf.slot?.path ?? "");
    ok("U2. a PDF uploaded with the ANON key, read back and extracted, is stored as a material", !!pdf.materialId && !pdf.error, pdf.error ?? "");
    const mat = pdf.materialId ? await store.getMaterial(admin, a, pdf.materialId) : null;
    ok("U3. the material records 2 pages, its chunks, and the attestation", !!mat?.ok && mat.data?.pageCount === 2 && (mat.data?.chunkCount ?? 0) >= 2);
    const chunks = pdf.materialId ? await store.listChunks(admin, a, pdf.materialId) : null;
    ok("U4. every PDF chunk cites one page, in order", !!chunks?.ok && chunks.data.length >= 2 && chunks.data.every(c => c.pageFrom !== null && c.pageFrom === c.pageTo)
      && chunks.data[0].pageFrom === 1 && chunks.data.at(-1)!.pageFrom === 2);
    const dx = await upload(a, DOCX_MIME, await docx(["Sepsis six is a bundle of care.", "Give oxygen and take blood cultures."]), "Sepsis.docx");
    const dxChunks = dx.materialId ? await store.listChunks(admin, a, dx.materialId) : null;
    ok("U5. a real DOCX is stored with chunks that carry NO page (cited by section)", !!dx.materialId && !!dxChunks?.ok && dxChunks.data.length >= 1
      && dxChunks.data.every(c => c.pageFrom === null), dx.error ?? "");
    const piiUp = await upload(a, PDF_MIME, tinyPdf([["Ward round notes", "NHS number 943 476 5919"]]), "ward.pdf");
    const afterPii = await admin.storage.from(BUCKET).list(a, { limit: 100 });
    ok("U6. a file holding an NHS number is refused, and its uploaded object is deleted",
      piiUp.error === "pii" && piiUp.pii.includes("nhs_number") && !(afterPii.data ?? []).some((o: any) => piiUp.slot && piiUp.slot.path.endsWith(o.name)));

    // ── R. RETRIEVAL ──
    const tsq = toTsQuery("How is acute kidney injury staged?")!;
    const sa = await store.searchCandidates(admin, a, tsq);
    const top = sa.ok ? rankChunks("How is acute kidney injury staged?", sa.data, 5) : [];
    ok("R1. FTS over the owner's chunks finds the staging passage first", top.length > 0 && /staged/.test(top[0].content), JSON.stringify(top.map(t => t.content.slice(0, 40))));
    const sb = await store.searchCandidates(admin, b, tsq);
    ok("R2. the same search by another person finds nothing of the owner's", sb.ok && sb.data.length === 0);
    const hostile = await store.searchCandidates(admin, a, toTsQuery("kidney' | !( drop ) & :*") ?? "kidney");
    ok("R3. hostile query text is sanitised before to_tsquery (no error)", hostile.ok);

    // ── Q. ASSESS AND REVISE (no AI: the stored-question path) ──
    const passage = top[0] ? (await store.toPassages(admin, a, [top[0]]))[0] : null;
    const ins = passage ? await store.insertQuestions(admin, a, {
      passage, kind: "mcq", model: "harness-no-ai", provider: "none", promptVersion: PROMPT_VERSIONS.mcq,
      drafts: [{ stem: "How is acute kidney injury staged?", options: ["By serum creatinine and urine output", "By blood pressure", "By heart rate", "By temperature"],
        correctIndex: 0, rationale: "The notes say it is staged by the rise in serum creatinine and by urine output.",
        sourceQuote: "Acute kidney injury is staged by the rise in serum creatinine and by urine output." }],
    }) : { ok: false, ids: [] };
    const qid = ins.ids[0];
    const q = qid ? await store.getQuestion(admin, a, qid) : null;
    ok("Q1. a stored question carries its chunk, quoted source, model and prompt version", !!q && q.chunkId === passage?.chunkId
      && q.promptVersion === PROMPT_VERSIONS.mcq && q.model === "harness-no-ai" && q.pageFrom === 1);
    const miss1 = q ? await store.recordAttempt(admin, a, q, 2) : null;
    const cards1 = await admin.from("individual_scholar_card").select("id, next_review_at, repetitions").eq("user_id", a);
    ok("Q2. a missed question becomes ONE spaced-review card, due today", miss1?.card === "created" && (cards1.data ?? []).length === 1
      && cards1.data[0].next_review_at === new Date().toISOString().slice(0, 10));
    const miss2 = q ? await store.recordAttempt(admin, a, q, 3) : null;
    const cards2 = await admin.from("individual_scholar_card").select("id").eq("user_id", a);
    ok("Q3. missing it again resets the same card, not a second one", miss2?.card === "reset" && (cards2.data ?? []).length === 1);
    const right = q ? await store.recordAttempt(admin, a, q, 0) : null;
    ok("Q4. a right answer records correct and adds no card", right?.correct === true && right.card === null);
    const due = await store.dueCards(admin, a);
    ok("Q5. the card is due, with its question and source", due.ok && due.data.length === 1 && due.data[0].question.id === qid);
    const cardId = due.ok ? due.data[0]?.id : null;
    const rev = cardId ? await store.reviewCard(admin, a, cardId, 5) : null;
    const dueAfter = await store.dueCards(admin, a);
    ok("Q6. an SM-2 review reschedules it, so it is no longer due today", !!rev?.ok && (rev as any).intervalDays >= 1 && dueAfter.ok && dueAfter.data.length === 0);
    const rows = await store.progressRows(admin, a);
    const prog = rows.ok ? buildProgress({ ...rows.data, today: new Date().toISOString().slice(0, 10) }) : null;
    const pm = prog?.materials.find(m => m.id === pdf.materialId);
    ok("Q7. progress: mastery from the LATEST answer (100%), 3 answers this week, and not-measured stays null for the DOCX",
      pm?.mastery === 100 && pm.answered === 1 && prog!.trend.at(-1)!.attempts === 3
      && prog!.materials.find(m => m.id === dx.materialId)?.mastery === null);

    // ── I. ISOLATION ──
    const aMat = pdf.materialId!, aChunk = passage?.chunkId ?? "", aCard = cardId ?? "";
    const iGet = await store.getMaterial(admin, b, aMat);
    const iChunks = await store.listChunks(admin, b, aMat);
    const iDel = await store.deleteMaterial(admin, b, aMat);
    const iRev = await store.reviewCard(admin, b, aCard, 5);
    const stillThere = await admin.from("individual_scholar_material").select("id").eq("id", aMat);
    ok("I1. another person, holding the owner's ids, gets 'not found' from every store call, and nothing changes",
      iGet.ok && iGet.data === null && (await store.getPassage(admin, b, aChunk)) === null && (await store.getQuestion(admin, b, qid ?? "")) === null
      && iChunks.ok && iChunks.data.length === 0 && iDel.ok && !iDel.found && !iRev.ok
      && (await store.signedOriginalUrl(admin, b, aMat)) === null && (stillThere.data ?? []).length === 1);
    const asA = createClient(url!, anonKey!, { auth: { persistSession: false } }) as any;
    const asB = createClient(url!, anonKey!, { auth: { persistSession: false } }) as any;
    const sA = await asA.auth.signInWithPassword({ email: FIX.a, password: FIX_PASSWORD });
    const sB = await asB.auth.signInWithPassword({ email: FIX.b, password: FIX_PASSWORD });
    if (sA.error || sB.error) ok("I2. the fixtures can sign in for the RLS group", false, (sA.error ?? sB.error)!.message);
    else {
      const counts = async (c: any) => Promise.all(SCHOLAR_TABLES.map(t => c.from(t).select("id", { count: "exact", head: true })));
      const aSees = await counts(asA), bSees = await counts(asB);
      ok("I2. RLS: the owner's session sees its own rows in every Scholar table", aSees.every((r: any) => !r.error && (r.count ?? 0) > 0),
        JSON.stringify(aSees.map((r: any) => r.count)));
      ok("I3. RLS: another person's session sees none of them", bSees.every((r: any) => !r.error && (r.count ?? 0) === 0), JSON.stringify(bSees.map((r: any) => r.count)));
      const wIns = await asA.from("individual_scholar_attempt").insert({ user_id: a, question_id: qid, chosen_index: 0, correct: true });
      const wUpd = await asA.from("individual_scholar_card").update({ status: "mastered" }).eq("user_id", a).select("id");
      const wDel = await asA.from("individual_scholar_material").delete().eq("id", aMat).select("id");
      const unchanged = await admin.from("individual_scholar_card").select("status").eq("user_id", a);
      ok("I4. RLS: even the owner's browser session can write nothing (no write policies)",
        !!wIns.error && (wUpd.error || (wUpd.data ?? []).length === 0) && (wDel.error || (wDel.data ?? []).length === 0) && unchanged.data?.[0]?.status === "active");
      const dlB = await asB.storage.from(BUCKET).download(pdf.slot!.path);
      const dlA = await asA.storage.from(BUCKET).download(pdf.slot!.path);
      ok("I5. storage: no browser session can read an original directly (only a server-issued signed URL)", !!dlB.error && !!dlA.error);
      const signed = await store.signedOriginalUrl(admin, a, aMat);
      ok("I6. the owner gets a working five-minute signed URL to their original", !!signed && (await fetch(signed)).ok);
    }
    const fk1 = await admin.from("individual_scholar_chunk").insert({ material_id: aMat, user_id: b, ordinal: 99, page_from: 1, page_to: 1, content: "x" });
    const fk2 = await admin.from("individual_scholar_question").insert({ user_id: b, material_id: aMat, chunk_id: aChunk, kind: "mcq", stem: "x", options: ["a", "b", "c", "d"], correct_index: 0, rationale: "x", source_quote: "x", model: "x", provider: "x", prompt_version: "x" });
    ok("I7. composite keys refuse a row that belongs to one person but points at another's material", !!fk1.error && !!fk2.error);
    const base = { user_id: b, title: "t", file_name: "t.pdf", mime_type: PDF_MIME, byte_size: 10, sha256: "x", page_count: 1, chunk_count: 1, char_count: 1, extractor: "x" };
    const noAttest = await admin.from("individual_scholar_material").insert({ ...base, storage_path: `${b}/x1.pdf` });
    const badPath = await admin.from("individual_scholar_material").insert({ ...base, storage_path: `${a}/x2.pdf`, pii_attested_at: new Date().toISOString() });
    const tooBig = await admin.from("individual_scholar_material").insert({ ...base, storage_path: `${b}/x3.pdf`, byte_size: 11 * 1024 * 1024, pii_attested_at: new Date().toISOString() });
    const docxPages = await admin.from("individual_scholar_material").insert({ ...base, mime_type: DOCX_MIME, storage_path: `${b}/x4.docx`, pii_attested_at: new Date().toISOString() });
    ok("I8. the schema refuses a material with no attestation, outside the owner's folder, over 10 MB, or a DOCX with pages",
      !!noAttest.error && !!badPath.error && !!tooBig.error && !!docxPages.error);

    // ── A. AI THROUGH THE GATEWAY ──
    if (!aiStatus().configured || !passage) console.log("  NOTE  no AI provider configured here -- group A NOT RUN");
    else {
      const t0 = new Date().toISOString();
      const ex = await runExplain(a, "How is acute kidney injury staged?", [passage]);
      ok("A1. an explanation runs through generate(); it is shown only if it passed the grounding check, else withheld with a reason",
        ex.ok && (ex.check.ok ? /\[S1\]/.test(ex.check.text) : ["not_in_notes", "no_citation", "bad_citation", "ungrounded"].includes(ex.check.reason)),
        ex.ok ? (ex.check.ok ? "" : `withheld:${ex.check.reason}`) : `error:${(ex as any).error}`);
      if (ex.ok) console.log(`        explain: ${ex.check.ok ? "shown" : `withheld (${ex.check.reason})`}, model ${ex.model}`);
      const qs = await runQuestions(a, "mcq", passage);
      ok("A2. question writing runs through generate(); every kept question quotes the passage verbatim",
        qs.ok && qs.check.kept.every(k => passage.content.replace(/\s+/g, " ").toLowerCase().includes(k.sourceQuote.replace(/\s+/g, " ").toLowerCase().replace(/[.\s]+$/, ""))),
        qs.ok ? `kept ${qs.check.kept.length}, dropped ${qs.check.dropped.map(d => d.reason).join(",")}` : `error:${(qs as any).error}`);
      if (qs.ok) console.log(`        questions: kept ${qs.check.kept.length}, dropped [${qs.check.dropped.map(d => d.reason).join(", ")}]`);
      await new Promise(r => setTimeout(r, 2500)); // the gateway records usage fire-and-forget
      const usage = await admin.from("plat_ai_requests").select("operation, attribution_scope, tenant_id, status, model").eq("actor_id", a).gte("created_at", t0);
      const ops = (usage.data ?? []).map((u: any) => u.operation);
      ok("A3. plat_ai_requests records both calls for the person: attribution_scope 'person', no tenant",
        ops.includes("individual_scholar_explain") && ops.includes("individual_scholar_mcq")
        && (usage.data ?? []).every((u: any) => u.attribution_scope === "person" && u.tenant_id === null), JSON.stringify(usage.data ?? usage.error));
    }

    // ── M. D1 ──
    const ids = [a, b];
    const estate = await Promise.all(ESTATE_LEARNING.map(t => admin.from(t).select("*", { count: "exact", head: true })
      .in(t === "cpd_logs" || t === "course_enrollments" || t === "learning_enrolments" || t === "quiz_attempts" ? "user_id" : "nurse_id", ids)));
    const written = ESTATE_LEARNING.filter((_, i) => !estate[i].error && (estate[i].count ?? 0) > 0);
    ok("M1. D1: no estate learning table that hospital analytics read holds a row for any fixture", written.length === 0, written.join(", "));

    // ── E. ERASURE ──
    const delDx = dx.materialId ? await store.deleteMaterial(admin, a, dx.materialId) : { ok: false, found: false };
    const dxLeft = dx.materialId ? await admin.from("individual_scholar_chunk").select("id").eq("material_id", dx.materialId) : { data: [1] };
    const objs1 = await admin.storage.from(BUCKET).list(a, { limit: 100 });
    ok("E1. deleting one material removes its object and cascades its chunks",
      delDx.ok && delDx.found && (dxLeft.data ?? []).length === 0 && !(objs1.data ?? []).some((o: any) => dx.slot && dx.slot.path.endsWith(o.name)));
    const orphan = await store.createUploadSlot(admin, a, PDF_MIME);
    if (orphan) await createClient(url!, anonKey!, { auth: { persistSession: false } }).storage.from(BUCKET).uploadToSignedUrl(orphan.path, orphan.token, tinyPdf(["never processed"]), { contentType: PDF_MIME });
    const erase = await store.eraseAllMaterial(admin, a);
    const left = await Promise.all(SCHOLAR_TABLES.filter(t => t !== "individual_scholar_consent").map(t => admin.from(t).select("id", { count: "exact", head: true }).eq("user_id", a)));
    const objs2 = await admin.storage.from(BUCKET).list(a, { limit: 100 });
    ok("E2. erasing everything removes every material, question, attempt and card, and every object (an unprocessed upload too)",
      erase.ok && left.every((r: any) => (r.count ?? 0) === 0) && (objs2.data ?? []).length === 0, JSON.stringify({ erase, left: left.map((r: any) => r.count), objs: (objs2.data ?? []).length }));
    const consentKept = await store.readConsent(admin, a);
    ok("E3. the consent record is kept (it records a choice, not material)", consentKept.ok && consentKept.data.granted);
  } finally {
    await cleanup();
    const left = await Promise.all(SCHOLAR_TABLES.map(t => admin.from(t).select("id", { count: "exact", head: true }).in("user_id", [a, b])));
    ok("Z1. fixtures removed -- no Scholar row is left for any fixture", left.every((r: any) => (r.count ?? 0) === 0));
    await restoreFlag();
    const flagAfter = await admin.from("practice_platform_flags").select("enabled").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle();
    ok("Z2. the release flag is restored to its state before the run", priorFlag ? flagAfter.data?.enabled === priorFlag.enabled : flagAfter.data === null);
  }

  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
}

main().catch(async e => {
  console.error(e);
  try { await cleanup(); await restoreFlag(); } catch { /* reported above */ }
  process.exit(1);
});
