/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * HQ-SCHOLAR-PREVIEW-01 -- the two demonstration learners the Scholar product preview opens, prepared on STAGING.
 *
 *   npx tsx scripts/provision-scholar-demo-learner.ts up      [--base http://localhost:3100] [--owner <profile id>]
 *   npx tsx scripts/provision-scholar-demo-learner.ts refresh [--base ...] [--owner ...]   erase each learner's Scholar records, then seed again
 *   npx tsx scripts/provision-scholar-demo-learner.ts status                              designation, access and a count of every kind of record
 *   npx tsx scripts/provision-scholar-demo-learner.ts down                                remove the learners, their records, designation and classification
 *
 * WHAT IT MAKES (no password on either account: they are signed into only by a preview ticket, or minted here for seeding)
 *   scholar-demo@competen.demo           mode read_only   the learner the Product Preview opens. Fully seeded.
 *   scholar-demo-sandbox@competen.demo   mode testing     the sandbox for Testing mode. Seeded with the notes, analysis and a study plan only.
 *   (If Supabase rejects the .demo address the .invalid fallback demo.competen.invalid is used and printed.)
 *
 * HOW (every step is the real thing, nothing is faked)
 *   accounts   admin createUser, email confirmed, NO password
 *   classify   hq_account_classify (migration 650) as the owner: account type demo. A designation requires it (migration 860)
 *   access     grantIndividualAccess (Scholar, adult confirmed) with the owner as grantor, onboarded, terms accepted (as scholar-hfe-fixture does)
 *   designate  individual_scholar_preview_designate (migration 860), owner only
 *   seed       through the REAL HTTP APIs of the dev server, with a session minted here (generateLink + verifyOtp, cookies captured by
 *              the same @supabase/ssr adapter the app uses): synthetic teaching notes (no patient data), their analysis, a Learn session,
 *              flashcard decks with generated cards and reviews, a revision session, a clinical case played to the end, an OSCE station
 *              and attempt, an evaluation, and the study plan.
 *
 * AI steps use the staging AI configuration. A step that cannot run (no route, not eligible, a provider failure) is RECORDED in the
 * summary below and the run continues. A record is never written to a table directly to make a step look done.
 * NOT SEEDED: study calendar entries. The calendar only holds moves of planned activities, whose references are computed from the plan
 * on the day, so there is no honest way to create one ahead of time. The summary says so.
 *
 * Needs migration 860 on staging. Reads shared configuration and never writes it.
 * ⚠ STAGING ONLY: assertSafeTarget refuses the production project and refuses a target it cannot identify.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { BUCKET, TEXT_MIME } from "../src/lib/individual/scholar/config";
import { individualIdentityProfile } from "../src/lib/platform-membership";

loadEnvConfig(process.cwd(), true);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "provision-scholar-demo-learner");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

const LEARNERS = [
  { mode: "read_only", local: "scholar-demo", name: "Demo Learner", full: true },
  { mode: "testing", local: "scholar-demo-sandbox", name: "Demo Learner (Sandbox)", full: false },
] as const;
type Learner = typeof LEARNERS[number];
const DOMAINS = ["competen.demo", "demo.competen.invalid"];
const LEGAL = {
  h: { terms: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION ?? "" },
  s: { terms: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION ?? "", privacy: process.env.INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION ?? "" },
};

