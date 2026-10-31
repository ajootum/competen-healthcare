/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR-OSCE-01 s11 -- THE MANDATORY ACCEPTANCE OF OSCE PRACTICE (Respiratory Assessment), plus Adaptive Exams
 * (SCHOLAR-PRACTICE-EXAMS-01, same PR). Over HTTP against a dev server pointed at STAGING. Every assertion reads a REAL
 * output (route replies, stored rows, the rendered page HTML), and the key outputs are printed so a human can judge them.
 *
 *   O1  a student selects and starts the respiratory assessment station (the Competen practice template)
 *   O2  station instructions and clinical context display (the station page HTML before a run; no guidance yet)
 *   O3  the timer: the server's start and duration, a resume that keeps the clock, a time-up run (by resume and by a
 *       late autosave) finished with what was saved, completion recorded
 *   O4  structured written responses under the station's headings: autosaved mid-run, "reloaded" by fetching the run
 *       again (the resume path), continued and submitted; an identifier is refused, unknown headings dropped
 *   O5  the checklist with its criteria and critical flags (the self-check view and the snapshot the run is marked against)
 *   O6  the self-review: every item marked, the practice score, critical misses
 *   O7  optional AI feedback through an eligible educational model (activity evaluate), six parts, suggested ticks only
 *   O8  results: strengths, gaps (critical first), the score explained, revision activities
 *   O9  the attempt and learning history kept (rows, the station's run history, the station list)
 *   O10 no verified clinical competency, DACUM grade or Passport-verified record is created (before/after counts)
 *   O11 unreviewed station content is clearly identified (template; a station written by AI from notes)
 *   O12 mobile/tablet: checked by the coordinator in a browser (not here)
 *   AD  Adaptive Exams: a programme-aligned exam on a short respiratory note, the difficulty path changing, the report
 *       (strengths, gaps, the exact practice-estimate label), history kept
 *   G   every AI call by the fixtures ran on a model eligible for its activity; no refusal
 *   Z   fixtures removed (except the coordinator's browser fixture, kept on purpose); staging settings unchanged
 *
 * STAGING CONFIGURATION: this run changes NONE (scholar_osce and scholar_adaptive_exams default on). It snapshots every
 * platform/individual Scholar policy row first and Z proves they are byte-for-byte unchanged.
 *
 * TIME-UP RUNS: an 8-minute station cannot be waited out in a harness, so a run's started_at is moved 9 minutes back by
 * the service role (simulated elapsed time). Everything after that -- the resume, the late save, the finish -- is the
 * product's own route on the server's clock.
 *
 * KEPT FIXTURE: harness-osce-browser@competen.test (one respiratory template station) is created for the coordinator's
 * browser check and NOT removed in Z. Its password is written only to OSCE_BROWSER_FIXTURE_FILE, never printed. A re-run
 * replaces it. Remove it later with: OSCE_REMOVE_BROWSER_FIXTURE=1 (runs only Z for it).
 *
 * ⚠ STAGING ONLY (refuses any other project). From a checkout with node_modules and the staging .env.local:
 *   BASE_URL=http://localhost:3100 npx tsx scripts/scholar-practice-acceptance-harness.ts
 * From a worktree without node_modules, run it from the checkout that has them (its .env.local and tsconfig):
 *   NODE_PATH=<checkout>/node_modules BASE_URL=http://localhost:3100 npx tsx <this worktree>/scripts/scholar-practice-acceptance-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { Client as Pg } from "pg";
import { writeFileSync } from "node:fs";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { BUCKET, TEXT_MIME, ADAPTIVE_REPORT_LABEL, ADAPTIVE_RULE } from "../src/lib/individual/scholar/config";
import { OSCE_PRACTICE_LABEL, TEMPLATE_CONTENT_STATUS, OSCE_FEEDBACK_PARTS, claimsVerification, osceTemplate } from "../src/lib/individual/scholar/osce";

loadEnvConfig(process.cwd(), true);
const STAGING_REF = "ezhvpgtcqcdsgylrxgdb";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-practice-acceptance-harness");
if (ref !== STAGING_REF) { console.error(`REFUSING: this harness runs on the staging project only (${STAGING_REF}), not ${ref}.`); process.exit(1); }
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error("REFUSING: BASE_URL must be a local dev server pointed at staging."); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const DB_URL = process.env.STAGING_DB_URL;
if (DB_URL && !DB_URL.includes(STAGING_REF)) { console.error("REFUSING: STAGING_DB_URL does not name the staging project."); process.exit(1); }

let pass = 0; const fails: string[] = []; const pends: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}${d ? ` -- ${d}` : ""}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const pend = (n: string, why: string) => { pends.push(n); console.log(`  PEND  ${n} -- ${why}`); };
const show = (label: string, v: unknown) => console.log(`        ${label}: ${typeof v === "string" ? v : JSON.stringify(v)}`);

const FIX = { grantor: "harness-osce-grantor@competen.test", a: "harness-osce-a@competen.test", b: "harness-osce-b@competen.test" };
const BROWSER = "harness-osce-browser@competen.test";
const OSCE_BROWSER_FIXTURE_FILE = process.env.OSCE_BROWSER_FIXTURE_FILE
  ?? "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/a8637d9f-8e17-4384-a425-178c29a6d626/scratchpad/osce-browser-fixture.txt";
const rnd = () => Math.random().toString(36).slice(2);
const PW = `osce-${rnd()}-Aa1!`;
const BROWSER_PW = `osceb-${rnd()}${rnd()}-Aa1!`;
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};

