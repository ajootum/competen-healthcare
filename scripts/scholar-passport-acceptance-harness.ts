/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR PASSPORT ACCEPTANCE HARNESS -- COMPETEN-IND-004 s11, migration 375, against a STAGING project.
 *
 *   npx --yes tsx scripts/scholar-passport-acceptance-harness.ts
 *   VERIFY_BASE_URL=http://localhost:3033 npx --yes tsx scripts/scholar-passport-acceptance-harness.ts
 *
 * ⚠ STAGING ONLY. assertSafeTarget refuses the production project. It creates three synthetic fixtures
 * (harness-ind004p-*@competen.test), study rows, Passport choices and share links, and removes them all
 * at the end. The individual_app release flag is recorded, set ON for the run and put back as it was.
 *
 * What it proves, owner continuation GO 2026-10-23 item 3:
 *   D  nothing is in the Passport by default, though the study history exists
 *   O  opt-in per eligible achievement, inclusion and removal independent, ineligible refused
 *   H  removal leaves the study history exactly as it was
 *   X  notes, questions, answers and AI output never reach the Passport or a share link
 *   L  self-directed, self-declared and organisation-verified items carry distinct labels
 *   I  cross-user isolation: RLS own-row, the 375 composite key, the store keyed on the caller
 *   S  share links: a live link loses an achievement the moment it is removed, a new link minted after
 *      removal never shows it, another person's link and an organisation-minted link show none of it.
 *      Over HTTP against /verify when VERIFY_BASE_URL names a running server of this branch, and always
 *      through the same functions /verify calls.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess } from "../src/lib/individual/grants";
import { individualAppEnabled, INDIVIDUAL_APP_FLAG } from "../src/lib/individual/gate";
import * as store from "../src/lib/individual/scholar/store";
import { chunkPages, extractMaterial } from "../src/lib/individual/scholar/extract";
import { eligibleAchievements } from "../src/lib/individual/scholar/passport-items";
import { BUCKET, PDF_MIME } from "../src/lib/individual/scholar/config";
import { tinyPdf } from "../src/lib/individual/scholar/test-documents";
import { EVIDENCE_LABEL, loadIndividualPassport } from "../src/lib/individual/passport";
import { mintShare, shareCarriesOwnRecords } from "../src/lib/individual/professional/share";
import { randomBytes } from "node:crypto";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-passport-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.VERIFY_BASE_URL?.replace(/\/$/, "") || null;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const FIX = { grantor: "harness-ind004p-grantor@competen.test", a: "harness-ind004p-a@competen.test", b: "harness-ind004p-b@competen.test" };
// A test value generated for this run, used only to sign the fixtures in for group I.
const FIX_PASSWORD = `ind004p-${randomBytes(9).toString("base64url")}-Aa1!`;
const RUN = randomBytes(3).toString("hex");
const LABEL_Q = `Harness renal practice ${RUN}`;
const LABEL_S = `Harness renal scenarios ${RUN}`;
const PAGE = [
  "Acute kidney injury is staged by the rise in serum creatinine and by urine output.",
  "Stage 3 is a rise to three times the baseline creatinine.",
];
const STEM = `Harness stem ${RUN}: how is acute kidney injury staged?`;
const OPTION = `Harness option ${RUN}: by serum creatinine and urine output`;

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
    await admin.from("individual_professional_share").delete().eq("user_id", u.id);
    await admin.from("passport_share_tokens").delete().eq("nurse_id", u.id);
    await admin.from("individual_scholar_material").delete().eq("user_id", u.id);
    await admin.from("individual_scholar_consent").delete().eq("user_id", u.id);
    await admin.from("individual_entitlement").delete().eq("user_id", u.id);
    await admin.from("individual_membership").delete().eq("user_id", u.id);
    await admin.from("audit_log").delete().eq("actor_id", u.id);
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

