/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR LEARN HARNESS -- COMPETEN-SCHOLAR Stage 3 (Learn: the Personal Learning Workspace), over HTTP, STAGING ONLY.
 *
 *   W  the material workspace: whole-material actions and the ways of learning the POLICY offers, beside the sections
 *   M  explain, summarise, simplify, go deeper -- from the notes, cited, AI-labelled; background beyond the notes
 *      never inside the answer (apart, labelled, or not at all; never for summarise or simplify)
 *   X  "Summarise this material": the sections in order, and the coverage said
 *   T  the tutor over the whole material, two turns, with the personal AI context (per request, audited without text)
 *   R  refusals: an unknown mode; a mode the policy has off (PEND when every mode is on here)
 *   I  isolation: another student cannot learn from these notes
 *   N  nothing stored: learning leaves no study record behind
 *
 * ⚠ NEEDS a dev server pointed at STAGING (BASE_URL) with individual_app ON, the staging-test legal versions AND
 * URLs (AI help needs them), and an AI provider. It READS the shared configuration and never writes it.
 * Fixtures: harness-learn-* identities, deleted at the start and the end.
 *
 * ⚠ STAGING ONLY: npx tsx scripts/privileged-harnesses.ts --staging --only scholar-learn
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { BUCKET, MATERIAL_SCOPE_SECTIONS, PDF_MIME } from "../src/lib/individual/scholar/config";
import { loadJoinOptions } from "../src/lib/individual/scholar/context";
import { tinyPdf } from "../src/lib/individual/scholar/test-documents";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-learn-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.BASE_URL ?? "http://localhost:3040";

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => console.log(`  PEND  ${n} -- ${why}`);
const note = (s: string) => console.log(`        ${s}`);

const FIX = { grantor: "harness-learn-grantor@competen.test", a: "harness-learn-a@competen.test", b: "harness-learn-b@competen.test" };
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

async function explainTwice(jar: Jar, body: Record<string, unknown>) {
  // A withheld answer is the grounding check doing its job; a student can ask again. Each try is checked.
  let r = await send("POST", "/api/individual/scholar/explain", body, jar);
  if (r.status === 200 && !r.json?.answer) r = await send("POST", "/api/individual/scholar/explain", body, jar);
  return r;
}

