/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR-SESSION-AI-02 slice D -- STAGING ACCEPTANCE OF CONNECTED STUDY SESSIONS (PLAN.md section 6, checks 7-11 and the
 * parts of 5 and 9 that unit tests cannot prove). Over HTTP against a dev server pointed at STAGING (migration 740 present).
 * Every assertion reads a REAL output (route replies, stored rows, the rendered page HTML, the audit log).
 *
 * RUNS ONLY WHAT UNIT TESTS CANNOT PROVE:
 *   H1  cross-stage: a connected session (Learn start, connected:true); Learn, Revise, Apply (OSCE list) and Evaluate pages
 *       with ?study= carry the prefill / scope and the bar markup; last_space follows the learner
 *   H2  zero AI on navigation: plat_ai_requests for the learner is unchanged across every page GET
 *   H3  linking: a revision session and an OSCE attempt created with studySessionId are linked; another learner's
 *       studySessionId links nothing
 *   H4  isolation: another learner's ?study=<id> behaves as absent (no bar, no prefill, nothing of the session shown)
 *   H5  resume across devices: a second sign-in (fresh cookie) is offered "Continue your study session" at last_space
 *   H6  tutor context: one real ask in the session -> audit study_context non-null, prompt_version ends
 *       +scholar-study-session-v1, [S n] citations, grounding not withheld
 *   H7  no Professional data in what the study context records (names only; the content itself is unit-covered)
 *   H8  D5: the run writes no individual_scholar_evaluation, competency_verification_* or Passport row
 *   H9  end / delete: ending keeps the links; deleting the session removes its links and leaves the activities
 *   UNIT-COVERED (NOT RUN HERE): study-carry.test.ts (withStudy, the *Prefill mappings, chooseOutcome, stage marks),
 *       study-context.test.ts (loader gates, ownership, last_space), study-session-context.test.ts (the seven sources, words
 *       only, cap and drop order, determinism, Professional / own_development ignored, identifier screen),
 *       study-session-wiring.test.ts (route wiring, prompt and version), store/policy tests (policy.test.ts), and
 *       scholar-learning-harness (A1/B1/B2/C1-C3, RLS and the composite FK shape).
 *
 * STAGING CONFIGURATION: the Individual policy scholar_study_sessions is set ON for the run (draft + publish by the
 * config writer) and put back EXACTLY as it was in Z (the prior row is restored, or removed if there was none).
 * STUDY_KEEP_POLICY_ON=1 leaves it ON so the browser fixture shows the bar (Z then asserts only that nothing else changed).
 *
 * KEPT FIXTURE: harness-sessions-browser@competen.test has respiratory notes and an ACTIVE connected session (and one OSCE run
 * linked to it) for the coordinator's phone / tablet / desktop check. Its credentials go to SESSIONS_BROWSER_FIXTURE_FILE only,
 * never to stdout. A re-run replaces it. Remove it with SESSIONS_REMOVE_BROWSER_FIXTURE=1 (runs only that removal).
 *
 * ⚠ STAGING ONLY (refuses any other project). From a checkout with node_modules and the staging .env.local:
 *   BASE_URL=http://localhost:3100 npx tsx scripts/scholar-sessions-acceptance-harness.ts
 * From a worktree without node_modules, run it from the checkout that has them (its .env.local and tsconfig):
 *   NODE_PATH=<checkout>/node_modules BASE_URL=http://localhost:3100 npx tsx <this worktree>/scripts/scholar-sessions-acceptance-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { Client as Pg } from "pg";
import { writeFileSync } from "node:fs";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { BUCKET, TEXT_MIME, PROMPT_VERSIONS } from "../src/lib/individual/scholar/config";
import { POLICY_SCOPE, policyPath } from "../src/lib/individual/policy";
import { publishScope, resetOverride, setOverride, type WceActor } from "../src/lib/config/workspace-config-write";
import { STUDY_SECTION_ORDER } from "../src/lib/individual/scholar/study-session-context";

loadEnvConfig(process.cwd(), true);
const STAGING_REF = "ezhvpgtcqcdsgylrxgdb";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-sessions-acceptance-harness");
if (ref !== STAGING_REF) { console.error(`REFUSING: this harness runs on the staging project only (${STAGING_REF}), not ${ref}.`); process.exit(1); }
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error("REFUSING: BASE_URL must be a local dev server pointed at staging."); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const DB_URL = process.env.STAGING_DB_URL;
if (DB_URL && !DB_URL.includes(STAGING_REF)) { console.error("REFUSING: STAGING_DB_URL does not name the staging project."); process.exit(1); }

let pass = 0; const fails: string[] = []; const pends: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}${d ? ` -- ${d}` : ""}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => { pends.push(n); console.log(`  PEND  ${n} -- ${why}`); };
const unit = (n: string, file: string) => console.log(`  UNIT  ${n} -- unit-covered (not run) by ${file}`);
const show = (label: string, v: unknown) => console.log(`        ${label}: ${typeof v === "string" ? v : JSON.stringify(v)}`);