// ── synthetic teaching notes. General clinical teaching content only: no patient, no identifiers. ─────────────────────────────────────
const SEPSIS_NOTES = [
  "Sepsis recognition and the first hour",
  "",
  "Sepsis is a life-threatening organ dysfunction caused by a dysregulated host response to infection. It is a time-critical emergency, and outcomes improve when it is recognised early and treated within the first hour.",
  "",
  "Recognition",
  "Suspect sepsis in any person with a suspected or confirmed infection who looks unwell. Look for a raised respiratory rate, a raised heart rate, a low blood pressure, a high or low temperature, new confusion and reduced urine output. A rising early warning score is a prompt to look for infection and to escalate.",
  "",
  "The first hour",
  "Within the first hour the team takes blood cultures before antibiotics where this causes no delay, measures a lactate, gives broad-spectrum antibiotics, starts intravenous fluids for hypotension or a raised lactate, and monitors urine output. These actions are often remembered as a bundle, and each should be recorded with its time.",
  "",
  "Escalation",
  "Escalate to the senior clinician as soon as sepsis is suspected. Use a structured handover that states the situation, the background, the assessment and the recommendation. Reassess after fluids and antibiotics, and repeat the lactate if it was raised.",
  "",
  "Safety netting",
  "When a person improves and goes home, explain which symptoms mean they must return urgently, and make sure the plan for follow-up is written down.",
].join("\n");
const MEDS_NOTES = [
  "Medication safety",
  "",
  "Medication errors are among the most common preventable causes of harm in healthcare. Safe practice relies on a consistent routine rather than on memory.",
  "",
  "The rights of medication administration",
  "Before giving any medicine confirm the right person, the right medicine, the right dose, the right route and the right time. Many services add the right documentation and the right to refuse. Check each against the prescription, not against what you expect.",
  "",
  "Checking the prescription",
  "Confirm the prescription is legible, signed and dated, and that the allergy status is recorded. Query anything unclear before preparing the medicine. Never guess a dose, and never give a medicine that someone else has prepared and you have not checked.",
  "",
  "High-risk medicines",
  "Insulin, anticoagulants, opioids and intravenous potassium are high-risk. Use an independent double check where local policy requires one, and calculate doses carefully, writing out the working.",
  "",
  "Reporting",
  "Report every error and every near miss through the local incident system. Reporting is how the system learns, and it is not a punishment. Tell the person and the senior clinician promptly if a medicine has been given in error.",
].join("\n");

// ── plumbing ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const BASE = flag("base") ?? process.env.BASE_URL ?? "http://localhost:3100";
const OWNER = flag("owner") ?? process.env.PREVIEW_OWNER_ID ?? "";

type Step = { learner: string; step: string; ok: boolean; detail: string };
const summary: Step[] = [];
const record = (learner: string, step: string, ok: boolean, detail = "") => { summary.push({ learner, step, ok, detail }); console.log(`  ${ok ? "ok  " : "SKIP"} ${learner} · ${step}${detail ? ` -- ${detail}` : ""}`); };

async function findUser(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
async function existing(l: Learner): Promise<{ id: string; email: string } | null> {
  for (const d of DOMAINS) { const u = await findUser(`${l.local}@${d}`); if (u) return { id: u.id, email: u.email }; }
  return null;
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
/** A signed-in cookie jar for the learner, minted exactly as the app's own client does it (no password involved). */
async function mintJar(email: string): Promise<Jar | null> {
  const jar: Jar = new Map();
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashed = link.data?.properties?.hashed_token;
  if (link.error || !hashed) return null;
  const sb = createServerClient(url!, anonKey!, {
    cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: cs => cs.forEach(({ name, value }) => jar.set(name, value)) },
  });
  const r = await sb.auth.verifyOtp({ type: "magiclink", token_hash: hashed });
  return r.error || !r.data?.user ? null : jar;
}
async function send(method: string, path: string, body: unknown, jar: Jar, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...headers, Cookie: cookieHeader(jar) }, body: body === undefined ? undefined : JSON.stringify(body) });
  absorb(jar, res);
  return { status: res.status, json: await res.json().catch(() => ({})) as any };
}
async function upload(jar: Jar, text: string, fileName: string): Promise<string | null> {
  const bytes = new TextEncoder().encode(text);
  const slot = await send("POST", "/api/individual/scholar/uploads", { mime: TEXT_MIME, size: bytes.byteLength, piiAttested: true }, jar);
  if (slot.status !== 200) return null;
  const put = await createClient(url!, anonKey!, { auth: { persistSession: false } }).storage.from(slot.json.bucket).uploadToSignedUrl(slot.json.path, slot.json.token, bytes, { contentType: TEXT_MIME });
  if (put.error) return null;
  const done = await send("POST", "/api/individual/scholar/materials", { uploadId: slot.json.uploadId, mime: TEXT_MIME, fileName, piiAttested: true }, jar);
  return done.status === 200 ? done.json.id as string : null;
}
async function analyseAll(jar: Jar, id: string) {
  for (let rounds = 0, left = 99; left > 0 && rounds < 8; rounds++) {
    const r = await send("POST", `/api/individual/scholar/materials/${id}/analyse`, {}, jar);
    if (r.status !== 200) break;
    left = r.json.remaining ?? 0;
  }
}
const why = (r: { status: number; json: any }) => `${r.status} ${r.json?.error ?? r.json?.message ?? ""}`.trim();

