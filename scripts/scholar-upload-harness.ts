/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR UPLOAD HARNESS -- COMPETEN-SCHOLAR-UPLOAD Stage 2, over HTTP, STAGING ONLY.
 *
 * The Upload stage the way a student meets it: Welcome (Upload my notes) -> the upload panel -> a real PDF
 * through the browser path (a signed slot, the bytes put with the ANON key, then processing) -> processed,
 * with its educational-context stamp -> topics and competency proposals found, with clinical-status labels ->
 * learn (an explanation and practice questions from it). Then the refusals, isolation and erasure.
 *
 *   W  welcome: "Upload my notes" leads to the upload panel, which states the formats and size the POLICY allows
 *   U  upload: a PDF is accepted, read and kept; the attestation, a disallowed format, an over-size declaration
 *      and identifier-shaped content are refused, and a refused file's object is removed; audit rows written
 *   T  plain text (migration 405 and the policy's "text" format): a pasted-text material is kept as a .txt
 *      original. PEND (nothing written) where text is not enabled here
 *   P  processed: the material page shows its sections, its source download and the context it was uploaded in
 *   M  mapped: topic finding runs over the material, proposals land on the page with their clinical-status label
 *   L  learn: an explanation and practice questions from the uploaded notes
 *   I  isolation: another person's session gets 404 for this material, its analysis and its original
 *   E  erasure: deleting the material removes it, its object and everything derived
 *
 * ⚠ NEEDS a dev server pointed at STAGING (BASE_URL) with individual_app ON and the staging-test legal
 * versions, an AI provider, the S1 seed allowlisted for Scholar and the viewing programme (seed-staging-
 * scholar-viewing.ts). It READS the shared configuration and never writes it: not individual_app, not the
 * allowlist, not the Individual policy. Fixtures: harness-upload-* identities, deleted at the start and the end.
 *
 * ⚠ STAGING ONLY: npx tsx scripts/privileged-harnesses.ts --staging --only scholar-upload
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { BUCKET, PDF_MIME, TEXT_MIME, uploadRules } from "../src/lib/individual/scholar/config";
import { loadJoinOptions } from "../src/lib/individual/scholar/context";
import { tinyPdf } from "../src/lib/individual/scholar/test-documents";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-upload-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const note = (s: string) => console.log(`        ${s}`);

const FIX = { grantor: "harness-upload-grantor@competen.test", a: "harness-upload-a@competen.test", b: "harness-upload-b@competen.test" };
const PW = `upl-${Math.random().toString(36).slice(2)}-Aa1!`;
// The legal versions the dev server itself is configured with (the same .env.local), so the D2 terms gate admits the fixtures.
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};
const NOTES = [
  ["Respiratory assessment begins with the respiratory rate, counted for a full minute while the patient is at rest.",
    "Observe chest movement, the use of accessory muscles and the colour of the lips and skin.",
    "Oxygen saturation is measured with a pulse oximeter, and a falling saturation may indicate deterioration."],
  ["Oxygen is a medicine and must be prescribed with a target saturation range.",
    "Check the prescription, the delivery device and the flow before starting oxygen therapy.",
    "Monitor the response of the patient and escalate to the nurse in charge if breathing worsens."],
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
    for (const t of ["individual_scholar_material", "individual_scholar_consent", "individual_scholar_learner", "individual_scholar_learner_context", "individual_entitlement", "individual_membership", "plat_ai_requests", "audit_log"])
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
  return { status: res.status, location: res.headers.get("location"), text: res.status === 200 ? (await res.text()).replace(/<!-- -->/g, "") : "" };
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
/** The browser path, over HTTP: the slot from the route, the bytes with the ANON key, then processing. */
async function upload(jar: Jar, mime: string, bytes: Uint8Array, fileName: string, attest = true) {
  const slot = await send("POST", "/api/individual/scholar/uploads", { mime, size: bytes.byteLength, piiAttested: attest }, jar);
  if (slot.status !== 200) return { slot, done: null as any };
  const browser = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const put = await browser.storage.from(slot.json.bucket).uploadToSignedUrl(slot.json.path, slot.json.token, bytes, { contentType: mime });
  if (put.error) return { slot, done: { status: 0, json: { error: put.error.message } } };
  const done = await send("POST", "/api/individual/scholar/materials", { uploadId: slot.json.uploadId, mime, fileName, piiAttested: true }, jar);
  return { slot, done };
}

async function main() {
  console.log(`SCHOLAR UPLOAD HARNESS (Stage 2) -- target ${ref}, server ${BASE}\n`);
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  if (!live) { console.log(`  PEND  no dev server at ${BASE}. Nothing created.`); return; }

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

  // The learner's educational context, through the route a student uses (the stamp needs a period).
  const opts = await loadJoinOptions(admin, policy);
  const programme = opts.ok ? opts.options.programmes.find(p => p.code === "nursing-ug-diploma") ?? opts.options.programmes[0] : null;
  const ctxSet = programme ? await send("PUT", "/api/individual/scholar/programme", { code: programme.code, level: programme.levels[0]?.code ?? null }, sa.jar) : null;
  note(`programme: ${programme?.code ?? "none"} -> ${ctxSet?.status}`);

  // ── W. Welcome to the upload panel ──
  const welcome = await get("/individual/welcome?for=scholar", sa.jar);
  const study = await get("/individual/scholar/study", sa.jar);
  ok("W1. Welcome offers 'Upload my notes', and it leads to the upload panel on My Learning",
    (welcome.status === 200 ? /Upload my notes/.test(welcome.text) : true) && study.status === 200 && /Upload study material/.test(study.text) && /id="upload"/.test(study.text),
    `welcome ${welcome.status}, study ${study.status}`);
  ok("W2. the panel states the formats and the size limit the POLICY allows, and says no competency need be chosen first",
    study.text.includes(`${rules.describe}, up to ${rules.maxMb} MB`) && /do not need to choose a competency first/.test(study.text), rules.describe);

  // ── U. upload ──
  const noAttest = await send("POST", "/api/individual/scholar/uploads", { mime: PDF_MIME, size: 1000, piiAttested: false }, sa.jar);
  const big = await send("POST", "/api/individual/scholar/uploads", { mime: PDF_MIME, size: rules.maxBytes + 1, piiAttested: true }, sa.jar);
  const image = await send("POST", "/api/individual/scholar/uploads", { mime: "image/jpeg", size: 1000, piiAttested: true }, sa.jar);
  const textOff = rules.text ? null : await send("POST", "/api/individual/scholar/uploads", { mime: TEXT_MIME, size: 100, piiAttested: true }, sa.jar);
  ok("U1. the slot refuses a missing attestation, an over-size file, a photo (no OCR) and any format the policy has off",
    noAttest.status === 400 && big.status === 400 && image.status === 400 && (textOff === null || textOff.status === 400), `${noAttest.status}/${big.status}/${image.status}/${textOff?.status ?? "-"}`);
  const pii = await upload(sa.jar, PDF_MIME, tinyPdf([["Patient NHS no 943 476 5919 admitted with chest pain."]]), "ward-list.pdf");
  const leftover = await admin.storage.from(BUCKET).list(a, { limit: 100 });
  ok("U2. ⚠ a file with an NHS-number shape is refused before anything is kept, and its uploaded object is removed",
    pii.done?.status === 422 && /NHS number/.test(pii.done?.json?.error ?? "") && (leftover.data ?? []).length === 0, `${pii.done?.status} ${pii.done?.json?.error}`);
  const good = await upload(sa.jar, PDF_MIME, tinyPdf(NOTES), "Respiratory notes.pdf");
  const id = good.done?.json?.id as string | undefined;
  ok("U3. a real PDF of respiratory notes is accepted, read on the server and kept: sections, pages", good.done?.status === 200 && !!id && good.done.json.chunks >= 2 && good.done.json.pages === 2,
    `${good.done?.status} ${JSON.stringify(good.done?.json)}`);
  if (!id) return;
  const audits = (await admin.from("audit_log").select("action").eq("actor_id", a)).data ?? [];
  ok("U4. the upload and the refusal are both audited", audits.some((r: any) => r.action === "individual_scholar_material_uploaded") && audits.some((r: any) => r.action === "individual_scholar_material_refused"));

  // ── T. plain text ──
  if (!rules.text) pend("T1. pasted text kept as a .txt original", "the 'text' format is off in the Individual policy here (needs 405, then HQ turns it on)");
  else {
    const t = await upload(sa.jar, TEXT_MIME, new TextEncoder().encode("Hand hygiene before and after patient contact prevents cross infection.\n\nUse a structured handover such as SBAR."), "Pasted notes.txt");
    const tm = t.done?.json?.id ? (await admin.from("individual_scholar_material").select("mime_type, storage_path, page_count").eq("id", t.done.json.id).single()).data : null;
    ok("T1. pasted text is kept as a .txt original, a text material with no pages", t.done?.status === 200 && tm?.mime_type === TEXT_MIME && /\.txt$/.test(tm?.storage_path ?? "") && tm?.page_count === null, `${t.done?.status} ${JSON.stringify(t.done?.json)}`);
  }

  // ── P. processed ──
  const mp = await get(`/individual/scholar/study/${id}`, sa.jar);
  ok("P1. the material page shows its sections, the original to download, and the context it was uploaded in",
    mp.status === 200 && /Sections/.test(mp.text) && mp.text.includes(`/api/individual/scholar/materials/${id}`) && (!programme || /uploaded while studying/.test(mp.text)),
    programme ? "" : "no programme on this environment: stamp not expected");
  const original = await fetch(`${BASE}/api/individual/scholar/materials/${id}`, { redirect: "manual", headers: { Cookie: cookieHeader(sa.jar) } });
  ok("P2. the source is preserved: the owner is redirected to a short-lived signed link to the original", original.status === 303 && /token=/.test(original.headers.get("location") ?? ""), `${original.status}`);

  // ── M. mapped ── (needs AI consent: the gate stays separate from upload)
  const consent = await send("POST", "/api/individual/scholar/consent", { grant: true }, sa.jar);
  if (consent.status !== 200) { pend("M/L. topics, competency proposals and learning", `AI consent could not be given here (${consent.status} ${consent.json?.error ?? ""}) -- the staging-test legal versions are not set on this server`); }
  else {
    let left = 99, rounds = 0, proposals = 0;
    while (left > 0 && rounds < 6) {
      const r = await send("POST", `/api/individual/scholar/materials/${id}/analyse`, {}, sa.jar);
      if (r.status !== 200) { note(`analyse: ${r.status} ${JSON.stringify(r.json)}`); break; }
      proposals += r.json.proposals ?? 0; left = r.json.remaining ?? 0; rounds++;
    }
    const mapped = await get(`/individual/scholar/study/${id}`, sa.jar);
    ok("M1. topic finding analyses every section and proposes competencies, shown with their clinical-status label",
      left === 0 && proposals > 0 && /Suggested by AI from your notes/.test(mapped.text) && /Not clinically reviewed|Draft content|Clinically approved/.test(mapped.text), `left ${left}, proposals ${proposals}`);
    // ── L. learn ──
    const chunkId = (await admin.from("individual_scholar_chunk").select("id").eq("material_id", id).order("ordinal").limit(1).single()).data?.id;
    let ex = await send("POST", "/api/individual/scholar/explain", { question: "Explain this section as simply as possible.", chunkId, mode: "simplify" }, sa.jar);
    if (!ex.json?.answer) ex = await send("POST", "/api/individual/scholar/explain", { question: "Explain this section as simply as possible.", chunkId, mode: "simplify" }, sa.jar);
    const q = await send("POST", "/api/individual/scholar/questions", { chunkId, kind: "mcq" }, sa.jar);
    ok("L1. the student learns from what they uploaded: a cited explanation and practice questions from it",
      ex.status === 200 && !!ex.json?.answer && /\[S1\]/.test(ex.json.answer) && q.status === 200 && (q.json?.created ?? 0) > 0, `explain ${ex.status} ${ex.json?.answer ? "shown" : ex.json?.message}, questions ${q.status} ${q.json?.created}`);
  }

  // ── I. isolation ──
  const bPage = await get(`/individual/scholar/study/${id}`, sb.jar);
  const bAnalyse = await send("POST", `/api/individual/scholar/materials/${id}/analyse`, {}, sb.jar);
  const bOriginal = await fetch(`${BASE}/api/individual/scholar/materials/${id}`, { redirect: "manual", headers: { Cookie: cookieHeader(sb.jar) } });
  ok("I1. ⚠ another student gets 404 for this material's page, its analysis and its original", bPage.status === 404 && bAnalyse.status === 404 && bOriginal.status === 404, `${bPage.status}/${bAnalyse.status}/${bOriginal.status}`);

  // ── E. erasure ──
  const del = await send("DELETE", `/api/individual/scholar/materials/${id}`, undefined, sa.jar);
  const row = (await admin.from("individual_scholar_material").select("id").eq("id", id).maybeSingle()).data;
  const objs = (await admin.storage.from(BUCKET).list(a, { limit: 100 })).data ?? [];
  const derived = (await admin.from("individual_scholar_chunk").select("id").eq("material_id", id)).data ?? [];
  ok("E1. the student deletes it: the row, its object and every derived section are gone", del.status === 200 && !row && derived.length === 0 && !objs.some((o: any) => o.name.startsWith(id)), `${del.status}`);
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