// ── the material ── a short respiratory lecture note (educational, no person)
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
const SECTIONS = ["Introduction and consent", "Assessment", "Findings", "Escalation and plan"];
const RESP_PARTIAL = { "Introduction and consent": "I would introduce myself by name and role, explain that I would like to assess their breathing, and ask if that is okay before starting." };
const RESP_FULL: Record<string, string> = {
  ...RESP_PARTIAL,
  Assessment: "I would look at how they are breathing, the rhythm and how hard they are working, whether they are using accessory muscles, and listen to the breath sounds on both sides of the chest.",
  Findings: "I would say what I found, for example that the breathing looks laboured, they cannot finish sentences and they look distressed, which are signs of respiratory distress.",
  "Escalation and plan": "I would sit them upright, stay with them and call for help, then hand over to the nurse in charge using SBAR: situation, background, assessment and recommendation.",
};

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
const rid = () => `osce-${Date.now().toString(36)}-${rnd().slice(0, 8)}`;
const refusals: { jar: Jar; path: string; status: number; code: string }[] = [];
async function send(method: string, path: string, body: unknown, jar: Jar) {
  const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar), "x-request-id": rid() }, body: body === undefined ? undefined : JSON.stringify(body) });
  absorb(jar, res);
  const json = await res.json().catch(() => ({})) as any;
  if (json?.code === "not_eligible" || /isn't available for this yet|not eligible/i.test(`${json?.error ?? ""}`)) refusals.push({ jar, path, status: res.status, code: json?.code ?? "words" });
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
const chunksOf = async (userId: string, materialId: string) =>
  ((await admin.from("individual_scholar_chunk").select("id, content").eq("user_id", userId).eq("material_id", materialId).order("ordinal")).data ?? []) as { id: string; content: string }[];
const attemptRow = async (id: string) => (await admin.from("individual_scholar_osce_attempt").select("*").eq("id", id).maybeSingle()).data as any;

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

// ── staging configuration: proved unchanged ──
async function policyRows() {
  const { data } = await admin.from("workspace_config_overrides").select("config_path, draft, published").eq("scope_type", "platform").eq("scope_ref", "individual").order("config_path");
  return JSON.stringify(data ?? []);
}

// ── O10: the verification and Passport tables, counted before and after (direct SQL on staging) ──
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

// ── G: AI routing (the corrected SQIE method) ──
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
/** The allowance activity each route passes to scholarAiRunner, keyed by the operation its call records. */
const routeActivity = (operation: string): string | null => {
  if (/^individual_scholar_osce_station/.test(operation)) return "questions";     // stations/route.ts fromNotes
  if (/^individual_scholar_osce_feedback/.test(operation)) return "evaluate";     // attempts/[id]/route.ts feedback
  if (/^individual_scholar_(revision_|mcq|questions)/.test(operation)) return "questions"; // adaptive-service generateForTarget
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
    steps: steps.map(s => ({ ...s, eligible: !!s.activity && (ELIG.get(s.activity) ?? []).some(e => s.model.startsWith(e.prefix)), routed: !!s.activity && [...(ROUTED.get(s.activity) ?? [])].some(m => s.model.startsWith(m)) })),
  };
}

const summary: Record<string, unknown> = {};
const OSCE_PAGE = "/individual/scholar/study/apply/osce";