// ── accounts, classification, access, designation ─────────────────────────────────────────────────────────────────────────────────
async function ensureAccount(l: Learner): Promise<{ id: string; email: string }> {
  const had = await existing(l);
  if (had) return had;
  let last = "";
  for (const d of DOMAINS) {
    const email = `${l.local}@${d}`;
    // No password: email_confirm true and nothing else. The account is entered only through a preview ticket.
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: l.name } });
    if (!error && data?.user) {
      await admin.from("profiles").update({ ...individualIdentityProfile(), full_name: l.name }).eq("id", data.user.id);
      return { id: data.user.id, email };
    }
    last = error?.message ?? "unknown";
  }
  throw new Error(`could not create ${l.local}: ${last}`);
}

async function provisionAccess(l: Learner, id: string) {
  const reason = l.mode === "read_only" ? "Demonstration learner for the read-only Scholar product preview" : "Sandbox demonstration learner for Scholar Testing mode";
  const c = await admin.rpc("hq_account_classify", { p_actor: OWNER, p_actor_name: "provision-scholar-demo-learner", p_profile_ids: [id], p_account_type: "demo", p_reason: reason, p_trace: "provision-scholar-demo-learner" });
  if (c.error) throw new Error(`classification refused: ${c.error.message}`);
  const g = validateGrant({ targetUserId: id, experiences: ["scholar"], adultConfirmed: true });
  if (isGrantRefusal(g)) throw new Error(g.message);
  const granted = await grantIndividualAccess(admin, g, OWNER);
  if (!granted.ok) throw new Error(granted.message);
  const now = new Date().toISOString();
  await admin.from("individual_membership").update({ onboarded_at: now, primary_experience: "scholar",
    foundation_terms_version: LEGAL.h.terms, foundation_privacy_version: LEGAL.h.privacy, foundation_accepted_at: now }).eq("user_id", id);
  await admin.from("individual_entitlement").update({ terms_version: LEGAL.s.terms, privacy_version: LEGAL.s.privacy, terms_accepted_at: now }).eq("user_id", id).eq("experience_code", "scholar");
  const d = await admin.rpc("individual_scholar_preview_designate", { p_actor: OWNER, p_user: id, p_mode: l.mode, p_reason: reason });
  if (d.error) throw new Error(`designation refused: ${d.error.message}`);
}