/** One material for a person: the browser upload path, then extraction, as the route does it. */
async function material(userId: string, title: string) {
  const bytes = tinyPdf([PAGE]);
  const slot = await store.createUploadSlot(admin, userId, PDF_MIME);
  if (!slot) throw new Error("no upload slot");
  const browser = createClient(url!, anonKey!, { auth: { persistSession: false } });
  const put = await browser.storage.from(BUCKET).uploadToSignedUrl(slot.path, slot.token, bytes, { contentType: PDF_MIME });
  if (put.error) throw new Error(`put: ${put.error.message}`);
  const ex = await extractMaterial(PDF_MIME, bytes);
  if (!ex.ok) throw new Error(`extract: ${ex.reason}`);
  const made = await store.createMaterial(admin, userId, {
    id: slot.uploadId, path: slot.path, title, fileName: `${title}.pdf`, mime: PDF_MIME, bytes,
    pageCount: ex.pageCount, extractor: ex.extractor, chunks: chunkPages(ex.pages),
  });
  if (!made.ok) throw new Error(`material: ${made.error}`);
  const chunks = await store.listChunks(admin, userId, made.id);
  const passage = chunks.ok ? await store.getPassage(admin, userId, chunks.data[0].id) : null;
  if (!passage) throw new Error("no passage");
  return { id: made.id, passage };
}

/** Questions written directly (no AI call): the stored shape the questions route writes after its checks. */
async function questions(userId: string, passage: any, kind: "mcq" | "case", n: number) {
  const drafts = Array.from({ length: n }, (_, i) => ({
    stem: `${STEM} (${kind} ${i + 1})`, options: [OPTION, "By the baseline creatinine alone", "By prerenal causes", "By renal and postrenal causes"] as [string, string, string, string],
    correctIndex: 0, rationale: "Your notes say so.", sourceQuote: PAGE[0],
  }));
  const r = await store.insertQuestions(admin, userId, { passage, kind, drafts, model: "harness", provider: "harness", promptVersion: "harness" });
  if (!r.ok) throw new Error("insertQuestions");
  return r.ids;
}

async function answer(userId: string, questionId: string, chosen: number) {
  const q = await store.getQuestion(admin, userId, questionId);
  if (!q) throw new Error("getQuestion");
  return store.recordAttempt(admin, userId, q, chosen);
}

async function historyCounts(userId: string) {
  const tables = ["individual_scholar_material", "individual_scholar_chunk", "individual_scholar_question", "individual_scholar_attempt", "individual_scholar_card"];
  const counts = await Promise.all(tables.map(t => admin.from(t).select("id", { count: "exact", head: true }).eq("user_id", userId)));
  return counts.map((c: any) => c.count ?? -1).join(",");
}

/** What /verify renders for this link: its own gate and companion check, then the study read. */
async function verifyStudy(token: { id: string; nurse_id: string }) {
  const carriesOwn = (await individualAppEnabled(admin)) && await shareCarriesOwnRecords(admin, token.id, token.nurse_id);
  if (!carriesOwn) return [] as string[];
  const s = await store.loadStudyAchievements(admin, token.nurse_id);
  return s.ok ? s.data.map(a => a.label) : ["<unreadable>"];
}

/** The page itself, over HTTP, when a server of this branch is running. Null when none was named. */
async function verifyHtml(token: string): Promise<string | null> {
  if (!BASE) return null;
  const res = await fetch(`${BASE}/verify/${token}`, { cache: "no-store" });
  // React separates adjacent text with <!-- --> in server HTML, so compare text, not markup.
  return res.ok ? (await res.text()).replace(/<!-- -->/g, "") : `HTTP ${res.status}`;
}