async function main() {
  console.log(`SCHOLAR-OSCE-01 s11 + ADAPTIVE ACCEPTANCE -- target ${ref} (staging), server ${BASE}\n`);
  if (process.env.OSCE_REMOVE_BROWSER_FIXTURE === "1") { await removeUser(BROWSER); ok("Z-browser. the kept browser fixture is removed", !(await findUser(BROWSER))); return; }
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  if (!live) { console.log(`  PEND  no dev server at ${BASE}. Nothing created.`); return; }
  await loadEligibility();
  await loadRouting();
  show("eligible (scholar: questions, evaluate)", Object.fromEntries(["questions", "evaluate"].map(a => [a, (ELIG.get(a) ?? []).map(x => `${x.prefix}<=${x.tier}`)])));
  show("routed (scholar: questions, evaluate)", Object.fromEntries(["questions", "evaluate"].map(a => [a, [...(ROUTED.get(a) ?? [])]])));
  const policyBefore = await policyRows();
  const countsBefore = await verificationCounts();
  POLICY_BEFORE = policyBefore; COUNTS_BEFORE = countsBefore;
  show("O10 tables counted", countsBefore ? Object.keys(countsBefore).length : "STAGING_DB_URL not set");

  await cleanup();
  await removeUser(BROWSER);
  const { data: gd, error: ge } = await admin.auth.admin.createUser({ email: FIX.grantor, password: PW, email_confirm: true });
  if (ge) throw ge;
  const grantor = gd.user.id as string;
  const A = await makeStudent(grantor, FIX.a, PW), B = await makeStudent(grantor, FIX.b, PW);
  ok("0. two fixture students sign in, accept the terms over HTTP and give AI consent",
    [A, B].every(s => s.signIn === 200 && s.terms === 200 && s.consent === 200), JSON.stringify([A, B].map(s => [s.signIn, s.terms, s.consent, s.consentError])));
  if (![A, B].every(s => s.consent === 200)) { await finishWithCleanup(policyBefore, countsBefore); return; }

  // ════════ O1. select and start ════════
  console.log("\n── O1-O2. select the respiratory station, its brief ──");
  const list0 = await page(OSCE_PAGE, A.jar);
  ok("O1a. the OSCE practice page offers the respiratory assessment template, labelled simulated practice",
    list0.status === 200 && list0.all.includes("Respiratory assessment and escalation") && list0.visible.includes(OSCE_PRACTICE_LABEL), `status ${list0.status}`);
  const made = await send("POST", "/api/individual/scholar/osce/stations", { source: "template", templateKey: "respiratory-assessment" }, A.jar);
  const again = await send("POST", "/api/individual/scholar/osce/stations", { source: "template", templateKey: "respiratory-assessment" }, A.jar);
  const stationId = made.json.id as string;
  ok("O1b. the student selects it: one station is made, and selecting it again returns the same one", made.status === 200 && !!stationId && again.json.id === stationId && again.json.existing === true, `${made.status} ${again.status} existing:${again.json.existing}`);
  if (!stationId) { await finishWithCleanup(policyBefore, countsBefore); return; }
  const stRow = (await admin.from("individual_scholar_osce_station").select("*").eq("id", stationId).single()).data as any;
  const tpl = osceTemplate("respiratory-assessment")!;

  // ════════ O2. instructions and clinical context ════════
  const brief = await page(`${OSCE_PAGE}/${stationId}`, A.jar);
  const briefChecks = {
    title: brief.visible.includes("Respiratory assessment and escalation"),
    scenario: brief.visible.includes(tpl.scenario), task: brief.visible.includes(tpl.candidateInstructions),
    objectives: tpl.objectives.every(o => brief.visible.includes(o)), duration: brief.visible.includes("8 minutes"),
    headings: brief.visible.includes(SECTIONS.join(", ")), bodySystem: brief.visible.includes("Respiratory"),
    profession: brief.visible.includes("Any healthcare profession"), label: brief.visible.includes(OSCE_PRACTICE_LABEL),
    start: brief.visible.includes("Start the station"),
  };
  show("O2 brief checks", briefChecks);
  ok("O2a. the station page shows the scenario, the task, what it practises, 8 minutes, the headings, body system, profession and the practice label",
    brief.status === 200 && Object.values(briefChecks).every(Boolean), Object.entries(briefChecks).filter(([, v]) => !v).map(([k]) => k).join(","));
  const guidanceLeak = brief.all.includes(tpl.guidance.assessmentGuidance!) || tpl.guidance.suggestedResponses.some(s => brief.all.includes(s));
  ok("O2b. no assessment guidance or suggested response reaches the page before a run (shown only after)", !guidanceLeak);
  const checklistInPayload = tpl.checklist.filter(i => brief.all.includes(i.text)).length;
  const checklistVisible = tpl.checklist.filter(i => brief.visible.includes(i.text)).length;
  show("O2 checklist before the run", { visibleItems: checklistVisible, itemsInPagePayload: checklistInPayload, of: tpl.checklist.length });
  summary.O2 = { checklistVisibleBeforeRun: checklistVisible, checklistInPayloadBeforeRun: checklistInPayload };

  // ════════ O3/O4. run 1: autosave, "reload", continue, finish ════════
  console.log("\n── O3-O4. run 1: start, autosave, reload, continue, finish ──");
  const s1 = await send("POST", "/api/individual/scholar/osce/attempts", { stationId }, A.jar);
  const run1 = s1.json.attemptId as string;
  show("start", { status: s1.status, resumed: s1.json.resumed, durationMinutes: s1.json.durationMinutes, startedAt: s1.json.startedAt, serverNow: s1.json.serverNow });
  ok("O3a. starting the station returns the server's start, the duration and the server clock (a new run, not resumed)",
    s1.status === 200 && !!run1 && s1.json.durationMinutes === 8 && !!Date.parse(s1.json.startedAt) && !!Date.parse(s1.json.serverNow) && s1.json.resumed === false);
  const save1 = await send("POST", `/api/individual/scholar/osce/attempts/${run1}`, { action: "save", responses: { ...RESP_PARTIAL, "Not a heading": "dropped" } }, A.jar);
  const afterSave = await attemptRow(run1);
  ok("O4a. a mid-run autosave keeps what is written under the station's headings (an unknown heading is dropped)",
    save1.status === 200 && save1.json.saved === true && JSON.stringify(afterSave?.responses) === JSON.stringify(RESP_PARTIAL) && !!afterSave?.last_saved_at, JSON.stringify(afterSave?.responses));
  const pii = await send("POST", `/api/individual/scholar/osce/attempts/${run1}`, { action: "save", responses: { ...RESP_PARTIAL, Findings: "Mr Smith, NHS number 943 476 5919, was breathless." } }, A.jar);
  ok("O4b. writing that identifies a patient is refused and not saved", pii.status === 422 && pii.json.identifier === true && JSON.stringify((await attemptRow(run1))?.responses) === JSON.stringify(RESP_PARTIAL), `${pii.status}`);
  // "Reload": the page is left and the run fetched again. The runner does exactly this: POST /attempts with the station.
  const reloadPage = await page(`${OSCE_PAGE}/${stationId}`, A.jar);
  const r1 = await send("POST", "/api/individual/scholar/osce/attempts", { stationId }, A.jar);
  const remaining = r1.json.startedAt ? Math.ceil(r1.json.durationMinutes * 60 - (Date.parse(r1.json.serverNow) - Date.parse(r1.json.startedAt)) / 1000) : null;
  show("reload", { status: r1.status, sameRun: r1.json.attemptId === run1, resumed: r1.json.resumed, responses: r1.json.responses, lastSavedAt: r1.json.lastSavedAt, remainingSeconds: remaining, pageSays: reloadPage.visible.includes("Resume my run") ? "Resume my run" : "?" });
  ok("O3b/O4c. after a reload the same run is RESUMED on the server clock (start unchanged, time left < 8:00) with the autosaved writing, and the page offers Resume",
    r1.status === 200 && r1.json.attemptId === run1 && r1.json.resumed === true && r1.json.startedAt === s1.json.startedAt && remaining !== null && remaining < 480 && remaining > 400
    && JSON.stringify(r1.json.responses) === JSON.stringify(RESP_PARTIAL) && reloadPage.visible.includes("Resume my run"));
  const save2 = await send("POST", `/api/individual/scholar/osce/attempts/${run1}`, { action: "save", responses: RESP_FULL }, A.jar);
  const fin1 = await send("POST", `/api/individual/scholar/osce/attempts/${run1}`, { action: "finish", responses: RESP_FULL }, A.jar);
  const row1 = await attemptRow(run1);
  show("finish", { save: save2.status, status: fin1.status, reply: fin1.json, row: { status: row1?.status, finished_at: row1?.finished_at, duration_seconds: row1?.duration_seconds, time_up: row1?.time_up } });
  ok("O3c/O4d. continuing and submitting: the four written responses are kept once, completion recorded from the server's clock",
    save2.status === 200 && fin1.status === 200 && row1?.status === "finished" && !!row1?.finished_at && row1?.time_up === false && row1?.duration_seconds >= 0 && row1?.duration_seconds < 480
    && SECTIONS.every(s => row1?.responses?.[s] === RESP_FULL[s]));
  const fin1b = await send("POST", `/api/individual/scholar/osce/attempts/${run1}`, { action: "finish", responses: {} }, A.jar);
  const save3 = await send("POST", `/api/individual/scholar/osce/attempts/${run1}`, { action: "save", responses: {} }, A.jar);
  ok("O3d. a finished run cannot be finished again or overwritten by a late save", fin1b.status === 409 && save3.status === 409 && save3.json.closed === true && SECTIONS.every(s => (row1?.responses ?? {})[s] === RESP_FULL[s]), `${fin1b.status} ${save3.status}`);
  ok("O5a. the run keeps the exact station it is marked against: version 1, the 10-item checklist with 5 critical items",
    row1?.station_version === 1 && Array.isArray(row1?.station_snapshot?.checklist) && row1.station_snapshot.checklist.length === 10 && row1.station_snapshot.checklist.filter((i: any) => i.critical).length === 5);

  // ════════ O5. the checklist with criteria and critical flags (the self-check view) ════════
  const check = await page(`${OSCE_PAGE}/${stationId}`, A.jar);
  const critOk = tpl.checklist.every(i => check.visible.includes(i.text));
  const critTags = (check.visible.match(/▲ ?Critical/g) ?? []).length;
  show("O5 self-check page", { heading: check.visible.includes("Check yourself against the checklist"), items: tpl.checklist.filter(i => check.visible.includes(i.text)).length, criticalTags: critTags, aiButton: check.visible.includes("Ask for AI feedback on what I wrote") });
  ok("O5b. the self-check shows every checklist criterion and the critical flag on each of the 5 critical items (word and symbol)",
    check.visible.includes("Check yourself against the checklist") && critOk && critTags >= 5, `critical tags ${critTags}`);

  // ════════ O7. optional AI feedback ════════
  console.log("\n── O7. AI feedback on run 1 ──");
  // A learner may ask again after a withheld reply (the button stays): up to three asks, each outcome recorded.
  const asks: { status: number; reason: string | null; model: string | null }[] = [];
  let fb: { status: number; json: any } = { status: 0, json: {} };
  for (let k = 0; k < 3; k++) {
    fb = await send("POST", `/api/individual/scholar/osce/attempts/${run1}`, { action: "feedback" }, A.jar);
    asks.push({ status: fb.status, reason: fb.json.withheld?.reason ?? (fb.status === 200 ? null : fb.json.error ?? null), model: fb.json.feedback?.model ?? null });
    if (fb.status === 200 || !fb.json.withheld) break;
  }
  const f = fb.json.feedback;
  show("feedback asks", asks);
  show("feedback shown", f ? { model: f.model, promptVersion: f.promptVersion, suggested: f.suggested, parts: f.parts } : fb.json);
  const fbActions = ((await admin.from("plat_ai_requests").select("action_id").eq("actor_id", A.id).eq("operation", "individual_scholar_osce_feedback")).data ?? []).map((r: any) => r.action_id).filter(Boolean);
  const outs = fbActions.length ? ((await admin.from("plat_ai_outcomes").select("outcome, rejection_reasons").in("action_id", fbActions)).data ?? []) as any[] : [];
  show("feedback outcomes recorded", outs.map(o => `${o.outcome}:${(o.rejection_reasons ?? []).join("+")}`));
  summary.O7 = { asks, shown: f ? { model: f.model, suggested: f.suggested, parts: f.parts } : null, outcomes: outs.map(o => `${o.outcome}:${(o.rejection_reasons ?? []).join("+")}`) };
  const feedbackText = f?.parts ? OSCE_FEEDBACK_PARTS.flatMap(k => f.parts[k] ?? []).join(" \n ") : "";
  const evalEligible = !!f?.model && (ELIG.get("evaluate") ?? []).some(e => String(f.model).startsWith(e.prefix));
  ok("O7-first. AI feedback is SHOWN on the learner's first request (not withheld by its own checks)", asks[0]?.status === 200, JSON.stringify(asks[0]));
  ok("O7a. AI feedback is returned through a model eligible for the evaluate activity (within three asks)", fb.status === 200 && evalEligible, `${fb.status} model:${f?.model} asks:${asks.length}`);
  ok("O7b. it has the six parts and suggested ticks for checklist items only, with no pass, mark or claim of competence",
    !!f?.parts && OSCE_FEEDBACK_PARTS.every(k => Array.isArray(f.parts[k])) && Array.isArray(f.suggested) && f.suggested.length > 0
    && f.suggested.every((t: any) => tpl.checklist.some(i => i.id === t.itemId)) && !claimsVerification(feedbackText) && !/\b\d+\s*(%|percent|out of|\/\s*10)\b/i.test(feedbackText));
  const sugg = new Map<string, string>((f?.suggested ?? []).map((t: any) => [t.itemId, t.mark]));
  ok("O7c. the feedback reads the writing honestly: the critical steps NOT written (rate over a full minute, SpO2 against target) are not suggested done",
    !!f && sugg.get("rate") !== "done" && sugg.get("spo2") !== "done", JSON.stringify({ rate: sugg.get("rate"), spo2: sugg.get("spo2"), consent: sugg.get("consent"), escalate: sugg.get("escalate") }));

  // ════════ O6/O8. the self-review and the result ════════
  console.log("\n── O6-O8. self-review and result ──");
  const partial = await send("POST", `/api/individual/scholar/osce/attempts/${run1}`, { action: "mark", ticks: [{ itemId: "intro", mark: "done" }] }, A.jar);
  ok("O6a. a self-review must mark every item (a partial marking is refused with the reason)", partial.status === 400 && /Mark every checklist item/.test(partial.json.error ?? ""), partial.json.error);
  // The learner's OWN honest marks from what they wrote (the product fills AI suggestions only into unmarked items, so the
  // learner's marks are what count): rate, SpO2 and documentation not written; breath sounds and first-line actions partly.
  const OWN: Record<string, string> = { intro: "done", consent: "done", rate: "missed", rhythm: "done", spo2: "missed", sounds: "partly", distress: "done", interventions: "partly", escalate: "done", document: "missed" };
  const ticks = tpl.checklist.map(i => ({ itemId: i.id, mark: OWN[i.id] }));
  const m1 = await send("POST", `/api/individual/scholar/osce/attempts/${run1}`, { action: "mark", ticks, useAi: !!f?.parts }, A.jar);
  const row1m = await attemptRow(run1);
  show("mark reply", { status: m1.status, summary: m1.json.summary, marking: m1.json.marking, criticalMissedIds: m1.json.criticalMissedIds, explanation: m1.json.explanation, strengths: m1.json.result?.strengths, gaps: m1.json.result?.gaps, remediation: (m1.json.remediation ?? []).map((r: any) => r.label), guidance: m1.json.guidance, guidelinesNote: m1.json.guidelinesNote });
  summary.O8 = { summary: m1.json.summary, marking: m1.json.marking, explanation: m1.json.explanation, strengths: m1.json.result?.strengths, gaps: m1.json.result?.gaps, criticalMissed: m1.json.result?.criticalMissed, remediation: (m1.json.remediation ?? []).map((r: any) => r.label) };
  const pts = ticks.reduce((n, t) => n + (t.mark === "done" ? 1 : t.mark === "partly" ? 0.5 : 0), 0);
  ok("O6b. the self-review is recorded once: every tick, the practice score from the marks (done 1, partly 0.5), critical misses counted",
    m1.status === 200 && row1m?.ticks?.length === 10 && Math.abs(Number(row1m?.score) - Math.round((pts / 10) * 1000) / 1000) < 1e-9 && row1m?.critical_missed === ticks.filter(t => t.mark === "missed" && tpl.checklist.find(i => i.id === t.itemId)!.critical).length,
    `${m1.status} score:${row1m?.score} (expected ${pts}/10) critical_missed:${row1m?.critical_missed}`);
  ok("O6c. marking with the AI's suggestions confirmed is recorded as ai_evaluation with the evaluator model kept from the server's copy",
    row1m?.marking === (f?.parts ? "ai_evaluation" : "self_graded") && (!f?.parts || row1m?.evaluator_model === f.model), `${row1m?.marking} ${row1m?.evaluator_model}`);
  const remedyText = (m1.json.remediation ?? []).map((r: any) => r.label).join(" | ");
  const missedCritical = (m1.json.result?.criticalMissed ?? []) as any[];
  ok("O8a. results identify strengths (done items) and gaps, critical misses first and apart",
    (m1.json.result?.strengths ?? []).length > 0 && (m1.json.result?.gaps ?? []).length > 0 && (missedCritical.length === 0 || m1.json.result.gaps[0].critical === true));
  ok("O8b. the score is explained (points, percentage, critical items counted apart, not a pass or fail) and the summary never says pass",
    (m1.json.explanation ?? []).length === 4 && /counts one point if marked done/.test(m1.json.explanation[0]) && /A high score does not cancel a missed critical item|marks no item as critical/.test(m1.json.explanation[2])
    && /not a pass or a fail/.test(m1.json.explanation[3]) && /^Practice score/.test(m1.json.summary ?? "") && !claimsVerification([m1.json.summary, ...(m1.json.explanation ?? [])].join(" ")));
  ok("O8c. revision activities target the gaps (Learn on each weak item, critical first, then Revise) and guidance is given only now",
    (m1.json.remediation ?? []).length >= 2 && (m1.json.remediation ?? []).slice(0, -1).every((r: any) => /^Learn: /.test(r.label)) && (missedCritical.length === 0 || remedyText.includes(missedCritical[0].text))
    && !!m1.json.guidance?.assessmentGuidance && !!m1.json.guidelinesNote, remedyText);
  const result = await page(`${OSCE_PAGE}/${stationId}`, A.jar);
  const rChecks = {
    label: result.visible.includes(OSCE_PRACTICE_LABEL), notReviewed: result.visible.includes("not clinically reviewed"),
    criticalPanel: missedCritical.length ? result.visible.includes(`Critical items missed: ${missedCritical.length}`) && result.visible.includes("a high score does not cancel a missed critical item") : result.visible.includes("No critical item missed"),
    explanation: result.visible.includes("Each of the 10 checklist items counts one point if marked done"), guidance: result.visible.includes("Guidance for this station") && result.visible.includes(tpl.guidance.assessmentGuidance!),
    marking: result.visible.includes(f?.parts ? "your marks, with AI suggestions you confirmed (not verified)" : "your own marks"), history: result.visible.includes("Your runs of this station"),
  };
  show("O8 results page checks", rChecks);
  ok("O8d. the results page shows the practice label, 'not clinically reviewed', the critical panel, the score explanation and the guidance",
    result.status === 200 && Object.values(rChecks).every(Boolean), Object.entries(rChecks).filter(([, v]) => !v).map(([k]) => k).join(","));

  // ════════ O3. time-up runs ════════
  console.log("\n── O3. time-up runs (started_at moved 9 minutes back: simulated elapsed time) ──");
  const back = (id: string) => admin.from("individual_scholar_osce_attempt").update({ started_at: new Date(Date.now() - 9 * 60_000).toISOString() }).eq("id", id);
  const s2 = await send("POST", "/api/individual/scholar/osce/attempts", { stationId }, A.jar);
  const run2 = s2.json.attemptId as string;
  await send("POST", `/api/individual/scholar/osce/attempts/${run2}`, { action: "save", responses: RESP_PARTIAL }, A.jar);
  await back(run2);
  const r2 = await send("POST", "/api/individual/scholar/osce/attempts", { stationId }, A.jar);
  const row2 = await attemptRow(run2);
  show("time-up by return", { status: r2.status, reply: { attemptId: r2.json.attemptId === run2, resumed: r2.json.resumed, finished: r2.json.finished, timeUp: r2.json.timeUp }, row: { status: row2?.status, time_up: row2?.time_up, duration_seconds: row2?.duration_seconds, responses: row2?.responses } });
  ok("O3e. returning after the time ran out finishes the run with what was saved: time up, 8:00 recorded (never more), straight to the self-check",
    r2.status === 200 && r2.json.attemptId === run2 && r2.json.finished === true && r2.json.timeUp === true && row2?.status === "finished" && row2?.time_up === true && row2?.duration_seconds === 480
    && JSON.stringify(row2?.responses) === JSON.stringify(RESP_PARTIAL));
  const m2 = await send("POST", `/api/individual/scholar/osce/attempts/${run2}`, { action: "mark", ticks: tpl.checklist.map(i => ({ itemId: i.id, mark: i.id === "intro" || i.id === "consent" ? "done" : "missed" })) }, A.jar);
  ok("O6d. a self-review without AI is recorded as the learner's own marks (self_graded, no evaluator)", m2.status === 200 && (await attemptRow(run2))?.marking === "self_graded" && (await attemptRow(run2))?.evaluator_model === null, `${m2.status} ${m2.json.summary}`);
  const s3 = await send("POST", "/api/individual/scholar/osce/attempts", { stationId }, A.jar);
  const run3 = s3.json.attemptId as string;
  await send("POST", `/api/individual/scholar/osce/attempts/${run3}`, { action: "save", responses: RESP_PARTIAL }, A.jar);
  await back(run3);
  const late = await send("POST", `/api/individual/scholar/osce/attempts/${run3}`, { action: "save", responses: RESP_FULL }, A.jar);
  const row3 = await attemptRow(run3);
  show("time-up by late save", { status: late.status, reply: late.json, row: { status: row3?.status, time_up: row3?.time_up, duration_seconds: row3?.duration_seconds, responsesKept: Object.keys(row3?.responses ?? {}) } });
  ok("O3f. an autosave arriving after the time (and grace) is refused and the run finished with what was LAST saved",
    late.status === 409 && late.json.closed === true && late.json.timeUp === true && row3?.status === "finished" && row3?.time_up === true && JSON.stringify(row3?.responses) === JSON.stringify(RESP_PARTIAL));
  const s4 = await send("POST", "/api/individual/scholar/osce/attempts", { stationId }, A.jar);
  const run4 = s4.json.attemptId as string;
  const ab = await send("POST", `/api/individual/scholar/osce/attempts/${run4}`, { action: "abandon" }, A.jar);
  const markAb = await send("POST", `/api/individual/scholar/osce/attempts/${run4}`, { action: "mark", ticks }, A.jar);
  ok("O9a. a discarded run is kept as abandoned and can never be marked", ab.status === 200 && (await attemptRow(run4))?.status === "abandoned" && markAb.status === 409, `${ab.status} ${markAb.status}`);

  // ════════ O9. history ════════
  console.log("\n── O9. attempt and learning history ──");
  const rows = ((await admin.from("individual_scholar_osce_attempt").select("id, status, time_up, score, marking, ticks, gaps, revision_suggestions, station_snapshot, responses").eq("user_id", A.id).eq("station_id", stationId)).data ?? []) as any[];
  show("runs kept", rows.map(r => ({ status: r.status, time_up: r.time_up, score: r.score, marking: r.marking, gaps: (r.gaps ?? []).length, revision: (r.revision_suggestions ?? []).length, written: Object.keys(r.responses ?? {}).length })));
  ok("O9b. every run is kept with what was written, its snapshot, and (when marked) ticks, score, gaps and revision suggestions",
    rows.length === 4 && rows.every(r => !!r.station_snapshot && Object.keys(r.responses ?? {}).length >= (r.status === "abandoned" ? 0 : 1))
    && rows.filter(r => r.ticks).length === 2 && rows.filter(r => r.ticks).every(r => Array.isArray(r.gaps) && Array.isArray(r.revision_suggestions)));
  const hist = await page(`${OSCE_PAGE}/${stationId}`, A.jar);
  const lst = await page(OSCE_PAGE, A.jar);
  const histChecks = { timeUpShown: hist.visible.includes("8:00 (time up)"), discarded: hist.visible.includes("discarded"), notMarked: hist.visible.includes("Not marked yet"), scores: (hist.visible.match(/Practice score/g) ?? []).length >= 2, listRuns: lst.visible.includes("4 runs"), listLast: /last: Practice score/.test(lst.visible) };
  show("history pages", histChecks);
  ok("O9c. the station's run history and the station list show every run (time up, discarded, not marked yet, practice scores)", Object.values(histChecks).every(Boolean), Object.entries(histChecks).filter(([, v]) => !v).map(([k]) => k).join(","));

  // ════════ O11. unreviewed content identified ════════
  console.log("\n── O11. unreviewed station content ──");
  ok("O11a. the template station is stored and shown as a practice template, not clinically reviewed (private formative)",
    stRow?.content_status === TEMPLATE_CONTENT_STATUS && stRow?.review_status === "private_formative" && brief.visible.includes(TEMPLATE_CONTENT_STATUS) && lst.visible.includes(TEMPLATE_CONTENT_STATUS), `${stRow?.content_status} / ${stRow?.review_status}`);
  const note = await uploadText(A.jar, NOTE_RESP, "Respiratory assessment lecture.txt");
  if (!note.id) ok("O11b. a respiratory note is uploaded for an AI-written station", false, note.why);
  else {
    const ai = await send("POST", "/api/individual/scholar/osce/stations", { source: "ai", materialId: note.id }, A.jar);
    const aiRow = ai.json.id ? (await admin.from("individual_scholar_osce_station").select("*").eq("id", ai.json.id).single()).data as any : null;
    show("AI station", { status: ai.status, reply: ai.json, row: aiRow ? { title: aiRow.title, content_status: aiRow.content_status, review_status: aiRow.review_status, model: aiRow.model, items: aiRow.checklist.map((i: any) => `${i.critical ? "[C] " : ""}${i.text} <- "${i.quote}"`) } : null });
    summary.O11_ai = { status: ai.status, withheld: ai.json.withheld ?? null, title: aiRow?.title ?? null, contentStatus: aiRow?.content_status ?? null, items: aiRow?.checklist?.map((i: any) => i.text) ?? null };
    if (aiRow) {
      const aiPage = await page(`${OSCE_PAGE}/${aiRow.id}`, A.jar);
      const grounded = aiRow.checklist.every((i: any) => !!i.quote && NOTE_RESP.toLowerCase().replace(/\s+/g, " ").includes(String(i.quote).toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "")));
      ok("O11b. a station written by AI from notes is labelled 'AI-generated from your notes, not clinically reviewed' on the page, each item quoted from the note",
        aiRow.content_status === "AI-generated from your notes, not clinically reviewed" && aiPage.visible.includes("AI-generated from your notes, not clinically reviewed") && aiPage.visible.includes(OSCE_PRACTICE_LABEL) && grounded);
    } else ok("O11b. an AI station from notes is either stored labelled as unreviewed or withheld with nothing kept and recovery offered",
      ai.status === 422 && !!ai.json.withheld && !!ai.json.recovery && !(await admin.from("individual_scholar_osce_station").select("id").eq("user_id", A.id).eq("source", "ai")).data?.length, `${ai.status} ${ai.json.error}`);
  }
  const { loadOsceLibraryStations } = await import("../src/lib/individual/scholar/library-questions");
  const lib = await loadOsceLibraryStations(admin);
  show("O11 governed library stations offered on staging", lib.length);
  ok("O11c. the only stations not labelled unreviewed are governed library copies (published and clinically approved)",
    ((await admin.from("individual_scholar_osce_station").select("source, content_status").eq("user_id", A.id)).data ?? []).every((s: any) => s.source === "library" || /not clinically reviewed/.test(s.content_status)));
  pend("O12. mobile/tablet usable", "coordinator (browser check)");

  // ════════ AD. Adaptive Exams ════════
  console.log("\n── AD. adaptive exam on a short respiratory note, aligned to programme competencies ──");
  const noteB = await uploadText(B.jar, NOTE_RESP, "Respiratory assessment lecture.txt");
  const chB = noteB.id ? await chunksOf(B.id, noteB.id) : [];
  const prog = await send("PUT", "/api/individual/scholar/programme", { code: "nursing-ug-diploma" }, B.jar);
  const { loadLearnerCatalogue } = await import("../src/lib/individual/scholar/competency-view");
  const cat = await loadLearnerCatalogue(admin, B.id);
  const comps = cat.competencies ?? [];
  const resp = comps.find(c => /respirat/i.test(`${c.title} ${c.domain ?? ""}`)) ?? null;
  show("AD setup", { note: noteB.id ? `${chB.length} section(s)` : noteB.why, programme: prog.status, catalogue: comps.length, competency: resp ? `${resp.code ?? ""} ${resp.title}` : null });
  const links = resp ? await Promise.all(chB.map(c => send("POST", "/api/individual/scholar/mappings", { chunkId: c.id, competencyId: resp.id }, B.jar))) : [];
  ok("AD0. the note is uploaded, the programme chosen, and its sections linked (accepted, by the student) to a respiratory programme competency",
    !!noteB.id && chB.length > 0 && prog.status === 200 && !!resp && links.length > 0 && links.every(l => l.status === 200), links.map(l => `${l.status} ${l.json.error ?? ""}`).join(","));
  /** One adaptive exam, driven as the runner does: next, answer (right or missed by PLAN), until the report. */
  const PLAN = [true, true, true, true, false];
  async function runExam(formats: string[], label: string) {
    const t0 = new Date(Date.now() - 2000).toISOString();
    const startAd = await send("POST", "/api/individual/scholar/revision/adaptive", { scope: { kind: "programme" }, formats, length: 5, start: "standard", feedback: "immediate" }, B.jar);
    show(`${label} start`, { formats, status: startAd.status, session: startAd.json.session, error: startAd.json.error });
    const sessionId = startAd.json.session?.id as string | undefined;
    const steps: any[] = []; const views: string[] = [];
    let report: any = null;
    for (let i = 0; sessionId && i < 8; i++) {
      const nx = await send("POST", "/api/individual/scholar/revision/adaptive/next", { sessionId }, B.jar);
      if (nx.json.done) { report = nx.json.report; break; }
      if (nx.status !== 200 || !nx.json.item) { show("next", { status: nx.status, error: nx.json.error }); break; }
      views.push(JSON.stringify(nx.json.item));
      const q = (await admin.from("individual_scholar_question").select("id, kind, correct_index, options, difficulty, library_version_id, stem, created_at").eq("id", nx.json.item.id).single()).data as any;
      const right = PLAN[steps.length] ?? true;
      const body = q.kind === "mcq" ? { response: { index: right ? q.correct_index : (q.correct_index + 1) % q.options.length } }
        : { response: { text: right ? "Count over a full minute and compare saturation with the prescribed target." : "I am not sure." }, selfGrade: right };
      const ans = await send("POST", "/api/individual/scholar/revision/answer", { questionId: q.id, sessionId, ...body }, B.jar);
      steps.push({ n: nx.json.number, kind: q.kind, target: nx.json.target, offered: q.difficulty, library: !!q.library_version_id, writtenDuringExam: Date.parse(q.created_at) >= Date.parse(t0), match: nx.json.match ?? null, note: nx.json.note ?? null, answered: right ? "right" : "missed", marked: ans.json.feedback?.correct ?? ans.json.correct ?? null, marking: ans.json.feedback?.marking ?? null, status: ans.status, stem: q.stem });
    }
    for (const s of steps) console.log(`        Q${s.n} [${s.kind}] asked:${s.target} offered:${s.offered}${s.library ? " (library)" : ""}${s.writtenDuringExam ? " (written for this exam)" : ""}${s.match ? ` match:${s.match}` : ""} -> ${s.answered} (marked correct:${s.marked} ${s.marking ?? ""}) | ${String(s.stem).slice(0, 80)}${s.note ? ` | note: ${s.note}` : ""}`);
    if (!report && sessionId) report = (await send("POST", "/api/individual/scholar/revision/adaptive/next", { sessionId }, B.jar)).json.report ?? null;
    show(`${label} report`, report ? { label: report.label, score: report.score, trajectory: report.trajectory.map((t: any) => `${t.n}:${t.asked}/${t.offered}:${t.result}`), start: report.start, finish: report.finish, sources: report.sources, strengths: report.strengths, gaps: report.gaps?.map((g: any) => g.label), byCompetency: report.byCompetency, recommendations: (report.recommendations ?? []).map((r: any) => r.title), stopped: report.stopped } : null);
    return { sessionId, steps, views, report };
  }
  if (resp && links.every(l => l.status === 200)) {
    // AD-1: multiple choice only, on the one-section note.
    const ex1 = await runExam(["mcq"], "AD-1 (mcq only)");
    ok("AD1. an adaptive exam starts on the programme's competencies, with the stated rule, and its report carries the exact label",
      !!ex1.sessionId && ex1.report?.label === ADAPTIVE_REPORT_LABEL && ex1.report?.rule === ADAPTIVE_RULE);
    ok("AD1b. an exam of 5 on a one-section note runs to its length while new questions can still be written",
      ex1.steps.length === 5, `answered ${ex1.steps.length} of 5; stopped: ${ex1.report?.stopped}; last note: ${ex1.steps.at(-1)?.note ?? ""}`);
    const wrote1 = ex1.steps.filter(s => s.writtenDuringExam).length;
    ok("AD1c. the report's sources count questions written for this exam as generated", (ex1.report?.sources?.generated ?? -1) === wrote1,
      `report generated:${ex1.report?.sources?.generated} stored:${ex1.report?.sources?.stored}; actually written during the exam: ${wrote1}`);
    // AD-2: multiple choice and short answer (the student marks a short answer against the accepted answers).
    const ex2 = await runExam(["mcq", "short"], "AD-2 (mcq + short)");
    const report = ex2.report, sessionId = ex2.sessionId, steps = ex2.steps;
    summary.AD = {
      ex1: { steps: ex1.steps.map(s => `${s.n}:${s.kind}:${s.target}/${s.offered}:${s.answered}${s.writtenDuringExam ? ":new" : ""}`), stopped: ex1.report?.stopped ?? null, sources: ex1.report?.sources ?? null },
      ex2: { steps: steps.map(s => `${s.n}:${s.kind}:${s.target}/${s.offered}:${s.answered}`), report: report ? { label: report.label, score: report.score, trajectory: report.trajectory, finish: report.finish, strengths: report.strengths, gaps: report.gaps?.map((g: any) => g.label), recommendations: (report.recommendations ?? []).map((r: any) => r.title), byCompetency: report.byCompetency, sources: report.sources, stopped: report.stopped } : null },
    };
    const asked = (report?.trajectory ?? []).map((t: any) => t.asked);
    ok("AD2. the difficulty path changes by the rule: standard for the first three, harder after three right in a row",
      asked.length >= 4 && asked.slice(0, 3).every((d: string) => d === "standard") && asked[3] === "harder" && steps.every(s => s.marked === (s.answered === "right")), `asked: ${asked.join(" > ")} finish:${report?.finish}`);
    ok("AD3. the report carries the EXACT practice-estimate label, a measured practice score and alignment to the programme competency",
      report?.label === ADAPTIVE_REPORT_LABEL && report?.score?.state === "measured" && (report?.byCompetency ?? []).some((g: any) => g.key === resp.id), `${JSON.stringify(report?.score)}`);
    ok("AD4. the report identifies strengths and gaps (with a revision recommendation for the gap)",
      (report?.strengths ?? []).length > 0 && (report?.gaps ?? []).length > 0 && (report?.recommendations ?? []).length > 0, JSON.stringify({ strengths: report?.strengths, gaps: report?.gaps?.map((g: any) => g.label) }));
    const histAd = await send("GET", "/api/individual/scholar/revision/adaptive", undefined, B.jar);
    const mine = (histAd.json.exams ?? []).filter((x: any) => x.id === sessionId || x.id === ex1.sessionId);
    const adPage = await page("/individual/scholar/study/revise/adaptive", B.jar);
    const repPage = sessionId ? await page(`/individual/scholar/study/revise/adaptive?session=${sessionId}`, B.jar) : null;
    show("AD history", { status: histAd.status, exams: mine, listPage: adPage.status, listHasLabel: adPage.visible.includes(ADAPTIVE_REPORT_LABEL), reportPage: repPage?.status, reportHasLabel: repPage?.visible.includes(ADAPTIVE_REPORT_LABEL), listSnippet: adPage.visible.slice(0, 200) });
    ok("AD5. both exams are kept in history (completed, with their practice scores) and the Adaptive pages show the exact label",
      histAd.status === 200 && mine.length === 2 && mine.every((x: any) => x.status === "completed" && x.practicePercent !== null) && histAd.json.label === ADAPTIVE_REPORT_LABEL
      && adPage.visible.includes(ADAPTIVE_REPORT_LABEL) && !!repPage?.visible.includes(ADAPTIVE_REPORT_LABEL), `list page ${adPage.status} report page ${repPage?.status}`);
    ok("AD6. no answer reached the browser before it was answered (the learner view of every item has no correct index, rationale or accepted answer)",
      [...ex1.views, ...ex2.views].length > 0 && [...ex1.views, ...ex2.views].every(v => !/correct_?[iI]ndex|rationale|"answer"|accepted/i.test(v)));
  }

  // ════════ G. AI routing ════════
  console.log("\n── G. AI routing and cost ──");
  let totalUsd = 0;
  for (const [n, s] of [["A", A], ["B", B]] as const) {
    const r = await routing(s.id);
    totalUsd += r.usd;
    show(`${n} (${r.source})`, { calls: r.calls, usd: r.usd });
    for (const x of r.steps) console.log(`        ${x.operation.padEnd(40)} activity:${String(x.activity).padEnd(10)} ${x.model.padEnd(20)} ${x.status} eligible:${x.eligible} routed:${x.routed}`);
    const okSteps = r.steps.filter(x => x.status === "ok");
    ok(`G-${n}a. every AI call by ${n} ran on a model eligible for its activity (ai_model_eligibility), on a configured route`,
      okSteps.length > 0 && okSteps.every(x => x.eligible && x.routed), okSteps.filter(x => !x.eligible || !x.routed).map(x => `${x.operation}:${x.activity}:${x.model}`).join(", ") || `${okSteps.length} calls`);
    const refused = refusals.filter(x => x.jar === s.jar);
    const failedRows = r.steps.filter(x => x.status !== "ok");
    ok(`G-${n}b. no eligibility refusal and no failed AI call for ${n}`, refused.length === 0 && failedRows.length === 0, JSON.stringify([...refused.map(x => `${x.path} ${x.status} ${x.code}`), ...failedRows.map(x => `${x.operation}:${x.status}`)]));
    summary[`G_${n}`] = { calls: r.calls, usd: r.usd, steps: r.steps.map(x => `${x.activity}:${x.model}:${x.status}`) };
  }
  summary.totalUsd = +totalUsd.toFixed(6);
  ok("E1. total AI spend for the run is under $2", totalUsd < 2, `$${totalUsd.toFixed(4)}`);

  // ════════ the coordinator's browser fixture (kept) ════════
  console.log("\n── browser fixture (kept for the coordinator) ──");
  const C = await makeStudent(grantor, BROWSER, BROWSER_PW);
  const cSt = C.consent === 200 ? await send("POST", "/api/individual/scholar/osce/stations", { source: "template", templateKey: "respiratory-assessment" }, C.jar) : { status: 0, json: {} as any };
  if (C.signIn === 200 && C.terms === 200 && C.consent === 200 && cSt.status === 200) {
    writeFileSync(OSCE_BROWSER_FIXTURE_FILE, `email: ${BROWSER}\npassword: ${BROWSER_PW}\nstation: ${BASE}${OSCE_PAGE}/${cSt.json.id}\nkept by scholar-practice-acceptance-harness (staging); remove with OSCE_REMOVE_BROWSER_FIXTURE=1\n`);
  }
  // The grantor is a FIX identity and is removed in Z; the browser fixture's grant stays valid (the grant row is its own).
  ok("BF. the browser fixture is signed up (terms over HTTP, consent, Scholar) with one respiratory template station; credentials written to the file only",
    C.signIn === 200 && C.terms === 200 && C.consent === 200 && cSt.status === 200, JSON.stringify([C.signIn, C.terms, C.consent, cSt.status]));
  summary.browserFixture = { email: BROWSER, station: cSt.json.id ?? null, file: OSCE_BROWSER_FIXTURE_FILE };

  await finishWithCleanup(policyBefore, countsBefore);
}