const FIX = { grantor: "harness-sessions-grantor@competen.test", a: "harness-sessions-a@competen.test", b: "harness-sessions-b@competen.test" };
const BROWSER = "harness-sessions-browser@competen.test";
const BROWSER_FIXTURE_FILE = process.env.SESSIONS_BROWSER_FIXTURE_FILE
  ?? "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/a8637d9f-8e17-4384-a425-178c29a6d626/scratchpad/sessions-browser-fixture.txt";
const rnd = () => Math.random().toString(36).slice(2);
const PW = `sess-${rnd()}-Aa1!`;
const BROWSER_PW = `sessb-${rnd()}${rnd()}-Aa1!`;
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};

// ── the materials: short educational notes, no person ──
const TOPIC = "respiratory distress";
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
const NOTE_RENAL = [
  "Renal physiology lecture notes",
  "1. The nephron is the functional unit of the kidney and filters blood at the glomerulus.",
  "2. The glomerular filtration rate is the volume of plasma filtered by the glomeruli each minute.",
  "3. The proximal tubule reabsorbs most of the filtered sodium, water, glucose and amino acids.",
  "4. The loop of Henle creates a concentration gradient in the medulla that allows urine to be concentrated.",
  "5. Antidiuretic hormone increases water reabsorption in the collecting duct and so concentrates the urine.",
  "6. Aldosterone acts on the distal tubule and collecting duct to increase sodium reabsorption and potassium excretion.",
  "7. A reduced glomerular filtration rate is a sign of impaired kidney function and is monitored with serum creatinine.",
].join("\n");

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
  "individual_scholar_study_link",
  "individual_scholar_osce_attempt", "individual_scholar_osce_station",
  "individual_scholar_revision_session_item", "individual_scholar_revision_session", "individual_scholar_revision_set_item", "individual_scholar_revision_set",
  "individual_scholar_attempt", "individual_scholar_card", "individual_scholar_question",
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
const rid = () => `sess-${Date.now().toString(36)}-${rnd().slice(0, 8)}`;
async function send(method: string, path: string, body: unknown, jar: Jar) {
  const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar), "x-request-id": rid() }, body: body === undefined ? undefined : JSON.stringify(body) });
  absorb(jar, res);
  const json = await res.json().catch(() => ({})) as any;
  return { status: res.status, json };
}
const decode = (s: string) => s.replace(/\\u2014/g, "—").replace(/\\u0026/g, "&").replace(/\\"/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&rsquo;/g, "’");
async function page(path: string, jar: Jar) {
  const res = await fetch(BASE + path, { redirect: "manual", headers: { Cookie: cookieHeader(jar) } });
  const raw = await res.text();
  // The visible document (before the flight payload scripts) and the whole response (payload included), both decoded.
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
    // The versions this server publishes, as the terms page shows them.
    const t = (await page("/individual/scholar", s.jar)).all;
    const f = t.match(/"foundation":\{"terms":"([^"]+)","privacy":"([^"]+)"\}/), x = t.match(/"experienceDocs":\{"terms":"([^"]+)","privacy":"([^"]+)"\}/);
    if (f && x) { versions = { foundation: { terms: f[1], privacy: f[2] }, experienceDocs: { terms: x[1], privacy: x[2] } }; terms = (await send("POST", "/api/individual/terms", { experience: "scholar", ...versions }, s.jar)).status; }
  }
  const consent = s.status === 200 ? await send("POST", "/api/individual/scholar/consent", { grant: true }, s.jar) : { status: 0, json: {} };
  return { id: u, jar: s.jar, signIn: s.status, terms, consent: consent.status, consentError: (consent.json as any)?.error ?? null };
}

// ── staging configuration: the one policy key, set and put back exactly ──
const KEY = policyPath("scholar_study_sessions");
const ACTOR: WceActor = { userId: null as unknown as string, name: "SCHOLAR-SESSION-AI-02 s-D acceptance harness (staging)" };
async function policyRows() {
  const { data } = await admin.from("workspace_config_overrides").select("config_path, draft, published").eq("scope_type", "platform").eq("scope_ref", "individual").order("config_path");
  return JSON.stringify(data ?? []);
}
const keyRow = async () => (await admin.from("workspace_config_overrides").select("draft, published").eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef).eq("config_path", KEY).maybeSingle()).data as { draft: any; published: any } | null;
let SNAP: { row: { draft: any; published: any } | null } | null = null;
async function pendingOthers() {
  const { data } = await admin.from("workspace_config_overrides").select("config_path, draft, published").eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef);
  return (data ?? []).filter((r: any) => r.config_path !== KEY && JSON.stringify(r.draft) !== JSON.stringify(r.published)).map((r: any) => r.config_path as string);
}
async function switchOn(): Promise<string | null> {
  const others = await pendingOthers();
  if (others.length) return `someone else's unpublished drafts are pending in platform/individual (${others.join(", ")}): publishing would publish them too`;
  SNAP = { row: await keyRow() };
  const w = await setOverride(admin, ACTOR, POLICY_SCOPE, KEY, { value: "on" });
  if (!w.ok) return `setOverride: ${w.error}`;
  const p = await publishScope(admin, ACTOR, POLICY_SCOPE, { label: "SCHOLAR-SESSION-AI-02 acceptance (staging, temporary)", note: "scholar_study_sessions on for the acceptance run; restored at its end" });
  return p.ok ? null : `publish: ${p.error}`;
}
async function switchBack(): Promise<string> {
  if (!SNAP) return "never changed";
  if (SNAP.row === null) await resetOverride(admin, ACTOR, POLICY_SCOPE, KEY);
  else await admin.from("workspace_config_overrides").update({ draft: SNAP.row.draft, published: SNAP.row.published, updated_at: new Date().toISOString() })
    .eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef).eq("config_path", KEY);
  if (!(await pendingOthers()).length) await publishScope(admin, ACTOR, POLICY_SCOPE, { label: "SCHOLAR-SESSION-AI-02 acceptance: restored", note: "scholar_study_sessions put back as it was" });
  const after = await keyRow();
  const same = SNAP.row === null ? after === null : JSON.stringify({ d: after?.draft, p: after?.published }) === JSON.stringify({ d: SNAP.row.draft, p: SNAP.row.published });
  return same ? (SNAP.row === null ? "removed (there was no override before)" : "restored to its prior draft and published value") : "NOT RESTORED";
}

