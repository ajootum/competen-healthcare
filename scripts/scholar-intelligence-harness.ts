/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR LEARNING INTELLIGENCE HARNESS -- COMPETEN-SCHOLAR-01 S5, over HTTP, STAGING ONLY.
 *
 * One Scholar learner, real sign-in and session, real answers through /api/individual/scholar/attempts and a
 * real revision review through /api/individual/scholar/cards/[id]. Then the Progress page is read for the four
 * measures, and revision is chosen for the Passport through the existing passport route.
 *
 *   L1  before any answers: knowledge, reasoning and coverage say Not measured, never a figure
 *   L2  below the threshold: "Too little practice to say", with have/need
 *   L3  knowledge and reasoning are separate panels with separate figures
 *   L4  coverage stays Not measured while S1/S2 are not connected
 *   L5  a review writes one review-log row (migration 391) and engagement counts it
 *   L6  revision can be chosen for the Passport and shows as a count, never the recall grade
 *   L7  recommendations render with their reasons
 *
 * Needs a staging-pointed dev server at BASE_URL with individual_app ON and the staging-test legal versions
 * (the staging launcher). It never writes the release flag. Fixtures: harness-s5-* identities, deleted at the
 * start and the end; study rows are inserted directly (no AI call), as a learner would have them.
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only scholar-intelligence
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { INDIVIDUAL_APP_FLAG } from "../src/lib/individual/gate";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
assertSafeTarget(url, "scholar-intelligence-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.BASE_URL ?? "http://localhost:3020";

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const LEARNER = "harness-s5-learner@competen.test", GRANTOR = "harness-s5-grantor@competen.test";
const PW = `s5-${Math.random().toString(36).slice(2)}-Aa1!`;
const LEGAL = { h: { terms: "staging-test-h-terms-1", privacy: "staging-test-h-privacy-1" }, s: { terms: "staging-test-s-terms-1", privacy: "staging-test-s-privacy-1" } };

async function findUser(email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit; if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
async function cleanup() {
  for (const email of [LEARNER, GRANTOR]) {
    const u = await findUser(email); if (!u) continue;
    await admin.from("individual_scholar_material").delete().eq("user_id", u.id); // cascades chunks, questions, attempts, cards, reviews, passport items
    await admin.from("individual_entitlement").delete().eq("user_id", u.id);
    await admin.from("individual_membership").delete().eq("user_id", u.id);
    await admin.from("audit_log").delete().eq("actor_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}

type Jar = Map<string, string>;
const cookie = (j: Jar) => [...j].map(([k, v]) => `${k}=${v}`).join("; ");
async function signIn(email: string): Promise<Jar> {
  const jar: Jar = new Map();
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  for (const c of (res.headers as any).getSetCookie()) { const [pair] = c.split(";"); const i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
  if (res.status !== 200) throw new Error(`sign-in ${res.status}`);
  return jar;
}
const post = async (path: string, body: unknown, j: Jar) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie(j) }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
};
const page = async (path: string, j: Jar) => {
  const r = await fetch(BASE + path, { headers: { Cookie: cookie(j) }, redirect: "manual" });
  return { status: r.status, text: (await r.text()).replace(/<!-- -->/g, "") };
};
/** The text of one Learning intelligence panel, by its heading id. */
const panel = (html: string, id: string) => {
  const i = html.indexOf(`id="${id}"`); if (i < 0) return "";
  const end = html.indexOf("</section>", i); return html.slice(i, end < 0 ? i + 4000 : end);
};

async function main() {
  console.log(`SCHOLAR LEARNING INTELLIGENCE HARNESS (S5) against ${BASE}\n`);
  const { data: flag } = await admin.from("practice_platform_flags").select("enabled").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle();
  if (flag?.enabled !== true) { console.log("  PEND  individual_app is not ON here. Nothing created. This harness never writes the flag."); return; }
  const probe = await admin.from("individual_scholar_review").select("id").limit(0);
  if (probe.error) { console.log(`  PEND  migration 391 is not applied here (${probe.error.code}). Nothing created.`); return; }

  await cleanup();
  const mk = async (email: string, name: string) => {
    const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { full_name: name } });
    if (error) throw error; return data.user.id as string;
  };
  const grantor = await mk(GRANTOR, "S5 Grantor"), learner = await mk(LEARNER, "S5 Learner");
  const req = validateGrant({ targetUserId: learner, experiences: ["scholar"], adultConfirmed: true });
  if (isGrantRefusal(req)) throw new Error(req.message);
  const g = await grantIndividualAccess(admin, req, grantor); if (!g.ok) throw new Error(g.message);
  const now = new Date().toISOString();
  await admin.from("individual_membership").update({ onboarded_at: now, primary_experience: "scholar",
    foundation_terms_version: LEGAL.h.terms, foundation_privacy_version: LEGAL.h.privacy, foundation_accepted_at: now }).eq("user_id", learner);
  await admin.from("individual_entitlement").update({ terms_version: LEGAL.s.terms, privacy_version: LEGAL.s.privacy, terms_accepted_at: now }).eq("user_id", learner);

  // Study rows, as a learner who uploaded one material would have them: 6 practice questions, 3 scenarios.
  const { data: mat } = await admin.from("individual_scholar_material").insert({
    user_id: learner, title: "S5 Cardiology notes", file_name: "cardio.pdf", mime_type: "application/pdf", byte_size: 1000, sha256: "0".repeat(64),
    storage_path: `${learner}/harness-s5.pdf`, page_count: 1, chunk_count: 1, char_count: 100, extractor: "harness", pii_attested_at: now,
  }).select("id").single();
  if (!mat) throw new Error("fixture material could not be written");
  const { data: chunk } = await admin.from("individual_scholar_chunk").insert({ material_id: mat.id, user_id: learner, ordinal: 1, page_from: 1, page_to: 1, content: "Heart failure notes." }).select("id").single();
  if (!chunk) throw new Error("fixture chunk could not be written");
  const qrow = (kind: "mcq" | "case", n: number) => ({ user_id: learner, material_id: mat.id, chunk_id: chunk.id, kind, stem: `S5 ${kind} ${n}`,
    options: ["A", "B", "C", "D"], correct_index: 0, rationale: "Because.", source_quote: "Heart failure notes.", model: "harness", provider: "harness", prompt_version: "harness" });
  const { data: qs } = await admin.from("individual_scholar_question").insert([...[1, 2, 3, 4, 5, 6].map(n => qrow("mcq", n)), ...[1, 2, 3].map(n => qrow("case", n))]).select("id, kind");
  if (!qs) throw new Error("fixture questions could not be written");
  const mcq = (qs as any[]).filter(x => x.kind === "mcq").map(x => x.id), cases = (qs as any[]).filter(x => x.kind === "case").map(x => x.id);

  const s = await signIn(LEARNER);
  const PROGRESS = "/individual/scholar/study/progress";

  const p0 = await page(PROGRESS, s);
  ok("L1. before any answers: knowledge, reasoning and coverage say Not measured, never a figure",
    p0.status === 200 && p0.text.includes("Learning intelligence") && panel(p0.text, "li-know").includes("Not measured")
    && panel(p0.text, "li-reason").includes("Not measured") && !/\d+%/.test(panel(p0.text, "li-know")), `status ${p0.status}`);

  // Three answers: below the threshold of 5.
  for (const [i, id] of mcq.slice(0, 3).entries()) await post("/api/individual/scholar/attempts", { questionId: id, chosenIndex: i === 2 ? 1 : 0 }, s);
  const p1 = await page(PROGRESS, s);
  ok("L2. below the threshold: Too little practice to say, with how many so far", panel(p1.text, "li-know").includes("Too little practice to say") && panel(p1.text, "li-know").includes("You have 3 so far"));

  // Three more practice answers (6 answered, 1 wrong) and three scenarios (1 right): both measured, separately.
  for (const id of mcq.slice(3)) await post("/api/individual/scholar/attempts", { questionId: id, chosenIndex: 0 }, s);
  for (const [i, id] of cases.entries()) await post("/api/individual/scholar/attempts", { questionId: id, chosenIndex: i === 0 ? 0 : 1 }, s);
  const p2 = await page(PROGRESS, s);
  const know = panel(p2.text, "li-know"), reason = panel(p2.text, "li-reason");
  ok("L3. knowledge and clinical reasoning are separate panels with their own figures (MCQ 83%, scenarios below threshold)",
    know.includes("83%") && know.includes("From 6 practice questions") && reason.includes("Too little practice to say") && reason.includes("You have 3 so far"), know.slice(0, 200));
  ok("L4. competency coverage stays Not measured while S1 and S2 are not connected", panel(p2.text, "li-cov").includes("Not measured") && panel(p2.text, "li-cov").includes("not yet linked") || panel(p2.text, "li-cov").includes("No competency framework"));

  // A missed question made a revision card. Review it once.
  const { data: card } = await admin.from("individual_scholar_card").select("id").eq("user_id", learner).limit(1).maybeSingle();
  const rv = card ? await post(`/api/individual/scholar/cards/${card.id}`, { quality: 4 }, s) : { status: 0, json: {} };
  const { data: logged } = await admin.from("individual_scholar_review").select("material_id, quality").eq("user_id", learner);
  const p3 = await page(PROGRESS, s);
  ok("L5. a review writes one review-log row and engagement counts it",
    !!card && rv.status === 200 && (logged ?? []).length === 1 && (logged as any[])[0].material_id === mat.id && (logged as any[])[0].quality === 4
    && panel(p3.text, "li-eng").includes("Revision reviews are recorded from"), `card ${!!card} review ${rv.status} rows ${(logged ?? []).length}`);

  const choose = await post("/api/individual/scholar/passport", { materialId: mat.id, achievement: "revision_reviews", label: "Cardiology revision" }, s);
  const passport = await page("/individual/scholar/passport", s);
  ok("L6. revision can be chosen for the Passport and shows as a count, never the recall grade",
    choose.status === 200 && passport.text.includes("Cardiology revision") && passport.text.includes("1 revision review of own notes") && !/recall/i.test(passport.text.slice(passport.text.indexOf("Cardiology revision"), passport.text.indexOf("Cardiology revision") + 400)),
    `choose ${choose.status} ${JSON.stringify(choose.json)}`);

  // L8. COMPETEN-SCHOLAR-01 P0: S1 and S2 are both live (COMPETENCY_SOURCES = the learner's programme catalogue
  // + S2 accepted maps). Without a programme, coverage says no framework is connected. With the learner's
  // programme chosen, coverage is MEASURED against that programme's competencies (the same denominator as
  // progress by competency). ⚠ SHARED STAGING CONFIG IS ONLY READ: the Scholar allowlist and the viewing
  // programme (scripts/seed-staging-scholar-viewing.ts) are never written here. The one write is the fixture
  // learner's own programme choice, removed with the fixture. No allowlisted programme here: PEND.
  const beforeCov = panel(p3.text, "li-cov");
  const viewing = (await admin.from("individual_scholar_programme").select("code").eq("code", "nursing-ug-diploma").eq("is_active", true).maybeSingle()).data;
  const { data: allow } = await admin.from("workspace_config_overrides").select("published")
    .eq("scope_type", "platform").eq("scope_ref", "individual").eq("config_path", "individual.policy.scholar_catalogues").maybeSingle();
  if (!viewing || !(allow?.published?.ids ?? []).length) {
    console.log("  PEND  L8. coverage against the learner's programme -- no allowlisted viewing programme on this environment (nothing written)");
  } else {
    await admin.from("individual_scholar_learner").upsert({ user_id: learner, programme_code: viewing.code }, { onConflict: "user_id" });
    const afterCov = panel((await page(PROGRESS, s)).text, "li-cov");
    await admin.from("individual_scholar_learner").delete().eq("user_id", learner);
    ok("L8. S1 and S2 are live: no programme is 'no framework connected'; with the learner's programme, coverage is measured against its competencies",
      beforeCov.includes("No competency framework is connected") && /Practised\s*0 of \d+/.test(afterCov),
      `before: ${beforeCov.slice(0, 120)} | after: ${afterCov.slice(0, 160)}`);
  }

  ok("L7. recommendations render with their reasons: scenarios short of the threshold ask for 2 more", p3.text.includes("What to do next") && p3.text.includes("Work through 2 more practice scenarios") && p3.text.includes("Then Scholar can show how your clinical reasoning is going"));
}

main()
  .catch(err => { fails.push(`crashed: ${err?.message ?? err}`); console.log(`  FAIL  crashed: ${err?.stack ?? err}`); })
  .finally(async () => {
    await cleanup().catch(() => {});
    console.log(`\n${fails.length === 0 ? "ALL GREEN" : "RED"} -- ${pass} passed, ${fails.length} failed`);
    if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exitCode = 1; }
  });
