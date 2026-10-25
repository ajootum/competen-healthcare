/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LIFELONG PASSPORT ACCEPTANCE -- COMPETEN-PROFESSIONAL-PASSPORT-01 Stage 7, owner GO s15, STAGING ONLY.
 *
 * One Individual with Scholar AND Professional history, through the library the routes call (the same share writer,
 * the same Passport read the preview and /verify use), against migration 540 on staging. Items 13-15 and 20 also open
 * the real /verify page over HTTP, as an unauthenticated recipient, when VERIFY_BASE_URL points at a staging-backed
 * server (e.g. http://localhost:3150); without it those parts are reported as not run, never as passed.
 *
 * Item 6 records a Stage 6 professional evaluation (530) through Stage 6's own functions and ticks it on the view. Item 7
 * (a C5 verified competency) needs an appointed assessor's decision and is reported as BOUNDED, never faked.
 *
 * ⚠ STAGING ONLY (assertSafeTarget). PEND until 540 is applied. Own harness-prof07-* identity, deleted after, with its
 * Scholar material. Writes one policy row (passport_ai, step 18) and restores it exactly.
 *
 *   VERIFY_BASE_URL=http://localhost:3150 npx tsx scripts/privileged-harnesses.ts --staging --only professional-passport-acceptance
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { loadLcpdConfig } from "../src/lib/individual/lcpd-config";
import { loadIndividualPassport } from "../src/lib/individual/passport";
import { loadPassportSelection } from "../src/lib/individual/passport-view";
import { loadProfessionalProfile } from "../src/lib/individual/professional/profile-store";
import { loadProfessionalRecord } from "../src/lib/individual/professional/record";
import { activateShare, loadShareHistory, mintShare, parseShare, revokeShare, shareCarriesOwnRecords } from "../src/lib/individual/professional/share";
import { parsePassportView } from "../src/lib/individual/professional/share-passport";
import { publishedCatalogue } from "../src/lib/learning/catalogue";
import { enrol, recordExternalCompletion } from "../src/lib/learning/record";
import { learningEnabled } from "../src/lib/learning/policy";
import { evaluate } from "../src/lib/individual/professional/evaluation";
import { loadEvaluationInput } from "../src/lib/individual/professional/evaluation-sources";
import { currentConfigVersion, recordEvaluation } from "../src/lib/individual/professional/evaluation-store";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "professional-passport-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
const BASE = process.env.VERIFY_BASE_URL?.replace(/\/$/, "") ?? null;

let pass = 0; const fails: string[] = []; const bounded: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); } };
const bound = (name: string, why: string) => { bounded.push(name); console.log(`  BOUNDED  ${name} -- ${why}`); };
const EMAIL = "harness-prof07-passport@competen.test";
const SCOPE = { scope_type: "platform", scope_ref: "individual" };
const ROWS = ["individual.policy.passport_ai"];
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const page = async (token: string) => { const r = await fetch(`${BASE}/verify/${token}`, { redirect: "manual" }); return { status: r.status, html: await r.text() }; };

async function findUser(email: string) {
  for (let p = 1; p <= 10; p++) {
    const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 200 });
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
  await admin.from("individual_professional_my_competency").delete().eq("user_id", u.id);
  // 530's snapshots go by cascade from the person (append-only); their share rows go with the links.
  await admin.from("learning_record").delete().eq("user_id", u.id);
  for (const t of ["individual_scholar_passport_item", "individual_scholar_attempt", "individual_scholar_question", "individual_scholar_chunk", "individual_scholar_material",
    "individual_professional_cpd", "individual_professional_evidence", "individual_professional_profile_item", "individual_professional_profile_context",
    "individual_professional_profile", "individual_entitlement", "individual_membership"]) await admin.from(t).delete().eq("user_id", u.id);
  await admin.from("audit_log").delete().eq("actor_id", u.id);
  await admin.from("profiles").delete().eq("id", u.id);
  await admin.auth.admin.deleteUser(u.id);
}
let prior: any[] = [];
async function restore() {
  for (const path of ROWS) {
    const was = prior.find(r => r.config_path === path);
    if (was) await admin.from("workspace_config_overrides").upsert(was, { onConflict: "scope_type,scope_ref,config_path" });
    else await admin.from("workspace_config_overrides").delete().eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).eq("config_path", path);
  }
}
const grant = async (me: string, exp: "scholar" | "professional") => {
  const g = validateGrant({ targetUserId: me, experiences: [exp], adultConfirmed: exp === "scholar", note: "PASSPORT-01 acceptance" });
  if (isGrantRefusal(g)) throw new Error(g.message);
  await grantIndividualAccess(admin, g, me);
};