async function finishWithCleanup(policyBefore: string, countsBefore: Record<string, number> | null) {
  console.log("\n── O10 + Z. nothing verified created; cleanup ──");
  const countsAfter = await verificationCounts().catch(() => null);
  if (countsBefore && countsAfter) {
    const changed = Object.keys({ ...countsBefore, ...countsAfter }).filter(t => countsBefore[t] !== countsAfter[t]).map(t => `${t}: ${countsBefore[t]} -> ${countsAfter[t]}`);
    show("O10 tables", `${Object.keys(countsAfter).length} (${Object.keys(countsAfter).join(", ")})`);
    ok("O10. no row was written to competency_verification_*, assessments*, estate osce_*, DACUM/rating or any Passport / verification table", changed.length === 0, changed.join("; "));
  } else pend("O10", "STAGING_DB_URL not set: the counts could not be read");
  ok("Z1. staging platform/individual settings are byte-for-byte as before the run (this run changed none)", (await policyRows()) === policyBefore);
  await cleanup();
  const gone = await Promise.all(Object.values(FIX).map(findUser));
  ok("Z2. fixture identities, their files and rows are gone (the browser fixture is kept on purpose)", gone.every(u => !u));
  console.log(`\nSUMMARY-JSON ${JSON.stringify(summary)}`);
  console.log(`\n${fails.length ? `FAILED -- ${pass} passed, ${fails.length} failed${pends.length ? `, ${pends.length} pending` : ""}` : `ALL GREEN -- ${pass} passed, 0 failed${pends.length ? `, ${pends.length} pending` : ""}`}`);
  if (fails.length) { console.log(`  failed: ${fails.join(" | ")}`); process.exitCode = 1; }
}

let POLICY_BEFORE = "", COUNTS_BEFORE: Record<string, number> | null = null;
main().catch(async e => { console.error(e); fails.push("crash"); await finishWithCleanup(POLICY_BEFORE, COUNTS_BEFORE).catch(() => {}); process.exit(1); });
