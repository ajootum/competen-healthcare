/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR PASSPORT SHARING ACCEPTANCE -- PRODUCT-EXPERIENCE P4 (owner Option A, 26 Oct), STAGING ONLY, over HTTP.
 *
 * A learner holding ONLY Competen Scholar shares formative records from their Passport, through the real route and
 * the real /verify page, as an unauthenticated recipient would see it:
 *   S1  a draft view carries exactly the study achievement ticked, and is closed to everyone until activated;
 *   S2  a Professional record, a record not on the Passport, and organisation records are refused;
 *   S3  once activated the recipient sees the chosen record, labelled formative and not verified, and NOT the
 *       unchosen one, the learner's notes, the question, the answer or anything the AI wrote;
 *   S4  only the learner's own Scholar links can be activated or withdrawn here;
 *   S5  withdrawing closes it, and the access log holds the refusal, the opening and the refusal after withdrawal.
 *
 * ⚠ STAGING ONLY (assertSafeTarget). BASE_URL must be a local staging-pointed dev server, started with the terms
 * versions passed here (never hard-coded): INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_{TERMS,PRIVACY}_VERSION and
 * INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_{TERMS,PRIVACY}_VERSION. Own harness-scholarshare identity, deleted after.
 *
 *   BASE_URL=http://localhost:3180 INDIVIDUAL_LEGAL_...=<v> npx tsx scripts/privileged-harnesses.ts --staging --only scholar-passport-share-acceptance
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anon) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "scholar-passport-share-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = (process.env.BASE_URL ?? "").replace(/\/$/, "");
if (!/^http:\/\/localhost:\d+$/.test(BASE)) { console.error("REFUSING: BASE_URL must be a local staging-pointed dev server."); process.exit(1); }
const v = (k: string) => process.env[`INDIVIDUAL_LEGAL_${k}`] ?? "";
const HOLDINGS = { terms: v("COMPETEN_HOLDINGS_TERMS_VERSION"), privacy: v("COMPETEN_HOLDINGS_PRIVACY_VERSION") };
const SCHOLAR = { terms: v("SCHOLAR_OPERATOR_TERMS_VERSION"), privacy: v("SCHOLAR_OPERATOR_PRIVACY_VERSION") };
if (![HOLDINGS.terms, HOLDINGS.privacy, SCHOLAR.terms, SCHOLAR.privacy].every(Boolean)) { console.error("REFUSING: pass the terms versions the staging server publishes."); process.exit(1); }

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); } };
const EMAIL = "harness-scholarshare@competen.test";
const SECRETS = ["PRIVATE NOTE TEXT 7Q", "QUESTION STEM SECRET 7Q", "AI RATIONALE SECRET 7Q", "Renal practice 7Q"];

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
  const u = await findUser(EMAIL);
  if (!u) return;
  const { data: tokens } = await admin.from("passport_share_tokens").select("id").eq("nurse_id", u.id);
  await admin.from("individual_professional_share").delete().eq("user_id", u.id);
  if (tokens?.length) await admin.from("passport_share_tokens").delete().in("id", tokens.map((t: any) => t.id));
  for (const t of ["individual_scholar_passport_item", "individual_scholar_attempt", "individual_scholar_question", "individual_scholar_chunk", "individual_scholar_material",
    "individual_legal_acceptance", "individual_entitlement", "individual_membership"]) await admin.from(t).delete().eq("user_id", u.id);
  await admin.from("audit_log").delete().eq("actor_id", u.id);
  await admin.from("profiles").delete().eq("id", u.id);
  await admin.auth.admin.deleteUser(u.id);
}
async function session(email: string, password: string) {
  const s = await createClient(url!, anon!, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) throw new Error(`sign-in: ${s.error?.message}`);
  return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(s.data.session)).toString("base64")}`;
}
const http = async (cookie: string, method: string, path: string, body?: any) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Cookie: cookie, Origin: BASE, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  return { status: res.status, json: await res.json().catch(() => null) as any };
};
const page = async (token: string) => (await fetch(`${BASE}/verify/${token}`, { redirect: "manual" })).text();

/** One studied material, answered, with a Passport item labelled `label`: notes, a question and an AI rationale behind it. */
async function studied(me: string, label: string, n: number) {
  const now = new Date().toISOString();
  const { data: mat } = await admin.from("individual_scholar_material").insert({ user_id: me, title: `Material ${n} 7Q`, file_name: `m${n}.pdf`, mime_type: "application/pdf",
    byte_size: 1000, sha256: String(n).repeat(64).slice(0, 64), storage_path: `${me}/harness-p4-${n}.pdf`, page_count: 1, chunk_count: 1, char_count: 100, extractor: "harness", pii_attested_at: now }).select("id").single();
  const { data: chunk } = await admin.from("individual_scholar_chunk").insert({ material_id: mat.id, user_id: me, ordinal: 1, page_from: 1, page_to: 1, content: SECRETS[0] }).select("id").single();
  const { data: q } = await admin.from("individual_scholar_question").insert({ user_id: me, material_id: mat.id, chunk_id: chunk.id, kind: "mcq", stem: SECRETS[1],
    options: ["A", "B", "C", "D"], correct_index: 0, rationale: SECRETS[2], source_quote: SECRETS[0], model: "harness", provider: "harness", prompt_version: "harness" }).select("id").single();
  await admin.from("individual_scholar_attempt").insert({ user_id: me, question_id: q.id, chosen_index: 0, correct: true });
  const { data: item } = await admin.from("individual_scholar_passport_item").insert({ user_id: me, material_id: mat.id, achievement: "practice_questions", label }).select("id").single();
  return item.id as string;
}

async function main() {
  console.log(`SCHOLAR PASSPORT SHARING ACCEPTANCE against ${ref}, route at ${BASE}\n`);
  const probe = await admin.from("individual_passport_share_view").select("share_token_id").limit(0);
  if (probe.error) { console.log(`PEND -- migration 540 is not applied here (${probe.error.code}). Nothing created.`); return; }
  await cleanup();
  try {
    const password = `p4-${randomBytes(12).toString("hex")}-Aa1!`;
    const { data: created } = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true, user_metadata: { full_name: "Harness Scholar Sharer" } });
    const me = created.user.id as string;
    await admin.from("profiles").update({ full_name: "Harness Scholar Sharer", role: null }).eq("id", me);
    const g = validateGrant({ targetUserId: me, experiences: ["scholar"], adultConfirmed: true, note: "PRODUCT-EXPERIENCE P4 acceptance" });
    if (isGrantRefusal(g)) throw new Error(g.message);
    await grantIndividualAccess(admin, g, me);
    const chosen = await studied(me, "Cardiac rhythms practice 7Q", 1);
    await studied(me, SECRETS[3], 2);
    const cookie = await session(EMAIL, password);
    const welcomed = await http(cookie, "POST", "/api/individual/preferences", { primaryExperience: "scholar", completeOnboarding: true });
    const accepted = await http(cookie, "POST", "/api/individual/terms", { experience: "scholar", foundation: HOLDINGS, experienceDocs: SCHOLAR });
    if (welcomed.status >= 300 || accepted.status >= 300) throw new Error(`onboarding ${welcomed.status}/${accepted.status}`);
    const onlyScholar = (await admin.from("individual_entitlement").select("experience_code").eq("user_id", me)).data?.map((r: any) => r.experience_code);

    // S2
    const cpd = await http(cookie, "POST", "/api/individual/scholar/passport-share", { [`record:cpd:${chosen}`]: "true" });
    const notOnPassport = await http(cookie, "POST", "/api/individual/scholar/passport-share", { [`record:study:${randomUUID()}`]: "true" });
    const institution = await http(cookie, "POST", "/api/individual/scholar/passport-share", { [`record:study:${chosen}`]: "true", includeInstitution: "true" });
    const nothing = await http(cookie, "POST", "/api/individual/scholar/passport-share", {});
    ok("S2. from Scholar a Professional record, a record not on the Passport, organisation records and an empty view are refused",
      [cpd, notOnPassport, institution, nothing].every(r => r.status === 400), [cpd, notOnPassport, institution, nothing].map(r => r.status).join("/"));

    // S1
    const made = await http(cookie, "POST", "/api/individual/scholar/passport-share", { [`record:study:${chosen}`]: "true", recipient: "My tutor", days: "7" });
    const link = made.json?.link;
    const rows = link ? (await admin.from("individual_passport_share_record").select("study_item_id, cpd_id, evidence_id, scholar_evaluation_id").eq("share_token_id", link.id)).data ?? [] : [];
    const companion = link ? (await admin.from("individual_professional_share").select("experience_code").eq("share_token_id", link.id).maybeSingle()).data : null;
    const draftPage = link ? await page(link.token) : "";
    ok("S1. a Scholar-only learner makes a draft view of exactly the one study achievement ticked, closed to everyone until activated",
      JSON.stringify(onlyScholar) === '["scholar"]' && made.status === 201 && made.json?.draft === true && companion?.experience_code === "scholar"
      && rows.length === 1 && rows[0].study_item_id === chosen && /not been activated/.test(draftPage) && !draftPage.includes("Cardiac rhythms practice 7Q"),
      `entitlements ${JSON.stringify(onlyScholar)}, status ${made.status}, records ${rows.length}`);
    if (!link) throw new Error("no link");

    // S4
    const estate = (await admin.from("passport_share_tokens").insert({ token: randomBytes(24).toString("hex"), nurse_id: me, hospital_id: null, scope: "full", consent: true, revoked: false,
      expires_at: new Date(Date.now() + 864e5).toISOString() }).select("id").single()).data;
    const notScholar = await http(cookie, "PATCH", `/api/individual/scholar/passport-share?id=${estate.id}`, { action: "activate" });
    const unknown = await http(cookie, "PATCH", `/api/individual/scholar/passport-share?id=${randomUUID()}`, {});
    const outsider = await fetch(`${BASE}/api/individual/scholar/passport-share?id=${link.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ action: "activate" }), redirect: "manual" });
    const stillDraft = (await admin.from("individual_passport_share_view").select("activated_at").eq("share_token_id", link.id).single()).data;
    ok("S4. only the learner's own Scholar links: another link, an unknown link and an unauthenticated caller are refused, and the draft stays closed",
      notScholar.status === 404 && unknown.status === 404 && outsider.status === 401 && !stillDraft.activated_at, `${notScholar.status}/${unknown.status}/${outsider.status}`);

    // S3
    const activated = await http(cookie, "PATCH", `/api/individual/scholar/passport-share?id=${link.id}`, { action: "activate" });
    const html = await page(link.token);
    // The "How to read" legend names every trust label; the records are what must never claim verification.
    // Next also streams the page's data in inline <script> tags, which repeat the legend: the rendered records only.
    const records = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<details[\s\S]*?<\/details>/g, "");
    ok("S3. the recipient sees the chosen study achievement, labelled formative and not verified, and nothing else of the learner's",
      activated.status === 200 && html.includes("Cardiac rhythms practice 7Q") && /Self-directed study, not a verified competency/.test(html) && /Educational and formative, not a verified competency/.test(html)
      && !SECRETS.some(s => html.includes(s)) && !/Independently verified/.test(records) && /How to read this Passport/.test(html),
      `activated ${activated.status}, chosen ${html.includes("Cardiac rhythms practice 7Q")}, self-directed label ${/Self-directed study, not a verified competency/.test(html)}, `
      + `trust label ${/Educational and formative, not a verified competency/.test(html)}, verified in records ${/Independently verified/.test(records)}, leaked [${SECRETS.filter(s => html.includes(s)).join(", ")}]`);

    // S5
    const withdrawn = await http(cookie, "PATCH", `/api/individual/scholar/passport-share?id=${link.id}`, {});
    const after = await page(link.token);
    const log = (await admin.from("individual_passport_share_access").select("result").eq("share_token_id", link.id)).data?.map((r: any) => r.result) ?? [];
    ok("S5. withdrawing closes the link, and the access log holds the draft refusal, the opening and the refusal after withdrawal",
      withdrawn.status === 200 && /revoked/.test(after) && !after.includes("Cardiac rhythms practice 7Q") && ["refused_draft", "shown", "refused_revoked"].every(r => log.includes(r)), log.join(","));
  } finally {
    await cleanup();
    ok("Z1. cleanup: no harness identity or link left", !(await findUser(EMAIL)));
  }
  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); try { await cleanup(); } catch { /* best effort */ } process.exit(1); });