// ── seeding through the real APIs ─────────────────────────────────────────────────────────────────────────────────────────────────
async function seed(l: Learner, id: string, email: string) {
  const who = l.local;
  const jar = await mintJar(email);
  if (!jar) { record(who, "session", false, "a sign-in session could not be minted"); return; }
  const consent = await send("POST", "/api/individual/scholar/consent", { grant: true }, jar);
  record(who, "AI consent", consent.status === 200, consent.status === 200 ? "" : why(consent));
  if (consent.status !== 200) return;

  const sepsis = await upload(jar, SEPSIS_NOTES, "Sepsis recognition and the first hour.txt");
  const meds = await upload(jar, MEDS_NOTES, "Medication safety.txt");
  record(who, "materials uploaded", !!sepsis && !!meds, `sepsis ${!!sepsis}, medication safety ${!!meds}`);
  for (const m of [sepsis, meds]) if (m) await analyseAll(jar, m);
  record(who, "materials analysed", !!sepsis, "");

  // The study plan: three questions, no AI.
  const plan = await send("POST", "/api/individual/scholar/study-plan", { goalType: "learn", sessionMinutes: 30, daysPerWeek: 4, goal: "Build safe, steady clinical study habits", priorities: [] }, jar);
  record(who, "study plan", plan.status === 200, plan.status === 200 ? "" : why(plan));
  if (!l.full || !sepsis) return;

  // Learn: a session on the sepsis notes and one explanation.
  const ls = await send("POST", "/api/individual/scholar/learn/sessions", { scope: { kind: "document", materialId: sepsis } }, jar);
  const lsession = ls.json?.session;
  let teachOk = false, teachWhy = "";
  if (lsession?.id) {
    for (let tries = 0; tries < 3 && !teachOk; tries++) {
      const t = await send("POST", "/api/individual/scholar/learn/act", { action: "teach", sessionId: lsession.id, step: 0 }, jar);
      teachOk = t.status === 200 && !!(t.json?.answer || t.json?.continuity);
      teachWhy = why(t);
    }
  } else teachWhy = why(ls);
  record(who, "Learn session and one explanation", teachOk, teachOk ? "" : teachWhy);

  // Flashcards: two decks, cards generated from each note, and reviews.
  const d1 = await send("POST", "/api/individual/scholar/flashcards/decks", { title: "Sepsis recognition", organiseBy: "topic", organiseRef: "Sepsis" }, jar);
  const d2 = await send("POST", "/api/individual/scholar/flashcards/decks", { title: "Medication safety", organiseBy: "topic", organiseRef: "Medication safety" }, jar);
  record(who, "flashcard decks", d1.status === 200 && d2.status === 200, d1.status === 200 && d2.status === 200 ? "" : `${why(d1)} / ${why(d2)}`);
  if (d1.json?.id && meds) {
    const g1 = await send("POST", "/api/individual/scholar/revision/sessions", { mode: "flashcards", scope: { kind: "document", materialId: sepsis }, quantity: 6, deckId: d1.json.id }, jar);
    const g2 = d2.json?.id ? await send("POST", "/api/individual/scholar/revision/sessions", { mode: "flashcards", scope: { kind: "document", materialId: meds }, quantity: 5, deckId: d2.json.id }, jar) : null;
    record(who, "flashcards generated", g1.status === 200, `${g1.status === 200 ? `sepsis ${g1.json?.generated ?? 0}` : why(g1)}${g2 ? `, medication ${g2.status === 200 ? g2.json?.generated ?? 0 : why(g2)}` : ""}`);
    // Reviews: a study session over the deck from stored cards (no AI), rated a mix of remembered and again.
    const s = await send("POST", "/api/individual/scholar/revision/sessions", { mode: "flashcards", deck: d1.json.id }, jar);
    const sid = s.json?.session?.id as string | undefined;
    const items = sid ? ((await send("GET", `/api/individual/scholar/revision/sessions/${sid}`, undefined, jar)).json?.items ?? []) as any[] : [];
    let rated = 0;
    for (const [i, it] of items.slice(0, 5).entries()) {
      const r = await send("POST", "/api/individual/scholar/revision/answer", { questionId: it.id, sessionId: sid, response: { quality: i % 3 === 1 ? 1 : 4 } }, jar);
      if (r.status === 200) rated++;
    }
    record(who, "flashcard reviews", rated > 0, `${rated} rated of ${items.length}`);
  }

  // Revision: a quick set from the sepsis notes, with the questions answered (the right answer read the way the server holds it, so the answers are real).
  const rv = await send("POST", "/api/individual/scholar/revision/sessions", { mode: "quick", scope: { kind: "documents", materialIds: [sepsis] }, quantity: 4, feedback: "immediate" }, jar, { "x-request-id": `demo-${Date.now()}` });
  const rsid = rv.json?.session?.id as string | undefined;
  let answered = 0;
  for (const it of ((rv.json?.items ?? []) as any[]).slice(0, 3)) {
    const q = (await admin.from("individual_scholar_question").select("kind, correct_index, answer").eq("user_id", id).eq("id", it.id).maybeSingle()).data as any;
    const response = !q ? null : q.kind === "mcq" || q.kind === "case" ? { index: q.correct_index } : q.kind === "mrq" ? { indexes: q.answer?.correct } : q.kind === "short" ? { text: q.answer?.accepted?.[0] } : q.kind === "match" ? { matches: q.answer?.matches } : q.kind === "sequence" ? { order: q.answer?.order } : null;
    if (!response) continue;
    const r = await send("POST", "/api/individual/scholar/revision/answer", { questionId: it.id, sessionId: rsid, response }, jar);
    if (r.status === 200) answered++;
  }
  record(who, "revision session", rv.status === 200 && answered > 0, rv.status === 200 ? `${answered} answered` : why(rv));

  // A clinical case from the notes, played to the end (the correct options are read from the stored blueprint, as the journey harness does).
  let made = await send("POST", "/api/individual/scholar/clinical/cases", { entry: "notes", scope: { kind: "document", materialId: sepsis }, context: "medical", mode: "guided", generateAnyway: true }, jar, { "x-request-id": `demo-case-${Date.now()}` });
  if (made.status === 422 || made.status === 502) made = await send("POST", "/api/individual/scholar/clinical/cases", { entry: "notes", scope: { kind: "document", materialId: sepsis }, context: "medical", mode: "guided", generateAnyway: true }, jar, { "x-request-id": `demo-case2-${Date.now()}` });
  let caseDone = false, caseWhy = made.status === 200 ? "" : why(made);
  if (made.status === 200 && made.json?.play) {
    const bp = ((await admin.from("individual_scholar_case").select("blueprint").eq("user_id", id).eq("id", made.json.caseId).maybeSingle()).data as any)?.blueprint;
    let cur = made.json.play;
    for (let step = 0; bp && step < 12 && cur.status === "active"; step++) {
      const dp = cur.view.stages[cur.view.stages.length - 1].decisionPoints.find((d: any) => !cur.answered.includes(d.token));
      const d = dp ? bp.decisionPoints.find((x: any) => x.prompt === dp.prompt) : null;
      if (!dp || !d) break;
      const body = d.kind === "free_text" ? { decisionToken: dp.token, text: d.expectedResponse ?? "I would check the observations, escalate and start the first-hour actions." }
        : { decisionToken: dp.token, optionTokens: d.options.filter((o: any) => o.correct).slice(0, d.kind === "single" ? 1 : 2).map((o: any) => dp.options[d.options.indexOf(o)].token) };
      const r = await send("POST", `/api/individual/scholar/clinical/sessions/private/${cur.sessionId}/answer`, body, jar);
      if (r.status !== 200) { caseWhy = `answer ${why(r)}`; break; }
      cur = r.json.play;
    }
    caseDone = cur.status === "completed";
    if (!caseDone && !caseWhy) caseWhy = `stopped at ${cur.status}`;
  }
  record(who, "clinical case played to the end", caseDone, caseDone ? "" : caseWhy);

  // OSCE: a station written from the notes (AI), a run with a short answer under every heading, finished.
  const st = await send("POST", "/api/individual/scholar/osce/stations", { source: "ai", materialId: sepsis }, jar);
  let osceOk = false, osceWhy = st.status === 200 ? "" : why(st);
  if (st.status === 200 && st.json?.id) {
    const att = await send("POST", "/api/individual/scholar/osce/attempts", { stationId: st.json.id }, jar);
    const stationView = await send("GET", `/api/individual/scholar/osce/stations/${st.json.id}`, undefined, jar);
    const sections: string[] = (stationView.json?.station?.sections ?? stationView.json?.sections ?? []) as string[];
    if (att.status === 200 && att.json?.attemptId) {
      const responses = Object.fromEntries(sections.map(s => [s, "Introduced myself, confirmed the person, checked the observations, recognised the warning signs and escalated using a structured handover."]));
      const fin = await send("POST", `/api/individual/scholar/osce/attempts/${att.json.attemptId}`, { action: "finish", ...(sections.length ? { responses } : {}) }, jar);
      osceOk = fin.status === 200; if (!osceOk) osceWhy = `finish ${why(fin)}`;
    } else osceWhy = `attempt ${why(att)}`;
  }
  record(who, "OSCE station and attempt", osceOk, osceOk ? "" : osceWhy);

  // An evaluation of the notes.
  const ev = await send("POST", "/api/individual/scholar/evaluations", { scope: { kind: "documents", materialIds: [sepsis, meds].filter(Boolean) }, method: "existing" }, jar);
  record(who, "evaluation", ev.status === 200, ev.status === 200 ? "" : why(ev));

  record(who, "study calendar entries", false, "not seeded: a calendar entry is a move of a planned activity whose reference is computed from the plan on the day");
}

