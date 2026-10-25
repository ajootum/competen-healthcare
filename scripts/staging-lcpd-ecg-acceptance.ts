/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COMPETEN-PROFESSIONAL-LCPD-01 s13 -- THE STAGE 4 ECG JOURNEY ON STAGING, over HTTP, as ONE synthetic Professional member.
 *
 * Owner GO (relayed 2026-10-25): staging only, ONE clearly labelled synthetic Professional member, the s13 journey with a
 * planted defect, then retire the identity (kept, banned), restore what was changed, and list every row created.
 * Owner decision, same day: "Defer the ECG Competen-course steps: IND-007 should run the rest of the Stage 4 journey,
 * report items 2, 3 and 6 as PEND, and send the PR." So NO course and NO other identity. learning_app is NOT switched:
 * no remaining item needs it. learning_commerce is never written.
 *
 *   LCPD_STATE=<file outside the repo> BASE_URL=http://localhost:3040 npx tsx scripts/staging-lcpd-ecg-acceptance.ts [--plant]
 *   LCPD_STATE=<same file>             BASE_URL=http://localhost:3040 npx tsx scripts/staging-lcpd-ecg-acceptance.ts --retire
 *
 * The journey may be run more than once on the SAME identity (the first run creates it and writes its generated
 * password and the PRE values to LCPD_STATE -- never to the output). Totals are computed from the database, so a re-run
 * checks the same things. --plant also edits the CPD page so the requirement summary claims "Verified", waits for the
 * dev server to serve it, expects RED, restores the file byte-identical and expects GREEN again. --retire ends the
 * entitlement, revokes the membership, revokes the sessions, bans the account (kept), proves sign-in is refused, checks
 * the flags against PRE, and lists every row the identity has.
 *
 * ⚠ ONE STAGING FIXTURE BESIDES THE MEMBER. Item 7 needs a configured CPD requirement, and the only door that publishes
 * one is the HQ policy route, which needs an HQ-appointed actor the GO does not allow. So each run writes the LCPD
 * configuration row ONLY (workspace_config_overrides, scope platform/individual, path individual.professional_lcpd),
 * draft and published, validated by checkLcpdDraft, with a SYNTHETIC requirement naming no real body. It does NOT call
 * publishScope, which would publish every other draft in the scope. The row was absent before, and is deleted after.
 * ⚠ STAGING ONLY: judgeTarget must name ezhvpgtcqcdsgylrxgdb, and the server must be local.
 */