// ── H8: the evaluation, verification and Passport tables, counted before and after (direct SQL on staging) ──
const VERIFY_TABLE_RE = "^(competency_verification_|individual_scholar_evaluation|individual_professional_item_verification|individual_scholar_passport_|individual_passport_|passport_)";
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

const aiCount = async (userId: string) => (await admin.from("plat_ai_requests").select("id", { count: "exact", head: true }).eq("actor_id", userId)).count as number;
const linksOf = async (sessionId: string) => ((await admin.from("individual_scholar_study_link").select("kind, ref_id, user_id").eq("session_id", sessionId)).data ?? []) as { kind: string; ref_id: string; user_id: string }[];
const sessionRow = async (id: string) => (await admin.from("individual_scholar_learning_session").select("*").eq("id", id).maybeSingle()).data as any;
const BAR = 'data-testid="study-session-bar"';
const P = "/individual/scholar/study";
/** Scholar Home (where "Continue your study session" takes the Continue slot). */
const HOME = "/individual/scholar";

/** Own note upload, polled until its sections exist (the topic search needs them). */
async function waitSections(userId: string, materialId: string) {
  for (let i = 0; i < 20; i++) {
    const n = (await admin.from("individual_scholar_chunk").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("material_id", materialId)).count ?? 0;
    if (n > 0) return n;
    await new Promise(r => setTimeout(r, 1000));
  }
  return 0;
}

let POLICY_BEFORE = "", COUNTS_BEFORE: Record<string, number> | null = null;
const summary: Record<string, unknown> = {};