// ── commands ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function needOwner() {
  if (!OWNER) { console.error("An owner profile id is required: --owner <profile id> or PREVIEW_OWNER_ID (the staging platform owner)."); process.exit(1); }
}
async function ownerCheck() {
  const r = await admin.rpc("hq_actor_is_owner", { p_actor: OWNER });
  if (r.error || r.data !== true) { console.error("That profile id is not a platform owner on this project, so nothing was changed."); process.exit(1); }
}
async function schemaCheck() {
  const r = await admin.from("individual_scholar_preview_learner").select("user_id", { head: true, count: "exact" });
  if (r.error) { console.error("Migration 860 is not applied on this project (individual_scholar_preview_learner is unreadable). Nothing was changed."); process.exit(1); }
}

async function up(reseed: boolean) {
  needOwner(); await ownerCheck(); await schemaCheck();
  const live = await fetch(BASE + "/individual/welcome", { redirect: "manual" }).catch(() => null);
  for (const l of LEARNERS) {
    console.log(`\n${l.local} (${l.mode})`);
    const acct = await ensureAccount(l);
    const dsg = await admin.from("individual_scholar_preview_learner").select("user_id").eq("user_id", acct.id).maybeSingle();
    if (!dsg.data) { await provisionAccess(l, acct.id); record(l.local, "account, classification, access, designation", true, acct.email); }
    else record(l.local, "account, classification, access, designation", true, `already in place (${acct.email})`);
    if (!live) { record(l.local, "seeding", false, `no dev server at ${BASE}: start it against the staging project, then run refresh`); continue; }
    if (reseed) {
      const jar = await mintJar(acct.email);
      if (jar) { const e = await send("POST", "/api/individual/scholar/erase", { confirm: "ERASE" }, jar); record(l.local, "erase earlier records", e.status === 200, e.status === 200 ? "" : why(e)); }
    } else {
      const has = await admin.from("individual_scholar_material").select("id", { head: true, count: "exact" }).eq("user_id", acct.id);
      if ((has.count ?? 0) > 0) { record(l.local, "seeding", true, `already seeded (${has.count} materials): use refresh to start again`); continue; }
    }
    await seed(l, acct.id, acct.email);
  }
  console.log("\nSUMMARY");
  for (const s of summary) console.log(`  ${s.ok ? "ok  " : "SKIP"} ${s.learner} · ${s.step}${s.detail ? ` -- ${s.detail}` : ""}`);
  console.log(`\ntarget ${ref}. Preview ready when both accounts show 'access, designation' ok. Run: status`);
}