import { loadEnvConfig } from "@next/env";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "", anon = process.env.STAGING_ANON_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || verdict.ref !== "ezhvpgtcqcdsgylrxgdb" || !key || !anon) { console.error(`REFUSING: not the staging project (${verdict.ok ? verdict.ref : verdict.reason}).`); process.exit(1); }
const REF = verdict.ref;
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
if (!/^http:\/\/localhost:\d+$/.test(BASE)) { console.error("REFUSING: BASE_URL must be a local staging-pointed dev server."); process.exit(1); }
const STATE = process.env.LCPD_STATE ?? "";
if (!STATE || resolve(STATE).toLowerCase().startsWith(resolve(process.cwd(), "..").toLowerCase())) { console.error("REFUSING: LCPD_STATE must be a file outside the repositories (it holds a password)."); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const PLANT = process.argv.includes("--plant"), RETIRE = process.argv.includes("--retire");

const EMAIL = "stage4-ecg-professional@staging.competen.invalid";
const NAME = "SYNTHETIC Stage 4 ECG professional (IND-007, staging, retire after)";
const PURPOSE = "Owner GO, Stage 4 ECG journey on staging, 2026-10-25 (COMPETEN-PROFESSIONAL-LCPD-01 s13). Synthetic. Retired after: kept, banned.";
const LABEL = "SYNTHETIC Stage 4 ECG";
const PAGE = "src/app/individual/(app)/[experience]/(professional)/cpd/page.tsx";
const PLANT_FROM = "Not verified. {summary.verifiedReason}", PLANT_TO = "Verified: {summary.eligible.hours} hours accepted.";
const FLAGS = ["individual_app", "learning_app", "learning_commerce"];
const REQ = "synthetic_stage4_ecg", REQ_HOURS = 20, REQ_CREDITS = 2, ELIGIBLE = ["workshop", "course", "mentorship"];
const TERMS = { experience: "professional", foundation: { terms: "staging-test-h-terms", privacy: "staging-test-h-privacy" }, experienceDocs: { terms: "staging-test-h-terms", privacy: "staging-test-h-privacy" } };

const results: { item: string; state: "PASS" | "FAIL" | "PEND"; detail: string }[] = [];
const ok = (item: string, c: boolean, detail = "") => { results.push({ item, state: c ? "PASS" : "FAIL", detail }); console.log(`  ${c ? "PASS" : "FAIL"}  ${item}${!c && detail ? ` -- ${detail}` : ""}`); return c; };
const pend = (item: string, why: string) => { results.push({ item, state: "PEND", detail: why }); console.log(`  PEND  ${item} -- ${why}`); };
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const r1 = (n: number) => Math.round(n * 10) / 10;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The visible text of a server-rendered page: scripts, React's text separators and tags removed, entities decoded. */
const textOf = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");

let cookie = "";
const http = async (method: string, path: string, body?: any, multipart?: FormData) => {
  const headers: Record<string, string> = { Cookie: cookie, Origin: BASE };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: multipart ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: "manual" });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* a page */ }
  return { status: res.status, text, json };
};
const page = async (path: string) => { const r = await http("GET", path); return { status: r.status, text: textOf(r.text) }; };

