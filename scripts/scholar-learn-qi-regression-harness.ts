/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR-LEARN-FIX-01 L-C -- STAGING REGRESSION of the reported PowerPoint scenario ("Quality Improvement Science and
 * Methods.pptx", 49 slides, 47 sections, slides 33 and 38 picture-only) plus one UNRELATED short text note, for one fresh
 * test user. Over HTTP against a dev server pointed at STAGING. Every check is one real request; no full suites.
 *
 *   R1  topics: the ready page before analysis says "Finding topics... n of m"; after the analyse loop topics render (>= 1)
 *       and the page never says "None found yet" / "No topics found"
 *   R2  lessons: <= maxSteps lessons covering >= 40 of 47 sections; lesson 1 holds slide 1 but is not slide 1 alone;
 *       titles are not comma-joined topic lists; each has an objective
 *   R3  teach lesson 1 (one AI call): not withheld; grounding sufficient or partial; prompt version has scholar-learn-teach-v1 or v2;
 *       citations map only to the QI slides; nothing from the unrelated note; a partial's uncoveredTerms are absent from the cited text
 *   R4  teach the lesson about the Model for Improvement / PDSA (one AI call): cites a slide that contains it
 *   R5  a genuine gap ("dosage of IV vancomycin", My notes only; one AI call + the AI-free recovery route): insufficient or withheld,
 *       accurate unanswered terms, the unrelated note not used
 *   R6  check understanding: the check flow records a verdict (learning event row), Continue advances
 *   R7  picture-only slides: policy scholar_material_image_slides = ai_transcription for the run (snapshot + restore),
 *       the slides route, what slides 33 and 38 yielded
 *   R8  an old-shaped session (one section per step, no objective stored) still renders (GET + the Learn page)
 *   Z   staging policy rows byte-for-byte as before; the grantor removed; the test user KEPT as a browser fixture
 *
 * SCHOLAR-GUIDED-LEARNING-01 G-C adds section G (runs after R2, before R3; R3 and R4 reuse the lessons G generated, so there is
 * no extra AI call), asserting the guided-learning contract over HTTP + staging DB reads:
 *   G1  open:true with nothing saved -> no AI request, a "generate" signal; then Teach lesson 1 -> shown (timing_ms recorded)
 *   G2  reopen lesson 1 with open:true -> saved lesson, zero AI requests, a scholar_learn_served row with cached:true
 *   G3  two identical teach requests for lesson 2 fired together -> exactly one generation; the twin is served the same lesson
 *   G4  lessons 1-4 (matched by title) each shown or partial; per-lesson timing_ms, plat_ai_requests latency/tokens;
 *       the Just Culture outcome, what salvage removed, cited slides
 *   G5  every [S n] in lessons 1-4 maps to the QI deck, none to the unrelated note
 *   G6  prepare-next: policy default off -> no AI; ON (snapshot/restore) -> at most one AI request for the next lesson, a
 *       second prepare -> zero, opening it -> served from saved (prepared and viewed)
 *   G7  safeguard spot check (a dose sentence is never salvaged): unit-covered (teach-salvage.test.ts)
 * Then docs/evidence/SCHOLAR-GUIDED-LEARNING/metrics.sql is run against staging (time filter = this run) via STAGING_DB_URL.
 *
 * ⚠ STAGING ONLY (refuses any other project). Run with cwd = a checkout that has node_modules + the staging .env.local:
 *   cd competen-p2 && NODE_PATH=<competen-p2>/node_modules BASE_URL=http://localhost:3100 \
 *     npx tsx ../competen-guided/scripts/scholar-learn-qi-regression-harness.ts
 * REUSE=1 keeps the existing fixture user and its materials (credentials read from the fixture file) and ONLY=R3,R4 limits
 * the cases run after R2. The fixture's credentials go to LEARN_QI_FIXTURE_FILE, never to stdout. REMOVE_FIXTURE=1 removes it.
 * The record is written to docs/evidence/SCHOLAR-GUIDED-LEARNING/acceptance-2026-10-31.md in the repository this script sits in.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { BUCKET, TEXT_MIME, PPTX_MIME } from "../src/lib/individual/scholar/config";
import { POLICY_SCOPE, policyPath, loadIndividualPolicy } from "../src/lib/individual/policy";
import { publishScope, resetOverride, setOverride, type WceActor } from "../src/lib/config/workspace-config-write";
import { parseTeachAnswer, questionText } from "../src/lib/individual/scholar/teach-format";

loadEnvConfig(process.cwd(), true);
const STAGING_REF = "ezhvpgtcqcdsgylrxgdb";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-learn-qi-regression-harness");
if (ref !== STAGING_REF) { console.error(`REFUSING: this harness runs on the staging project only (${STAGING_REF}), not ${ref}.`); process.exit(1); }
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error("REFUSING: BASE_URL must be a local dev server pointed at staging."); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

const FIXTURE_PPTX = process.env.QI_PPTX ?? "C:/Users/elish/Desktop/Quality Improvement Science and Methods.pptx";
const FIXTURE_SHA = "190ab7421f11911acf1e653ebde8a98a6d7b919aca100c412fd5e18c16fa18b9";
const GRANTOR = "harness-guided-grantor@competen.test";
const USER = "harness-guided-browser@competen.test";
const FIXTURE_FILE = process.env.LEARN_QI_FIXTURE_FILE
  ?? "C:/Users/elish/AppData/Local/Temp/claude/C--Users-elish-Documents-Competen/a8637d9f-8e17-4384-a425-178c29a6d626/scratchpad/guided-fixture.txt";
const RECORD = join(resolve(dirname(process.argv[1] ?? "."), ".."), "docs", "evidence", "SCHOLAR-GUIDED-LEARNING", "acceptance-2026-10-31.md");
const REUSE = process.env.REUSE === "1";
const ONLY = (process.env.ONLY ?? "").split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
const want = (c: string) => !ONLY.length || ONLY.includes(c);
const rnd = () => Math.random().toString(36).slice(2);
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};

const NOTE_TITLE = "recognising-deterioration-notes";
const NOTE = [
  "Recognising deterioration: short notes",
  "1. A raised respiratory rate is often the first sign that a person is getting worse, so count it over a full minute.",
  "2. Use an early warning score such as NEWS2 to combine respiratory rate, oxygen saturation, blood pressure, pulse, temperature and level of consciousness.",
  "3. A new confusion or a drop in the level of consciousness is a red flag and needs urgent escalation.",
  "4. Escalate using SBAR: situation, background, assessment and recommendation, and record the escalation.",
].join("\n");

// ── results ──
type Row = { id: string; check: string; result: "PASS" | "FAIL" | "INFO" | "SKIP"; evidence: string };
const rows: Row[] = [];
let pass = 0; const fails: string[] = [];
const ok = (id: string, check: string, c: boolean, ev = "") => { rows.push({ id, check, result: c ? "PASS" : "FAIL", evidence: ev }); if (c) pass++; else fails.push(`${id} ${check}`); console.log(`  ${c ? "PASS" : "FAIL"}  ${id} ${check}${ev ? ` -- ${ev}` : ""}`); };
const info = (id: string, check: string, ev: string) => { rows.push({ id, check, result: "INFO", evidence: ev }); console.log(`  INFO  ${id} ${check} -- ${ev}`); };
const skip = (id: string, check: string, why: string) => { rows.push({ id, check, result: "SKIP", evidence: why }); console.log(`  SKIP  ${id} ${check} -- ${why}`); };
/** R1/R2 are also the setup of every other case (analysis, session): they assert only when asked for. */
const okR = (id: string, check: string, c: boolean, ev = "") => { if (!ONLY.length || ONLY.includes(id.slice(0, 2))) ok(id, check, c, ev); };
const skipR = (id: string, check: string, why: string) => { if (!ONLY.length || ONLY.includes(id.slice(0, 2))) skip(id, check, why); };
const show = (label: string, v: unknown) => console.log(`        ${label}: ${typeof v === "string" ? v : JSON.stringify(v)}`);