const COUNTS: [string, string][] = [
  ["materials", "individual_scholar_material"], ["sections", "individual_scholar_chunk"], ["Learn sessions", "individual_scholar_learning_session"],
  ["flashcard decks", "individual_scholar_flashcard_deck"], ["questions and cards", "individual_scholar_question"], ["card reviews", "individual_scholar_review"],
  ["answers", "individual_scholar_attempt"], ["revision sessions", "individual_scholar_revision_session"], ["cases", "individual_scholar_case"], ["case sessions", "individual_scholar_case_session"],
  ["OSCE stations", "individual_scholar_osce_station"], ["OSCE attempts", "individual_scholar_osce_attempt"], ["evaluations", "individual_scholar_evaluation"],
  ["study plan", "individual_scholar_study_plan"], ["calendar entries", "individual_scholar_calendar_entry"],
];
async function status() {
  const r = await admin.from("individual_scholar_preview_learner").select("user_id, mode, designated_at");
  if (r.error) console.log("Migration 860 is not applied here (designations unreadable).");
  for (const l of LEARNERS) {
    const acct = await existing(l);
    console.log(`\n${l.local} (${l.mode})`);
    if (!acct) { console.log("  not created"); continue; }
    const d = (r.data ?? []).find((x: any) => x.user_id === acct.id);
    const cls = await admin.from("hq_account_classification").select("account_type").eq("profile_id", acct.id).maybeSingle();
    const live = await admin.from("individual_live_entitlement").select("experience_code").eq("user_id", acct.id);
    console.log(`  ${acct.email} · classified ${cls.data?.account_type ?? "no"} · designated ${d ? d.mode : "no"} · live ${((live.data ?? []) as any[]).map(x => x.experience_code).join(",") || "none"}`);
    for (const [label, table] of COUNTS) {
      const c = await admin.from(table).select("*", { head: true, count: "exact" }).eq("user_id", acct.id);
      console.log(`  ${label.padEnd(20)} ${c.error ? "unreadable" : c.count}`);
    }
  }
}