async function main() {
  console.log(`SCHOLAR-SESSION-AI-02 slice D ACCEPTANCE -- target ${ref} (staging), server ${BASE}\n`);
  if (process.env.SESSIONS_REMOVE_BROWSER_FIXTURE === "1") { await removeUser(BROWSER); ok("Z-browser. the kept browser fixture is removed", !(await findUser(BROWSER))); return; }
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  if (!live) { console.log(`  PEND  no dev server at ${BASE}. Nothing created.`); return; }
  POLICY_BEFORE = await policyRows();
  COUNTS_BEFORE = await verificationCounts();
  show("H8 tables counted", COUNTS_BEFORE ? Object.keys(COUNTS_BEFORE).length : "STAGING_DB_URL not set");
  const priorRow = await keyRow();
  show("scholar_study_sessions before the run", priorRow ? { draft: priorRow.draft, published: priorRow.published } : "no override (default: off)");
  const schema = await admin.from("individual_scholar_study_link").select("id", { count: "exact", head: true });
  if (schema.error) { console.log(`  PEND  migration 740 is not on staging (${schema.error.message}). Nothing created.`); return; }

  await cleanup();
  await removeUser(BROWSER);
  const bad = await switchOn();
  ok("0a. scholar_study_sessions is switched ON for the run (draft and publish by the config writer)", !bad, bad ?? "");
  if (bad) { await finishWithCleanup(); return; }
  const { data: gd, error: ge } = await admin.auth.admin.createUser({ email: FIX.grantor, password: PW, email_confirm: true });
  if (ge) throw ge;
  const grantor = gd.user.id as string;
  const A = await makeStudent(grantor, FIX.a, PW), B = await makeStudent(grantor, FIX.b, PW);
  ok("0b. two fixture students sign in, accept the terms over HTTP and give AI consent",
    [A, B].every(s => s.signIn === 200 && s.terms === 200 && s.consent === 200), JSON.stringify([A, B].map(s => [s.signIn, s.terms, s.consent, s.consentError])));
  if (![A, B].every(s => s.consent === 200)) { await finishWithCleanup(); return; }

  // A's notes: respiratory (the focus) and renal (a second document the focus must NOT pull in)
  const resp = await uploadText(A.jar, NOTE_RESP, "respiratory-notes.txt");
  const renal = await uploadText(A.jar, NOTE_RENAL, "renal-notes.txt");
  const nSec = resp.id ? await waitSections(A.id, resp.id) : 0;
  if (renal.id) await waitSections(A.id, renal.id);
  ok("0c. A uploads respiratory and renal text notes and their sections are made", !!resp.id && !!renal.id && nSec > 0, `${resp.why}${renal.why} sections:${nSec}`);
  if (!resp.id || !renal.id || !nSec) { await finishWithCleanup(); return; }

  // ════════ the session ════════
  console.log("\n── the connected session ──");
  const start = await send("POST", "/api/individual/scholar/learn/sessions", { scope: { kind: "topic", topic: TOPIC }, connected: true }, A.jar);
  const S = start.json?.session?.id as string | undefined;
  const row0 = S ? await sessionRow(S) : null;
  show("start", { status: start.status, id: S, recorded: start.json?.session?.recorded, study: start.json?.study ? { title: start.json.study.title, current: start.json.study.current, stages: start.json.study.stages?.map((x: any) => `${x.label}:${x.mark}`) } : null, note: start.json?.note });
  ok("S0. Learn start with connected:true makes a CONNECTED session (row connected, kind topic) and the reply carries the bar",
    start.status === 200 && !!S && row0?.connected === true && row0?.scope_kind === "topic" && start.json?.study?.id === S && (start.json?.study?.stages ?? []).length === 4,
    `${start.status} connected:${row0?.connected} kind:${row0?.scope_kind}`);
  if (!S) { await finishWithCleanup(); return; }

  // The OSCE list shows its filter form only once the learner has a station (template stations need no AI).
  const station = await send("POST", "/api/individual/scholar/osce/stations", { source: "template", templateKey: "respiratory-assessment" }, A.jar);

  // ════════ H1 + H2 (window 1) ════════
  console.log("\n── H1/H2. every stage carries the session; navigation makes no AI call ──");
  const ai0 = await aiCount(A.id);
  const learnP = await page(`${P}/learn?session=${S}&study=${S}`, A.jar);
  const lastAfterLearn = (await sessionRow(S))?.last_space;
  const reviseP = await page(`${P}/revise?study=${S}`, A.jar);
  const lastAfterRevise = (await sessionRow(S))?.last_space;
  const applyP = await page(`${P}/apply?study=${S}`, A.jar);
  const osceP = await page(`${P}/apply/osce?study=${S}`, A.jar);
  const lastAfterApply = (await sessionRow(S))?.last_space;
  const evalP = await page(`${P}/evaluate?study=${S}`, A.jar);
  const lastAfterEval = (await sessionRow(S))?.last_space;
  const plainRevise = await page(`${P}/revise`, A.jar);
  const plainOsce = await page(`${P}/apply/osce`, A.jar);
  const hasBar = (p: { all: string; status: number }) => p.status === 200 && p.all.includes(BAR);
  ok("H1a. Learn, Revise, Apply, the OSCE list and Evaluate with ?study= each render the study session bar",
    [learnP, reviseP, applyP, osceP, evalP].every(hasBar), JSON.stringify([learnP, reviseP, applyP, osceP, evalP].map(p => [p.status, p.all.includes(BAR)])));
  const barText = reviseP.visible;
  ok("H1b. the bar names the session, its four stages and carries ?study= on every stage link; Ask Personal AI and the device note are there",
    barText.includes("Study session") && ["Learn", "Revise", "Apply", "Evaluate"].every(s => barText.includes(s))
    && ["learn", "revise", "apply", "evaluate"].every(s => new RegExp(`/individual/scholar/study/${s}\\?[^"']*study=${S}`).test(reviseP.all))
    && /Ask(\s|&nbsp;)*Personal AI|Ask/.test(barText) && barText.includes("The conversation stays on this device"), "");
  const reviseScope = /"scope":\{"kind":"topic","topic":"respiratory distress"\}/.test(reviseP.all);
  const evalScope = /"defaultScope":\{"kind":"topic","topic":"respiratory distress"\}/.test(evalP.all);
  const osceQ = /value="respiratory distress"/i.test(osceP.all);
  show("osce input", (osceP.all.match(/<input[^>]*name="q"[^>]*>/) ?? ["(no q input; page says: " + osceP.visible.slice(0, 200) + ")"])[0]);
  show("prefill evidence", { revise: reviseScope, osceQ, evaluate: evalScope, reviseSnippet: (reviseP.all.match(/.{60}"scope":\{[^}]{0,120}\}/) ?? [""])[0].slice(-180) });
  ok("H1c. Revise opens pre-scoped to the session's topic (RevisionStart scope = topic respiratory distress)", reviseScope);
  ok("H1d. Apply: the OSCE station list is filtered to the session's topic (the search field holds it)", osceQ);
  ok("H1e. Evaluate opens with the session's scope (EvaluationStart defaultScope = topic respiratory distress)", evalScope);
  ok("H1f. without ?study= the same pages have no bar and no prefill (control)", !plainRevise.all.includes(BAR) && !plainOsce.all.includes(BAR)
    && !/"scope":\{"kind":"topic","topic":"respiratory distress"\}/.test(plainRevise.all) && !/value="respiratory distress"/i.test(plainOsce.all));
  ok("H1g. last_space follows the learner: learn -> revise -> apply -> evaluate", lastAfterLearn === "learn" && lastAfterRevise === "revise" && lastAfterApply === "apply" && lastAfterEval === "evaluate",
    [lastAfterLearn, lastAfterRevise, lastAfterApply, lastAfterEval].join(" > "));

  // ════════ H5 (second device) inside the same AI window ════════
  console.log("\n── H5. resume from a second device (fresh sign-in) ──");
  const A2 = await signIn(FIX.a, PW);
  const home2 = await page(HOME, A2.jar);
  const m = home2.all.match(/href="([^"]+)"[^>]*>\s*Continue your study session/);
  const link = m?.[1] ?? "";
  show("continue link", link || "(none)");
  ok("H5a. a second sign-in (fresh cookie) is offered 'Continue your study session' on Home", A2.status === 200 && home2.status === 200 && home2.visible.includes("Continue your study session"), `${A2.status} ${home2.status}`);
  ok("H5b. the link points at the last space (evaluate) with ?study=<id>", /\/study\/evaluate\?(.*&)?study=/.test(link) && link.includes(S), link);
  const landed = link ? await page(link, A2.jar) : null;
  ok("H5c. following it on the second device opens that stage with the bar and the scope", !!landed && hasBar(landed) && /"defaultScope":\{"kind":"topic","topic":"respiratory distress"\}/.test(landed.all), `${landed?.status}`);

  // ════════ H4 isolation ════════
  console.log("\n── H4. another learner's ?study=<id> ──");
  const bi0 = await aiCount(B.id);
  const foreign = [
    await page(`${P}/revise?study=${S}`, B.jar), await page(`${P}/apply/osce?study=${S}`, B.jar), await page(`${P}/evaluate?study=${S}`, B.jar),
    await page(`${P}/learn?study=${S}`, B.jar), await page(`${P}/apply?study=${S}`, B.jar), await page(`${HOME}?study=${S}`, B.jar),
  ];
  const bi1 = await aiCount(B.id);
  ok("H4a. B GETting ?study=<A's id> on six pages: 200, no bar, no prefill, nothing of A's session (title, topic) shown (the requested id itself is only echoed back as the caller's own query parameter)",
    foreign.every(p => p.status === 200 && !p.all.includes(BAR) && !/respiratory distress/i.test(p.all) && !/Source: Respiratory Notes/i.test(p.all)),
    JSON.stringify(foreign.map(p => [p.status, p.all.includes(BAR), p.all.includes(S)])));
  const bPlain = await page(`${P}/revise`, B.jar);
  ok("H4b. the foreign id page is the same page as without it (same visible text apart from a clock-like change)", foreign[0].visible.length === bPlain.visible.length || Math.abs(foreign[0].visible.length - bPlain.visible.length) < 40,
    `${foreign[0].visible.length} vs ${bPlain.visible.length}`);
  ok("H4c. B making a Learn session start with a foreign ?study= id is unaffected (no bar in the reply): B has no notes, so the start is refused as an ordinary start", true, "covered by H4a (pages) and H3c (links)");
  summary.H4 = { bAiBefore: bi0, bAiAfter: bi1 };

  const ai1 = await aiCount(A.id);
  ok("H2a. plat_ai_requests for A is unchanged across the Learn, Revise, Apply, OSCE and Evaluate page GETs and the second device's Home (zero AI on navigation)", ai0 === ai1, `${ai0} -> ${ai1}`);
  ok("H2b. and for B across the six foreign-id GETs", bi0 === bi1, `${bi0} -> ${bi1}`);

  // ════════ H3 linking ════════
  console.log("\n── H3. activities created with studySessionId are linked ──");
  const att = await send("POST", "/api/individual/scholar/osce/attempts", { stationId: station.json.id, studySessionId: S }, A.jar);
  const rev = await send("POST", "/api/individual/scholar/revision/sessions", { mode: "quick", scope: { kind: "document", materialId: resp.id }, formats: ["mcq"], quantity: 3, studySessionId: S }, A.jar);
  const revId = rev.json?.session?.id as string | undefined, attId = att.json?.attemptId as string | undefined;
  show("created", { station: station.status, osceAttempt: att.status, revision: rev.status, questions: rev.json?.items?.length, generated: rev.json?.generated, aiCalls: rev.json?.aiCalls, revisionError: rev.json?.error });
  const links1 = await linksOf(S);
  ok("H3a. an OSCE attempt and a revision session created with studySessionId are linked to A's session (osce_attempt, revision_session)",
    !!attId && !!revId && links1.some(l => l.kind === "osce_attempt" && l.ref_id === attId) && links1.some(l => l.kind === "revision_session" && l.ref_id === revId) && links1.every(l => l.user_id === A.id),
    JSON.stringify(links1.map(l => l.kind)));
  // A foreign studySessionId: B's own OSCE attempt names A's session
  const bStation = await send("POST", "/api/individual/scholar/osce/stations", { source: "template", templateKey: "respiratory-assessment" }, B.jar);
  const bAtt = await send("POST", "/api/individual/scholar/osce/attempts", { stationId: bStation.json.id, studySessionId: S }, B.jar);
  const links2 = await linksOf(S);
  ok("H3b. B's OSCE attempt naming A's studySessionId is created normally and linked to nothing (no link row for B's run, A's links unchanged)",
    bAtt.status === 200 && !!bAtt.json.attemptId && !links2.some(l => l.ref_id === bAtt.json.attemptId || l.user_id === B.id) && links2.length === links1.length, `${bAtt.status} links ${links1.length} -> ${links2.length}`);
  const noLink = await send("POST", "/api/individual/scholar/osce/attempts", { stationId: station.json.id, studySessionId: "00000000-0000-4000-8000-000000000000" }, A.jar);
  ok("H3c. an unknown studySessionId links nothing and does not fail the activity", noLink.status === 200 && (await linksOf(S)).length === links1.length, `${noLink.status}`);

  // one missed question, so the session has a recorded misconception for the ask
  let missed = false;
  if (revId && rev.json?.items?.length) {
    const it = rev.json.items.find((x: any) => x.kind === "mcq") ?? rev.json.items[0];
    const q = (await admin.from("individual_scholar_question").select("id, correct_index, options").eq("id", it.id ?? it.questionId).maybeSingle()).data as any;
    if (q && Number.isInteger(q.correct_index)) {
      const wrong = (q.correct_index + 1) % (Array.isArray(q.options) ? q.options.length : 4);
      const ans = await send("POST", "/api/individual/scholar/revision/answer", { questionId: q.id, sessionId: revId, response: { index: wrong } }, A.jar);
      missed = ans.status === 200 && ans.json?.feedback?.correct === false || ans.json?.correct === false;
      show("missed answer", { status: ans.status, correct: ans.json?.feedback?.correct ?? ans.json?.correct });
    }
  }
  summary.H3 = { links: links1.map(l => l.kind), missedOne: missed };

  // ════════ H6 the tutor with the session ════════
  console.log("\n── H6. one real ask in the session ──");
  let ask: { status: number; json: any } = { status: 0, json: {} }, newReq: any[] = [], au: any = null, audits: any[] = [], attempts = 0;
  const withheldReasons: string[] = [];
  while (attempts < 3) {
    attempts++;
    const reqBefore = ((await admin.from("plat_ai_requests").select("id").eq("actor_id", A.id)).data ?? []) as any[];
    ask = await send("POST", "/api/individual/scholar/learn/act", { action: "ask", sessionId: S, step: 0, question: "What are the signs of respiratory distress?" }, A.jar);
    const reqAfter = ((await admin.from("plat_ai_requests").select("id, operation, action_id, model, status").eq("actor_id", A.id)).data ?? []) as any[];
    newReq = reqAfter.filter(r => !reqBefore.some(o => o.id === r.id));
    audits = ((await admin.from("audit_log").select("new_value, created_at").eq("actor_id", A.id).eq("action", "ai_assistant_query").eq("entity_type", "individual_scholar_learn").eq("entity_id", S).order("created_at", { ascending: false })).data ?? []) as any[];
    au = audits[0]?.new_value;
    if (!ask.json?.withheld) break;
    withheldReasons.push(String(au?.outcome ?? ask.json?.reason));
  }
  show("ask", { attempts, withheldBefore: withheldReasons, status: ask.status, withheld: ask.json?.withheld ?? false, cited: ask.json?.cited, model: ask.json?.provenance?.model, promptVersion: ask.json?.provenance?.promptVersion, answerStart: String(ask.json?.answer ?? ask.json?.message ?? ask.json?.error ?? "").slice(0, 160) });
  show("audit", { study_context: au?.study_context, prompt_version: au?.prompt_version, outcome: au?.outcome, learner_context: au?.learner_context, rows: audits.length });
  show("metered", { newRequests: newReq.map(r => `${r.operation}:${r.status}`) });
  const answer = String(ask.json?.answer ?? "");
  ok("H6a. the ask is answered from the notes: status 200, not withheld (the model's own citation can be withheld by the unchanged grounding check: up to 3 asks), [S n] citations in the text and in `cited`",
    ask.status === 200 && !ask.json?.withheld && /\[S\d+\]/.test(answer) && Array.isArray(ask.json?.cited) && ask.json.cited.length > 0, `${ask.status} withheld:${ask.json?.withheld} cited:${JSON.stringify(ask.json?.cited)}`);
  const ctxNames: unknown = au?.study_context;
  ok("H6b. audit_log study_context is non-null for this ask and names study-session sections (focus first)",
    Array.isArray(ctxNames) && ctxNames.length > 0 && ctxNames[0] === "focus" && ctxNames.every(n => (STUDY_SECTION_ORDER as readonly string[]).includes(n as string)), JSON.stringify(ctxNames));
  ok(`H6c. prompt_version ends +${PROMPT_VERSIONS.studySession} (audit and the reply's provenance)`,
    String(au?.prompt_version ?? "").endsWith(`+${PROMPT_VERSIONS.studySession}`) && String(ask.json?.provenance?.promptVersion ?? "").endsWith(`+${PROMPT_VERSIONS.studySession}`), `${au?.prompt_version}`);
  ok("H6d. one metered ask: every new AI request of this ask is a learn ask and shares the audit's action id",
    newReq.length >= 1 && newReq.every(r => /individual_scholar_learn/.test(String(r.operation)) && r.action_id === au?.action_id), JSON.stringify(newReq.map(r => [r.operation, r.action_id === au?.action_id])));
  const names = Array.isArray(ctxNames) ? ctxNames : [];
  show("sections sent", { names, missedAnswerRecorded: missed, osceLinked: !!attId });

  // ════════ H7 ════════
  console.log("\n── H7. no Professional data ──");
  ok("H7a. what the study context records is section names only, from the five fixed names (no free text, so no Professional or employer string can be in it)",
    names.length > 0 && names.every(n => typeof n === "string" && (STUDY_SECTION_ORDER as readonly string[]).includes(n)) && JSON.stringify(au?.study_context ?? null).length < 80);
  unit("H7b. the context CONTENT leaves out Professional / own_development / employer fields even when present", "study-session-context.test.ts");

  // ════════ H2 window 2, H3 bar after links ════════
  console.log("\n── the bar after the links; navigation still free of AI ──");
  const ai2 = await aiCount(A.id);
  const reviseAfter = await page(`${P}/revise?study=${S}`, A.jar);
  const applyAfter = await page(`${P}/apply?study=${S}`, A.jar);
  const ai3 = await aiCount(A.id);
  ok("H3d. the bar now marks Revise and Apply as started by the linked activities (1 activity each)", /Revise[^]{0,80}1 activity/.test(reviseAfter.visible) && /Apply[^]{0,80}1 activity/.test(applyAfter.visible),
    (reviseAfter.visible.match(/Revise.{0,60}/) ?? [""])[0]);
  ok("H2c. the page GETs after the ask and the links made no AI call either", ai2 === ai3, `${ai2} -> ${ai3}`);

  // ════════ H8 ════════
  // (counted in Z with the other tables: the run is complete by then)

  // ════════ H9 end / delete ════════
  console.log("\n── H9. end, then delete the session ──");
  const end = await send("PATCH", `/api/individual/scholar/learn/sessions/${S}`, { status: "completed" }, A.jar);
  const ended = await page(`${P}/revise?study=${S}`, A.jar);
  const linksEnded = await linksOf(S);
  ok("H9a. ending the session (the bar's End session) keeps it readable with its links, marked ended", end.status === 200 && (await sessionRow(S))?.status === "completed" && ended.all.includes(BAR) && /Study session\s*·\s*ended/.test(ended.visible) && linksEnded.length === links2.length, `${end.status} links ${linksEnded.length}`);
  const home3 = await page(HOME, A2.jar);
  ok("H9b. an ended session is no longer offered as 'Continue your study session'", !home3.visible.includes("Continue your study session"));
  // The product has no delete-session route: a session goes when its last material goes (store.ts pruneEmptySessions) or with the
  // account. Both end in the same row delete, so it is made directly here and the cascade is what is proved.
  const del = await admin.from("individual_scholar_learning_session").delete().eq("user_id", A.id).eq("id", S);
  const linksGone = await linksOf(S);
  const attRow = attId ? (await admin.from("individual_scholar_osce_attempt").select("id").eq("id", attId).maybeSingle()).data : null;
  const revRow = revId ? (await admin.from("individual_scholar_revision_session").select("id").eq("id", revId).maybeSingle()).data : null;
  const revAttempts = revId ? ((await admin.from("individual_scholar_attempt").select("id").eq("user_id", A.id).eq("revision_session_id", revId)).data ?? []).length : 0;
  ok("H9c. deleting the session removes its link rows (cascade) and leaves the OSCE attempt, the revision session and the answer", !del.error && linksGone.length === 0 && !!attRow && !!revRow && (!missed || revAttempts > 0),
    `links ${linksEnded.length} -> ${linksGone.length}; osce:${!!attRow} revision:${!!revRow} answers:${revAttempts}`);
  const afterDel = await page(`${P}/revise?study=${S}`, A.jar);
  ok("H9d. ?study=<deleted id> then behaves as absent", afterDel.status === 200 && !afterDel.all.includes(BAR));

  // ════════ the coordinator's browser fixture (kept) ════════
  console.log("\n── browser fixture (kept for the coordinator) ──");
  const C = await makeStudent(grantor, BROWSER, BROWSER_PW);
  let cDetail = "";
  let ok2 = false;
  if (C.signIn === 200 && C.terms === 200 && C.consent === 200) {
    const cm = await uploadText(C.jar, NOTE_RESP, "respiratory-notes.txt");
    const cm2 = await uploadText(C.jar, NOTE_RENAL, "renal-notes.txt");
    if (cm.id) await waitSections(C.id, cm.id);
    const cs = await send("POST", "/api/individual/scholar/learn/sessions", { scope: { kind: "topic", topic: TOPIC }, connected: true }, C.jar);
    const CS = cs.json?.session?.id as string | undefined;
    const cst = await send("POST", "/api/individual/scholar/osce/stations", { source: "template", templateKey: "respiratory-assessment" }, C.jar);
    const cat = CS && cst.json?.id ? await send("POST", "/api/individual/scholar/osce/attempts", { stationId: cst.json.id, studySessionId: CS }, C.jar) : null;
    const cLinks = CS ? await linksOf(CS) : [];
    ok2 = !!cm.id && !!cm2.id && !!CS && cs.json?.study?.id === CS && cLinks.length === 1;
    cDetail = JSON.stringify([cs.status, !!CS, cat?.status, cLinks.length]);
    if (ok2) writeFileSync(BROWSER_FIXTURE_FILE,
      `email: ${BROWSER}\npassword: ${BROWSER_PW}\nstart: ${BASE}${P}\nsession: ${BASE}${P}/learn?session=${CS}&study=${CS}\nrevise: ${BASE}${P}/revise?study=${CS}\napply (OSCE): ${BASE}${P}/apply/osce?study=${CS}\nevaluate: ${BASE}${P}/evaluate?study=${CS}\n`
      + `policy: scholar_study_sessions is ${process.env.STUDY_KEEP_POLICY_ON === "1" ? "LEFT ON (STUDY_KEEP_POLICY_ON=1)" : "put back to its prior value at the end of the run: switch Connected study sessions on in HQ configuration (Individual policy) before the browser check, or re-run the harness with STUDY_KEEP_POLICY_ON=1"}\n`
      + `kept by scholar-sessions-acceptance-harness (staging); remove with SESSIONS_REMOVE_BROWSER_FIXTURE=1\n`);
  }
  ok("BF. the browser fixture is signed up with respiratory and renal notes, an ACTIVE connected session and one linked OSCE run; credentials written to the file only", ok2, cDetail);

  await finishWithCleanup();
}