async function main() {
  console.log(`LIFELONG PASSPORT ACCEPTANCE (Stage 7) against ${ref}${BASE ? `, /verify at ${BASE}` : ", /verify over HTTP not run (no VERIFY_BASE_URL)"}\n`);
  const probe = await admin.from("individual_passport_share_view").select("share_token_id").limit(0);
  if (probe.error) { console.log(`PEND -- migration 540 is not applied here (${probe.error.code}). Nothing created.`); return; }
  prior = (await admin.from("workspace_config_overrides").select("*").eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).in("config_path", ROWS)).data ?? [];
  await cleanup();
  try {
    const { data: created } = await admin.auth.admin.createUser({ email: EMAIL, password: `p7-${randomBytes(12).toString("hex")}-Aa1!`, email_confirm: true, user_metadata: { full_name: "Harness Lifelong Learner" } });
    const me = created.user.id as string;
    await admin.from("profiles").update({ full_name: "Harness Lifelong Learner", role: null }).eq("id", me);

    // Scholar FIRST: study, then a study achievement chosen for the Passport.
    await grant(me, "scholar");
    const now = new Date().toISOString();
    const { data: mat } = await admin.from("individual_scholar_material").insert({ user_id: me, title: "Cardiac rhythm notes", file_name: "rhythms.pdf", mime_type: "application/pdf",
      byte_size: 1000, sha256: "0".repeat(64), storage_path: `${me}/harness-s7.pdf`, page_count: 1, chunk_count: 1, char_count: 100, extractor: "harness", pii_attested_at: now }).select("id").single();
    const { data: chunk } = await admin.from("individual_scholar_chunk").insert({ material_id: mat.id, user_id: me, ordinal: 1, page_from: 1, page_to: 1, content: "Sinus rhythm notes." }).select("id").single();
    const { data: qs } = await admin.from("individual_scholar_question").insert([1, 2].map(n => ({ user_id: me, material_id: mat.id, chunk_id: chunk.id, kind: "mcq", stem: `S7 ${n}`,
      options: ["A", "B", "C", "D"], correct_index: 0, rationale: "Because.", source_quote: "Sinus rhythm notes.", model: "harness", provider: "harness", prompt_version: "harness" }))).select("id");
    for (const q of qs ?? []) await admin.from("individual_scholar_attempt").insert({ user_id: me, question_id: q.id, chosen_index: 0, correct: true });
    await admin.from("individual_scholar_passport_item").insert({ user_id: me, material_id: mat.id, achievement: "practice_questions", label: "Cardiac rhythms practice" });
    const beforePro = await loadIndividualPassport(admin, me, today);

    // Then Professional: activation must not touch the Scholar history (19).
    await grant(me, "professional");
    await admin.from("individual_professional_profile").insert({ user_id: me, experience_code: "professional", self_declared_profession: "Clinician", registration_completed_at: now });
    const { data: qual } = await admin.from("individual_professional_profile_item").insert({ user_id: me, experience_code: "professional", section: "qualification", title: "BSc Health Sciences", organisation: "A university" }).select("id").single();
    const { data: cpdRows } = await admin.from("individual_professional_cpd").insert([
      { user_id: me, experience_code: "professional", activity_type: "course", title: "Chosen: ECG interpretation workshop", hours: 3, activity_date: yesterday },
      { user_id: me, experience_code: "professional", activity_type: "course", title: "Unrelated: wound care update", hours: 1, activity_date: yesterday },
    ]).select("id, title");
    const chosenCpd = cpdRows.find((c: any) => c.title.startsWith("Chosen")).id, otherCpd = cpdRows.find((c: any) => c.title.startsWith("Unrelated")).id;
    const { data: evRows } = await admin.from("individual_professional_evidence").insert([
      { user_id: me, experience_code: "professional", kind: "credential", title: "Chosen: lapsed life support certificate", issuing_body: "A training body", issued_on: "2024-01-01", expires_on: yesterday },
      { user_id: me, experience_code: "professional", kind: "credential", title: "Unrelated: manual handling certificate", issued_on: yesterday },
    ]).select("id, title");
    const chosenEv = evRows.find((e: any) => e.title.startsWith("Chosen")).id;

    // Competen Learning: an external course completed through Learning's own functions, where staging publishes one.
    let learningId: string | null = null;
    if (await learningEnabled(admin)) {
      const ext = (await publishedCatalogue(admin, { delivery: "external" }))?.[0];
      if (ext) {
        const e = await enrol(admin, me, ext.offeringId);
        if (e.ok && (await recordExternalCompletion(admin, me, e.recordId, { completedOn: yesterday, hours: 2, reflection: "", file: null })).ok) learningId = e.recordId;
      }
    }

    // 1-5, 19
    const passport = await loadIndividualPassport(admin, me, today);
    const record = await loadProfessionalRecord(admin, me);
    const profile = await loadProfessionalProfile(admin, me);
    const study = passport.study.ok ? passport.study.data.find(s => s.label === "Cardiac rhythms practice") : undefined;
    ok("1. the one shared Passport opens for an Individual with Scholar and Professional history", passport.study.ok && passport.competencies !== null && passport.credentials !== null);
    ok("2. Scholar educational achievements are there, chosen by the student, with their Passport item", !!study?.itemId && study.answered === 2);
    ok("3. Professional qualifications and credentials are there", (profile.items ?? []).some(i => i.id === qual.id) && (record.evidence ?? []).length === 2);
    if (learningId) ok("4. a Competen Learning course achievement is there, read from Learning", (passport.learning?.items ?? []).some((l: any) => l.recordId === learningId));
    else bound("4. Competen Learning course achievement", "staging publishes no external course, or Learning is off; not faked");
    ok("5. external CPD evidence is there", (record.cpd ?? []).length === 2);
    // 6: a Stage 6 evaluation of the person's own ECG record, through Stage 6's functions (deterministic, no AI).
    const evPolicy = (await loadIndividualPolicy(admin)).professionalEvaluation;
    const evIn = await loadEvaluationInput(admin, me, today);
    const evRun = evaluate(evIn.input, { kind: "topic", ref: "ECG" }, evPolicy);
    const evRec = evRun ? await recordEvaluation(admin, me, evRun, { context: evIn.context, policy: evPolicy, configVersion: await currentConfigVersion(admin), ai: null, supersedes: null }) : null;
    const evaluationId = evRec && evRec.ok ? evRec.id : null;
    ok("6. a formative Professional evaluation (Stage 6) is recorded for the person, offered for sharing", !!evaluationId && evPolicy.sharing === "offer", `sharing ${evPolicy.sharing}`);
    bound("7. an independently verified competency (C5)", "needs a current decision by an appointed assessor (none on staging; the person-side wiring is prof/c5-adapter-wiring); only verifiedNow reads verified (harness T1)");
    ok("19. Scholar history survives Professional activation: the same study achievement, before and after", beforePro.study.ok && beforePro.study.data.some(s => s.itemId === study?.itemId) && !!study);

    // 9-11: select records, a draft, preview, then activate a time-limited link.
    const pp = (await loadIndividualPolicy(admin)).professionalPassport;
    const v = parsePassportView({ purpose: "job-application", recipient: "Ward manager", summary: "Acute care, five years.",
      [`record:cpd:${chosenCpd}`]: "true", [`record:evidence:${chosenEv}`]: "true", [`record:study:${study!.itemId}`]: "true" }, pp);
    if (!v.ok) throw new Error(v.error);
    const link = await mintShare(admin, me, parseShare({ days: 7 }), { overview: false, itemIds: [qual.id] }, learningId ? [learningId] : [], [], v.value, evaluationId ? [evaluationId] : []);
    if (!link) throw new Error("the link could not be minted");
    const tok = (await admin.from("passport_share_tokens").select("consent, expires_at").eq("id", link.id).single()).data;
    ok("9. individual records are selected for one view: one CPD entry, one credential, one study item, a profile record" + (learningId ? ", one course" : ""),
      (await admin.from("individual_passport_share_record").select("id").eq("share_token_id", link.id)).data?.length === 3);
    const policy = await loadIndividualPolicy(admin);
    const ctx = { today, profile: policy.professionalProfile, competency: policy.professionalCompetency, lcpd: await loadLcpdConfig(admin), passport: policy.professionalPassport };
    const preview = await loadPassportSelection(admin, me, link.id, ctx);
    const titles = preview.items.map(i => i.title);
    ok("10. the owner previews exactly what the recipient will see, while the link is still a closed draft", tok.consent === false && !preview.meta?.activatedAt && titles.includes("Chosen: ECG interpretation workshop") && preview.meta?.purposeLabel === "A job application");
    if (BASE) { const d = await page(link.token); ok("10b. a draft refuses the recipient until activated", /not been activated/.test(d.html)); }
    const activated = await activateShare(admin, me, link.id);
    const days = Math.round((Date.parse(tok.expires_at) - Date.now()) / 864e5);
    ok("11. the time-limited link is activated, once", activated && days >= 6 && days <= 7 && !(await activateShare(admin, me, link.id)));

    // 12, 8, 17
    const live = await loadPassportSelection(admin, me, link.id, ctx);
    const liveTitles = live.items.map(i => i.title);
    ok("12. unrelated records stay off: the other CPD entry, the other credential, and anything not ticked",
      !liveTitles.some(t => t.startsWith("Unrelated")) && live.items.filter(i => i.category === "cpd").length === 1 && live.items.filter(i => i.category === "evidence").length === 1
      && live.items.filter(i => i.category === "study").length === 1 && !live.items.some(i => i.category === "institution"));
    const lapsedItem = live.items.find(i => i.title.startsWith("Chosen: lapsed"));
    ok("8. provenance and current status are on every record: source, issuer, date, trust, validity, meaning; the lapsed credential says Expired",
      live.items.every(i => i.sourceService && i.trust && i.validity && i.meaning) && lapsedItem?.validity === "expired" && lapsedItem.issuer === "A training body");
    const evItem = live.items.find(i => i.key === `evaluation:530:${evaluationId}`);
    ok("6b. the ticked evaluation is on the view as formative (educational), with its findings and limitations, no AI text",
      !!evItem && evItem.trust === "educational" && evItem.validity === "not_applicable" && /Limitations|:/.test(evItem.description ?? "") && !/ai_text/.test(JSON.stringify(evItem)));
    ok("17. nothing self-reported is presented as independently verified",
      !live.items.some(i => i.trust === "independently_verified") && live.items.find(i => i.category === "study")?.trust === "educational" && live.items.find(i => i.category === "cpd")?.trust === "self_declared");

    // 13-15 over HTTP, as an unauthenticated recipient
    if (BASE) {
      const r = await page(link.token);
      ok("13. an unauthenticated recipient opens the view", r.status === 200 && r.html.includes("Chosen: ECG interpretation workshop") && !r.html.includes("Unrelated: wound care update"));
      ok("14. authenticity, validity and meaning are on the page", /Meaning:/.test(r.html) && /Self-declared, not verified/.test(r.html) && /Expired/.test(r.html) && /Educational and formative/.test(r.html)
        && /Formative evaluations/.test(r.html));
    } else { bound("13. unauthenticated recipient over HTTP", "VERIFY_BASE_URL not set"); bound("14. displayed authenticity, validity and meaning over HTTP", "VERIFY_BASE_URL not set"); }
    const cpdBefore = (await admin.from("individual_professional_cpd").select("id").eq("user_id", me)).data?.length;
    const revoked = await revokeShare(admin, me, link.id);
    if (BASE) {
      const r = await page(link.token);
      const h = (await loadShareHistory(admin, me, [link.id])).get(link.id);
      ok("15. after revocation the hosted view is refused, and the owner's history shows the opening and the refusal", revoked && /revoked/.test(r.html) && !r.html.includes("Chosen: ECG") && (h?.opened ?? 0) >= 1 && (h?.refused ?? 0) >= 1);
    } else ok("15. the link is revoked (the page refusal itself needs VERIFY_BASE_URL)", revoked && (await admin.from("passport_share_tokens").select("revoked").eq("id", link.id).single()).data?.revoked === true);
    ok("16. the source records are untouched by sharing and revoking", (await admin.from("individual_professional_cpd").select("id").eq("user_id", me)).data?.length === cpdBefore && cpdBefore === 2
      && (await admin.from("individual_scholar_passport_item").select("id").eq("user_id", me)).data?.length === 1);

    // 18
    await admin.from("workspace_config_overrides").upsert({ ...SCOPE, config_path: ROWS[0], draft: { value: "off" }, published: { value: "off" } }, { onConflict: "scope_type,scope_ref,config_path" });
    const off = (await loadIndividualPolicy(admin)).professionalPassport.ai;
    const v2 = parsePassportView({ [`record:cpd:${otherCpd}`]: "true" }, (await loadIndividualPolicy(admin)).professionalPassport);
    const l2 = v2.ok ? await mintShare(admin, me, parseShare({ days: 3 }), { overview: false, itemIds: [] }, [], [], v2.value) : null;
    const s2 = l2 ? await loadPassportSelection(admin, me, l2.id, ctx) : null;
    ok("18. with AI off, viewing, sharing and verification all work", off === "off" && !!l2 && (await activateShare(admin, me, l2!.id)) && s2!.items.length === 1);

    // 20: an organisation-minted link carries none of the person's own records
    const estate = (await admin.from("passport_share_tokens").insert({ token: randomBytes(24).toString("hex"), nurse_id: me, hospital_id: null, scope: "full", consent: true, revoked: false,
      expires_at: new Date(Date.now() + 864e5).toISOString() }).select("id, token").single()).data;
    const estateOwn = await shareCarriesOwnRecords(admin, estate.id, me);
    if (BASE) {
      const r = await page(estate.token);
      ok("20. an organisation's link does not expose the personal Passport: no own record, no Scholar study", !estateOwn && r.status === 200 && !/Chosen:|Unrelated:|Cardiac rhythms/.test(r.html));
    } else ok("20. an organisation's link carries none of the person's own records (page check needs VERIFY_BASE_URL)", !estateOwn);
  } finally {
    await restore();
    await cleanup();
    const pol = (await admin.from("workspace_config_overrides").select("*").eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).in("config_path", ROWS)).data ?? [];
    ok("Z1. cleanup: no harness identity or link left, and the policy row exactly as it was", !(await findUser(EMAIL)) && JSON.stringify(pol) === JSON.stringify(prior));
  }
  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed, ${bounded.length} bounded (not faked)`);
  if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); try { await restore(); await cleanup(); } catch { /* best effort */ } process.exit(1); });