async function down() {
  for (const l of LEARNERS) {
    const u = await existing(l);
    if (!u) continue;
    const listed = await admin.storage.from(BUCKET).list(u.id, { limit: 1000 });
    if (listed.data?.length) await admin.storage.from(BUCKET).remove(listed.data.map((o: any) => `${u.id}/${o.name}`));
    await admin.from("individual_scholar_preview_session").delete().eq("learner_id", u.id);
    await admin.from("individual_scholar_preview_learner").delete().eq("user_id", u.id);
    for (const t of ["individual_scholar_case_session", "individual_scholar_case", "individual_scholar_revision_session", "individual_scholar_revision_set", "individual_scholar_learning_session",
      "individual_scholar_learning_preference", "individual_scholar_osce_attempt", "individual_scholar_osce_station", "individual_scholar_evaluation", "individual_scholar_study_plan",
      "individual_scholar_flashcard_deck", "individual_scholar_review", "individual_scholar_card", "individual_scholar_attempt", "individual_scholar_question",
      "individual_scholar_material", "individual_scholar_collection", "individual_scholar_consent", "individual_scholar_learner", "individual_scholar_learner_context",
      "individual_entitlement", "individual_membership", "hq_account_classification"])
      await admin.from(t).delete().eq(t === "hq_account_classification" ? "profile_id" : "user_id", u.id);
    await admin.from("plat_ai_requests").delete().eq("actor_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
    console.log(`removed ${l.local}`);
  }
}

(async () => {
  console.log(`provision-scholar-demo-learner · target ${ref} · server ${BASE}`);
  if (cmd === "up") await up(false);
  else if (cmd === "refresh") await up(true);
  else if (cmd === "status") await status();
  else if (cmd === "down") await down();
  else { console.error("up | refresh | status | down   [--base <dev server>] [--owner <profile id>]"); process.exit(1); }
})().catch(e => { console.error(String(e?.message ?? e)); process.exit(1); });