async function findUser() {
  for (let p = 1; p <= 20; p++) {
    const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === EMAIL);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
const readFlags = async () => (await admin.from("practice_platform_flags").select("flag, enabled, note").in("flag", FLAGS)).data ?? [];
const signIn = async (password: string) => {
  const s = await createClient(url, anon, { auth: { persistSession: false } }).auth.signInWithPassword({ email: EMAIL, password });
  if (s.error || !s.data.session) throw new Error(`sign-in: ${s.error?.message}`);
  cookie = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(s.data.session)).toString("base64")}`;
  return s.data.session;
};

/** Every row this identity has, by table: the list the GO asks for. */
async function inventory(uid: string) {
  const T: [string, string][] = [["individual_membership", "user_id"], ["individual_entitlement", "user_id"], ["individual_professional_goal", "user_id"],
    ["individual_professional_cpd", "user_id"], ["individual_professional_cpd_history", "user_id"], ["individual_professional_cpd_setting", "user_id"],
    ["individual_professional_reflection", "user_id"], ["individual_professional_learning_reflection", "user_id"], ["individual_professional_competency_map", "user_id"],
    ["individual_professional_share", "user_id"], ["individual_professional_share_learning", "user_id"], ["passport_share_tokens", "nurse_id"],
    ["notifications", "user_id"], ["audit_log", "actor_id"], ["plat_ai_requests", "actor_id"], ["learning_record", "user_id"]];
  const out: string[] = [];
  for (const [t, c] of T) {
    const r = await admin.from(t).select("id", { count: "exact", head: true }).eq(c, uid);
    out.push(`${t}: ${r.error ? `unreadable (${r.error.message})` : r.count}`);
  }
  const docs = await admin.storage.from("individual-professional-evidence").list(uid).catch(() => ({ data: null }));
  out.push(`storage individual-professional-evidence/${uid}/: ${docs?.data ? docs.data.length : "not listed"}`);
  return out;
}

async function retire() {
  const { endIndividualExperience, setIndividualMembershipStatus } = await import("../src/lib/individual/grants");
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  const u = await findUser();
  if (!u || u.id !== st.uid) { console.error("REFUSING: the identity in LCPD_STATE is not on staging."); process.exit(1); }
  const session = await signIn(st.password);
  const ended = await endIndividualExperience(admin, u.id, "professional");
  const rv = await setIndividualMembershipStatus(admin, u.id, "revoke", u.id);
  const so = await admin.auth.admin.signOut(session.access_token, "global");
  await admin.auth.admin.updateUserById(u.id, { ban_duration: "876000h", user_metadata: { full_name: NAME, synthetic: true, purpose: PURPOSE, retired: new Date().toISOString() } });
  const again = await createClient(url, anon, { auth: { persistSession: false } }).auth.signInWithPassword({ email: EMAIL, password: st.password });
  const stale = await http("GET", "/api/individual/professional/mappings");
  const now = await readFlags();
  const same = FLAGS.every(f => JSON.stringify(now.find((r: any) => r.flag === f) ?? null) === JSON.stringify(st.preFlags.find((r: any) => r.flag === f) ?? null));
  const cfg = (await admin.from("workspace_config_overrides").select("id").eq("scope_type", "platform").eq("scope_ref", "individual").eq("config_path", "individual.professional_lcpd").maybeSingle()).data;
  console.log(`RETIRE ${u.id}: entitlement ended (${ended.ok ? ended.ended : ended.message}), membership ${rv.ok ? `${rv.from} -> ${rv.to}` : rv.message}, sessions revoked (${so.error ? so.error.message : "ok"}), banned until ~2126 (kept)`);
  ok("R1. the identity is retired and kept: sign-in refused, the old session refused", !!again.error && stale.status >= 400, `sign-in ${again.error ? "refused" : "ALLOWED"}, old session HTTP ${stale.status}`);
  ok("R2. the flags are exactly their PRE values (this run wrote none) and the config fixture is gone", same && !cfg, JSON.stringify({ pre: st.preFlags, now }));
  console.log("\nROWS THE IDENTITY HAS (all kept as the record; the config fixture was deleted after each run):");
  for (const l of await inventory(u.id)) console.log(`  - ${l}`);
}

async function journey() {
  const { checkLcpdDraft, LCPD_PATH } = await import("../src/lib/individual/lcpd-config");
  const { grantIndividualAccess, validateGrant, isGrantRefusal, endIndividualExperience } = await import("../src/lib/individual/grants");
  console.log(`STAGE 4 ECG JOURNEY -- staging ${REF}, server ${BASE}${PLANT ? ", with the planted defect" : ""}\n`);

  const flags = await readFlags();
  const flagOf = (f: string) => flags.find((r: any) => r.flag === f) ?? null;
  console.log(`flags now: individual_app=${flagOf("individual_app")?.enabled ?? "no row"}, learning_app=${flagOf("learning_app")?.enabled ?? "no row (off)"}, learning_commerce=${flagOf("learning_commerce")?.enabled ?? "no row (off)"}`);
  if (flagOf("individual_app")?.enabled !== true) { console.error("REFUSING: individual_app is not ON on staging, and this GO does not switch it."); process.exit(1); }
  if ((await admin.from("workspace_config_overrides").select("id").eq("scope_type", "platform").eq("scope_ref", "individual").eq("config_path", LCPD_PATH).maybeSingle()).data) {
    console.error(`REFUSING: ${LCPD_PATH} is configured on staging already; this run does not overwrite it.`); process.exit(1);
  }

  // ── The ONE synthetic member: created on the first run, reused after ──
  let st: { uid: string; password: string; preFlags: any[] };
  const existing = await findUser();
  if (!existing) {
    if (existsSync(STATE)) { console.error("REFUSING: LCPD_STATE exists but the identity does not."); process.exit(1); }
    const password = `${randomBytes(18).toString("base64url")}-Aa1!`;
    const { data: created, error } = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true, user_metadata: { full_name: NAME, synthetic: true, purpose: PURPOSE } });
    if (error || !created?.user) throw new Error(`createUser: ${error?.message}`);
    st = { uid: created.user.id, password, preFlags: flags };
    writeFileSync(STATE, JSON.stringify(st));
    await admin.from("profiles").update({ full_name: NAME }).eq("id", st.uid);
    const g = validateGrant({ targetUserId: st.uid, experiences: ["professional"], note: PURPOSE.slice(0, 200) });
    if (isGrantRefusal(g)) throw new Error(`grant refused: ${g.message}`);
    const out = await grantIndividualAccess(admin, g, st.uid);
    if (!out.ok) throw new Error(`grant failed: ${out.message}`);
    console.log(`member ${st.uid} created (${EMAIL}), Professional only; PRE flags and the password are in LCPD_STATE`);
  } else {
    if (!existsSync(STATE)) { console.error("REFUSING: the identity exists but LCPD_STATE does not -- it is not this run's."); process.exit(1); }
    st = JSON.parse(readFileSync(STATE, "utf8"));
    if (st.uid !== existing.id || existing.banned_until) { console.error("REFUSING: the identity is retired or not the one in LCPD_STATE."); process.exit(1); }
    console.log(`member ${st.uid} reused (same identity)`);
  }
  const uid = st.uid;
  const session = await signIn(st.password);
  const terms = await http("POST", "/api/individual/terms", TERMS);
  if (terms.status !== 200) throw new Error(`terms: HTTP ${terms.status} ${terms.text.slice(0, 200)}`);
  // The welcome's own action: Professional as the primary experience, onboarding complete (the shell sends a member
  // who has not been welcomed to /individual/welcome first).
  const welcomed = await http("POST", "/api/individual/preferences", { primaryExperience: "professional", completeOnboarding: true });
  if (welcomed.status !== 200) throw new Error(`welcome: HTTP ${welcomed.status} ${welcomed.text.slice(0, 200)}`);
  console.log("terms accepted (staging TEST versions), welcome completed\n");
  const pageSrc = readFileSync(PAGE);
  const ai0 = (await admin.from("plat_ai_requests").select("id", { count: "exact", head: true }).eq("actor_id", uid)).count ?? 0;
  let shareId: string | null = null;

  /** What the requirement summary must say, from the database: the cycle starting 20 days ago. */
  const expected = async () => {
    const start = day(-20);
    const rows = ((await admin.from("individual_professional_cpd").select("activity_type, hours, cpd_points, activity_date").eq("user_id", uid)).data ?? []).filter((r: any) => r.activity_date >= start && r.activity_date <= day(0));
    const el = rows.filter((r: any) => ELIGIBLE.includes(r.activity_type));
    return { hours: r1(el.reduce((s: number, r: any) => s + Number(r.hours ?? 0), 0)), credits: r1(el.reduce((s: number, r: any) => s + Number(r.cpd_points ?? 0), 0)), withoutHours: rows.filter((r: any) => r.hours == null).length };
  };
  const req15 = (t: string) => t.includes("Not verified. Competen has no authorised route") && !/Verified: /.test(t);

  try {
    // ── 1. Open My Learning & CPD ──
    const p1 = await page("/individual/professional/cpd");
    ok("1. My Learning & CPD opens for the member", p1.status === 200 && p1.text.includes("Learning & CPD") && p1.text.includes("CPD log"), `HTTP ${p1.status}`);

    // ── 2, 3, 6: Competen Learning (owner decision: deferred) ──
    const why = "no published, clinically approved, certified Competen course can exist on staging until Learning's author, clinical reviewer, publisher and certificate issuer are appointed (owner decision 2026-10-25: deferred)";
    pend("2. View an existing Competen Learning enrolment or completion", why);
    pend("3. Professional references the authoritative Learning record", why);
    pend("6. View the certificate and evidence status of the course", why);

    // A development goal, and the ECG learning recorded as CPD.
    const goal = await http("POST", "/api/individual/professional/goals", { title: `${LABEL}: interpret 12-lead ECGs unaided`, targetDate: day(90) });
    const goalId = goal.json?.id;
    const cpd1 = await http("POST", "/api/individual/professional/cpd", { activityType: "workshop", title: `${LABEL}: 12-lead ECG workshop`, provider: "Ward teaching (synthetic)", hours: "2", activityDate: day(-10), goalId });
    const cpdId = cpd1.json?.id;

    // ── 4. A personal reflection, through Stage 2's writer ──
    const refl = await http("POST", "/api/individual/professional/learning-reflections", { cpdId, template: "guided", answers: ["SYNTHETIC-PRIVATE-REFLECTION axis and rate first", "", "I now check the QT interval every time"], impact: "applied" });
    const reflRow = refl.json?.id ? (await admin.from("individual_professional_learning_reflection").select("reflection_id, impact, cpd_id").eq("id", refl.json.id).maybeSingle()).data : null;
    const body = reflRow ? (await admin.from("individual_professional_reflection").select("body, template_code").eq("id", reflRow.reflection_id).maybeSingle()).data : null;
    ok("4. a guided reflection on the ECG learning is saved privately, with the impact the member reports, through Stage 2's writer",
      refl.status === 201 && reflRow?.impact === "applied" && reflRow.cpd_id === cpdId && body?.template_code === "guided" && /QT interval/.test(body?.body ?? "") && !/\n\n\n/.test(body?.body ?? ""),
      `goal ${goal.status}, cpd ${cpd1.status} ${cpd1.text.slice(0, 120)}, reflection ${refl.status} ${refl.text.slice(0, 160)}`);

    // ── 5. Linked to a development goal and a CFCA outcome ──
    const maps = await http("GET", "/api/individual/professional/mappings");
    const offered = maps.json?.offered ?? [];
    const comp = offered.find((c: any) => /^CF-/.test(c.code)) ?? offered[0];
    const add = comp ? await http("POST", "/api/individual/professional/mappings", { action: "add", kind: "cpd", id: cpdId, competencyId: comp.competencyId }) : { status: 0, text: "no competency offered" };
    const link = (await admin.from("individual_professional_cpd").select("goal_id").eq("id", cpdId).maybeSingle()).data;
    const mapRow = (await admin.from("individual_professional_competency_map").select("id, source").eq("user_id", uid).eq("cpd_id", cpdId)).data ?? [];
    ok(`5. the CPD entry is linked to the development goal and to a CFCA competency (${comp?.code ?? "none"}), by the member, self-declared`,
      cpd1.status === 201 && link?.goal_id === goalId && add.status === 200 && mapRow.length === 1 && mapRow[0].source === "person",
      JSON.stringify({ cpd: cpd1.status, mappings: maps.status, offered: offered.length, add: add.status, addText: add.text.slice(0, 120), mapRow }));

    // ── 7. CPD hours or credits under a configured requirement (the one labelled config fixture) ──
    const draft = checkLcpdDraft({ requirements: [{
      code: REQ, label: `${LABEL} requirement (not a regulator rule)`, profession: "Nurse (synthetic)", jurisdiction: "Staging (synthetic)",
      body: "No real body, a staging fixture", source: { title: "Staging fixture for the Stage 4 journey, IND-007", reference: null, url: null },
      reviewStatus: "unreviewed", reviewedOn: null, cycleMonths: 12, requiredHours: REQ_HOURS, requiredCredits: REQ_CREDITS, eligibleTypes: ELIGIBLE,
      mandatoryCategories: [], evidence: null, reportingPeriod: null, effectiveFrom: day(-30), effectiveTo: null, version: "synthetic-1" }] });
    if (!draft.ok) throw new Error(`requirement draft: ${draft.error}`);
    const cfgW = await admin.from("workspace_config_overrides").insert({ scope_type: "platform", scope_ref: "individual", config_path: LCPD_PATH, hospital_id: null,
      draft: draft.settings, published: draft.settings, updated_by: null, updated_by_name: `${LABEL} acceptance fixture (IND-007, staging, deleted after)`, updated_at: new Date().toISOString() }).select("id").single();
    if (cfgW.error) throw new Error(`config fixture: ${cfgW.error.message}`);
    console.log(`  (config fixture ${cfgW.data.id} written: ${LCPD_PATH}, one synthetic requirement)`);
    const pick = await http("PUT", "/api/individual/professional/cpd/requirement", { requirementCode: REQ, cycleStart: day(-20) });
    const p7 = await page("/individual/professional/cpd");
    const e7 = await expected();
    ok("7. under the configured requirement the member sees hours and credits recorded and potentially eligible, against what is required, with its source",
      pick.status === 200 && p7.text.includes(`${LABEL} requirement`) && p7.text.includes(`${e7.hours} of ${REQ_HOURS} hours`) && p7.text.includes(`${e7.credits} of ${REQ_CREDITS} credits`) && p7.text.includes("Source: Staging fixture"),
      `PUT ${pick.status} ${pick.text.slice(0, 120)}; expected ${JSON.stringify(e7)}; page: ${p7.text.match(/Potentially eligible.{0,80}/)?.[0]}`);

    // ── 8. An external or independent activity: a configured type, no hours, decimal credits ──
    const cpd2 = await http("POST", "/api/individual/professional/cpd", { activityType: "mentorship", title: `${LABEL}: ECG mentoring with a cardiology nurse`, provider: "Independent (synthetic)", hours: "", cpdPoints: "0.5", activityDate: day(-3) });
    const cpd2Id = cpd2.json?.id;
    const cpd2Row = cpd2Id ? (await admin.from("individual_professional_cpd").select("hours, cpd_points").eq("id", cpd2Id).maybeSingle()).data : null;
    const p8 = await page("/individual/professional/cpd");
    const e8 = await expected();
    ok("8. an independent activity is recorded with only a description and a date: no hours, 0.5 credits, counted as credits and as an entry without hours",
      cpd2.status === 201 && cpd2Row?.hours === null && Number(cpd2Row?.cpd_points) === 0.5 && p8.text.includes(`${e8.credits} of ${REQ_CREDITS} credits`) && p8.text.includes(`${e8.withoutHours} with no hours recorded`),
      `HTTP ${cpd2.status} ${cpd2.text.slice(0, 160)}; expected ${JSON.stringify(e8)}`);

    // ── 9. Evidence added without duplication: a document on the SAME entry, the earlier version kept ──
    const before = (await admin.from("individual_professional_cpd").select("id").eq("user_id", uid)).data?.length ?? 0;
    const fd = new FormData();
    for (const [k, v] of Object.entries({ activityType: "workshop", title: `${LABEL}: 12-lead ECG workshop`, provider: "Ward teaching (synthetic)", hours: "2.5", activityDate: day(-10), goalId })) fd.append(k, String(v));
    fd.append("document", new Blob([Buffer.from("%PDF-1.4\n% SYNTHETIC Stage 4 attendance note\n")], { type: "application/pdf" }), "synthetic-attendance.pdf");
    const put = await http("PUT", `/api/individual/professional/cpd?id=${cpdId}`, undefined, fd);
    const after = (await admin.from("individual_professional_cpd").select("id, evidence_class").eq("user_id", uid)).data ?? [];
    const hist = (await admin.from("individual_professional_cpd_history").select("hours").eq("cpd_id", cpdId)).data ?? [];
    ok("9. a document is added to the same entry: still one entry (now source-linked), no second CPD row, and the earlier version is kept as history",
      put.status === 200 && after.length === before && after.find((r: any) => r.id === cpdId)?.evidence_class === "source_linked" && hist.length === 1 && Number(hist[0].hours) === 2,
      `PUT ${put.status} ${put.text.slice(0, 160)}; rows ${before}->${after.length}; history ${JSON.stringify(hist)}`);

    // ── 10. Selectively share through the Passport ──
    const liveBefore = (await admin.from("passport_share_tokens").select("id").eq("nurse_id", uid).eq("revoked", false)).data ?? [];
    const share = await http("POST", "/api/individual/professional/share", { scope: "full", days: "7", label: `${LABEL} link` });
    shareId = share.json?.link?.id ?? null;
    const token = share.json?.link?.token;
    const v = token ? await page(`/verify/${token}`) : { status: 0, text: "" };
    ok("10. nothing is shared until the member makes a link; the link they chose shows their CPD, each with its evidence class",
      liveBefore.length === 0 && share.status === 201 && v.status === 200 && v.text.includes("12-lead ECG workshop") && v.text.includes("Records the professional added themselves") && v.text.includes("Self-declared"),
      `live links before ${liveBefore.length}, share ${share.status} ${share.text.slice(0, 120)}, verify ${v.status}`);

    // ── 11. Private reflections stay private ──
    const anonRead = await createClient(url, anon, { auth: { persistSession: false } }).from("individual_professional_reflection").select("id").eq("user_id", uid);
    const mine = createClient(url, anon, { auth: { persistSession: false } });
    await mine.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    const ownRead = await mine.from("individual_professional_reflection").select("id").eq("user_id", uid);
    ok("11. the reflection is on no Passport link, unreadable without the member's session, and readable to the member",
      !v.text.includes("SYNTHETIC-PRIVATE-REFLECTION") && !v.text.includes("QT interval") && (anonRead.data ?? []).length === 0 && (ownRead.data ?? []).length >= 1,
      JSON.stringify({ anon: anonRead.data?.length, own: ownRead.data?.length, ownErr: ownRead.error?.message }));

    // ── 12. Works without AI ──
    const ai1 = (await admin.from("plat_ai_requests").select("id", { count: "exact", head: true }).eq("actor_id", uid)).count ?? 0;
    ok("12. the whole journey made no AI request", ai0 === 0 && ai1 === 0, `${ai0} -> ${ai1}`);

    // ── 13. Works without a competency catalogue ──
    const cpd2Maps = (await admin.from("individual_professional_competency_map").select("id").eq("cpd_id", cpd2Id)).data ?? [];
    const lcpdSrc = ["src/app/api/individual/professional/cpd/route.ts", "src/app/api/individual/professional/cpd/requirement/route.ts", "src/app/api/individual/professional/learning-reflections/route.ts",
      "src/lib/individual/professional/cpd-requirements.ts", "src/lib/individual/professional/learning-reflections.ts", "src/lib/individual/lcpd-config.ts"].map(f => readFileSync(f, "utf8")).join("\n");
    ok("13. recording, reflecting and requirements need no catalogue: the mentoring entry has no competency and is still counted, and none of their code reads a catalogue",
      cpd2.status === 201 && cpd2Maps.length === 0 && p8.text.includes(`${e8.credits} of ${REQ_CREDITS} credits`) && !/loadCatalogueFor|loadIndividualCatalogue|professional_catalogues/.test(lcpdSrc), `maps ${cpd2Maps.length}`);

    // ── 14. History survives an entitlement change ──
    const ended = await endIndividualExperience(admin, uid, "professional");
    const refused = await http("POST", "/api/individual/professional/cpd", { activityType: "course", title: `${LABEL}: after the end`, hours: "1", activityDate: day(0) });
    const kept = (await admin.from("individual_professional_cpd").select("id").in("id", [cpdId, cpd2Id])).data?.length ?? 0;
    const keptHist = (await admin.from("individual_professional_cpd_history").select("id").eq("cpd_id", cpdId)).data?.length ?? 0;
    const g2 = validateGrant({ targetUserId: uid, experiences: ["professional"], note: `${PURPOSE.slice(0, 120)} Regranted to show the history is kept.` });
    const back = !isGrantRefusal(g2) ? await grantIndividualAccess(admin, g2, uid) : { ok: false };
    await http("POST", "/api/individual/terms", TERMS);
    const p14 = await page("/individual/professional/cpd");
    ok("14. ending Professional refuses new writes but keeps every record, and a later entitlement shows the same history",
      ended.ok && refused.status === 403 && kept === 2 && keptHist === 1 && (back as any).ok && p14.status === 200 && p14.text.includes("12-lead ECG workshop") && p14.text.includes("ECG mentoring"),
      JSON.stringify({ ended, refused: refused.status, kept, keptHist, back: (back as any).ok }));

    // ── 15. Self-reported learning is never presented as verified competence ──
    const verifiedImpact = await http("POST", "/api/individual/professional/learning-reflections", { cpdId: cpd2Id, template: "quick", answers: ["Mentoring"], impact: "verified" });
    const classes = [...new Set(((await admin.from("individual_professional_cpd").select("evidence_class").eq("user_id", uid)).data ?? []).map((r: any) => r.evidence_class))].sort();
    const csv = await http("GET", "/api/individual/professional/cpd/export");
    ok("15. nothing self-reported reads as verified: impact 'verified' is refused, entries are self-declared or source-linked, the requirement says Not verified, the export and the link say self-declared",
      verifiedImpact.status === 400 && JSON.stringify(classes) === JSON.stringify(["self_declared", "source_linked"]) && csv.status === 200 && /Self-declared/.test(csv.text) && !/verified/i.test(csv.text)
        && req15(p14.text) && v.text.includes("not verified by Competen or by any organisation"),
      JSON.stringify({ impact: verifiedImpact.status, classes, csv: csv.status, req: req15(p14.text) }));

    // ── PLANT: the requirement summary claims "Verified"; item 15's check must go red on the served page, then green ──
    if (PLANT) {
      const src = pageSrc.toString("utf8");
      if (src.split(PLANT_FROM).length !== 2) throw new Error("plant anchor not found exactly once");
      writeFileSync(PAGE, src.replace(PLANT_FROM, PLANT_TO));
      let planted = "";
      for (let i = 0; i < 40 && !/Verified: /.test(planted); i++) { await sleep(3000); planted = (await page("/individual/professional/cpd")).text; }
      const red = !req15(planted);
      writeFileSync(PAGE, pageSrc);
      let healed = "";
      for (let i = 0; i < 40 && !req15(healed); i++) { await sleep(3000); healed = (await page("/individual/professional/cpd")).text; }
      ok("P1. PLANTED DEFECT (the CPD page says 'Verified: N hours accepted'): item 15's check goes RED on the served page", red, red ? "" : "the plant was NOT caught");
      ok("P2. plant removed: the page source is byte-identical and item 15's check is GREEN again", readFileSync(PAGE).equals(pageSrc) && req15(healed));
    }
  } finally {
    writeFileSync(PAGE, pageSrc);
    if (shareId) await http("PATCH", `/api/individual/professional/share?id=${shareId}`);
    await admin.from("workspace_config_overrides").delete().eq("scope_type", "platform").eq("scope_ref", "individual").eq("config_path", LCPD_PATH);
    const now = await readFlags();
    const same = FLAGS.every(f => JSON.stringify(now.find((r: any) => r.flag === f) ?? null) === JSON.stringify(flagOf(f)));
    const cfgGone = !(await admin.from("workspace_config_overrides").select("id").eq("scope_type", "platform").eq("scope_ref", "individual").eq("config_path", LCPD_PATH).maybeSingle()).data;
    ok("Z. after the run: no flag written, the config fixture deleted, the Passport link revoked, the page source byte-identical", same && cfgGone && readFileSync(PAGE).equals(pageSrc));
  }
}

(RETIRE ? retire() : journey()).then(() => {
  const f = results.filter(r => r.state === "FAIL"), p = results.filter(r => r.state === "PEND");
  console.log(`\n${f.length ? "RED" : "GREEN"} -- ${results.filter(r => r.state === "PASS").length} passed, ${f.length} failed, ${p.length} PEND${f.length ? `: ${f.map(x => x.item.split(".")[0]).join(", ")}` : ""}`);
  process.exitCode = f.length ? 1 : 0;
}).catch(e => { console.error(e); process.exitCode = 1; });