async function main() {
  console.log(`SCHOLAR LEARN HARNESS (Stage 3) -- target ${ref}, server ${BASE}\n`);
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
  const sa = await signIn(FIX.a), sb = await signIn(FIX.b);
  ok("0. two fixture students sign in", sa.status === 200 && sb.status === 200, `${sa.status}/${sb.status}`);
  const opts = await loadJoinOptions(admin, policy);
  const programme = opts.ok ? opts.options.programmes.find(p => p.code === "nursing-ug-diploma") ?? opts.options.programmes[0] : null;
  if (programme) await send("PUT", "/api/individual/scholar/programme", { code: programme.code, level: programme.levels[0]?.code ?? null }, sa.jar);
  note(`policy: modes ${policy.scholarLearningModes.join(", ")}; background ${policy.scholarBeyondNotes}; programme ${programme?.code ?? "none"}`);

  const up = await upload(sa.jar, PDF_MIME, tinyPdf(NOTES), "Respiratory notes.pdf");
  const id = up.done?.json?.id as string | undefined;
  const consent = await send("POST", "/api/individual/scholar/consent", { grant: true }, sa.jar);
  ok("S. setup: notes uploaded and AI help turned on (the consent gate, separate from upload)", !!id && consent.status === 200, `${up.done?.status} / consent ${consent.status} ${consent.json?.error ?? ""}`);
  if (!id || consent.status !== 200) return;
  const chunks = (await admin.from("individual_scholar_chunk").select("id, ordinal").eq("material_id", id).order("ordinal")).data ?? [];
  const c1 = chunks[0]?.id as string;

  // ── W. the material workspace ──
  const ws = await get(`/individual/scholar/study/${id}`, sa.jar);
  ok("W1. the material workspace offers the whole-material actions and the policy's ways of learning, beside the sections",
    ws.status === 200 && /Summarise this material/.test(ws.text) && /Tutor me on this material/.test(ws.text) && /How should it explain\?/.test(ws.text)
    && ["Explain", "Summarise", "Simplify", "Go deeper"].every(l => ws.text.includes(l)) && /Sections/.test(ws.text));

  // ── M. each way of learning, on a section, from the notes and cited ──
  const results: Record<string, any> = {};
  for (const [mode, q] of [["explain", "Explain this section clearly, as a tutor would."], ["summary", "Summarise this section."], ["simplify", "Explain this section as simply as possible."], ["deeper", "Explain this section in depth."]] as const) {
    results[mode] = await explainTwice(sa.jar, { question: q, chunkId: c1, mode });
    note(`${mode}: ${results[mode].status} ${results[mode].json?.answer ? "shown" : results[mode].json?.message ?? results[mode].json?.error} | background ${JSON.stringify(results[mode].json?.supplementary ? Object.keys(results[mode].json.supplementary) : null)}`);
  }
  ok("M1. explain, summarise, simplify and go deeper each answer from the notes, cited, with the AI label",
    ["explain", "summary", "simplify", "deeper"].every(m => results[m].status === 200 && /\[S1\]/.test(results[m].json?.answer ?? "") && results[m].json?.label)
    , Object.entries(results).map(([k, v]) => `${k}:${v.status}/${v.json?.answer ? "y" : "n"}`).join(" "));
  const sup = results.deeper.json?.supplementary;
  ok("M2. background beyond the notes is never in the answer: it comes apart, under its own label, or not at all (and never for summarise or simplify)",
    !results.summary.json?.supplementary && !results.simplify.json?.supplementary && !results.explain.json?.supplementary
    && (sup == null || (sup.text ? /Beyond your notes/.test(sup.label) && !results.deeper.json.answer.includes(sup.text) : !!sup.withheld)));

  // ── X. the whole material ──
  const whole = await explainTwice(sa.jar, { question: "Summarise this material.", materialId: id, scope: "material", mode: "summary" });
  ok("X1. 'Summarise this material' reads the material's sections in order and says how much it covered",
    whole.status === 200 && !!whole.json?.answer && whole.json?.coverage?.of === chunks.length && whole.json?.coverage?.sections === Math.min(chunks.length, MATERIAL_SCOPE_SECTIONS),
    `${whole.status} ${JSON.stringify(whole.json?.coverage)} ${whole.json?.answer ? "" : whole.json?.message}`);
  const scoped = await send("POST", "/api/individual/scholar/explain", { question: "Summarise this material.", materialId: id, mode: "summary" }, sa.jar);
  note(`the same request WITHOUT the material scope (search): ${scoped.json?.answer ? "answered" : scoped.json?.message ?? scoped.status}`);

  // ── T. the tutor, with the personal AI context ──
  const t1 = await explainTwice(sa.jar, { question: "Teach me this material step by step.", materialId: id, scope: "material", mode: "tutor" });
  const t2 = t1.json?.answer ? await explainTwice(sa.jar, { question: "You count it for a full minute.", chunkIds: t1.json.passageIds, mode: "tutor", history: [{ speaker: "tutor", text: t1.json.answer }] }) : null;
  ok("T1. the tutor teaches the whole material and continues from the student's reply, each turn cited and checked",
    t1.status === 200 && !!t1.json?.answer && !!t2 && t2.status === 200 && !!t2.json?.answer && /\[S\d\]/.test(t2.json.answer),
    `${t1.status}/${t1.json?.answer ? "y" : t1.json?.message} ${t2?.status}/${t2?.json?.answer ? "y" : t2?.json?.message}`);
  const audits = ((await admin.from("audit_log").select("new_value").eq("actor_id", a).eq("entity_type", "individual_scholar_explain")).data ?? []) as any[];
  const tutorRows = audits.filter(r => r.new_value?.mode === "tutor");
  ok("T2. the tutor used the student's own study context, assembled per request -- and the audit holds no study text",
    tutorRows.length > 0 && tutorRows.some(r => r.new_value?.learner_context === true) && !audits.some(r => /Respiratory|I study/.test(JSON.stringify(r.new_value ?? {}))),
    `${tutorRows.length} tutor rows`);
  const ws2 = await get(`/individual/scholar/study/${id}`, sa.jar);
  ok("T3. the workspace tells the student, where the tutor is, that nothing is saved", /Not saved|not saved/.test(ws2.text));

  // ── R. refusals ──
  const bad = await send("POST", "/api/individual/scholar/explain", { question: "x", chunkId: c1, mode: "lecture" }, sa.jar);
  ok("R1. a way of learning that does not exist is refused", bad.status === 400);
  if (!policy.scholarLearningModes.includes("deeper")) {
    const off = await send("POST", "/api/individual/scholar/explain", { question: "x", chunkId: c1, mode: "deeper" }, sa.jar);
    ok("R2. a way of learning the policy has switched off is refused", off.status === 403);
  } else pend("R2. a switched-off mode is refused over HTTP", "every mode is on in this environment's policy (pinned statically: K21, P38)");

  // ── I. isolation ──
  const bSection = await send("POST", "/api/individual/scholar/explain", { question: "Explain this section.", chunkId: c1, mode: "explain" }, sb.jar);
  const bWhole = await send("POST", "/api/individual/scholar/explain", { question: "Summarise this material.", materialId: id, scope: "material", mode: "summary" }, sb.jar);
  ok("I1. ⚠ another student cannot learn from this student's notes: their section and their material are not found",
    bSection.status === 404 && (bWhole.status === 404 || (bWhole.status === 403 && /consent|AI help/i.test(bWhole.json?.error ?? ""))), `${bSection.status}/${bWhole.status}`);

  // ── N. nothing stored ──
  const qCount = (await admin.from("individual_scholar_question").select("id", { count: "exact" }).eq("user_id", a).limit(1)).count ?? -1;
  ok("N1. learning writes nothing to the student's study record: no explanation, summary or tutor turn is stored", qCount === 0, `${qCount} question rows`);
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