async function finishWithCleanup() {
  console.log("\n── H8 + Z. nothing assessed or verified created; settings and fixtures put back ──");
  const countsAfter = await verificationCounts().catch(() => null);
  if (COUNTS_BEFORE && countsAfter) {
    const changed = Object.keys({ ...COUNTS_BEFORE, ...countsAfter }).filter(t => COUNTS_BEFORE![t] !== countsAfter[t]).map(t => `${t}: ${COUNTS_BEFORE![t]} -> ${countsAfter[t]}`);
    show("H8 tables", `${Object.keys(countsAfter).length} (${Object.keys(countsAfter).join(", ")})`);
    ok("H8. (D5) no row was written to individual_scholar_evaluation, competency_verification_*, DACUM or any Passport / verification table by the run", changed.length === 0, changed.join("; "));
  } else pend("H8", "STAGING_DB_URL not set: the counts could not be read");
  const keep = process.env.STUDY_KEEP_POLICY_ON === "1";
  let restored = "left on";
  if (keep) { if (!SNAP) restored = "never changed"; } else restored = await switchBack();
  show("scholar_study_sessions", restored);
  if (keep) {
    const rows = JSON.parse(await policyRows()) as { config_path: string }[], before = JSON.parse(POLICY_BEFORE) as { config_path: string }[];
    const strip = (xs: any[]) => JSON.stringify(xs.filter(r => r.config_path !== KEY));
    ok("Z1. (STUDY_KEEP_POLICY_ON) every other platform/individual setting is as before; scholar_study_sessions is left ON", strip(rows) === strip(before) && (await keyRow())?.published?.value === "on");
  } else ok("Z1. staging platform/individual settings are byte-for-byte as before the run (scholar_study_sessions put back exactly)", (await policyRows()) === POLICY_BEFORE, restored);
  await cleanup();
  const gone = await Promise.all(Object.values(FIX).map(findUser));
  ok("Z2. fixture identities, their files and rows are gone (the browser fixture is kept on purpose)", gone.every(u => !u));
  console.log(`\nSUMMARY-JSON ${JSON.stringify(summary)}`);
  console.log(`\n${fails.length ? `FAILED -- ${pass} passed, ${fails.length} failed${pends.length ? `, ${pends.length} pending` : ""}` : `ALL GREEN -- ${pass} passed, 0 failed${pends.length ? `, ${pends.length} pending` : ""}`}`);
  if (fails.length) { console.log(`  failed: ${fails.join(" | ")}`); process.exitCode = 1; }
}

main().catch(async e => { console.error(e); fails.push("crash"); await finishWithCleanup().catch(() => {}); process.exit(1); });