async function main() {
  console.log(`SCHOLAR PASSPORT ACCEPTANCE HARNESS (COMPETEN-IND-004 s11, migration 375) -- target ${ref}`);
  console.log(BASE ? `  /verify over HTTP at ${BASE}\n` : "  NOTE  VERIFY_BASE_URL not set -- the share checks run through /verify's functions only, not over HTTP\n");

  const probe = await admin.from("individual_scholar_passport_item").select("id").limit(0);
  if (probe.error) {
    console.log(`  PEND  migration 375 is not applied here (${probe.error.code ?? probe.error.message}). Nothing was created.`);
    process.exit(0);
  }
  // A control for the probe itself: a table that does not exist must read as an error here.
  const control = await admin.from("individual_scholar_passport_item_nonexistent").select("id").limit(0);
  ok("P0. the 375 probe can fail: a missing table reads as an error", !!control.error);

  await cleanup();
  const flagRead = await admin.from("practice_platform_flags").select("flag, enabled, note").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle();
  priorFlag = flagRead.data ?? null;
  await admin.from("practice_platform_flags").upsert({ flag: INDIVIDUAL_APP_FLAG, enabled: true, note: "scholar-passport-acceptance-harness: ON (restored after run)" });
  ok("R0. the release gate reads ON for the run (prior state recorded for Z2)", (await individualAppEnabled(admin)) === true);

  const grantor = await makeUser(FIX.grantor);
  const a = await makeUser(FIX.a);
  const b = await makeUser(FIX.b);
  const ga = await grantIndividualAccess(admin, { targetUserId: a, experiences: ["scholar", "professional"], adultConfirmed: true, note: "scholar-passport-acceptance-harness" }, grantor);
  const gb = await grantIndividualAccess(admin, { targetUserId: b, experiences: ["scholar", "professional"], adultConfirmed: true, note: "scholar-passport-acceptance-harness" }, grantor);
  ok("S0. both fixtures hold live Scholar and Professional pilot grants", ga.ok && gb.ok);

  try {
    // ── the study history ──
    const m = await material(a, `Harness renal notes ${RUN}`);
    const mcq = await questions(a, m.passage, "mcq", 2);
    const cases = await questions(a, m.passage, "case", 1);
    await answer(a, mcq[0], 1);          // wrong: a card
    await answer(a, mcq[0], 0);          // then right: still ONE question answered
    await answer(a, mcq[1], 0);
    const mb = await material(b, `Harness B notes ${RUN}`);
    const mcqB = await questions(b, mb.passage, "mcq", 1);
    await answer(b, mcqB[0], 0);

    // ── D. NOTHING BY DEFAULT ──
    const d0 = await store.loadStudyAchievements(admin, a);
    const pp0 = await loadIndividualPassport(admin, a, new Date().toISOString().slice(0, 10));
    ok("D1. with a study history and no choice, nothing is in the Passport",
      d0.ok && d0.data.length === 0 && pp0.study.ok && pp0.study.data.length === 0);
    const rows = await store.progressRows(admin, a);
    const ch0 = await store.listPassportChoices(admin, a);
    const el = rows.ok && ch0.ok ? eligibleAchievements({ ...rows.data, choices: ch0.data }) : [];
    ok("D2. the eligible achievements are the earned ones only: practice questions (2 answered), not scenarios (none answered yet)",
      el.length === 1 && el[0].achievement === "practice_questions" && el[0].answered === 2 && el[0].chosenLabel === null, JSON.stringify(el));

    // ── O. OPT-IN, PER ITEM, INDEPENDENT ──
    const before = await historyCounts(a);
    ok("O1. an achievement not yet earned is refused (scenarios, none answered)",
      (await store.includeInPassport(admin, a, { materialId: m.id, achievement: "practice_scenarios", label: LABEL_S })) === "not_eligible");
    ok("O2. including an earned achievement adds exactly that one, with the chosen title",
      (await store.includeInPassport(admin, a, { materialId: m.id, achievement: "practice_questions", label: LABEL_Q })) === "included");
    const o2 = await store.loadStudyAchievements(admin, a);
    ok("O3. it is shown with the count of distinct questions answered (2) and when, labelled by the person's title",
      o2.ok && o2.data.length === 1 && o2.data[0].label === LABEL_Q && o2.data[0].answered === 2 && !!o2.data[0].lastStudied, JSON.stringify(o2));
    await answer(a, cases[0], 0);
    ok("O4. once earned, the second achievement can be included on its own",
      (await store.includeInPassport(admin, a, { materialId: m.id, achievement: "practice_scenarios", label: LABEL_S })) === "included");
    const o4 = await store.loadStudyAchievements(admin, a);
    ok("O5. both are shown", o4.ok && o4.data.map(x => x.label).sort().join("|") === [LABEL_Q, LABEL_S].sort().join("|"));

    // ── S. SHARE LINKS (minted while both are included) ──
    const live = await mintShare(admin, a, { scope: "full", label: "harness live link", days: 1 });
    const liveSummary = await mintShare(admin, a, { scope: "summary", label: "harness summary link", days: 1 });
    ok("S1. a Professional link carries the person's chosen study, through /verify's own functions",
      !!live && (await verifyStudy({ id: live.id, nurse_id: a })).sort().join("|") === [LABEL_Q, LABEL_S].sort().join("|"));
    const h1 = live ? await verifyHtml(live.token) : null;
    if (BASE) ok("S1h. over HTTP: the live link's page shows both titles and the self-directed label",
      !!h1 && h1.includes(LABEL_Q) && h1.includes(LABEL_S) && h1.includes(EVIDENCE_LABEL.self_directed), h1?.slice(0, 80) ?? "");
    const hs = liveSummary ? await verifyHtml(liveSummary.token) : null;
    if (BASE) ok("S2h. over HTTP: a summary link gives the count, not the titles",
      !!hs && hs.includes("2 self-directed study achievements") && !hs.includes(LABEL_Q));

    // ── remove one ──
    const removed = await store.removeFromPassport(admin, a, m.id, "practice_questions");
    const o6 = await store.loadStudyAchievements(admin, a);
    ok("O6. removing one takes off that one only; the other stays",
      removed.ok && removed.found && o6.ok && o6.data.length === 1 && o6.data[0].label === LABEL_S);
    ok("H1. the study history is exactly as it was: material, chunks, questions, answers, cards",
      (await historyCounts(a)) === before.split(",").map((n, i) => (i === 3 ? String(Number(n) + 1) : n)).join(","),
      `${before} -> ${await historyCounts(a)} (one scenario answered in between)`);

    ok("S3. the SAME live link no longer shows the removed achievement (read at render time)",
      !!live && (await verifyStudy({ id: live.id, nurse_id: a })).join("|") === LABEL_S);
    const h3 = live ? await verifyHtml(live.token) : null;
    if (BASE) ok("S3h. over HTTP: the same live link's page no longer shows the removed title, and still shows the other",
      !!h3 && !h3.includes(LABEL_Q) && h3.includes(LABEL_S));
    const fresh = await mintShare(admin, a, { scope: "full", label: "harness new link", days: 1 });
    ok("S4. a link minted after the removal never shows it",
      !!fresh && (await verifyStudy({ id: fresh.id, nurse_id: a })).join("|") === LABEL_S);
    const h4 = fresh ? await verifyHtml(fresh.token) : null;
    if (BASE) ok("S4h. over HTTP: the new link's page does not show the removed title", !!h4 && !h4.includes(LABEL_Q) && h4.includes(LABEL_S));

    // ── foreign and organisation-minted links ──
    const bLink = await mintShare(admin, b, { scope: "full", label: "harness B link", days: 1 });
    const orgToken = randomBytes(24).toString("hex");
    const { data: org } = await admin.from("passport_share_tokens").insert({
      token: orgToken, nurse_id: a, hospital_id: null, scope: "full", label: "harness organisation-style link",
      expires_at: new Date(Date.now() + 86400000).toISOString(), consent: true, revoked: false,
    }).select("id, token").single();
    ok("S5. another person's link shows none of A's study, and an organisation-minted link for A shows none at all",
      !!bLink && (await verifyStudy({ id: bLink.id, nurse_id: b })).length === 0 && !!org && (await verifyStudy({ id: org.id, nurse_id: a })).length === 0);
    const hb = bLink ? await verifyHtml(bLink.token) : null;
    const ho = org ? await verifyHtml(org.token) : null;
    if (BASE) ok("S5h. over HTTP: neither page shows A's titles or the self-directed section",
      !!hb && !!ho && ![hb, ho].some(h => h.includes(LABEL_S) || h.includes(LABEL_Q)) && !ho.includes("Self-directed study the professional chose to show"));

    // ── X. CONTENT NEVER SHOWN ──
    const pp = await loadIndividualPassport(admin, a, new Date().toISOString().slice(0, 10));
    const blob = JSON.stringify([pp.study, o4, await store.loadStudyAchievements(admin, a)]);
    ok("X1. the Passport's study data holds no note text, question, option, answer or AI provenance",
      ![PAGE[0], STEM, OPTION, "chosen", "correct", "rationale", "sourceQuote", "harness\",\"provider"].some(s => blob.includes(s)), blob.slice(0, 200));
    if (BASE) ok("X2. over HTTP: the share page shows no note text, question or option", !!h1 && ![PAGE[0], STEM, OPTION].some(s => h1.includes(s)));

    // ── L. LABELS ──
    const labels = [EVIDENCE_LABEL.self_directed, EVIDENCE_LABEL.self_declared, EVIDENCE_LABEL.source_linked, EVIDENCE_LABEL.institution_verified, EVIDENCE_LABEL.institution_issued];
    ok("L1. self-directed, self-declared, document-attached, verified and issued items each carry their own label, and only the organisation classes say verified or issued",
      new Set(labels).size === 5 && /self-directed/i.test(labels[0]) && /not a verified/i.test(labels[0]) && /self-declared/i.test(labels[1])
      && /^verified/i.test(labels[3]) && /^issued/i.test(labels[4]));

    // ── I. ISOLATION ──
    const asA = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const asB = createClient(url!, anonKey!, { auth: { persistSession: false } });
    const sa = await asA.auth.signInWithPassword({ email: FIX.a, password: FIX_PASSWORD });
    const sb = await asB.auth.signInWithPassword({ email: FIX.b, password: FIX_PASSWORD });
    const seenA = await asA.from("individual_scholar_passport_item").select("id");
    const seenB = await asB.from("individual_scholar_passport_item").select("id, user_id");
    ok("I1. RLS: the owner's session sees their own choice, another person's session sees none of it",
      !sa.error && !sb.error && (seenA.data ?? []).length === 1 && (seenB.data ?? []).every((r: any) => r.user_id === b) && (seenB.data ?? []).length === 0);
    const write = await asA.from("individual_scholar_passport_item").insert({ user_id: a, material_id: m.id, achievement: "practice_questions", label: "browser write" });
    const del = await asA.from("individual_scholar_passport_item").delete().eq("user_id", a).select("id");
    ok("I2. RLS: even the owner's browser session cannot add or remove a choice (no write policy)",
      !!write.error && (del.data ?? []).length === 0 && (await store.listPassportChoices(admin, a)).ok);
    const cross = await admin.from("individual_scholar_passport_item").insert({ user_id: b, material_id: m.id, achievement: "practice_questions", label: "cross" });
    ok("I3. the 375 composite key refuses a choice for one person pointing at another person's material", !!cross.error, cross.error?.message ?? "accepted");
    ok("I4. the store, called as B with A's material, refuses to include and finds nothing to remove; A's choice is untouched",
      (await store.includeInPassport(admin, b, { materialId: m.id, achievement: "practice_scenarios", label: "hijack" })) === "not_eligible"
      && !(await store.removeFromPassport(admin, b, m.id, "practice_scenarios")).found
      && (await store.loadStudyAchievements(admin, a)).ok && ((await store.loadStudyAchievements(admin, a)) as any).data.length === 1);
    const badLabel = await admin.from("individual_scholar_passport_item").insert({ user_id: a, material_id: m.id, achievement: "practice_questions", label: "  padded  " });
    const badKind = await admin.from("individual_scholar_passport_item").insert({ user_id: a, material_id: m.id, achievement: "accuracy", label: "x" });
    ok("I5. the schema refuses an untrimmed label and an achievement kind that does not exist", !!badLabel.error && !!badKind.error);

    // ── erasing the material ──
    const erased = await store.deleteMaterial(admin, a, m.id);
    ok("C1. deleting the material takes its achievements off the Passport and off the live link (the 375 cascade)",
      erased.ok && ((await store.loadStudyAchievements(admin, a)) as any).data?.length === 0 && !!live && (await verifyStudy({ id: live.id, nurse_id: a })).length === 0);
  } finally {
    await cleanup();
    await restoreFlag();
    const left = await Promise.all([FIX.a, FIX.b, FIX.grantor].map(findUser));
    ok("Z1. every fixture is gone", left.every(u => !u));
    const flagAfter = await admin.from("practice_platform_flags").select("enabled").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle();
    ok("Z2. the release flag is restored to its state before the run", priorFlag ? flagAfter.data?.enabled === priorFlag.enabled : flagAfter.data === null);
  }

  console.log(`\n${fails.length === 0 ? "ALL GREEN" : "RED"} -- ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main().catch(async e => {
  console.error(e);
  await cleanup().catch(() => {});
  await restoreFlag().catch(() => {});
  process.exit(1);
});
