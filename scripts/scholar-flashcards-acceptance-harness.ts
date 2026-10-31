/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR-FLASHCARDS-01 s14 -- THE MANDATORY ACCEPTANCE OF FLASHCARDS (renal system + respiratory assessment notes).
 * Over HTTP against a dev server pointed at STAGING. Every assertion reads a REAL output (route replies, stored rows,
 * rendered page HTML, the exported PDF bytes parsed back), and the key outputs are printed so a human can judge them.
 *
 *   F1  a learner generates meaningful flashcards from uploaded notes (renal, respiratory; activity questions)
 *   F2  clear questions, accurate answers (fronts ask, one concept, not copied; printed verbatim for judgement)
 *   F3  source references preserved (each AI card keeps its note quote, found in the note, and its citation)
 *   F4  create, edit and organise decks (make, rename, organise by module, add, move between decks, remove a deck;
 *       a hand-written card labelled "Your card", edited, bookmarked)
 *   F5  cards flip on desktop/tablet/mobile -- COORDINATOR in a browser; here only the API (reveal) and page HTML
 *   F6  recall ratings saved (attempt rows in the session, 391 review rows with quality 1 / 4)
 *   F7  spaced schedules updated on the EXISTING SM-2 ("Didn't remember" = 1, "Remembered" = 4), checked against
 *       scheduleRecall with the policy's SRS bounds, over two sessions
 *   F8  leave and resume a deck with the correct revision history (the session resumed; the deck reloaded; history)
 *   F9  a single deck downloads as a PDF
 *   F10 printable A4 cards (valid PDF, A4, duplex front/back pages; single layout too)
 *   F11 selected cards from several decks combine into one revision guide
 *   F12 the guide has headings, questions, answers, summaries (Key Concepts), checklist, references, disclaimer
 *   F13 PDF assembly triggers no AI call (plat_ai_requests and ai_usage_ledger counted before and after)
 *   F14 private material protected: a second learner cannot read, export, study, edit or move learner 1's cards/decks
 *   F15 no verified competency record created (before/after counts of competency_verification_*, assessment*, osce_*,
 *       DACUM, passport and verification tables)
 *   G   every AI call ran on a model eligible for its activity; cost
 *   Z   fixtures removed (except the coordinator's flashcards browser fixture, kept on purpose); staging settings unchanged
 *
 * STAGING CONFIGURATION: this run changes NONE (scholar_flashcards defaults on). Z proves the policy rows unchanged.
 *
 * KEPT FIXTURE: harness-flashcards-browser@competen.test (one renal note, one deck of AI and hand-written cards) for the
 * coordinator's flip check on desktop/tablet/mobile. Its password is written only to FLASHCARDS_BROWSER_FIXTURE_FILE,
 * never printed. A re-run replaces it. Remove it with FLASHCARDS_REMOVE_BROWSER_FIXTURE=1. The OSCE browser fixture
 * (harness-osce-browser@competen.test) is only READ here (never changed or removed).
 *
 * PDFs: every export of the run is written to FLASHCARDS_PDF_DIR (default the release acceptance-pdfs folder).
 *
 * ⚠ STAGING ONLY (refuses any other project). From the checkout with node_modules and the staging .env.local:
 *   NODE_PATH=<checkout>/node_modules BASE_URL=http://localhost:3100 npx tsx <this worktree>/scripts/scholar-flashcards-acceptance-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { Client as Pg } from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { BUCKET, TEXT_MIME, LEARNER_CARD_LABEL } from "../src/lib/individual/scholar/config";
import { flashcardFrontAsks, flashcardDraftProblem } from "../src/lib/individual/scholar/question-intel";
import { RECALL, scheduleRecall } from "../src/lib/individual/scholar/flashcards";
import { FLASHCARD_PDF_DISCLAIMER, pdfText } from "../src/lib/individual/scholar/flashcard-pdf";

loadEnvConfig(process.cwd(), true);
const STAGING_REF = "ezhvpgtcqcdsgylrxgdb";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-flashcards-acceptance-harness");
if (ref !== STAGING_REF) { console.error(`REFUSING: this harness runs on the staging project only (${STAGING_REF}), not ${ref}.`); process.exit(1); }
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error("REFUSING: BASE_URL must be a local dev server pointed at staging."); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const DB_URL = process.env.STAGING_DB_URL;
if (DB_URL && !DB_URL.includes(STAGING_REF)) { console.error("REFUSING: STAGING_DB_URL does not name the staging project."); process.exit(1); }
const PDF_DIR = process.env.FLASHCARDS_PDF_DIR ?? "C:/Users/elish/Documents/Competen/RELEASE-2026-10-25/PENDING-25/acceptance-pdfs";

let pass = 0; const fails: string[] = []; const pends: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}${d ? ` -- ${d}` : ""}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => { pends.push(n); console.log(`  PEND  ${n} -- ${why}`); };
const show = (label: string, v: unknown) => console.log(`        ${label}: ${typeof v === "string" ? v : JSON.stringify(v)}`);

const FIX = { grantor: "harness-flash-grantor@competen.test", a: "harness-flash-a@competen.test", b: "harness-flash-b@competen.test" };
const BROWSER = "harness-flashcards-browser@competen.test";
const OSCE_BROWSER = "harness-osce-browser@competen.test";
const BROWSER_FIXTURE_FILE = process.env.FLASHCARDS_BROWSER_FIXTURE_FILE
  ?? "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/a8637d9f-8e17-4384-a425-178c29a6d626/scratchpad/flashcards-browser-fixture.txt";
const rnd = () => Math.random().toString(36).slice(2);
const PW = `flash-${rnd()}-Aa1!`;
const BROWSER_PW = `flashb-${rnd()}${rnd()}-Aa1!`;
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};

// ── the material: two short lecture notes (educational, no person) ──
const NOTE_RENAL = [
  "Renal system lecture notes",
  "1. The nephron is the functional unit of the kidney, and each kidney contains about one million nephrons.",
  "2. Each nephron has a glomerulus inside Bowman's capsule, a proximal convoluted tubule, the loop of Henle, a distal convoluted tubule and a collecting duct.",
  "3. The glomerulus filters the blood, and most of the water, sodium and glucose in the filtrate is reabsorbed in the proximal convoluted tubule.",
  "4. The glomerular filtration rate (GFR) is the volume of fluid filtered by the glomeruli each minute. A normal adult GFR is about 90 to 120 mL/min/1.73 m2.",
  "5. Estimated GFR (eGFR) is calculated from serum creatinine, age and sex, and is used to stage chronic kidney disease.",
  "6. Acute kidney injury (AKI) is a rapid fall in kidney function, shown by a rise in serum creatinine or a fall in urine output.",
  "7. KDIGO stage 1 AKI is a creatinine 1.5 to 1.9 times baseline, or urine output below 0.5 mL/kg/h for 6 to 12 hours.",
  "8. KDIGO stage 2 AKI is a creatinine 2.0 to 2.9 times baseline, or urine output below 0.5 mL/kg/h for 12 hours or more.",
  "9. KDIGO stage 3 AKI is a creatinine 3 times baseline or more, urine output below 0.3 mL/kg/h for 24 hours or more, or no urine for 12 hours.",
  "10. Causes of AKI are pre-renal (reduced perfusion, such as dehydration or haemorrhage), intrinsic renal (damage to the kidney itself, such as acute tubular necrosis or nephrotoxic drugs) and post-renal (obstruction to urine outflow, such as an enlarged prostate).",
  "11. Fluid balance monitoring records all intake and output on a fluid balance chart, including oral and intravenous fluids, urine, drains and vomit.",
  "12. Weigh the person daily at the same time on the same scales, because a change in weight is a reliable guide to fluid status.",
  "13. Report urine output below 0.5 mL/kg/h, a rising creatinine, or a positive fluid balance with signs of overload such as oedema or breathlessness.",
].join("\n");
const NOTE_RESP = [
  "Respiratory assessment lecture notes",
  "1. A respiratory assessment starts with introducing yourself, explaining the assessment and gaining consent.",
  "2. Count the respiratory rate over a full minute, because a raised respiratory rate is an early sign of deterioration.",
  "3. Assess the rhythm, depth and effort of breathing, including use of accessory muscles and the ability to speak in full sentences.",
  "4. Measure oxygen saturation with pulse oximetry and interpret it against the target range prescribed for that person.",
  "5. Listen to breath sounds on both sides of the chest and note wheeze, crackles or reduced air entry.",
  "6. Signs of respiratory distress include a raised respiratory rate, accessory muscle use, inability to complete sentences and cyanosis.",
  "7. First-line actions within scope include sitting the person upright and giving prescribed oxygen.",
  "8. Escalate using a structured handover such as SBAR: situation, background, assessment and recommendation.",
  "9. Document the findings, the actions taken and the escalation in the agreed format.",
].join("\n");
const NOTE_B = "Cardiac notes\n1. The heart has four chambers: two atria and two ventricles.\n2. The sinoatrial node is the natural pacemaker of the heart.";
const HAND = { front: "What hourly urine output is the KDIGO threshold for oliguria in AKI?", back: "Below 0.5 mL/kg/h." };
const HAND_EDIT = { front: "What hourly urine output is the KDIGO threshold for oliguria in AKI?", back: "Below 0.5 mL/kg/h (for 6 hours or more: stage 1)." };
const HAND_EDIT2 = { front: "What urine output threshold defines oliguria in KDIGO AKI staging?", back: "Below 0.5 mL/kg/h (6 hours or more is stage 1)." };