// ── fixtures ──
async function findUser(email: string) {
  for (let p = 1; p <= 20; p++) {
    const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
const USER_TABLES = [
  "individual_scholar_learning_event_source", "individual_scholar_learning_event", "individual_scholar_learning_step", "individual_scholar_learning_session",
  "individual_scholar_chunk_analysis", "individual_scholar_chunk", "individual_scholar_material", "individual_scholar_collection",
  "individual_scholar_consent", "individual_scholar_learner", "individual_scholar_learner_context", "individual_entitlement", "individual_membership", "plat_ai_requests", "audit_log",
];
async function removeUser(email: string): Promise<string | null> {
  const u = await findUser(email);
  if (!u) return null;
  const listed = await admin.storage.from(BUCKET).list(u.id, { limit: 1000 });
  if (listed.data?.length) await admin.storage.from(BUCKET).remove(listed.data.map((o: any) => `${u.id}/${o.name}`));
  for (const t of USER_TABLES) await admin.from(t).delete().eq(t === "audit_log" || t === "plat_ai_requests" ? "actor_id" : "user_id", u.id);
  await admin.from("profiles").delete().eq("id", u.id);
  const r = await admin.auth.admin.deleteUser(u.id);
  return r.error ? r.error.message : null;
}

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
async function send(method: string, path: string, body: unknown, jar: Jar) {
  const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", Cookie: cookieHeader(jar), "x-request-id": `lqi-${Date.now().toString(36)}-${rnd().slice(0, 8)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  absorb(jar, res);
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const decode = (s: string) => s.replace(/\\u2014/g, "—").replace(/\\u0026/g, "&").replace(/\\"/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&rsquo;/g, "’");
async function page(path: string, jar: Jar) {
  const res = await fetch(BASE + path, { redirect: "manual", headers: { Cookie: cookieHeader(jar) } });
  const raw = await res.text();
  const noScript = raw.replace(/<script[\s\S]*?<\/script>/g, " ");
  return { status: res.status, visible: decode(noScript.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")), html: noScript, all: decode(raw) };
}
async function signIn(email: string, password: string) { const jar: Jar = new Map(); const r = await send("POST", "/api/auth/login", { email, password }, jar); return { jar, status: r.status }; }

async function upload(jar: Jar, bytes: Uint8Array, mime: string, fileName: string) {
  const slot = await send("POST", "/api/individual/scholar/uploads", { mime, size: bytes.byteLength, piiAttested: true }, jar);
  if (slot.status !== 200) return { id: null as string | null, why: `slot ${slot.status} ${slot.json.error ?? ""}` };
  const put = await createClient(url!, anonKey!, { auth: { persistSession: false } }).storage.from(slot.json.bucket).uploadToSignedUrl(slot.json.path, slot.json.token, bytes, { contentType: mime });
  if (put.error) return { id: null, why: `storage ${put.error.message}` };
  const done = await send("POST", "/api/individual/scholar/materials", { uploadId: slot.json.uploadId, mime, fileName, piiAttested: true }, jar);
  return done.status === 200 ? { id: (done.json.id ?? done.json.material?.id) as string, why: "" } : { id: null, why: `materials ${done.status} ${done.json.error ?? ""}` };
}

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
  const consent = s.status === 200 ? await send("POST", "/api/individual/scholar/consent", { grant: true }, s.jar) : { status: 0, json: {} as any };
  return { id: u, jar: s.jar, signIn: s.status, terms, consent: consent.status, consentError: consent.json?.error ?? null };
}

// ── staging policy: snapshot, change, restore exactly (as the SQIE harness does) ──
const ACTOR: WceActor = { userId: null as unknown as string, name: "SCHOLAR-LEARN-FIX-01 L-C regression harness (staging)" };
type Snap = { path: string; row: { draft: any; published: any } | null };
const snaps: Snap[] = [];
const policyRows = async () => JSON.stringify((await admin.from("workspace_config_overrides").select("config_path, draft, published").eq("scope_type", "platform").eq("scope_ref", "individual").order("config_path")).data ?? []);
async function setPolicy(k: string, v: unknown): Promise<string | null> {
  const path = policyPath(k as any);
  const { data: all } = await admin.from("workspace_config_overrides").select("config_path, draft, published").eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef);
  const others = (all ?? []).filter((r: any) => r.config_path !== path && JSON.stringify(r.draft) !== JSON.stringify(r.published)).map((r: any) => r.config_path);
  if (others.length) return `unpublished drafts pending (${others.join(", ")}): publishing would publish them too`;
  const mine = (all ?? []).find((r: any) => r.config_path === path);
  if (!snaps.some(s => s.path === path)) snaps.push({ path, row: mine ? { draft: mine.draft, published: mine.published } : null });
  const w = await setOverride(admin, ACTOR, POLICY_SCOPE, path, v);
  if (!w.ok) return `setOverride: ${w.error}`;
  const p = await publishScope(admin, ACTOR, POLICY_SCOPE, { label: "SCHOLAR-LEARN-FIX-01 L-C regression (staging, temporary)", note: `set ${k} for the regression run; restored at its end` });
  return p.ok ? null : `publish: ${p.error}`;
}
async function restorePolicy() {
  if (!snaps.length) return;
  for (const s of [...snaps].reverse()) {
    if (s.row === null) await resetOverride(admin, ACTOR, POLICY_SCOPE, s.path);
    else await admin.from("workspace_config_overrides").update({ draft: s.row.draft, published: s.row.published, updated_at: new Date().toISOString() }).eq("scope_type", POLICY_SCOPE.scopeType).eq("scope_ref", POLICY_SCOPE.scopeRef).eq("config_path", s.path);
  }
  snaps.length = 0;
  await publishScope(admin, ACTOR, POLICY_SCOPE, { label: "SCHOLAR-LEARN-FIX-01 L-C regression: restored", note: "settings changed for the regression run put back" }).catch(() => {});
}

// ── small helpers ──
const stem = (t: string) => (t.length > 5 ? t.slice(0, 5) : t);
const matched = (text: string, terms: readonly string[]) => { const words = text.toLowerCase().normalize("NFKD").split(/[^a-z0-9]+/); return terms.filter(t => words.some(w => w.startsWith(stem(t)))); };
const chunkMeta = async (ids: string[]) => {
  const out = new Map<string, { materialId: string; slide: number | null; content: string }>();
  if (!ids.length) return out;
  const { data } = await admin.from("individual_scholar_chunk").select("id, material_id, page_from, content").in("id", ids);
  for (const r of data ?? []) out.set(r.id, { materialId: r.material_id, slide: r.page_from, content: r.content });
  return out;
};
const cited = (answer: string) => [...new Set([...String(answer ?? "").matchAll(/\[S(\d+)\]/g)].map(m => Number(m[1])))];
const slidesOf = (sources: any[], tags: number[], meta: Map<string, any>) => tags.map(t => meta.get(sources[t - 1]?.chunkId)?.slide).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);

const summary: Record<string, unknown> = {};
/** The AI gate's recent refusals for this user, in its own words (rule, tier, reason), so an environment refusal is not read as a product failure. */
const gateRefusals = async (userId: string) => {
  const { data } = await admin.from("audit_log").select("new_value").eq("actor_id", userId).eq("action", "ai_gate_decision").order("created_at", { ascending: false }).limit(20);
  const seen = new Map<string, number>();
  for (const r of data ?? []) { const v = r.new_value ?? {}; if (v.decision !== "refused") continue; const k = `${v.activity}/${v.rule}/${v.reason}/${v.mode}`; seen.set(k, (seen.get(k) ?? 0) + 1); }
  return seen.size ? ` AI gate refusals (activity/rule/reason/mode): ${[...seen].map(([k, n]) => `${k} x${n}`).join("; ")}` : "";
};
let policyBefore = "";
let metricsMd = "";
const runStart = new Date(Date.now() - 2 * 60_000).toISOString(); // the run window (two minutes of clock slack); the test user is new, so only this run's rows fall in it

/** metrics.sql, read only, with its time filter (now() - interval '30 days') replaced by this run's start. Needs STAGING_DB_URL. */
async function runMetrics(since: string): Promise<string> {
  const dbUrl = process.env.STAGING_DB_URL;
  if (!dbUrl) return "STAGING_DB_URL is not set: metrics.sql not run.";
  if (!dbUrl.includes(STAGING_REF)) return "REFUSED: STAGING_DB_URL does not name the staging project; metrics.sql not run.";
  const file = join(resolve(dirname(process.argv[1] ?? "."), ".."), "docs", "evidence", "SCHOLAR-GUIDED-LEARNING", "metrics.sql");
  const sql = readFileSync(file, "utf8").replace(/now\(\) - interval '30 days'/g, `'${since}'::timestamptz`);
  const stmts = sql.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join("\n").split(/;\s*(?:\n|$)/).map(x => x.trim()).filter(Boolean);
  const pg: any = await import("pg" as string);
  const Client = pg.Client ?? pg.default?.Client;
  const c = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  const out: string[] = [`Window: created_at >= ${since} (this run). Read only.`, ""];
  try {
    await c.connect();
    await c.query("set default_transaction_read_only = on");
    let n = 0;
    for (const q of stmts) {
      n++;
      try {
        const r = await c.query(q);
        const cols = r.fields.map((f: any) => f.name);
        out.push(`Query ${n}:`, "", `| ${cols.join(" | ")} |`, `|${cols.map(() => "---").join("|")}|`,
          ...(r.rows.length ? r.rows.map((row: any) => `| ${cols.map((k: string) => String(row[k] === null ? "" : typeof row[k] === "object" ? JSON.stringify(row[k]) : row[k]).replace(/\|/g, "/")).join(" | ")} |`) : [`| (no rows) |${cols.slice(1).map(() => " |").join("")}`]), "");
      } catch (e) { out.push(`Query ${n}: ERROR ${(e as Error).message}`, ""); }
    }
  } catch (e) { out.push(`connection failed: ${(e as Error).message}`); }
  finally { await c.end().catch(() => {}); }
  return out.join("\n");
}

const medianOf = (xs: number[]) => { const a = xs.filter(x => Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2); };
/** The per-lesson latency table (G4): route stages from the audit rows' timing_ms, the model call from plat_ai_requests, the client wall clock. */
function latencyTable(): string {
  const ls: any[] = (summary.G as any)?.lessons ?? [];
  const gen = ls.filter(l => l.timing);
  if (!gen.length) return "(no generation rows with timing_ms)";
  const stages = ["auth_policy", "passages_outline", "related", "references", "cache", "standing_preflight", "dedupe_claim", "dedupe_wait", "context", "risk", "research", "generate", "ai", "save", "total"];
  const head = `| Stage (ms) | ${ls.map(l => `L${l.idx + 1} ${String(l.title).slice(0, 28)}`).join(" | ")} | median |`;
  const line = (label: string, f: (l: any) => number | null | undefined) => {
    const vals = ls.map(f);
    return `| ${label} | ${vals.map(v => (v === null || v === undefined ? "" : String(v))).join(" | ")} | ${medianOf(vals.filter((v): v is number => typeof v === "number")) ?? ""} |`;
  };
  return [head, `|---|${ls.map(() => "---").join("|")}|---|`,
    ...stages.filter(k => ls.some(l => l.timing?.[k] !== undefined)).map(k => line(k === "generate" ? "generate (includes ai; the checks = generate - ai)" : k, l => l.timing?.[k])),
    line("checks (generate - ai)", l => (l.timing?.generate !== undefined && l.timing?.ai !== undefined ? l.timing.generate - l.timing.ai : null)),
    line("model latency_ms (plat_ai_requests)", l => l.model_ms), line("input tokens", l => l.in_tok), line("output tokens", l => l.out_tok),
    line("client wall clock (request to reply)", l => l.wall),
    line("outside the route (wall - total)", l => (l.timing?.total !== undefined ? l.wall - l.timing.total : null)),
    line("outside the model call (wall - model)", l => (l.model_ms ? l.wall - l.model_ms : null)),
  ].join("\n");
}

async function main() {
  console.log(`SCHOLAR-LEARN-FIX-01 L-C regression -- target ${ref} (staging), server ${BASE}, reuse=${REUSE}, only=${ONLY.join(",") || "all"}\n`);
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  if (!live) { console.log(`  no dev server at ${BASE}. Nothing created.`); process.exitCode = 1; return; }
  const bytes = readFileSync(FIXTURE_PPTX);
  const sha = createHash("sha256").update(bytes).digest("hex");
  ok("0a", "fixture file is the production deck (sha256 190ab742...)", sha === FIXTURE_SHA, sha.slice(0, 12));
  policyBefore = await policyRows();
  const policy = await loadIndividualPolicy(admin);
  const maxSteps = policy.scholarSessionMaxSteps;
  info("0b", "policy", `scholarSessionMaxSteps=${maxSteps}, learningHistory=${policy.scholarLearningHistory}`);

  // ── the test user ──
  let jar: Jar, userId: string, password = "";
  if (REUSE) {
    const fx = readFileSync(FIXTURE_FILE, "utf8").split(/\r?\n/);
    password = (fx.find(l => l.startsWith("password=")) ?? "").slice(9);
    const s = await signIn(USER, password);
    userId = (await findUser(USER))?.id;
    if (s.status !== 200 || !userId) { console.log("  REUSE: the fixture user cannot sign in"); process.exitCode = 1; return; }
    jar = s.jar;
  } else {
    const e1 = await removeUser(USER); const e2 = await removeUser(GRANTOR);
    if (e1 || e2) console.log(`  note: earlier fixture removal said: ${e1 ?? ""} ${e2 ?? ""}`);
    password = `gl-${rnd()}${rnd()}-Aa1!`;
    const { data: gd, error: ge } = await admin.auth.admin.createUser({ email: GRANTOR, password: `g-${rnd()}${rnd()}-Aa1!`, email_confirm: true });
    if (ge) throw ge;
    const A = await makeStudent(gd.user.id, USER, password);
    ok("0c", "fresh test user: signs in, accepts terms over HTTP, gives AI consent", A.signIn === 200 && A.terms === 200 && A.consent === 200, JSON.stringify([A.signIn, A.terms, A.consent, A.consentError]));
    if (!(A.signIn === 200 && A.terms === 200 && A.consent === 200)) return;
    jar = A.jar; userId = A.id;
    mkdirSync(dirname(FIXTURE_FILE), { recursive: true });
    writeFileSync(FIXTURE_FILE, `email=${USER}\npassword=${password}\nnote=SCHOLAR-LEARN-FIX-01 L-C browser fixture (staging). QI deck + recognising-deterioration note uploaded; session left on lesson 1. Remove with REMOVE_FIXTURE=1.\n`);
  }

  // ── materials ──
  let qiId: string | null = null, noteId: string | null = null;
  if (REUSE) {
    const { data } = await admin.from("individual_scholar_material").select("id, mime_type").eq("user_id", userId);
    qiId = (data ?? []).find((m: any) => m.mime_type === PPTX_MIME)?.id ?? null;
    noteId = (data ?? []).find((m: any) => m.mime_type === TEXT_MIME)?.id ?? null;
  } else {
    const up = await upload(jar, new Uint8Array(bytes), PPTX_MIME, "Quality Improvement Science and Methods.pptx");
    qiId = up.id;
    ok("0d", "QI deck uploaded through the normal upload route (pptx mime)", !!qiId, up.why || `material ${qiId}`);
    const nt = await upload(jar, new TextEncoder().encode(NOTE), TEXT_MIME, `${NOTE_TITLE}.txt`);
    noteId = nt.id;
    ok("0e", "unrelated short text note uploaded for the same user", !!noteId, nt.why || `material ${noteId}`);
  }
  if (!qiId || !noteId) { console.log("  fixtures missing; stopping"); return; }
  const { data: qiRow } = await admin.from("individual_scholar_material").select("id, title, chunk_count, page_count, extraction_quality").eq("id", qiId).single();
  const SECTIONS = Number(qiRow?.chunk_count ?? 0);
  info("0f", "QI material", `${qiRow?.title}; ${qiRow?.page_count} slides, ${SECTIONS} sections, empty_units ${JSON.stringify(qiRow?.extraction_quality?.empty_units ?? null)}`);

  // ════════ R1 topics ════════
  console.log("\n── R1. topics ──");
  const READY = `/individual/scholar/study/ready?ids=${qiId}`;
  const st0 = await send("GET", `/api/individual/scholar/materials/${qiId}/analyse`, undefined, jar);
  const before = await page(READY, jar);
  const analysedBefore = Number(st0.json.analysed ?? 0);
  if (analysedBefore === 0) {
    okR("R1a", `ready page before analysis says "Finding topics… n of m", never "None found yet"`,
      before.status === 200 && new RegExp(`Finding topics… 0 of ${SECTIONS} sections`).test(before.visible) && !/None found yet|No topics found/.test(before.visible),
      (before.visible.match(/Finding topics[^.]{0,40}/)?.[0] ?? "no progress line") + `; status ${before.status}`);
  } else skipR("R1a", "before-analysis wording", `already analysed ${analysedBefore} of ${SECTIONS} (REUSE)`);
  let guard = 0, calls = 0; const errs: string[] = [];
  while (guard++ < 30) {
    let r = await send("POST", `/api/individual/scholar/materials/${qiId}/analyse`, {}, jar);
    for (let t = 1; t < 3 && r.status !== 200; t++) r = await send("POST", `/api/individual/scholar/materials/${qiId}/analyse`, {}, jar);
    if (r.status !== 200) { errs.push(`${r.status} ${r.json.error ?? ""}`); break; }
    if (r.json.analysed) calls++;
    if (!r.json.remaining) break;
  }
  const status1 = await send("GET", `/api/individual/scholar/materials/${qiId}/analyse`, undefined, jar);
  const { data: an } = await admin.from("individual_scholar_chunk_analysis").select("chunk_id, concepts").eq("user_id", userId).eq("material_id", qiId);
  const concepts = [...new Set((an ?? []).flatMap((r: any) => (Array.isArray(r.concepts) ? r.concepts : []).map((c: any) => String(typeof c === "string" ? c : c?.name ?? ""))).filter(Boolean))] as string[];
  const after = await page(READY, jar);
  const pills = (after.html.match(/rounded-full bg-gray-100 px-2\.5/g) ?? []).length;
  const showsConcept = concepts.some(c => after.visible.toLowerCase().includes(c.toLowerCase()));
  okR("R1b", "after the analyse loop topics render (>= 1) and the page never says None found yet / No topics found / Finding topics",
    errs.length === 0 && status1.json.analysed >= SECTIONS && pills >= 1 && showsConcept && !/None found yet|No topics found|Finding topics/.test(after.visible),
    `${calls} analyse calls${errs.length ? `, errors ${errs.join("; ")}` : ""}; analysed ${status1.json.analysed}/${status1.json.sections}; ${concepts.length} distinct concepts in DB; ${pills} topic pills on the page.${errs.length ? await gateRefusals(userId) : ""}`);
  summary.R1 = { calls, analysed: status1.json.analysed, concepts: concepts.length, pills };

  // ════════ R2 lessons ════════
  console.log("\n── R2. lessons ──");
  const ses = await send("POST", "/api/individual/scholar/learn/sessions", { scope: { kind: "document", materialId: qiId } }, jar);
  const session = ses.json.session;
  const steps: any[] = session?.steps ?? [];
  const allIds = steps.flatMap(s => s.sections.map((x: any) => x.chunkId));
  const meta = await chunkMeta(allIds);
  const covered = new Set(allIds).size;
  const lesson1 = steps[0];
  const l1Slides = (lesson1?.sections ?? []).map((x: any) => meta.get(x.chunkId)?.slide).filter((x: any) => typeof x === "number");
  const commaJoined = steps.filter(s => (String(s.title).match(/,/g) ?? []).length >= 2).map(s => s.title);
  const noObjective = steps.filter(s => !String(s.objective ?? "").trim()).length;
  show("lesson titles", steps.map((s, i) => `${i + 1}. ${s.title} [${s.sections.length} sections] -- ${s.objective}`));
  okR("R2a", `a recorded session starts: <= maxSteps (${maxSteps}) lessons`, ses.status === 200 && !!session?.id && session.recorded === true && steps.length >= 1 && steps.length <= maxSteps, `status ${ses.status}, ${steps.length} lessons, recorded ${session?.recorded}${ses.json.error ? ` (${ses.json.error})` : ""}`);
  okR("R2b", `lessons cover >= 40 of ${SECTIONS} sections`, covered >= 40, `${covered} of ${SECTIONS}; coverage ${JSON.stringify(session?.coverage)}`);
  okR("R2c", "lesson 1 includes slide 1 but is not slide 1 alone", l1Slides.includes(1) && (lesson1?.sections?.length ?? 0) > 1, `lesson 1 slides ${JSON.stringify(l1Slides)}`);
  okR("R2d", "titles are not comma-joined topic lists, and each lesson has an objective", commaJoined.length === 0 && noObjective === 0, commaJoined.length ? `comma-joined: ${commaJoined.join(" | ")}` : `${steps.length} titles, ${noObjective} without objective`);
  summary.R2 = { titles: steps.map(s => s.title), objectives: steps.map(s => s.objective), sections: steps.map(s => s.sections.length), covered };
  if (!session?.id) { console.log("  no session; stopping"); return; }
  const sid: string = session.id;
  const stepNo = (i: number) => steps[i]?.step ?? i;
  const act = async (body: any) => { const t0 = performance.now(); const r = await send("POST", "/api/individual/scholar/learn/act", { sessionId: sid, mode: "notes", ...body }, jar); return { ...r, wall: Math.round(performance.now() - t0) }; };
  const sourcesOfReply = (r: any): any[] => r.json.sources ?? [];

  let g1Teach: any = null; // G1's Teach of lesson 1: R3 asserts on it (no second AI call)
  // ════════ G guided learning (SCHOLAR-GUIDED-LEARNING-01 G-C) ════════
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  /** plat_ai_requests rows for this learner (the AI gateway's own log): the count is what "an AI request" means below. */
  const aiCount = async () => (await admin.from("plat_ai_requests").select("id", { count: "exact", head: true }).eq("actor_id", userId)).count ?? 0;
  /** The learn trail for this learner (generation, served and in-flight rows). Waits briefly: served rows are written after the response. */
  const learnRows = async (): Promise<any[]> => {
    await sleep(1800);
    const { data } = await admin.from("audit_log").select("id, action, created_at, new_value").eq("actor_id", userId).eq("entity_type", "individual_scholar_learn")
      .in("action", ["ai_assistant_query", "scholar_learn_served", "scholar_learn_inflight"]).order("created_at", { ascending: true }).limit(1000);
    return data ?? [];
  };
  const genRowsFor = (rs: any[], stepN: number, prepared: boolean) => rs.filter(r => r.action === "ai_assistant_query" && r.new_value?.action === "teach" && r.new_value?.step === stepN && !!r.new_value?.prepared === prepared);
  const reqOf = async (actionId: string | null | undefined) => actionId
    ? ((await admin.from("plat_ai_requests").select("model, latency_ms, input_tokens, output_tokens, cost_usd, status").eq("actor_id", userId).eq("action_id", actionId)).data ?? []) : [];
  type Rec = { idx: number; reply: any; wall: number; row: any; how: string };
  const byIdx = new Map<number, Rec>();
  // Lessons 1-4 by TITLE (the planner's order is not assumed): the most specific pattern claims its lesson first.
  const pats: RegExp[] = [/dimension/i, /system/i, /just\s*culture/i, /model for improvement|pdsa/i];
  const taken = new Set<number>(); const pick: (number | null)[] = [null, null, null, null];
  for (const k of [2, 3, 0, 1]) { const i = steps.findIndex((s, j) => pats[k].test(String(s.title)) && !taken.has(j)); if (i >= 0) { pick[k] = i; taken.add(i); } }
  for (let k = 0; k < 4; k++) if (pick[k] === null) { const j = steps.findIndex((_, x) => !taken.has(x)); pick[k] = j; taken.add(j); }
  const tg = pick.map((idx, k) => ({ slot: k + 1, idx: idx as number, matched: pats[k].test(String(steps[idx as number]?.title)), title: String(steps[idx as number]?.title ?? "?") }));
  const G: any = { lessons: [] as any[] };
  summary.G = G;
  let perTeach = 1;

  if (want("G")) {
    console.log("\n── G. guided learning ──");
    show("lessons 1-4 by title", tg.map(t => `slot ${t.slot} -> lesson ${t.idx + 1} "${t.title}"${t.matched ? "" : " (NOT matched by title: index fallback)"}`));
    G.titles = tg;
    const l0 = stepNo(0);

    // G1: open with nothing saved, then teach
    let c0 = await aiCount();
    const o1 = await act({ action: "teach", step: l0, open: true });
    let c1 = await aiCount();
    ok("G1a", "open:true on lesson 1 with nothing saved: no AI request and a generate signal", o1.status === 200 && o1.json.open === "generate" && o1.json.cached === false && !o1.json.answer && c1 === c0,
      `status ${o1.status}, open ${o1.json.open}, cached ${o1.json.cached}, plat_ai_requests ${c0} -> ${c1}, wall ${o1.wall} ms`);
    const t1 = await act({ action: "teach", step: l0 });
    const c2 = await aiCount();
    perTeach = Math.max(1, c2 - c1);
    let rows = await learnRows();
    const g1row = genRowsFor(rows, l0, false).slice(-1)[0] ?? null;
    ok("G1b", "Teach lesson 1 after the open: shown (not withheld), cached:false, one generation row with timing_ms", t1.status === 200 && !t1.json.withheld && !!t1.json.answer && t1.json.cached === false && !!g1row?.new_value?.timing_ms,
      `status ${t1.status}, withheld ${!!t1.json.withheld}${t1.json.reason ? ` (${t1.json.reason})` : ""}, grounding ${t1.json.grounding?.outcome}, plat_ai_requests +${c2 - c1}, audit outcome ${g1row?.new_value?.outcome}, wall ${t1.wall} ms, route total ${g1row?.new_value?.timing_ms?.total} ms`);
    g1Teach = t1;
    byIdx.set(0, { idx: 0, reply: t1, wall: t1.wall, row: g1row, how: "generated (G1)" });

    // G2: reopen lesson 1
    c0 = await aiCount(); let nB = rows.length;
    const o2 = await act({ action: "teach", step: l0, open: true });
    c1 = await aiCount(); rows = await learnRows();
    let nr = rows.slice(nB);
    const served2 = nr.filter(r => r.action === "scholar_learn_served" && r.new_value?.step === l0);
    ok("G2", "reopen lesson 1 with open:true: the saved lesson, zero AI requests, no generation row, a scholar_learn_served row with cached:true",
      o2.status === 200 && o2.json.cached === true && !!o2.json.answer && o2.json.answer === t1.json.answer && c1 === c0 && !nr.some(r => r.action === "ai_assistant_query") && served2.some(r => r.new_value?.cached === true),
      `status ${o2.status}, cached ${o2.json.cached}, same answer ${o2.json.answer === t1.json.answer}, plat_ai_requests ${c0} -> ${c1}, served rows ${served2.length} (cached ${JSON.stringify(served2.map(r => r.new_value?.cached))}), served timing total ${served2[0]?.new_value?.timing_ms?.total} ms, wall ${o2.wall} ms`);
    G.reopen = { wall: o2.wall, served: served2[0]?.new_value?.timing_ms ?? null };

    // G3: two identical teach requests for lesson 2 at once
    const i2 = tg[1].idx, s2 = stepNo(i2);
    const pre3 = await act({ action: "teach", step: s2, open: true });
    c0 = await aiCount(); nB = rows.length;
    const [ra, rb] = await Promise.all([act({ action: "teach", step: s2 }), act({ action: "teach", step: s2 })]);
    c1 = await aiCount(); rows = await learnRows(); nr = rows.slice(nB);
    const gens3 = genRowsFor(nr, s2, false);
    const gen3 = [ra, rb].find(x => x.json.cached === false && x.json.answer) ?? null;
    const twin = [ra, rb].find(x => x !== gen3) ?? null;
    const dupRows = nr.filter(r => r.action === "scholar_learn_served" && r.new_value?.duplicate_suppressed === true);
    ok("G3a", `two identical teach requests for lesson ${i2 + 1} ("${steps[i2]?.title}") fired together: exactly one generation (one audit generation row, plat_ai_requests +${perTeach} as for one lesson)`,
      pre3.json.open === "generate" && gens3.length === 1 && c1 - c0 === perTeach && !!gen3,
      `precondition open:${pre3.json.open}; statuses ${ra.status}/${rb.status}; generation rows ${gens3.length}; plat_ai_requests ${c0} -> ${c1}; generator wall ${gen3?.wall} ms, twin wall ${twin?.wall} ms`);
    const same = !!twin && twin.json.cached === true && twin.json.answer === gen3?.json.answer;
    ok("G3b", "the twin is marked duplicate and served the same lesson (or told to retry / that the first was withheld)", !!twin && twin.json.duplicateSuppressed === true,
      `twin: duplicateSuppressed ${twin?.json.duplicateSuppressed}, cached ${twin?.json.cached}, served the same lesson ${same}, retry ${twin?.json.retry}, withheld ${twin?.json.withheld}; duplicate_suppressed audit rows ${dupRows.length} (first: ${JSON.stringify(dupRows.map(r => r.new_value?.first ?? "served_saved"))})`);
    if (gen3) byIdx.set(i2, { idx: i2, reply: gen3, wall: gen3.wall, row: gens3[0] ?? null, how: "generated (G3, concurrent twin)" });
    G.dedupe = { twinWall: twin?.wall ?? null, generatorWall: gen3?.wall ?? null, servedTheSame: same };

    // G4: lessons 1-4 in order, as the guided client does (open, then teach when told to generate)
    for (const t of tg) {
      if (byIdx.has(t.idx)) continue;
      const st = stepNo(t.idx);
      const o = await act({ action: "teach", step: st, open: true });
      if (o.json.cached === true && o.json.answer) { byIdx.set(t.idx, { idx: t.idx, reply: o, wall: o.wall, row: null, how: "already saved (opened, no AI)" }); continue; }
      nB = rows.length;
      const g = await act({ action: "teach", step: st });
      rows = await learnRows();
      byIdx.set(t.idx, { idx: t.idx, reply: g, wall: g.wall, row: genRowsFor(rows.slice(nB), st, false)[0] ?? null, how: `generated (open said ${o.json.open})` });
    }
    const slideOf = async (rec: Rec) => {
      const srcs: any[] = rec.reply.json.sources ?? [];
      const m = await chunkMeta(srcs.map(s => s.chunkId));
      const tags = cited(rec.reply.json.answer);
      return { srcs, m, tags, slides: slidesOf(srcs, tags, m) };
    };
    for (const t of tg) {
      const rec = byIdx.get(t.idx)!;
      const nv = rec.row?.new_value ?? {};
      const reqs = await reqOf(nv.action_id);
      const j = rec.reply.json;
      const sl = await slideOf(rec);
      const lessonOk = rec.reply.status === 200 && !j.withheld && !!j.answer && (j.grounding?.outcome === "sufficient" || j.grounding?.outcome === "partial");
      ok(`G4.${t.slot}`, `lesson ${t.idx + 1} "${t.title}" is shown or partial (not withheld)`, lessonOk,
        `${rec.how}; status ${rec.reply.status}, withheld ${!!j.withheld}${j.reason ? ` (${j.reason})` : ""}${j.message && j.withheld ? ` "${String(j.message).slice(0, 120)}"` : ""}, grounding ${j.grounding?.outcome}, audit outcome ${nv.outcome ?? "n/a"}, salvage removed ${j.salvage?.removed ?? nv.salvage_removed ?? 0}, cited slides ${JSON.stringify(sl.slides)}`);
      G.lessons.push({
        slot: t.slot, idx: t.idx, title: t.title, matched: t.matched, how: rec.how, outcome: nv.outcome ?? (j.withheld ? `withheld:${j.reason}` : "shown"), grounding: j.grounding?.outcome,
        salvageRemoved: j.salvage?.removed ?? nv.salvage_removed ?? 0, salvageDetail: nv.salvage_detail ?? null, cited: sl.slides, wall: rec.wall, timing: nv.timing_ms ?? null,
        model_ms: reqs.reduce((a: number, r: any) => a + (r.latency_ms ?? 0), 0) || null, in_tok: reqs.reduce((a: number, r: any) => a + (r.input_tokens ?? 0), 0) || null, out_tok: reqs.reduce((a: number, r: any) => a + (r.output_tokens ?? 0), 0) || null,
        model: reqs[0]?.model ?? null, calls: reqs.length, usd: reqs.reduce((a: number, r: any) => a + Number(r.cost_usd ?? 0), 0),
      });
    }
    const jc = G.lessons.find((l: any) => l.slot === 3);
    info("G4.JC", "Just Culture", `lesson ${jc.idx + 1} "${jc.title}": outcome ${jc.outcome}, grounding ${jc.grounding}, salvaged/removed ${jc.salvageRemoved}${jc.salvageDetail ? ` (rule: ${jc.salvageDetail})` : ""}, cited slides ${JSON.stringify(jc.cited)}`);

    // G5: citations
    for (const t of tg) {
      const rec = byIdx.get(t.idx)!;
      const sl = await slideOf(rec);
      const fromNote = sl.srcs.filter(s => sl.m.get(s.chunkId)?.materialId === noteId || s.materialId === noteId).length;
      const allQi = sl.srcs.length > 0 && sl.srcs.every(s => sl.m.get(s.chunkId)?.materialId === qiId && typeof sl.m.get(s.chunkId)?.slide === "number");
      const tagsOk = sl.tags.length > 0 && sl.tags.every(n => n >= 1 && n <= sl.srcs.length);
      ok(`G5.${t.slot}`, `lesson ${t.idx + 1}: every [S n] maps to a QI slide, none to the unrelated note`, !!rec.reply.json.answer && allQi && tagsOk && fromNote === 0,
        `${sl.tags.length} distinct tags ${JSON.stringify(sl.tags)} of ${sl.srcs.length} sources, cited slides ${JSON.stringify(sl.slides)}, sources from the note ${fromNote}`);
    }

    // G6: prepare-next
    const nextIdx = steps.findIndex((_, j) => j >= 1 && !taken.has(j));
    if (nextIdx < 1) skip("G6", "prepare-next", "no lesson beyond lessons 1-4 to prepare");
    else {
      // Lesson 2 is already saved by G3 (prepare never replaces a saved lesson), so prepare-next is shown on the first lesson not yet saved.
      const curStep = stepNo(nextIdx - 1), nxt = stepNo(nextIdx);
      const mv = await send("PATCH", `/api/individual/scholar/learn/sessions/${sid}`, { currentStep: curStep, move: "resume" }, jar);
      const pol = await loadIndividualPolicy(admin);
      c0 = await aiCount();
      const pOff = await act({ action: "teach", step: curStep, prepare: true });
      c1 = await aiCount();
      ok("G6a", "scholar_learn_prepare_next default: off -> a prepare call makes no AI request", mv.status === 200 && pol.scholarLearnPrepareNext === false && pOff.json.prepared === false && pOff.json.reason === "off" && c1 === c0,
        `policy on=${pol.scholarLearnPrepareNext}, current step moved (${mv.status}) to lesson ${nextIdx}, prepare -> ${JSON.stringify(pOff.json)}, plat_ai_requests ${c0} -> ${c1}`);
      const se = await setPolicy("scholar_learn_prepare_next", { value: "on" });
      if (se) ok("G6b", "prepare-next switched ON for the run (staging policy, snapshot/restore)", false, se);
      else {
        c0 = await aiCount(); nB = rows.length;
        const p1 = await act({ action: "teach", step: curStep, prepare: true });
        c1 = await aiCount(); rows = await learnRows(); nr = rows.slice(nB);
        const gp = genRowsFor(nr, nxt, true);
        ok("G6b", `prepare:true on lesson ${nextIdx}: at most one AI request, for lesson ${nextIdx + 1} only (one prepared generation row)`, p1.json.prepared === true && p1.json.step === nxt && gp.length === 1 && c1 - c0 <= perTeach && c1 - c0 >= 1,
          `prepare -> ${JSON.stringify({ prepared: p1.json.prepared, step: p1.json.step, reason: p1.json.reason })}, plat_ai_requests +${c1 - c0}, prepared generation rows ${gp.length} (outcome ${gp[0]?.new_value?.outcome}, saved ${gp[0]?.new_value?.saved}), total ${gp[0]?.new_value?.timing_ms?.total} ms, wall ${p1.wall} ms`);
        const p2 = await act({ action: "teach", step: curStep, prepare: true });
        const c3 = await aiCount();
        ok("G6c", "a second prepare call makes zero AI requests", p2.json.prepared === false && p2.json.reason === "saved" && c3 === c1, `prepare -> ${JSON.stringify(p2.json)}, plat_ai_requests ${c1} -> ${c3}`);
        nB = rows.length;
        const o6 = await act({ action: "teach", step: nxt, open: true });
        const c4 = await aiCount(); rows = await learnRows(); nr = rows.slice(nB);
        const sv = nr.filter(r => r.action === "scholar_learn_served" && r.new_value?.step === nxt && r.new_value?.dedupe_key && r.new_value.dedupe_key === gp[0]?.new_value?.dedupe_key);
        ok("G6d", `open lesson ${nextIdx + 1}: served from the prepared copy (cached, zero AI, a served row on the prepared key = prepared and viewed)`, o6.json.cached === true && !!o6.json.answer && c4 === c3 && sv.length === 1,
          `cached ${o6.json.cached}, plat_ai_requests ${c3} -> ${c4}, served rows on the prepared key ${sv.length}, served total ${sv[0]?.new_value?.timing_ms?.total} ms, wall ${o6.wall} ms`);
        G.prepare = { prepareWall: p1.wall, openWall: o6.wall, genTotal: gp[0]?.new_value?.timing_ms?.total ?? null };
      }
      await restorePolicy();
      ok("G6e", "scholar_learn_prepare_next restored (staging policy rows byte-for-byte as before)", (await policyRows()) === policyBefore);
    }

    // G7: safeguards spot check
    info("G7", "a teach whose notes carry a dose sentence is not salvaged into a dose claim", "unit-covered, not re-run: src/lib/individual/scholar/teach-salvage.test.ts \"control: an invented dose or a safety-critical number withholds the whole lesson (never salvaged)\" (G-A targeted vitest: pass). The QI deck holds no dose sentence, so there is no fixture path over HTTP.");
  }

  // ════════ R3 teach lesson 1 ════════
  let teach1: any = null;
  if (want("R3") || want("R6")) {
    console.log("\n── R3. teach lesson 1 ──");
    const t = g1Teach ?? await act({ action: "teach", step: stepNo(0), fresh: true });
    teach1 = t.json;
    const srcs = sourcesOfReply(t);
    const m = await chunkMeta(srcs.map(s => s.chunkId));
    const tags = cited(t.json.answer);
    const onlyQi = srcs.length > 0 && srcs.every(s => m.get(s.chunkId)?.materialId === qiId && typeof m.get(s.chunkId)?.slide === "number");
    const noNote = !srcs.some(s => m.get(s.chunkId)?.materialId === noteId || s.materialId === noteId);
    const g = t.json.grounding;
    const tagsValid = tags.length > 0 && tags.every(n => n >= 1 && n <= srcs.length);
    const parts = parseTeachAnswer(String(t.json.answer ?? ""));
    const citedText = tags.map(n => m.get(srcs[n - 1]?.chunkId)?.content ?? "").join("\n");
    const partialOk = g?.outcome !== "partial" || ((g.uncoveredTerms ?? []).length > 0 && matched(citedText, g.uncoveredTerms).length === 0);
    const cs = slidesOf(srcs, tags, m);
    ok("R3a", "teach lesson 1 is not withheld and grounding is sufficient or partial", t.status === 200 && !t.json.withheld && !t.json.continuity && (g?.outcome === "sufficient" || g?.outcome === "partial"),
      `status ${t.status}, withheld ${!!t.json.withheld}${t.json.reason ? ` (${t.json.reason})` : ""}${t.json.continuity ? ` continuity: ${t.json.continuity.message}` : ""}, grounding ${g?.outcome}, covered ${JSON.stringify(g?.covered)}, uncovered ${JSON.stringify(g?.uncoveredTerms)}${t.json.error ? ` error ${t.json.error}` : ""}`);
    ok("R3b", "prompt version is a structured Teach Me version (scholar-learn-teach-v1 or v2)", /scholar-learn-teach-v[12]\b/.test(String(t.json.provenance?.promptVersion ?? "")), String(t.json.provenance?.promptVersion));
    ok("R3c", "structured (overview + key points), every [S n] points at a source", !!parts && !!parts.overview && parts.points.length >= 1 && tagsValid, `overview ${!!parts?.overview}, ${parts?.points.length ?? 0} key points, example ${!!parts?.example}, ${parts?.questions.length ?? 0} check questions, tags ${JSON.stringify(tags)}`);
    ok("R3d", "all sources are QI slides and none is from the unrelated note", onlyQi && noNote, `${srcs.length} sources: slides ${srcs.map(s => m.get(s.chunkId)?.slide).join(",")}`);
    ok("R3e", "if partial, the uncovered terms are absent from the cited passages", partialOk, `outcome ${g?.outcome}, uncovered ${JSON.stringify(g?.uncoveredTerms)}`);
    info("R3", "cited slides (lesson 1 teach)", `cited ${JSON.stringify(cs)} of sources ${JSON.stringify(srcs.map(s => m.get(s.chunkId)?.slide))}; related ${JSON.stringify(g?.related)}`);
    summary.R3 = { cited: cs, outcome: g?.outcome, uncovered: g?.uncoveredTerms, promptVersion: t.json.provenance?.promptVersion };
  }

  // ════════ R4 PDSA lesson ════════
  if (want("R4")) {
    console.log("\n── R4. the Model for Improvement / PDSA lesson ──");
    const re = /PDSA|Model for Improvement|Plan.{0,4}Do.{0,4}Study.{0,4}Act/i;
    // The lesson whose sections mention it MOST (an agenda slide in lesson 1 may name it in passing).
    const mentions = steps.map(s => s.sections.filter((x: any) => re.test(meta.get(x.chunkId)?.content ?? "")).length);
    const idx = mentions.every(n => n === 0) ? -1 : mentions.indexOf(Math.max(...mentions));
    if (idx < 0) ok("R4a", "a lesson holds the Model for Improvement / PDSA", false, "no lesson section mentions it");
    else {
      const t = byIdx.get(idx)?.reply ?? await act({ action: "teach", step: stepNo(idx), fresh: true });
      const srcs = sourcesOfReply(t);
      const m = await chunkMeta(srcs.map(s => s.chunkId));
      const tags = cited(t.json.answer);
      const hit = tags.filter(n => re.test(m.get(srcs[n - 1]?.chunkId)?.content ?? ""));
      ok("R4a", `teach lesson ${idx + 1} ("${steps[idx].title}") cites a slide whose text contains the Model for Improvement / PDSA`, t.status === 200 && !t.json.withheld && hit.length > 0,
        `status ${t.status}, withheld ${!!t.json.withheld}, grounding ${t.json.grounding?.outcome}, cited slides ${JSON.stringify(slidesOf(srcs, tags, m))}, of which mention it ${JSON.stringify(slidesOf(srcs, hit, m))}${t.json.error ? ` error ${t.json.error}` : ""}`);
      summary.R4 = { lesson: idx + 1, title: steps[idx].title, cited: slidesOf(srcs, tags, m), mention: slidesOf(srcs, hit, m) };
    }
  }

  // ════════ R5 genuine gap ════════
  if (want("R5")) {
    console.log("\n── R5. a genuine gap: dosage of IV vancomycin, My notes only ──");
    const q = "What is the dosage of IV vancomycin?";
    const t = await act({ action: "ask", step: stepNo(0), question: q });
    const srcs = sourcesOfReply(t);
    const m = await chunkMeta(srcs.map(s => s.chunkId));
    const g = t.json.grounding;
    const text = srcs.map(s => m.get(s.chunkId)?.content ?? "").join("\n");
    const accurate = !!g && g.keyTerms.length > 0 && g.uncoveredTerms.every((x: string) => matched(text, [x]).length === 0) && g.covered.every((x: string) => matched(text, [x]).length === 1)
      && g.uncoveredTerms.some((x: string) => /vanco/.test(x));
    ok("R5a", "ask about something absent from the deck is insufficient or withheld", t.status === 200 && (t.json.withheld === true || g?.outcome === "insufficient"),
      `status ${t.status}, withheld ${!!t.json.withheld}${t.json.reason ? ` (${t.json.reason})` : ""}, grounding ${g?.outcome}${t.json.error ? ` error ${t.json.error}` : ""}`);
    ok("R5b", "unanswered terms are accurate (absent from the shown passages, covered ones present, vancomycin unanswered)", accurate, `keyTerms ${JSON.stringify(g?.keyTerms)}, covered ${JSON.stringify(g?.covered)}, uncovered ${JSON.stringify(g?.uncoveredTerms)}`);
    ok("R5c", "the unrelated note is not used (no source from it)", !srcs.some(s => s.materialId === noteId || m.get(s.chunkId)?.materialId === noteId), `${srcs.length} sources`);
    // The AI-free recovery route, My notes only, scoped to the session: the unrelated note must never appear as evidence.
    for (const [label, question] of [["vancomycin", q], ["deterioration (the note's own topic)", "How do I recognise deterioration with a raised respiratory rate and NEWS2?"]] as const) {
      const rec = await send("POST", "/api/individual/scholar/evidence/recover", { question, sessionId: sid, mode: "notes_only" }, jar);
      const body = JSON.stringify(rec.json);
      const leak = body.includes(noteId) || body.toLowerCase().includes(NOTE_TITLE);
      ok("R5d", `recovery, My notes only, scoped to the session -- ${label}: the unrelated note is not offered as evidence`, rec.status === 200 && !leak,
        `status ${rec.status}, verdict ${rec.json.sufficiency?.verdict}, covered ${JSON.stringify(rec.json.sufficiency?.covered)}, unanswered ${JSON.stringify(rec.json.sufficiency?.unanswered)}, ${rec.json.evidence?.notes?.length ?? "?"} note items`);
    }
  }

  // ════════ R6 check understanding + Continue ════════
  if (want("R6")) {
    console.log("\n── R6. check understanding, then Continue ──");
    if (!teach1 || teach1.withheld) skip("R6", "check flow", "no shown Teach answer for lesson 1 to check against");
    else {
      const parts = parseTeachAnswer(String(teach1.answer ?? ""));
      let checkQ = parts?.questions[0] ? questionText(parts.questions[0]) : "";
      let route = "teach question (clarify)";
      if (!checkQ) {
        const c = await act({ action: "check", step: stepNo(0) });
        checkQ = c.json.checkQuestion ?? ""; route = "check action";
      }
      if (!checkQ) ok("R6a", "a check question is available", false, "none from Teach and the check action gave none");
      else {
        const gist = (parts?.points[0] ?? parts?.overview ?? "").replace(/\s*\[S\d+\]/g, "").slice(0, 280);
        const v = await act({ action: "clarify", step: stepNo(0), checkQuestion: checkQ, answer: gist || "Quality improvement uses small tests of change." });
        const verdict = v.json.verdict?.value ?? null;
        const { data: ev } = await admin.from("individual_scholar_learning_event").select("step, action, verdict").eq("session_id", sid).eq("action", "clarify");
        ok("R6a", "check understanding gives a verdict and records a learning event row (clarify + verdict)", v.status === 200 && !!verdict && (ev ?? []).some((e: any) => e.step === stepNo(0) && e.verdict === verdict),
          `via ${route}; status ${v.status}, verdict ${verdict}, withheld ${!!v.json.withheld}, event rows ${JSON.stringify(ev)}${v.json.error ? ` error ${v.json.error}` : ""}`);
      }
      if (steps.length > 1) {
        const mv = await send("PATCH", `/api/individual/scholar/learn/sessions/${sid}`, { currentStep: stepNo(1), move: "resume" }, jar);
        const { data: srow } = await admin.from("individual_scholar_learning_session").select("current_step").eq("id", sid).single();
        const get = await send("GET", `/api/individual/scholar/learn/sessions/${sid}`, undefined, jar);
        ok("R6b", "Continue advances to the next lesson and the session remembers it", mv.status === 200 && srow?.current_step === stepNo(1) && get.json.session?.currentStep === 1, `PATCH ${mv.status}, current_step ${srow?.current_step}, GET currentStep ${get.json.session?.currentStep}, progress ${JSON.stringify(get.json.progress)}`);
      }
    }
  }

  // ════════ R7 picture-only slides ════════
  if (want("R7")) {
    console.log("\n── R7. picture-only slides 33 and 38 ──");
    const off = await send("POST", `/api/individual/scholar/materials/${qiId}/slides`, {}, jar);
    ok("R7a", "with the policy off (default) the slides route refuses and calls no AI", off.status === 403, `status ${off.status} ${off.json.error ?? ""}`);
    const setErr = await setPolicy("scholar_material_image_slides", { value: "ai_transcription" });
    if (setErr) ok("R7b", "policy set to ai_transcription for the run", false, setErr);
    else {
      let res: any, status = 0; const readAll: number[] = []; const skippedAll: any[] = []; let tries = 0, remaining = 1;
      while (remaining > 0 && tries++ < 3) {
        const r = await send("POST", `/api/individual/scholar/materials/${qiId}/slides`, {}, jar);
        res = r.json; status = r.status;
        if (r.status !== 200) break;
        readAll.push(...(r.json.read ?? [])); skippedAll.push(...(r.json.skipped ?? [])); remaining = r.json.remaining ?? 0;
      }
      const { data: added } = await admin.from("individual_scholar_chunk").select("ordinal, page_from, content").eq("material_id", qiId).in("page_from", [33, 38]).order("ordinal");
      const { data: mq } = await admin.from("individual_scholar_material").select("chunk_count, extraction_quality").eq("id", qiId).single();
      ok("R7b", "slides route answered (read / skipped with reasons)", status === 200, `status ${status}${res?.error ? ` ${res.error}` : ""}; read ${JSON.stringify(readAll)}; skipped ${JSON.stringify(skippedAll)}; remaining ${remaining}.${status !== 200 ? await gateRefusals(userId) : ""}`);
      info("R7", "what slides 33 and 38 yielded",
        [33, 38].map(n => { const sec = (added ?? []).filter((a: any) => a.page_from === n); const sk = skippedAll.find((s: any) => s.slide === n);
          return `slide ${n}: ${sec.length ? `${sec.length} section(s) added (${sec.reduce((a: number, b: any) => a + b.content.length, 0)} chars; starts "${sec[0].content.slice(0, 90).replace(/\s+/g, " ")}")` : `no section; ${sk ? `skip reason ${sk.reason}` : "not attempted"}`}`; }).join(" | ")
        + `; material now ${mq?.chunk_count} sections, ai_read_units ${JSON.stringify(mq?.extraction_quality?.ai_read_units)}, ai_tried_units ${JSON.stringify(mq?.extraction_quality?.ai_tried_units)}`);
      summary.R7 = { read: readAll, skipped: skippedAll, added: (added ?? []).map((a: any) => a.page_from) };
    }
    await restorePolicy();
    ok("R7c", "policy restored (staging rows byte-for-byte as before)", (await policyRows()) === policyBefore);
  }

  // ════════ R8 old-shaped session ════════
  if (want("R8")) {
    console.log("\n── R8. an old-shaped session still renders ──");
    // The pre-L-A planner made one step per section where topics changed and stored no objective. The rows are written
    // straight to the tables (the shape createLearningSession writes), which is the stored form an old session has.
    const { data: ch } = await admin.from("individual_scholar_chunk").select("id, material_id").eq("material_id", qiId).order("ordinal").limit(8);
    const { data: srow, error: se } = await admin.from("individual_scholar_learning_session").insert({ user_id: userId, scope_kind: "document", title: "Old-shaped session (harness)", topic: null, competency_id: null }).select("id").single();
    if (se || !srow) ok("R8a", "an old-shaped session is created", false, se?.message ?? "no row");
    else {
      await admin.from("individual_scholar_learning_step").insert((ch ?? []).map((c: any, i: number) => ({ session_id: srow.id, user_id: userId, step: i, chunk_id: c.id, material_id: c.material_id })));
      const get = await send("GET", `/api/individual/scholar/learn/sessions/${srow.id}`, undefined, jar);
      const old = get.json.session?.steps ?? [];
      const pg = await page(`/individual/scholar/study/learn?session=${srow.id}`, jar);
      const t0 = old[0]?.title;
      ok("R8a", "GET returns the stored steps unchanged (8 one-section steps) with a recomputed title and objective each", get.status === 200 && old.length === 8 && old.every((s: any) => s.sections.length === 1 && String(s.title).trim() && "objective" in s),
        `status ${get.status}, ${old.length} steps, titles ${JSON.stringify(old.map((s: any) => s.title))}`);
      ok("R8b", "the Learn page renders the old session (200, first lesson title on the page)", pg.status === 200 && !!t0 && pg.all.includes(String(t0).slice(0, 30)) && !/could not be found/i.test(pg.visible), `status ${pg.status}, first title "${t0}"`);
      info("R8", "old saved Teach artefacts (free text)", "unit-covered (teach-format.test: old-format -> null, rendered as written); not created here to avoid an extra AI call");
    }
  }

  for (const c of ["R1", "R2", "R3", "R4", "R6", "R7", "R8"]) if (!want(c)) skip(c, c === "R1" ? "topics" : c === "R2" ? "lessons" : c === "R3" ? "teach lesson 1 (covered by G1/G4/G5)" : c === "R4" ? "Model for Improvement lesson (covered by G4)" : c === "R6" ? "check understanding" : c === "R7" ? "picture-only slides" : "old-shaped session", "verified earlier today (regression-2026-10-31), not re-run");
  // The browser fixture: the session is left on lesson 1 (saved, so reopening costs no AI).
  const back = await send("PATCH", `/api/individual/scholar/learn/sessions/${sid}`, { currentStep: stepNo(0), move: "resume" }, jar);
  const { data: fin } = await admin.from("individual_scholar_learning_session").select("current_step").eq("id", sid).single();
  ok("Z0", "the fixture session is left on lesson 1", back.status === 200 && fin?.current_step === stepNo(0), `PATCH ${back.status}, current_step ${fin?.current_step}, session ${sid}`);

  console.log("\n── metrics.sql against staging ──");
  metricsMd = await runMetrics(runStart);
  console.log(metricsMd);
  console.log(`\nSUMMARY-JSON ${JSON.stringify(summary)}`);
}

function writeRecord() {
  const cell = (s: string) => String(s).replace(/\|/g, "/").replace(/\n/g, " ");
  const r2 = summary.R2 as any;
  const md = [
    "# SCHOLAR-GUIDED-LEARNING-01 G-C: staging acceptance of guided learning on the QI PowerPoint (31 Oct 2026)",
    "",
    "Harness: `scripts/scholar-learn-qi-regression-harness.ts` (staging only; dev server at `BASE_URL` against the staging project, serving `scholar/guided-learning-01` at 843c3e0c). The R checks are the earlier QI regression, kept; section G is new.",
    `Fixture: \`Quality Improvement Science and Methods.pptx\` (sha256 ${FIXTURE_SHA.slice(0, 8)}..., the production upload) and one unrelated note ("${NOTE_TITLE}"), for one fresh test user. The user is kept as a browser fixture (credentials in the scratchpad fixture file, not here).`,
    `Result: ${fails.length ? `**${fails.length} FAILED**: ${fails.join("; ")}` : "**all checks passed**"} (${pass} passed). Generated by the harness run at ${new Date().toISOString()}.`,
    "",
    "| Check | What | Result | Evidence |", "|---|---|---|---|",
    ...rows.map(r => `| ${r.id} | ${cell(r.check)} | ${r.result} | ${cell(r.evidence)} |`),
    "",
    "## Per-lesson latency (G4)", "",
    "Lessons 1-4 matched by title. Route stages are the audit row's timing_ms (milliseconds); the model call is plat_ai_requests (latency_ms, tokens) joined by action_id; wall clock is the HTTP request as the client sees it.", "",
    latencyTable(), "",
    ...(((summary.G as any)?.lessons ?? []) as any[]).map((l: any) => `- Lesson ${l.idx + 1} "${l.title}" (${l.matched ? "matched by title" : "index fallback"}; ${l.how}): outcome ${l.outcome}, grounding ${l.grounding}, salvage removed ${l.salvageRemoved}${l.salvageDetail ? ` (${l.salvageDetail})` : ""}, cited slides ${JSON.stringify(l.cited)}, model ${l.model}, ${l.calls} model call(s), est. cost $${l.usd.toFixed(4)}`),
    "",
    "## Lessons (R2)", "",
    ...(r2?.titles ?? []).map((t: string, i: number) => `${i + 1}. ${t} (${r2.sections[i]} sections) -- ${r2.objectives[i]}`),
    "",
    "## metrics.sql against staging (this run's window)", "",
    metricsMd || "(not run)", "",
  ].join("\n");
  mkdirSync(dirname(RECORD), { recursive: true });
  writeFileSync(RECORD, md);
  console.log(`  record written: ${RECORD}`);
}

async function finish() {
  await restorePolicy().catch(() => {});
  ok("Z1", "staging platform/individual settings are byte-for-byte as before the run", (await policyRows()) === policyBefore);
  if (!REUSE) {
    const gone = await removeUser(GRANTOR);
    ok("Z2", "the grantor fixture is removed (the test user is kept for the browser check)", !(await findUser(GRANTOR)), gone ?? "");
  }
  console.log(`\n${fails.length ? `FAILED -- ${pass} passed, ${fails.length} failed` : `ALL GREEN -- ${pass} passed, 0 failed`}`);
  if (fails.length) { console.log(`  failed: ${fails.join(" | ")}`); process.exitCode = 1; }
  try { writeRecord(); } catch (e) { console.log(`  record not written: ${(e as Error).message}`); }
}

if (process.env.REMOVE_FIXTURE === "1") {
  removeUser(USER).then(e => { console.log(e ? `remove failed: ${e}` : "browser fixture removed"); });
} else {
  main().then(finish).catch(async e => { console.error(e); fails.push("crash"); await finish().catch(() => {}); process.exit(1); });
}