// ── fixtures ──
async function findUser(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
const USER_TABLES = [
  "individual_scholar_flashcard_mark", "individual_scholar_flashcard_deck_card", "individual_scholar_flashcard_deck",
  "individual_scholar_revision_session_item", "individual_scholar_revision_session", "individual_scholar_revision_set_item", "individual_scholar_revision_set",
  "individual_scholar_review", "individual_scholar_attempt", "individual_scholar_card", "individual_scholar_question",
  "individual_scholar_learning_event_source", "individual_scholar_learning_event", "individual_scholar_learning_step", "individual_scholar_learning_session",
  "individual_scholar_material", "individual_scholar_collection", "individual_scholar_consent", "individual_scholar_learner", "individual_scholar_learner_context",
  "individual_entitlement", "individual_membership", "plat_ai_requests", "audit_log",
];
async function removeUser(email: string) {
  const u = await findUser(email);
  if (!u) return;
  const listed = await admin.storage.from(BUCKET).list(u.id, { limit: 1000 });
  if (listed.data?.length) await admin.storage.from(BUCKET).remove(listed.data.map((o: any) => `${u.id}/${o.name}`));
  for (const t of USER_TABLES) await admin.from(t).delete().eq(t === "audit_log" || t === "plat_ai_requests" ? "actor_id" : "user_id", u.id);
  await admin.from("profiles").delete().eq("id", u.id);
  await admin.auth.admin.deleteUser(u.id);
}
const cleanup = async () => { for (const e of Object.values(FIX)) await removeUser(e); };

// ── HTTP ──
type Jar = Map<string, string>;
const cookieHeader = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(jar: Jar, res: Response) {
  for (const c of (res.headers as any).getSetCookie?.() ?? []) {
    const [pair] = c.split(";"); const i = pair.indexOf("=");
    const name = pair.slice(0, i), value = pair.slice(i + 1);
    if (!value || /max-age=0/i.test(c)) jar.delete(name); else jar.set(name, value);
  }
}
const rid = () => `flash-${Date.now().toString(36)}-${rnd().slice(0, 8)}`;
const refusals: { jar: Jar; path: string; status: number; code: string }[] = [];
async function send(method: string, path: string, body: unknown, jar: Jar) {
  const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar), "x-request-id": rid() }, body: body === undefined ? undefined : JSON.stringify(body) });
  absorb(jar, res);
  const json = await res.json().catch(() => ({})) as any;
  if (json?.code === "not_eligible" || /isn't available for this yet|not eligible/i.test(`${json?.error ?? ""}`)) refusals.push({ jar, path, status: res.status, code: json?.code ?? "words" });
  return { status: res.status, json };
}
async function getBytes(path: string, jar: Jar) {
  const res = await fetch(BASE + path, { redirect: "manual", headers: { Cookie: cookieHeader(jar) } });
  const buf = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get("content-type") ?? "", disposition: res.headers.get("content-disposition") ?? "", cache: res.headers.get("cache-control") ?? "", bytes: buf };
}
const decode = (s: string) => s.replace(/\\u2014/g, "—").replace(/\\u0026/g, "&").replace(/\\"/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&rsquo;/g, "’").replace(/&#183;|&middot;/g, "·");
async function page(path: string, jar: Jar) {
  const res = await fetch(BASE + path, { redirect: "manual", headers: { Cookie: cookieHeader(jar) } });
  const raw = await res.text();
  const visible = decode(raw.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  return { status: res.status, visible, all: decode(raw) };
}
async function signIn(email: string, password: string) { const jar: Jar = new Map(); const r = await send("POST", "/api/auth/login", { email, password }, jar); return { jar, status: r.status }; }
async function uploadText(jar: Jar, text: string, fileName: string) {
  const bytes = new TextEncoder().encode(text);
  const slot = await send("POST", "/api/individual/scholar/uploads", { mime: TEXT_MIME, size: bytes.byteLength, piiAttested: true }, jar);
  if (slot.status !== 200) return { id: null, why: `slot ${slot.status} ${slot.json.error ?? ""}` };
  const put = await createClient(url!, anonKey!, { auth: { persistSession: false } }).storage.from(slot.json.bucket).uploadToSignedUrl(slot.json.path, slot.json.token, bytes, { contentType: TEXT_MIME });
  if (put.error) return { id: null, why: "storage" };
  const done = await send("POST", "/api/individual/scholar/materials", { uploadId: slot.json.uploadId, mime: TEXT_MIME, fileName, piiAttested: true }, jar);
  return done.status === 200 ? { id: done.json.id as string, why: "" } : { id: null, why: `materials ${done.status} ${done.json.error ?? ""}` };
}

/** A student signed up as one is: Scholar granted, onboarded, terms accepted over HTTP, AI consent given. */
async function makeStudent(grantor: string, email: string, password: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const u = data.user.id as string;
  const req = validateGrant({ targetUserId: u, experiences: ["scholar"], adultConfirmed: true });
  if (isGrantRefusal(req)) throw new Error(req.message);
  const g = await grantIndividualAccess(admin, req, grantor); if (!g.ok) throw new Error(g.message);
  await admin.from("individual_membership").update({ onboarded_at: new Date().toISOString(), primary_experience: "scholar" }).eq("user_id", u);
  const s = await signIn(email, password);
  let versions = LEGAL.h.terms && LEGAL.s.terms ? { foundation: LEGAL.h, experienceDocs: LEGAL.s } : null;
  let terms = s.status === 200 && versions ? (await send("POST", "/api/individual/terms", { experience: "scholar", ...versions }, s.jar)).status : 0;
  if (s.status === 200 && terms !== 200) {
    const t = (await page("/individual/scholar", s.jar)).all;
    const f = t.match(/"foundation":\{"terms":"([^"]+)","privacy":"([^"]+)"\}/), x = t.match(/"experienceDocs":\{"terms":"([^"]+)","privacy":"([^"]+)"\}/);
    if (f && x) { versions = { foundation: { terms: f[1], privacy: f[2] }, experienceDocs: { terms: x[1], privacy: x[2] } }; terms = (await send("POST", "/api/individual/terms", { experience: "scholar", ...versions }, s.jar)).status; }
  }
  const consent = s.status === 200 ? await send("POST", "/api/individual/scholar/consent", { grant: true }, s.jar) : { status: 0, json: {} };
  return { id: u, jar: s.jar, signIn: s.status, terms, consent: consent.status, consentError: (consent.json as any)?.error ?? null };
}

// ── staging configuration: proved unchanged ──
async function policyRows() {
  const { data } = await admin.from("workspace_config_overrides").select("config_path, draft, published").eq("scope_type", "platform").eq("scope_ref", "individual").order("config_path");
  return JSON.stringify(data ?? []);
}

// ── F15: the verification and Passport tables, counted before and after (direct SQL on staging) ──
const VERIFY_TABLE_RE = "^(competency_verification_|osce_|assessment|competency_assessment|competency_rating|individual_professional_item_verification|individual_scholar_passport_|individual_passport_|passport_)";
async function verificationCounts(): Promise<Record<string, number> | null> {
  if (!DB_URL) return null;
  const c = new Pg({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const t = await c.query(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and (table_name ~ $1 or table_name ~ 'dacum') order by 1`, [VERIFY_TABLE_RE]);
    const out: Record<string, number> = {};
    for (const r of t.rows) out[r.table_name] = Number((await c.query(`select count(*)::int n from public."${String(r.table_name).replace(/"/g, "")}"`)).rows[0].n);
    return out;
  } finally { await c.end(); }
}

// ── G: AI routing ──
const ELIG = new Map<string, { prefix: string; tier: string | null }[]>();
async function loadEligibility() {
  const { data } = await admin.from("ai_model_eligibility").select("activity, provider, model_prefix, eligible, max_risk_tier, effective_to").eq("product", "scholar").eq("eligible", true);
  for (const r of data ?? []) if (!r.effective_to || Date.parse(r.effective_to) > Date.now()) ELIG.set(r.activity, [...(ELIG.get(r.activity) ?? []), { prefix: r.model_prefix, tier: r.max_risk_tier }]);
}
const ROUTED = new Map<string, Set<string>>();
async function loadRouting() {
  const { activityReadiness } = await import("../src/lib/ai/allowance");
  for (const a of (await activityReadiness(admin, "scholar")) ?? []) ROUTED.set(a.code, new Set(Object.values(a.routes).filter(Boolean).map(r => r!.model)));
}
const routeActivity = (operation: string): string | null => {
  if (/^individual_scholar_(revision_|mcq|questions)/.test(operation)) return "questions"; // sessions/route.ts generation
  if (/^individual_scholar_evaluate/.test(operation)) return "evaluate";
  return null;
};
async function routing(userId: string) {
  const rows = ((await admin.from("plat_ai_requests").select("operation, model, status, cost_usd, action_id, created_at").eq("actor_id", userId).order("created_at")).data ?? []) as any[];
  const ledger = ((await admin.from("ai_usage_ledger").select("request_id, activity, model, status, risk_tier").eq("user_id", userId).eq("product", "scholar")).data ?? []) as any[];
  const steps = ledger.length
    ? ledger.filter(l => l.status !== "released").map(l => ({ operation: `ledger:${l.request_id}`, activity: l.activity as string | null, model: String(l.model ?? ""), status: "ok", cost: 0 }))
    : rows.map(r => ({ operation: String(r.operation ?? ""), activity: routeActivity(String(r.operation ?? "")), model: String(r.model ?? ""), status: String(r.status), cost: Number(r.cost_usd) || 0 }));
  return {
    source: ledger.length ? "ai_usage_ledger" : "plat_ai_requests", usd: +rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0).toFixed(6), calls: rows.length,
    operations: rows.map(r => `${r.operation}:${r.model}:${r.status}`),
    steps: steps.map(s => ({ ...s, eligible: !!s.activity && (ELIG.get(s.activity) ?? []).some(e => s.model.startsWith(e.prefix)), routed: !!s.activity && [...(ROUTED.get(s.activity) ?? [])].some(m => s.model.startsWith(m)) })),
  };
}
async function aiCounts(userIds: string[]) {
  const req = await admin.from("plat_ai_requests").select("id", { count: "exact", head: true });
  const mine = await admin.from("plat_ai_requests").select("id", { count: "exact", head: true }).in("actor_id", userIds);
  const led = await admin.from("ai_usage_ledger").select("request_id", { count: "exact", head: true }).in("user_id", userIds);
  return { allRequests: req.count as number, fixtureRequests: mine.count as number, fixtureLedger: led.count as number };
}

// ── PDF: parsed back with pdf-lib (structure) and unpdf (text) ──
const A4 = { w: 595.28, h: 841.89 };
const norm = (s: string) => pdfText(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
async function parsePdf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const sizes = doc.getPages().map(p => p.getSize());
  const proxy = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(proxy, { mergePages: false });
  const pages = (text as string[]).map(t => t.replace(/\s+/g, " "));
  return { pages: sizes.length, a4: sizes.every(s => Math.abs(s.width - A4.w) < 1 && Math.abs(s.height - A4.h) < 1), sizes, pageText: pages, flat: norm(pages.join(" ")) };
}
const has = (flatText: string, s: string) => flatText.includes(norm(s));
const savedPdfs: string[] = [];
function savePdf(name: string, bytes: Uint8Array) {
  mkdirSync(PDF_DIR, { recursive: true });
  const p = `${PDF_DIR}/${name}`;
  writeFileSync(p, bytes);
  savedPdfs.push(p);
}

const FC = "/api/individual/scholar/flashcards";
const FC_PAGE = "/individual/scholar/study/revise/flashcards";
const flatNote = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const summary: Record<string, unknown> = {};

async function cardsOf(jar: Jar, q: string) { const r = await send("GET", `${FC}${q}`, undefined, jar); return { status: r.status, cards: (r.json.cards ?? []) as any[], decks: r.json.decks ?? [] }; }
const cardRow = async (userId: string, qid: string) => (await admin.from("individual_scholar_card").select("ease_factor, interval_days, repetitions, reviews, next_review_at, last_quality, status").eq("user_id", userId).eq("question_id", qid).maybeSingle()).data as any;

async function main() {
  console.log(`SCHOLAR-FLASHCARDS-01 s14 ACCEPTANCE -- target ${ref} (staging), server ${BASE}\n`);
  if (process.env.FLASHCARDS_REMOVE_BROWSER_FIXTURE === "1") { await removeUser(BROWSER); ok("Z-browser. the kept flashcards browser fixture is removed", !(await findUser(BROWSER))); return; }
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  if (!live) { console.log(`  PEND  no dev server at ${BASE}. Nothing created.`); return; }
  await loadEligibility();
  await loadRouting();
  show("eligible (scholar: questions)", (ELIG.get("questions") ?? []).map(x => `${x.prefix}<=${x.tier}`));
  show("routed (scholar: questions)", [...(ROUTED.get("questions") ?? [])]);
  const policyBefore = await policyRows();
  const countsBefore = await verificationCounts();
  POLICY_BEFORE = policyBefore; COUNTS_BEFORE = countsBefore;
  show("F15 tables counted", countsBefore ? Object.keys(countsBefore).length : "STAGING_DB_URL not set");
  const { loadIndividualPolicy } = await import("../src/lib/individual/policy");
  const policy = await loadIndividualPolicy(admin);
  const srs = { masteryReps: policy.scholarSrsMasteryReps, masteryDays: policy.scholarSrsMasteryDays, maxIntervalDays: policy.scholarSrsMaxIntervalDays, harderIntervalPercent: policy.scholarSrsHarderIntervalPercent };
  show("policy", { scholarFlashcards: policy.scholarFlashcards, perGeneration: policy.scholarFlashcardsPerGeneration, deckMax: policy.scholarFlashcardDeckMax, exports: policy.scholarFlashcardExports, difficulty: policy.scholarFlashcardDifficulty, srs });

  // The OSCE browser fixture: read only, to say whether it could serve the flashcards browser check.
  const osceB = await findUser(OSCE_BROWSER);
  if (osceB) {
    const ent = (await admin.from("individual_entitlement").select("experience_code, status, ends_at").eq("user_id", osceB.id)).data ?? [];
    const con = (await admin.from("individual_scholar_consent").select("*").eq("user_id", osceB.id)).data ?? [];
    const mats = (await admin.from("individual_scholar_material").select("id").eq("user_id", osceB.id)).data ?? [];
    const qs = (await admin.from("individual_scholar_question").select("id").eq("user_id", osceB.id).eq("kind", "flashcard")).data ?? [];
    summary.osceBrowserFixture = { exists: true, entitlements: ent.map((e: any) => `${e.experience_code}:${e.status}${e.ends_at ? `:ends ${e.ends_at}` : ""}`), consentRows: con.length, materials: mats.length, flashcards: qs.length };
  } else summary.osceBrowserFixture = { exists: false };
  show("OSCE browser fixture (read only)", summary.osceBrowserFixture);

  await cleanup();
  await removeUser(BROWSER);
  const { data: gd, error: ge } = await admin.auth.admin.createUser({ email: FIX.grantor, password: PW, email_confirm: true });
  if (ge) throw ge;
  const grantor = gd.user.id as string;
  const A = await makeStudent(grantor, FIX.a, PW), B = await makeStudent(grantor, FIX.b, PW);
  ok("0. two fixture learners sign in, accept the terms over HTTP and give AI consent",
    [A, B].every(s => s.signIn === 200 && s.terms === 200 && s.consent === 200), JSON.stringify([A, B].map(s => [s.signIn, s.terms, s.consent, s.consentError])));
  if (![A, B].every(s => s.consent === 200)) { await finishWithCleanup(policyBefore, countsBefore); return; }

  // ════════ F1-F3. upload notes, make decks, generate cards into them ════════
  console.log("\n── F1-F3. upload, decks, generate ──");
  const renal = await uploadText(A.jar, NOTE_RENAL, "Renal system lecture.txt");
  const resp = await uploadText(A.jar, NOTE_RESP, "Respiratory assessment lecture.txt");
  ok("F1a. both notes upload (renal system, respiratory assessment)", !!renal.id && !!resp.id, `${renal.why} ${resp.why}`);
  if (!renal.id || !resp.id) { await finishWithCleanup(policyBefore, countsBefore); return; }
  const d1 = await send("POST", `${FC}/decks`, { title: "Renal system", organiseBy: "module", organiseRef: "Year 2 renal module" }, A.jar);
  const d2 = await send("POST", `${FC}/decks`, { title: "Respiratory assessment", organiseBy: "topic", organiseRef: "Respiratory assessment" }, A.jar);
  const D1 = d1.json.id as string, D2 = d2.json.id as string;
  ok("F4a. named decks are made, organised by module and by topic", d1.status === 200 && d2.status === 200 && !!D1 && !!D2, `${d1.status} ${d2.status} ${d1.json.error ?? ""}`);

  const g1 = await send("POST", "/api/individual/scholar/revision/sessions", { mode: "flashcards", scope: { kind: "document", materialId: renal.id }, quantity: 6, deckId: D1 }, A.jar);
  const g2 = await send("POST", "/api/individual/scholar/revision/sessions", { mode: "flashcards", scope: { kind: "document", materialId: resp.id }, quantity: 4, deckId: D2 }, A.jar);
  show("generate renal", { status: g1.status, generated: g1.json.generated, reused: g1.json.reused, library: g1.json.library, aiCalls: g1.json.aiCalls, note: g1.json.note, withheld: g1.json.withheld, error: g1.json.error });
  show("generate respiratory", { status: g2.status, generated: g2.json.generated, reused: g2.json.reused, library: g2.json.library, aiCalls: g2.json.aiCalls, note: g2.json.note, withheld: g2.json.withheld, error: g2.json.error });
  const genItems = [...(g1.json.items ?? []), ...(g2.json.items ?? [])];
  ok("F1b. the generation reply carries learner views only (no back, rationale or source quote reaches the browser before reveal)",
    genItems.length > 0 && genItems.every((i: any) => !("back" in i) && !("answer" in i) && !("rationale" in i) && !("sourceQuote" in i)), Object.keys(genItems[0] ?? {}).join(","));

  const r1 = await cardsOf(A.jar, `?deck=${D1}`), r2 = await cardsOf(A.jar, `?deck=${D2}`);
  const renalCards = r1.cards, respCards = r2.cards;
  ok("F1c. a learner generates flashcards from each note, filed into the deck asked for (renal >= 4, respiratory >= 3)",
    g1.status === 200 && g2.status === 200 && renalCards.length >= 4 && respCards.length >= 3 && g1.json.generated >= 4 && g2.json.generated >= 3,
    `renal ${renalCards.length} (generated ${g1.json.generated}), resp ${respCards.length} (generated ${g2.json.generated})`);
  console.log("\n        ── generated cards (verbatim) ──");
  for (const [label, cs, note] of [["RENAL", renalCards, NOTE_RENAL], ["RESP", respCards, NOTE_RESP]] as const) {
    for (const c of cs) {
      const src = (c.sources ?? [])[0];
      console.log(`        [${label}] Q: ${c.front}\n               A: ${c.back}\n               explanation: ${c.explanation ?? "-"} | topic: ${c.topic ?? "-"} | level: ${c.level ?? "-"} | difficulty: ${c.difficulty ?? "-"}\n               source: ${src?.citation ?? "-"} | quote: "${src?.quote ?? ""}" | quote in note: ${!!src?.quote && flatNote(note).includes(flatNote(src.quote))}\n               origin: ${c.originLabel} | version: ${c.version}`);
    }
  }
  summary.cards = { renal: renalCards.map(c => ({ front: c.front, back: c.back, quote: c.sources?.[0]?.quote ?? null, citation: c.sources?.[0]?.citation ?? null })), resp: respCards.map(c => ({ front: c.front, back: c.back, quote: c.sources?.[0]?.quote ?? null, citation: c.sources?.[0]?.citation ?? null })) };
  const ai = [...renalCards.map(c => ({ c, note: NOTE_RENAL })), ...respCards.map(c => ({ c, note: NOTE_RESP }))];
  const quality = ai.map(({ c, note }) => ({ id: c.id, asks: flashcardFrontAsks(c.front), problem: flashcardDraftProblem(c.front, c.back, note), question: /\?\s*$/.test(c.front) }));
  show("F2 per-card checks", quality.map(q => `${q.asks ? "asks" : "NOT-ASK"}/${q.problem ?? "ok"}/${q.question ? "?" : "term"}`));
  ok("F2a. every generated front is a recall prompt (a question or short term), not a sentence copied from the notes, one concept on the back",
    quality.length > 0 && quality.every(q => q.asks && !q.problem));
  const fronts = ai.map(x => x.c.front.toLowerCase().trim());
  ok("F2b. no two generated cards repeat the same front", new Set(fronts).size === fronts.length);
  ok("F3a. every AI card keeps its source: origin 'notes', a citation, and a quote found word for word in the uploaded note",
    ai.every(({ c, note }) => c.origin === "notes" && (c.sources ?? []).some((s: any) => s.origin === "notes" && !!s.citation && !!s.quote && flatNote(note).includes(flatNote(s.quote))) && /not clinically reviewed/.test(c.originLabel)),
    ai.filter(({ c, note }) => !(c.sources ?? []).some((s: any) => s.quote && flatNote(note).includes(flatNote(s.quote)))).map(({ c }) => c.front).join(" | "));

  // ════════ F4. hand-written card, edit, bookmark, organise ════════
  console.log("\n── F4. a card you write, edit, bookmark, organise ──");
  const copied = await send("POST", FC, { materialId: renal.id, front: "The nephron is the functional unit of the kidney, and each kidney contains about one million nephrons.", back: "Yes." }, A.jar);
  const pii = await send("POST", FC, { materialId: renal.id, front: "What was Mr Smith's urine output, NHS number 943 476 5919?", back: "0.3 mL/kg/h" }, A.jar);
  ok("F4b. a hand-written card that is a copied sentence is refused (not a prompt); one naming a patient is refused (422)",
    copied.status === 400 && copied.json.reason === "not_a_prompt" && pii.status === 422, `${copied.status}:${copied.json.reason} ${pii.status}:${pii.json.reason}`);
  const hand = await send("POST", FC, { materialId: renal.id, deckId: D1, ...HAND }, A.jar);
  const H = hand.json.id as string;
  const dup = await send("POST", FC, { materialId: renal.id, ...HAND }, A.jar);
  const hRow = (await admin.from("individual_scholar_question").select("model, provider, prompt_version, review_status, content_version, kind").eq("id", H).maybeSingle()).data as any;
  const hView0 = (await cardsOf(A.jar, `?card=${H}`)).cards[0];
  show("hand card", { status: hand.status, note: hand.json.note, row: hRow, label: hView0?.originLabel, deckIds: hView0?.deckIds?.length, dup: dup.status });
  ok("F4c. a hand-written card is saved with no AI (model 'learner'), private formative, labelled 'Your card', added to the deck; a repeat is refused (409)",
    hand.status === 200 && !!H && hRow?.model === "learner" && hRow?.review_status === "private_formative" && hView0?.originLabel === LEARNER_CARD_LABEL && hView0?.origin === "learner" && hView0?.deckIds?.includes(D1) && dup.status === 409);
  const e1 = await send("PATCH", `${FC}/${H}`, HAND_EDIT, A.jar);
  const hView1 = (await cardsOf(A.jar, `?card=${H}`)).cards[0];
  const editAi = await send("PATCH", `${FC}/${renalCards[0]?.id}`, { front: "What is the nephron?", back: "Edited." }, A.jar);
  ok("F4d. the learner edits their own card (content version 2, new back); a card from notes cannot be rewritten (404)",
    e1.status === 200 && hView1?.back === HAND_EDIT.back && hView1?.contentVersion === 2 && editAi.status === 404 && (await cardsOf(A.jar, `?card=${renalCards[0]?.id}`)).cards[0]?.front === renalCards[0]?.front,
    `${e1.status} v${hView1?.contentVersion} notes-card edit ${editAi.status}`);
  const bm = await send("PATCH", `${FC}/${renalCards[1]?.id}`, { bookmarked: true }, A.jar);
  const note = await send("PATCH", `${FC}/${renalCards[1]?.id}`, { note: "Learn the stage thresholds by heart." }, A.jar);
  const lib1 = await send("GET", `${FC}?deck=bookmarked`, undefined, A.jar);
  ok("F4e. a card is bookmarked (and given a private note), and it appears in the Bookmarked cards deck",
    bm.status === 200 && note.status === 200 && (lib1.json.cards ?? []).length === 1 && lib1.json.cards[0].id === renalCards[1]?.id && lib1.json.cards[0].bookmarked === true && lib1.json.cards[0].note === "Learn the stage thresholds by heart.",
    `${bm.status} ${note.status} bookmarked deck: ${(lib1.json.cards ?? []).length}`);
  const ren = await send("PATCH", `/api/individual/scholar/flashcards/decks/${D1}`, { title: "Renal system: AKI and fluid balance" }, A.jar);
  const tmp = await send("POST", `${FC}/decks`, { title: "Scratch deck", cardIds: [respCards[0]?.id].filter(Boolean) }, A.jar);
  const del = await send("DELETE", `/api/individual/scholar/flashcards/decks/${tmp.json.id}`, undefined, A.jar);
  const stillThere = (await cardsOf(A.jar, `?card=${respCards[0]?.id}`)).cards.length === 1;
  const deckRow = (await admin.from("individual_scholar_flashcard_deck").select("title, organise_by, organise_ref").eq("id", D1).maybeSingle()).data as any;
  ok("F4f. a deck is renamed (organisation kept), and a deck made from chosen cards can be removed with its cards kept",
    ren.status === 200 && deckRow?.title === "Renal system: AKI and fluid balance" && deckRow?.organise_by === "module" && tmp.status === 200 && del.status === 200 && stillThere, `${ren.status} ${tmp.status} ${del.status} kept:${stillThere}`);
  const decksPage = await page(`${FC_PAGE}?view=decks`, A.jar);
  const cardsPage = await page(`${FC_PAGE}?view=cards`, A.jar);
  show("pages", { decks: decksPage.status, decksShowTitles: decksPage.visible.includes("Renal system: AKI and fluid balance") && decksPage.visible.includes("Respiratory assessment"), cards: cardsPage.status, yourCardLabel: cardsPage.visible.includes(LEARNER_CARD_LABEL), handFront: cardsPage.visible.includes(HAND_EDIT.front) });
  ok("F4g. My Decks shows both decks; All cards shows the hand-written card labelled 'Your card · written by you, not clinically reviewed'",
    decksPage.status === 200 && decksPage.visible.includes("Renal system: AKI and fluid balance") && decksPage.visible.includes("Respiratory assessment") && cardsPage.status === 200 && cardsPage.visible.includes(LEARNER_CARD_LABEL) && cardsPage.visible.includes(HAND_EDIT.front));

  // ════════ F5-F8. study, rate, leave, resume, finish, reload ════════
  console.log("\n── F5-F8. study session 1 on the renal deck ──");
  const s1 = await send("POST", "/api/individual/scholar/revision/sessions", { mode: "flashcards", deck: D1 }, A.jar);
  const S1 = s1.json.session?.id as string;
  const sv = await send("GET", `/api/individual/scholar/revision/sessions/${S1}`, undefined, A.jar);
  const order = (sv.json.items ?? []).map((i: any) => i.id as string);
  const deckNow = (await cardsOf(A.jar, `?deck=${D1}`)).cards;
  const backs = deckNow.map(c => c.back as string).filter(b => b.length > 6);
  show("session 1", { status: s1.status, total: s1.json.session?.total, generated: s1.json.generated, items: order.length });
  ok("F7a. a deck study session is made from stored cards only, with no AI (generated 0), every card of the deck in it",
    s1.status === 200 && !!S1 && s1.json.generated === 0 && order.length === deckNow.length && deckNow.every(c => order.includes(c.id)), `${order.length} of ${deckNow.length}`);
  const studyPage0 = await page(`${FC_PAGE}?session=${S1}`, A.jar);
  ok("F5a. the study page renders the card front (Question, tap to reveal) and NO back is in the page before it is revealed",
    studyPage0.status === 200 && studyPage0.visible.includes("Tap to reveal answer") && !backs.some(b => studyPage0.all.includes(b)), `status ${studyPage0.status} backs leaked: ${backs.filter(b => studyPage0.all.includes(b)).length}`);
  const rv = await send("POST", "/api/individual/scholar/revision/answer", { questionId: order[0], sessionId: S1, reveal: true }, A.jar);
  const revealCard = deckNow.find(c => c.id === order[0]);
  const attemptsAfterReveal = (await admin.from("individual_scholar_attempt").select("id", { count: "exact", head: true }).eq("user_id", A.id)).count;
  ok("F5b. reveal (the flip) returns the back, its source and origin label, and records nothing",
    rv.status === 200 && rv.json.back === revealCard?.back && !!rv.json.card?.originLabel && attemptsAfterReveal === 0, `${rv.status} attempts ${attemptsAfterReveal}`);
  pend("F5c. flip on desktop/tablet/mobile", "coordinator (browser check)");

  // Ratings: a mix, the hand-written card included.
  const plan: Record<string, "again" | "remembered"> = {};
  order.forEach((id, i) => { plan[id] = i % 3 === 1 ? "again" : "remembered"; });
  plan[H] = "again";
  const before = new Map<string, any>();
  for (const id of order) before.set(id, await cardRow(A.id, id));
  const rated: string[] = [];
  const rate = async (id: string) => {
    const r = await send("POST", "/api/individual/scholar/revision/answer", { questionId: id, sessionId: S1, response: { quality: RECALL[plan[id]].quality } }, A.jar);
    if (r.status === 200) rated.push(id);
    return r;
  };
  const firstHalf = order.slice(0, 3);
  const rr = [];
  for (const id of firstHalf) rr.push(await rate(id));
  // "Leave": the learner goes away. Come back by the session link: the same session, resumed where they were.
  const back1 = await send("GET", `/api/individual/scholar/revision/sessions/${S1}`, undefined, A.jar);
  const resumePage = await page(`${FC_PAGE}?session=${S1}`, A.jar);
  const sRow = (await admin.from("individual_scholar_revision_session").select("status, position").eq("id", S1).maybeSingle()).data as any;
  show("resume", { status: back1.status, answered: (back1.json.answered ?? []).map((a: any) => a.questionId === firstHalf[(back1.json.answered ?? []).indexOf(a)]), position: back1.json.session?.position, row: sRow, page: resumePage.status });
  ok("F8a. after leaving, the session is resumed: the same session, still active, with the three cards already rated recorded as answered",
    back1.status === 200 && back1.json.session?.status !== "completed" && (back1.json.answered ?? []).length === 3 && firstHalf.every(id => (back1.json.answered ?? []).some((a: any) => a.questionId === id)) && resumePage.status === 200,
    `answered ${(back1.json.answered ?? []).length} position ${back1.json.session?.position} status ${back1.json.session?.status}`);
  const again = await send("POST", "/api/individual/scholar/revision/answer", { questionId: firstHalf[0], sessionId: S1, response: { quality: 4 } }, A.jar);
  ok("F6a. a card rated once in a session cannot be rated twice in it (409)", again.status === 409, `${again.status}`);
  // One card (not the hand-written one) is left unrated, to show an unstudied card stays new.
  const leaveOut = order.length > 4 ? [...order].reverse().find(id => id !== H && !firstHalf.includes(id)) : undefined;
  for (const id of order.slice(3).filter(id => id !== leaveOut)) rr.push(await rate(id));
  const unrated = order.filter(id => !rated.includes(id));
  const end1 = await send("PATCH", `/api/individual/scholar/revision/sessions/${S1}`, { complete: true }, A.jar);
  show("session 1 end", { status: end1.status, summary: end1.json.summary, rated: rated.length, unrated: unrated.length, ratingStatuses: rr.map(r => r.status) });
  const reviews1 = ((await admin.from("individual_scholar_review").select("card_id, quality, interval_days, reviewed_at").eq("user_id", A.id)).data ?? []) as any[];
  const attempts1 = ((await admin.from("individual_scholar_attempt").select("question_id, revision_session_id, marking").eq("user_id", A.id).eq("revision_session_id", S1)).data ?? []) as any[];
  ok("F6b. every recall rating is saved: one attempt in the session and one 391 review row per rated card, quality 1 for Didn't remember and 4 for Remembered",
    rr.every(r => r.status === 200) && attempts1.length === rated.length && reviews1.length === rated.length
    && rated.every(id => attempts1.some(a => a.question_id === id)) && reviews1.map(r => r.quality).sort().join() === rated.map(id => RECALL[plan[id]].quality).sort().join(),
    `attempts ${attempts1.length} reviews ${reviews1.length} rated ${rated.length}`);
  ok("F8b. ending the session marks it completed and summarises it", end1.status === 200 && end1.json.session?.status === "completed" && end1.json.summary?.answered === rated.length, `${end1.status}`);

  // The SM-2 schedule, card by card, against the shared scheduler with the policy's bounds.
  const sched: string[] = []; let schedOk = rated.length > 0;
  for (const id of rated) {
    const prev = before.get(id), row = await cardRow(A.id, id);
    const card = deckNow.find(c => c.id === id);
    const exp = scheduleRecall({ ease: Number(prev?.ease_factor ?? 2.5), interval: prev?.interval_days ?? 0, reps: prev?.repetitions ?? 0 }, plan[id], card?.difficulty ?? null, srs);
    const good = !!row && Number(row.ease_factor) === exp.ease && row.interval_days === exp.interval && row.repetitions === exp.reps && row.next_review_at === plusDays(exp.interval) && row.last_quality === RECALL[plan[id]].quality && row.reviews === (prev?.reviews ?? 0) + 1;
    if (!good) schedOk = false;
    sched.push(`${plan[id]}: ease ${row?.ease_factor} (exp ${exp.ease}) interval ${row?.interval_days} (exp ${exp.interval}) next ${row?.next_review_at} reps ${row?.repetitions}${good ? "" : " MISMATCH"}`);
  }
  show("F7 schedules after session 1", sched);
  ok("F7b. each rated card is rescheduled by the existing SM-2: Remembered (4) 1 day, ease kept; Didn't remember (1) tomorrow, ease down 0.54", schedOk);

  const reload = await cardsOf(A.jar, `?deck=${D1}`);
  const hist = reload.cards.map(c => ({ id: c.id, state: c.review.state, next: c.review.nextReviewAt, history: c.review.history.map((h: any) => `${h.recall}:${h.quality}`) }));
  show("F8 deck reloaded", hist.map(h => `${h.state} next:${h.next} [${h.history.join(",")}]`));
  ok("F8c. loading the deck again shows each card's correct history and next review: rated cards with one review of the grade given; unrated ones not studied",
    reload.status === 200 && reload.cards.every(c => rated.includes(c.id)
      ? c.review.history.length === 1 && c.review.history[0].quality === RECALL[plan[c.id]].quality && c.review.reviews === 1 && c.review.state === (plan[c.id] === "again" ? "needs_practice" : "remembered") && !!c.review.nextReviewAt && c.review.nextReviewAt > today()
      : c.review.reviews === 0 && c.review.state === "new" && c.review.history.length === 0));
  const due = await send("POST", "/api/individual/scholar/revision/sessions", { mode: "flashcards", deck: D1, only: "due" }, A.jar);
  ok("F7c. 'due today' on the deck now offers only the cards not yet studied (rated cards are scheduled for later)",
    unrated.length ? due.status === 200 && due.json.session?.total === unrated.length : due.status === 404, `${due.status} total ${due.json.session?.total} unrated ${unrated.length}`);
  const histPage = await page(`${FC_PAGE}?view=history`, A.jar);
  show("history page", { status: histPage.status, needs: histPage.visible.includes("Needs more practice"), remembered: histPage.visible.includes("Remembered"), front: rated.some(id => histPage.visible.includes(deckNow.find(c => c.id === id)?.front ?? "~~")) });
  ok("F8d. the Revision History page shows the reviews (Remembered / Needs more practice) with the cards' fronts",
    histPage.status === 200 && histPage.visible.includes("Needs more practice") && histPage.visible.includes("Remembered") && rated.some(id => histPage.visible.includes(deckNow.find(c => c.id === id)?.front ?? "~~")));

  // Edit after reviews: schedule and history untouched.
  const hBefore = await cardRow(A.id, H);
  const e2 = await send("PATCH", `${FC}/${H}`, HAND_EDIT2, A.jar);
  const hAfter = await cardRow(A.id, H);
  const hView2 = (await cardsOf(A.jar, `?card=${H}`)).cards[0];
  ok("F4h. editing a reviewed hand-written card raises its version (3) and leaves its schedule and review history untouched",
    e2.status === 200 && hView2?.contentVersion === 3 && hView2?.front === HAND_EDIT2.front && JSON.stringify(hBefore) === JSON.stringify(hAfter) && hView2?.review.history.length === (rated.includes(H) ? 1 : 0), `${e2.status} v${hView2?.contentVersion}`);

  // Move a reviewed card from the renal deck to the respiratory deck (as a test of the move; the history must follow).
  const mover = rated.find(id => id !== H && plan[id] === "remembered") ?? rated[0];
  const histBeforeMove = JSON.stringify((await cardsOf(A.jar, `?card=${mover}`)).cards[0]?.review);
  const mv = await send("PATCH", `/api/individual/scholar/flashcards/decks/${D1}`, { remove: [mover], moveTo: D2 }, A.jar);
  const afterMove = (await cardsOf(A.jar, `?card=${mover}`)).cards[0];
  const inD1 = (await cardsOf(A.jar, `?deck=${D1}`)).cards.some(c => c.id === mover), inD2 = (await cardsOf(A.jar, `?deck=${D2}`)).cards.some(c => c.id === mover);
  ok("F4i. a reviewed card moved between decks leaves the first, joins the second, and keeps its schedule and review history exactly",
    mv.status === 200 && !inD1 && inD2 && JSON.stringify(afterMove?.review) === histBeforeMove && afterMove?.deckIds?.includes(D2) && !afterMove?.deckIds?.includes(D1), `${mv.status} inD1:${inD1} inD2:${inD2}`);
  if (mover !== undefined) { const back = await send("PATCH", `/api/individual/scholar/flashcards/decks/${D2}`, { remove: [mover], moveTo: D1 }, A.jar); show("moved back", back.status); }

  // Session 2: the second review of each rated card, on the same scheduler.
  console.log("\n── F7. study session 2 (second reviews) ──");
  const s2 = await send("POST", "/api/individual/scholar/revision/sessions", { mode: "flashcards", deck: D1 }, A.jar);
  const S2 = s2.json.session?.id as string;
  const two = [rated.find(id => plan[id] === "remembered"), rated.find(id => plan[id] === "again")].filter((x): x is string => !!x);
  const sched2: string[] = []; let sched2Ok = two.length === 2;
  for (const id of two) {
    const prev = await cardRow(A.id, id);
    const r = await send("POST", "/api/individual/scholar/revision/answer", { questionId: id, sessionId: S2, response: { quality: 4 } }, A.jar);
    const row = await cardRow(A.id, id);
    const card = deckNow.find(c => c.id === id);
    const exp = scheduleRecall({ ease: Number(prev.ease_factor), interval: prev.interval_days, reps: prev.repetitions }, "remembered", card?.difficulty ?? null, srs);
    const good = r.status === 200 && Number(row.ease_factor) === exp.ease && row.interval_days === exp.interval && row.repetitions === exp.reps && row.next_review_at === plusDays(exp.interval);
    if (!good) sched2Ok = false;
    sched2.push(`${plan[id]} then remembered: reps ${prev.repetitions}->${row.repetitions} interval ${prev.interval_days}->${row.interval_days} (exp ${exp.interval}) ease ${prev.ease_factor}->${row.ease_factor} (exp ${exp.ease}) next ${row.next_review_at} difficulty ${card?.difficulty}${good ? "" : " MISMATCH"}`);
  }
  await send("PATCH", `/api/individual/scholar/revision/sessions/${S2}`, { complete: true }, A.jar);
  show("F7 schedules after session 2", sched2);
  ok("F7d. a second Remembered grows the interval by SM-2 (a card remembered twice: 6 days, or the policy's harder share; a lapsed card restarts at 1)", sched2Ok);
  const final = (await cardsOf(A.jar, `?card=${two[0]}`)).cards[0];
  ok("F8e. the revision history of a card reviewed in two sessions reads newest first: remembered, remembered",
    final?.review.history.length === 2 && final.review.history.every((h: any) => h.recall === "remembered") && final.review.history[0].at >= final.review.history[1].at, JSON.stringify(final?.review.history));
  summary.schedules = { session1: sched, session2: sched2 };

  // ════════ F9-F13. downloads ════════
  console.log("\n── F9-F13. downloads (and no AI) ──");
  const aiBefore = await aiCounts([A.id, B.id]);
  const renalNow = (await cardsOf(A.jar, `?deck=${D1}`)).cards, respNow = (await cardsOf(A.jar, `?deck=${D2}`)).cards;
  const head = await fetch(`${BASE}${FC}/export?format=deck&deck=${D1}`, { method: "HEAD", headers: { Cookie: cookieHeader(A.jar) } });
  const deck1 = await getBytes(`${FC}/export?format=deck&deck=${D1}`, A.jar);
  const print1 = await getBytes(`${FC}/export?format=print&deck=${D1}`, A.jar);
  const printS = await getBytes(`${FC}/export?format=print&deck=${D1}&layout=single`, A.jar);
  const guide1 = await getBytes(`${FC}/export?format=guide&deck=${D1}`, A.jar);
  const guide2 = await getBytes(`${FC}/export?format=guide&deck=${D1}&deck=${D2}`, A.jar);
  const selected = [...renalNow.slice(0, 3), ...respNow.slice(0, 2)].map(c => c.id);
  const notSelected = [...renalNow.slice(3), ...respNow.slice(2)];
  const guideSel = await getBytes(`${FC}/export?format=guide&${selected.map(id => `card=${id}`).join("&")}`, A.jar);
  const deck2 = await getBytes(`${FC}/export?format=deck&deck=${D1}&deck=${D2}`, A.jar);
  const aiAfter = await aiCounts([A.id, B.id]);
  for (const [n, f] of [["deck-renal", deck1], ["print-renal-duplex", print1], ["print-renal-single", printS], ["guide-renal", guide1], ["guide-renal+respiratory", guide2], ["guide-selected-5-cards", guideSel], ["deck-renal+respiratory", deck2]] as const)
    if (f.status === 200) savePdf(`flashcards-${n}.pdf`, f.bytes);
  show("downloads", Object.fromEntries([["deck1", deck1], ["print1", print1], ["printS", printS], ["guide1", guide1], ["guide2", guide2], ["guideSel", guideSel], ["deck2", deck2]].map(([k, f]: any) => [k, `${f.status} ${f.type} ${f.bytes.byteLength}B ${f.cache} ${f.disposition}`])));

  const pd = deck1.status === 200 ? await parsePdf(deck1.bytes) : null;
  show("deck PDF", pd ? { pages: pd.pages, a4: pd.a4, page1: pd.pageText[0]?.slice(0, 400) } : null);
  ok("F9. a single deck downloads as a PDF (attachment, no-store) with every card's question and answer, the labels, source and disclaimer, on A4",
    head.status === 204 && deck1.status === 200 && deck1.type === "application/pdf" && /attachment/.test(deck1.disposition) && /no-store/.test(deck1.cache) && !!pd && pd.a4 && pd.pages >= 1
    && renalNow.every(c => has(pd.flat, c.front) && has(pd.flat, c.back)) && has(pd.flat, "Question") && has(pd.flat, "Answer") && has(pd.flat, FLASHCARD_PDF_DISCLAIMER) && has(pd.flat, "Renal system: AKI and fluid balance"),
    pd ? `pages ${pd.pages}; missing: ${renalNow.filter(c => !has(pd.flat, c.front) || !has(pd.flat, c.back)).map(c => c.front).join(" | ")}` : `${deck1.status}`);

  const pp = print1.status === 200 ? await parsePdf(print1.bytes) : null;
  const ps = printS.status === 200 ? await parsePdf(printS.bytes) : null;
  const sheets = Math.ceil(renalNow.length / 8);
  const frontsOn = (t: string) => renalNow.filter(c => has(norm(t), c.front)).length, backsOn = (t: string) => renalNow.filter(c => has(norm(t), c.back)).length;
  show("print PDF", pp ? { pages: pp.pages, a4: pp.a4, sizes: pp.sizes[0], perPage: pp.pageText.map(t => `fronts ${frontsOn(t)} backs ${backsOn(t)}`), page2: pp.pageText[1]?.slice(0, 300) } : null);
  show("print single PDF", ps ? { pages: ps.pages, a4: ps.a4, perPage: ps.pageText.map(t => `fronts ${frontsOn(t)} backs ${backsOn(t)}`) } : null);
  ok("F10a. printable cards: a valid A4 PDF, duplex -- question pages and answer pages alternate (2 per sheet of 8), every question on a front page and every answer on the back page behind it",
    !!pp && pp.a4 && pp.pages === 2 * sheets && pp.pageText.every((t, i) => i % 2 === 0 ? frontsOn(t) > 0 : backsOn(t) > 0)
    && renalNow.every(c => pp.pageText.some((t, i) => i % 2 === 0 && has(norm(t), c.front)) && pp.pageText.some((t, i) => i % 2 === 1 && has(norm(t), c.back))) && has(pp.flat, "flip on long edge"),
    pp ? `pages ${pp.pages} (expected ${2 * sheets})` : `${print1.status}`);
  ok("F10b. the single-sided layout is also A4 with question and answer side by side on the same page",
    !!ps && ps.a4 && renalNow.every(c => ps.pageText.some(t => has(norm(t), c.front) && has(norm(t), c.back))), ps ? `pages ${ps.pages}` : `${printS.status}`);

  const g = guide1.status === 200 ? await parsePdf(guide1.bytes) : null;
  const gm = guide2.status === 200 ? await parsePdf(guide2.bytes) : null;
  const gs = guideSel.status === 200 ? await parsePdf(guideSel.bytes) : null;
  const heads = ["Key Concepts", "Questions and Answers", "Quick Revision Checklist", "References"];
  const guideChecks = (x: Awaited<ReturnType<typeof parsePdf>> | null, cs: any[]) => x ? {
    a4: x.a4, pages: x.pages, headings: heads.filter(h => has(x.flat, h)), clinicalApplication: has(x.flat, "Clinical Application"), contents: has(x.flat, "Contents"),
    questions: cs.filter(c => has(x.flat, c.front)).length, answers: cs.filter(c => has(x.flat, c.back)).length, of: cs.length,
    disclaimer: has(x.flat, FLASHCARD_PDF_DISCLAIMER), notesRef: has(x.flat, "Renal system lecture") || has(x.flat, "Respiratory assessment lecture"),
  } : null;
  const gc = guideChecks(g, renalNow), gmc = guideChecks(gm, [...renalNow, ...respNow]), gsc = guideChecks(gs, [...renalNow.slice(0, 3), ...respNow.slice(0, 2)]);
  show("guide (renal)", gc); show("guide (renal + respiratory decks)", gmc); show("guide (5 selected cards from both decks)", gsc);
  if (g) { const ki = g.pageText.findIndex(t => /Key Concepts/.test(t)); show("guide Key Concepts page (excerpt)", (g.pageText[ki] ?? "").slice(0, 600)); const ri = g.pageText.findIndex((t, i) => i > 0 && /References/.test(t) && /notes/i.test(t)); show("guide References page (excerpt)", (g.pageText[ri >= 0 ? ri : g.pages - 1] ?? "").slice(-600)); }
  ok("F12. the revision guide has its headings (Key Concepts = summaries, Questions and Answers, Quick Revision Checklist, References), every question and answer, the disclaimer and the note references, on A4",
    !!gc && gc.a4 && gc.headings.length === 4 && gc.questions === gc.of && gc.answers === gc.of && gc.disclaimer && gc.notesRef, JSON.stringify(gc));
  ok("F11a. two decks combine into one revision guide: both decks' cards, the title naming both",
    !!gmc && gmc.a4 && gmc.headings.length === 4 && gmc.questions === gmc.of && has(gm!.flat, "Renal system: AKI and fluid balance") && has(gm!.flat, "Respiratory assessment"), JSON.stringify(gmc));
  ok("F11b. cards selected from both decks combine into one guide holding exactly those cards",
    !!gsc && gsc.questions === gsc.of && gsc.answers === gsc.of && notSelected.every(c => !has(gs!.flat, c.front)), `${JSON.stringify(gsc)} unselected present: ${notSelected.filter(c => gs && has(gs.flat, c.front)).length}`);
  const pd2 = deck2.status === 200 ? await parsePdf(deck2.bytes) : null;
  ok("F11c. two decks download as one deck PDF too", !!pd2 && [...renalNow, ...respNow].every(c => has(pd2.flat, c.front)), pd2 ? `pages ${pd2.pages}` : `${deck2.status}`);
  show("AI counts around the exports", { before: aiBefore, after: aiAfter });
  ok("F13. assembling seven PDFs made no AI call (plat_ai_requests overall and the fixtures' ledger unchanged)",
    JSON.stringify(aiBefore) === JSON.stringify(aiAfter), `${JSON.stringify(aiBefore)} -> ${JSON.stringify(aiAfter)}`);
  const ex = ((await admin.from("audit_log").select("new_value").eq("actor_id", A.id).eq("action", "individual_scholar_flashcard_export")).data ?? []) as any[];
  ok("F13b. each export is audited by code and count only (no card words)", ex.length === 7 && ex.every(r => !JSON.stringify(r.new_value).includes(renalNow[0]?.front?.slice(0, 20) ?? "~~")), `${ex.length} rows`);

  // ════════ F14. a second learner ════════
  console.log("\n── F14. a second learner tries learner 1's cards and decks ──");
  const nb = await uploadText(B.jar, NOTE_B, "Cardiac notes.txt");
  const bCard = nb.id ? await send("POST", FC, { materialId: nb.id, front: "What is the natural pacemaker of the heart?", back: "The sinoatrial node." }, B.jar) : { status: 0, json: {} as any };
  const bDeck = await send("POST", `${FC}/decks`, { title: "Cardiac" }, B.jar);
  const aIds = [...renalNow, ...respNow].map(c => c.id);
  const aFronts = [...renalNow, ...respNow].map(c => c.front);
  const t: Record<string, string> = {};
  const readCards = await send("GET", `${FC}?${aIds.slice(0, 5).map(id => `card=${id}`).join("&")}`, undefined, B.jar);
  t.readCards = `${readCards.status} cards:${(readCards.json.cards ?? []).length}`;
  const readDeck = await send("GET", `${FC}?deck=${D1}`, undefined, B.jar);
  t.readDeck = `${readDeck.status} cards:${(readDeck.json.cards ?? []).length}`;
  const readAll = await send("GET", FC, undefined, B.jar);
  const bAllIds = (readAll.json.cards ?? []).map((c: any) => c.id);
  t.readAll = `${readAll.status} cards:${bAllIds.length}`;
  const exDeck = await getBytes(`${FC}/export?format=deck&deck=${D1}`, B.jar);
  const exGuide = await getBytes(`${FC}/export?format=guide&deck=${D1}&deck=${D2}`, B.jar);
  const exCards = await getBytes(`${FC}/export?format=print&${aIds.slice(0, 4).map(id => `card=${id}`).join("&")}`, B.jar);
  t.export = `${exDeck.status}/${exGuide.status}/${exCards.status} ${exDeck.type}`;
  const study = await send("POST", "/api/individual/scholar/revision/sessions", { mode: "flashcards", deck: D1 }, B.jar);
  const studyIds = await send("POST", "/api/individual/scholar/revision/sessions", { mode: "flashcards", cardIds: aIds.slice(0, 3) }, B.jar);
  t.study = `${study.status}/${studyIds.status}`;
  const sess = await send("GET", `/api/individual/scholar/revision/sessions/${S1}`, undefined, B.jar);
  const sessEnd = await send("PATCH", `/api/individual/scholar/revision/sessions/${S1}`, { complete: true }, B.jar);
  t.session = `${sess.status}/${sessEnd.status}`;
  const reveal = await send("POST", "/api/individual/scholar/revision/answer", { questionId: aIds[0], reveal: true }, B.jar);
  const rateA = await send("POST", "/api/individual/scholar/revision/answer", { questionId: aIds[0], response: { quality: 4 } }, B.jar);
  t.answer = `${reveal.status}/${rateA.status} back:${reveal.json.back ? "LEAK" : "none"}`;
  const editA = await send("PATCH", `${FC}/${H}`, { front: "What did learner B write?", back: "Overwritten." }, B.jar);
  const markA = await send("PATCH", `${FC}/${aIds[0]}`, { bookmarked: true }, B.jar);
  const delA = await send("DELETE", `${FC}/${H}`, undefined, B.jar);
  t.cardWrites = `${editA.status}/${markA.status}/${delA.status}`;
  const deckA = await send("PATCH", `/api/individual/scholar/flashcards/decks/${D1}`, { title: "Taken" }, B.jar);
  const deckDel = await send("DELETE", `/api/individual/scholar/flashcards/decks/${D1}`, undefined, B.jar);
  const steal = bDeck.json.id ? await send("PATCH", `/api/individual/scholar/flashcards/decks/${bDeck.json.id}`, { add: aIds.slice(0, 2) }, B.jar) : { status: 0, json: {} };
  const genInto = await send("POST", "/api/individual/scholar/revision/sessions", { mode: "flashcards", scope: { kind: "document", materialId: renal.id }, quantity: 2, deckId: D1 }, B.jar);
  t.deckWrites = `${deckA.status}/${deckDel.status} add-A-cards-to-B-deck:${steal.status} generate-into-A-deck:${genInto.status}`;
  const bStealRows = bDeck.json.id ? ((await admin.from("individual_scholar_flashcard_deck_card").select("question_id").eq("deck_id", bDeck.json.id)).data ?? []) as any[] : [];
  const bMarkRows = ((await admin.from("individual_scholar_flashcard_mark").select("question_id").eq("user_id", B.id)).data ?? []) as any[];
  const aDeckRow = (await admin.from("individual_scholar_flashcard_deck").select("title").eq("id", D1).maybeSingle()).data as any;
  const aHand = (await cardsOf(A.jar, `?card=${H}`)).cards[0];
  const bStudyPage = await page(`${FC_PAGE}?session=${S1}`, B.jar);
  const bCardsPage = await page(`${FC_PAGE}?view=cards`, B.jar);
  const bDeckPage = await page(`${FC_PAGE}?deck=deck:${D1}`, B.jar);
  t.pages = `${bStudyPage.status}/${bCardsPage.status}/${bDeckPage.status} A-fronts-visible:${aFronts.filter(f => bStudyPage.all.includes(f) || bCardsPage.all.includes(f) || bDeckPage.all.includes(f)).length}`;
  const anon = await getBytes(`${FC}/export?format=deck&deck=${D1}`, new Map());
  t.anonymous = `${anon.status} ${anon.type}`;
  show("F14 attempts by learner B", t);
  ok("F14a. learner B cannot READ learner A's cards or decks: by card id, by deck id, or in B's own list (B sees only B's card)",
    readCards.status === 200 && (readCards.json.cards ?? []).length === 0 && readDeck.status === 200 && (readDeck.json.cards ?? []).length === 0
    && bCard.status === 200 && bAllIds.length === 1 && bAllIds[0] === bCard.json.id && !bAllIds.some((id: string) => aIds.includes(id)));
  ok("F14b. learner B cannot EXPORT learner A's deck, decks or cards (404, no PDF); nobody signed out can export",
    [exDeck, exGuide, exCards].every(x => x.status === 404 && !/pdf/.test(x.type)) && anon.status !== 200 && !/pdf/.test(anon.type));
  ok("F14c. learner B cannot study, reveal, rate or resume learner A's cards or sessions (404)",
    study.status === 404 && studyIds.status === 404 && sess.status === 404 && sessEnd.status === 404 && reveal.status === 404 && rateA.status === 404 && !reveal.json.back);
  ok("F14d. learner B cannot edit, delete, bookmark, rename, delete or take into a deck learner A's cards and decks; A's data unchanged",
    editA.status === 404 && delA.status === 404 && markA.status !== 200 && deckA.status === 404 && deckDel.status === 404 && steal.status !== 200 && genInto.status === 404
    && bStealRows.length === 0 && bMarkRows.length === 0 && aDeckRow?.title === "Renal system: AKI and fluid balance" && aHand?.front === HAND_EDIT2.front,
    `mark:${markA.status} ${markA.json.error ?? ""} steal:${steal.status} ${(steal as any).json?.error ?? ""}`);
  ok("F14e. learner B's pages show none of learner A's cards (the study link of A's session is 'not found')",
    bStudyPage.visible.includes("That study session could not be found") && aFronts.every(f => !bStudyPage.all.includes(f) && !bCardsPage.all.includes(f) && !bDeckPage.all.includes(f)));
  summary.F14 = t;

  // ════════ G. AI routing and cost ════════
  console.log("\n── G. AI routing and cost ──");
  let totalUsd = 0;
  for (const [n, s] of [["A", A], ["B", B]] as const) {
    const r = await routing(s.id);
    totalUsd += r.usd;
    show(`${n} (${r.source})`, { calls: r.calls, usd: r.usd, operations: r.operations });
    const okSteps = r.steps.filter(x => x.status === "ok");
    if (n === "A") ok(`G-Aa. every AI call by A ran on a model eligible for its activity, on a configured route`,
      okSteps.length > 0 && okSteps.every(x => x.eligible && x.routed), okSteps.filter(x => !x.eligible || !x.routed).map(x => `${x.operation}:${x.activity}:${x.model}`).join(", ") || `${okSteps.length} calls`);
    else ok("G-Ba. learner B made no AI call (upload, a hand-written card and refused attempts only)", r.calls === 0, `${r.calls}`);
    const refused = refusals.filter(x => x.jar === s.jar);
    ok(`G-${n}b. no eligibility refusal and no failed AI call for ${n}`, refused.length === 0 && r.steps.every(x => x.status === "ok"), JSON.stringify(refused.map(x => `${x.path} ${x.status}`)));
    summary[`G_${n}`] = { calls: r.calls, usd: r.usd, operations: r.operations };
  }

  // ════════ the coordinator's browser fixture (kept) ════════
  console.log("\n── browser fixture (kept for the coordinator) ──");
  const C = await makeStudent(grantor, BROWSER, BROWSER_PW);
  let cDeck: string | null = null, cCards = 0;
  if (C.consent === 200) {
    const n = await uploadText(C.jar, NOTE_RENAL, "Renal system lecture.txt");
    const dk = await send("POST", `${FC}/decks`, { title: "Renal system (browser check)" }, C.jar);
    cDeck = dk.json.id ?? null;
    if (n.id && cDeck) {
      await send("POST", "/api/individual/scholar/revision/sessions", { mode: "flashcards", scope: { kind: "document", materialId: n.id }, quantity: 5, deckId: cDeck }, C.jar);
      await send("POST", FC, { materialId: n.id, deckId: cDeck, ...HAND }, C.jar);
      cCards = (await cardsOf(C.jar, `?deck=${cDeck}`)).cards.length;
    }
  }
  const cr = C.id ? await routing(C.id) : { usd: 0, calls: 0 };
  totalUsd += cr.usd;
  if (C.signIn === 200 && C.consent === 200 && cDeck && cCards > 0)
    writeFileSync(BROWSER_FIXTURE_FILE, `email: ${BROWSER}\npassword: ${BROWSER_PW}\ndeck: ${BASE}${FC_PAGE}?view=decks (deck "Renal system (browser check)", ${cCards} cards)\nkept by scholar-flashcards-acceptance-harness (staging); remove with FLASHCARDS_REMOVE_BROWSER_FIXTURE=1\n`);
  ok("BF. the flashcards browser fixture is signed up with one renal deck of AI and hand-written cards; credentials written to the file only",
    C.signIn === 200 && C.terms === 200 && C.consent === 200 && !!cDeck && cCards > 1, JSON.stringify([C.signIn, C.terms, C.consent, cCards, cr.calls]));
  summary.browserFixture = { email: BROWSER, cards: cCards, aiCalls: cr.calls, usd: cr.usd, file: BROWSER_FIXTURE_FILE };
  summary.totalUsd = +totalUsd.toFixed(6);
  summary.pdfs = savedPdfs;
  ok("E1. total AI spend for the run is under $1", totalUsd < 1, `$${totalUsd.toFixed(4)}`);

  await finishWithCleanup(policyBefore, countsBefore);
}

async function finishWithCleanup(policyBefore: string, countsBefore: Record<string, number> | null) {
  console.log("\n── F15 + Z. nothing verified created; cleanup ──");
  const countsAfter = await verificationCounts().catch(() => null);
  if (countsBefore && countsAfter) {
    const changed = Object.keys({ ...countsBefore, ...countsAfter }).filter(t => countsBefore[t] !== countsAfter[t]).map(t => `${t}: ${countsBefore[t]} -> ${countsAfter[t]}`);
    show("F15 tables", `${Object.keys(countsAfter).length} (${Object.keys(countsAfter).join(", ")})`);
    ok("F15. no row was written to competency_verification_*, assessments*, estate osce_*, DACUM/rating or any Passport / verification table", changed.length === 0, changed.join("; "));
  } else pend("F15", "STAGING_DB_URL not set: the counts could not be read");
  ok("Z1. staging platform/individual settings are byte-for-byte as before the run (this run changed none)", (await policyRows()) === policyBefore);
  await cleanup();
  const gone = await Promise.all(Object.values(FIX).map(findUser));
  ok("Z2. fixture identities, their files and rows are gone (the browser fixtures are kept on purpose)", gone.every(u => !u));
  const osce = await findUser(OSCE_BROWSER);
  show("Z3 OSCE browser fixture still present", !!osce);
  console.log(`\nSUMMARY-JSON ${JSON.stringify(summary)}`);
  console.log(`\n${fails.length ? `FAILED -- ${pass} passed, ${fails.length} failed${pends.length ? `, ${pends.length} pending` : ""}` : `ALL GREEN -- ${pass} passed, 0 failed${pends.length ? `, ${pends.length} pending` : ""}`}`);
  if (fails.length) { console.log(`  failed: ${fails.join(" | ")}`); process.exitCode = 1; }
}

let POLICY_BEFORE = "", COUNTS_BEFORE: Record<string, number> | null = null;
main().catch(async e => { console.error(e); fails.push("crash"); await finishWithCleanup(POLICY_BEFORE, COUNTS_BEFORE).catch(() => {}); process.exit(1); });
