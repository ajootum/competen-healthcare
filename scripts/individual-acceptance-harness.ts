/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * INDIVIDUAL ACCEPTANCE HARNESS -- COMPETEN-IND-003 s5 and the owner rulings D1-D10, against a real
 * database, STAGING ONLY.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS EXISTS TO KEEP TRUE (one assertion group each).
 *
 *   A. Dual experience: one person holds Scholar AND Professional, and the neutral sign-in offers Competen
 *      Individual -- and NOT the estate, which they do not hold.
 *   B. Single experience: Scholar-only and Professional-only people see only theirs. Direct Professional
 *      needs no Scholar row, ever.
 *   C. Liveness is the DATABASE clock: ended and not-yet-started periods are not live. The control for A/B.
 *   D. Graduation activates (D4): Professional is added on the same account, membership and Passport, and
 *      Scholar stays live -- graduation does not revoke it.
 *   E. Primary experience: honoured while live, falls back when not.
 *   F. Product boundaries: no platform, practice or enterprise membership, and profiles.role unchanged from
 *      what the new-user trigger wrote.
 *   G. RLS (D6): own rows readable, another person's not, and no self-grant from a browser session.
 *   H. Refusals: suspended and revoked memberships, and an ended experience, are refused.
 *   I. Age (D8): the grant refuses Scholar without the 18+ confirmation, the SCHEMA refuses a raw Scholar
 *      row without it, and a granted Scholar row records who confirmed and when.
 *   J. Terms (D2): acceptance is all-or-nothing in the schema, and the gate opens only on the current
 *      published versions.
 *   K. HQ authority (D9): the capability, the Individual Product Administrator position and its grant
 *      exist in the HQ catalogue, and a person with no appointment does not hold the right.
 *   L. Passport provenance and AI boundaries (D3): an organisation-verified credential and a self-declared
 *      one are labelled differently, and the AI context names the person's own record and nobody else's.
 *   M. Employer visibility (D1): nothing Individual did wrote to the estate learning tables that hospital
 *      analytics read.
 *
 * ⚠ IT IMPORTS THE RULES IT TESTS -- readIndividualAccess, decideLanding, effectivePrimary,
 * resolveProductDestinations, grantIndividualAccess, validateGrant, endIndividualExperience, termsGate,
 * loadIndividualPassport, buildHistory, recordContext, resolveHqPositions. Nothing below restates them.
 *
 * ⚠ MIGRATION 370 FIRST. Until it is applied every group reports PEND, never PASS, the run exits 0, and
 * nothing is created.
 *
 * ⚠ STAGING ONLY. .env.local names PRODUCTION. assertSafeTarget refuses production before any client is
 * built, so run it with the three Supabase variables remapped to staging:
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only individual-acceptance
 *
 * ⚠ RUN IT ALONE. Its fixture identities are its own (harness-ind003-*@competen.test) and it deletes them.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { readIndividualAccess, decideLanding, effectivePrimary, isNotProvisioned } from "../src/lib/individual/access";
import { resolveProductDestinations } from "../src/lib/identity/product-resolution";
import { loadIndividualPassport } from "../src/lib/individual/passport";
import { buildHistory, loadEntitlementHistory } from "../src/lib/individual/history";
import { grantIndividualAccess, validateGrant, isGrantRefusal, endIndividualExperience, type GrantRequest } from "../src/lib/individual/grants";
import { termsGate } from "../src/lib/individual/terms";
import { entityLegal, type EntityLegal } from "../src/lib/individual/legal";
import { recordContext } from "../src/lib/individual/assistant";
import { resolveHqPositions } from "../src/lib/hq/context";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "individual-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const FIX = {
  grantor: "harness-ind003-grantor@competen.test",
  both: "harness-ind003-both@competen.test",
  scholar: "harness-ind003-scholar@competen.test",
  pro: "harness-ind003-pro@competen.test",
  suspended: "harness-ind003-suspended@competen.test",
  revoked: "harness-ind003-revoked@competen.test",
};
// A test value generated for this run, used only to sign fixtures in for the RLS group (G).
const FIX_PASSWORD = `ind003-${Math.random().toString(36).slice(2)}-Aa1!`;
// Test legal configuration for J -- versions that exist only inside this run, never a deployment's.
const TEST_LEGAL_ENV = {
  INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_TERMS_VERSION: "harness-h-terms", INDIVIDUAL_LEGAL_COMPETEN_HOLDINGS_PRIVACY_VERSION: "harness-h-privacy",
  INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION: "harness-s-terms", INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_PRIVACY_VERSION: "harness-s-privacy",
};
const testLegal = (e: EntityLegal["entity"]) => entityLegal(e, TEST_LEGAL_ENV);
const ESTATE_LEARNING = ["quiz_attempts", "knowledge_attempts", "cpd_logs", "course_enrollments", "learning_enrolments", "cdp_reinforcement_cards", "skill_log_entries"];

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
    await admin.from("individual_entitlement").delete().eq("user_id", u.id);
    await admin.from("individual_membership").delete().eq("user_id", u.id);
    await admin.from("professional_credentials").delete().eq("nurse_id", u.id);
    await admin.from("audit_log").delete().eq("actor_id", u.id);
    await admin.from("profiles").delete().eq("id", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}

async function makeUser(email: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: FIX_PASSWORD, email_confirm: true });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id as string;
}

async function grant(target: string, by: string, experiences: GrantRequest["experiences"]) {
  const req = validateGrant({ targetUserId: target, experiences, adultConfirmed: true });
  if (isGrantRefusal(req)) throw new Error(`grant refused: ${req.message}`);
  const out = await grantIndividualAccess(admin, req, by);
  if (!out.ok) throw new Error(`grant failed: ${out.message}`);
  return out;
}

/** A raw ledger row, for periods the grant service never writes (ended, future). */
async function rawEntitlement(userId: string, code: "scholar" | "professional", extra: Record<string, unknown>) {
  const r = await admin.from("individual_entitlement").insert({
    user_id: userId, experience_code: code, source: "pilot",
    operating_entity: code === "scholar" ? "scholar_operator" : "competen_holdings",
    ...(code === "scholar" ? { adult_confirmed_at: new Date().toISOString() } : {}), ...extra,
  });
  if (r.error) throw new Error(`raw entitlement: ${r.error.message}`);
}

async function main() {
  console.log(`\nIndividual acceptance harness -- COMPETEN-IND-003 -- target ${ref}\n`);

  const probe = await admin.from("individual_membership").select("id").limit(1);
  if (probe.error && isNotProvisioned(probe.error)) {
    console.log("  PEND  A-M: migration 370 is not applied on this project. Nothing was created.");
    console.log("\nPENDING -- 0 passed, 13 groups pending (apply 370, then re-run)");
    process.exit(0);
  }
  if (probe.error) { console.error(`store unreadable: ${probe.error.message}`); process.exit(1); }

  await cleanup();
  const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

  const grantor = await makeUser(FIX.grantor);
  const both = await makeUser(FIX.both);
  const scholar = await makeUser(FIX.scholar);
  const pro = await makeUser(FIX.pro);
  const suspended = await makeUser(FIX.suspended);
  const revoked = await makeUser(FIX.revoked);
  // ⚠ THE BASELINE FOR F2. The new-user trigger (migration 335) writes profiles.role = 'nurse' for every new
  // account, so "role is null" is not Individual's claim. Individual's claim is that it never CHANGES the
  // role -- measured against this snapshot, taken before any Individual code runs.
  const allIds = [grantor, both, scholar, pro, suspended, revoked];
  const roleSnapshot = new Map(((await admin.from("profiles").select("id, role, roles").in("id", allIds)).data ?? [])
    .map((p: any) => [p.id, JSON.stringify([p.role, p.roles])]));

  // ── I. age eligibility at grant time (before anything else is written for these people) ──
  const noAdult = validateGrant({ targetUserId: scholar, experiences: ["scholar"] });
  ok("I1. D8: the grant refuses Scholar without the 18+ confirmation", isGrantRefusal(noAdult) && noAdult.code === "AGE_ELIGIBILITY_REQUIRED");
  const rawNoAdult = await admin.from("individual_entitlement").insert({ user_id: scholar, experience_code: "scholar", source: "pilot", operating_entity: "scholar_operator" });
  ok("I2. ⚠ D8: the SCHEMA refuses a raw Scholar row with no adult confirmation", !!rawNoAdult.error, rawNoAdult.error?.message ?? "insert succeeded");

  await grant(both, grantor, ["scholar", "professional"]);
  await rawEntitlement(both, "scholar", { starts_at: iso(-60), ends_at: iso(-30) });
  await rawEntitlement(both, "professional", { starts_at: iso(30) });
  await grant(scholar, grantor, ["scholar"]);
  await grant(pro, grantor, ["professional"]);
  await grant(suspended, grantor, ["scholar"]);
  await admin.from("individual_membership").update({ status: "suspended", suspended_at: iso(0) }).eq("user_id", suspended);
  await grant(revoked, grantor, ["professional"]);
  await admin.from("individual_membership").update({ status: "revoked", revoked_at: iso(0), revoked_by: grantor }).eq("user_id", revoked);

  const sRow = await admin.from("individual_entitlement").select("adult_confirmed_at, adult_confirmed_by, granted_by, source").eq("user_id", scholar).eq("experience_code", "scholar").single();
  ok("I3. D8: a granted Scholar row records who confirmed eligibility and when", !!sRow.data?.adult_confirmed_at && sRow.data?.adult_confirmed_by === grantor && sRow.data?.granted_by === grantor);
  const again = await grant(scholar, grantor, ["scholar"]);
  ok("I4. the grant is idempotent: an already-live experience is reported, not duplicated", again.granted.length === 0 && again.alreadyLive.join() === "scholar");

  // ── A. dual experience ──
  const a: any = await readIndividualAccess(admin, both);
  ok("A1. one person holds Scholar AND Professional through live entitlements", a.state === "member" && a.live.join() === "scholar,professional", JSON.stringify(a));
  const r: any = await resolveProductDestinations(admin, both);
  const codes = r.state === "one" ? [r.destination.code] : r.state === "many" ? r.destinations.map((d: any) => d.code) : [];
  ok("A2. neutral sign-in offers Competen Individual and NOT the estate they do not hold", codes.includes("individual") && !codes.includes("platform"), JSON.stringify(r));

  // ── B. single experience ──
  const b1: any = await readIndividualAccess(admin, scholar);
  ok("B1. a Scholar-only person sees only Scholar", b1.state === "member" && b1.live.join() === "scholar");
  const b2: any = await readIndividualAccess(admin, pro);
  const proScholar = await admin.from("individual_entitlement").select("id").eq("user_id", pro).eq("experience_code", "scholar");
  ok("B2. direct Professional: live Professional with no Scholar row ever written", b2.live?.join() === "professional" && (proScholar.data ?? []).length === 0);
  ok("B3. a new member lands on the welcome first", decideLanding(b2.membership, b2.live).kind === "welcome");

  // ── C. DB-clock liveness ──
  const rows = await admin.from("individual_entitlement").select("id").eq("user_id", both);
  const liveRows = await admin.from("individual_live_entitlement").select("id").eq("user_id", both);
  ok("C1. ⚠ 4 ledger rows, 2 live -- ended and future periods are excluded by the database clock",
    (rows.data ?? []).length === 4 && (liveRows.data ?? []).length === 2, `${rows.data?.length}/${liveRows.data?.length}`);

  // ── D. graduation activates and does not revoke ──
  const before = await admin.from("individual_membership").select("id").eq("user_id", scholar).single();
  await admin.from("individual_entitlement").insert({ user_id: scholar, experience_code: "professional", source: "graduation", operating_entity: "competen_holdings", granted_by: grantor });
  const d: any = await readIndividualAccess(admin, scholar);
  const after = await admin.from("individual_membership").select("id").eq("user_id", scholar).single();
  ok("D1. D4: graduation adds Professional on the same account and membership, and Scholar stays live",
    d.live?.join() === "scholar,professional" && before.data?.id === after.data?.id);
  const passportS = await loadIndividualPassport(admin, scholar, new Date().toISOString().slice(0, 10));
  const hist = buildHistory({ joinedAt: d.membership.grantedAt, entitlements: await loadEntitlementHistory(admin, scholar), passport: passportS });
  ok("D2. one continuous history keeps Scholar and shows Professional activated on graduation",
    hist.some(h => h.title === "Competen Scholar started") && hist.some(h => h.title === "Competen Professional started" && h.detail === "activated on graduation"));

  // ── E. primary experience ──
  await admin.from("individual_membership").update({ primary_experience: "professional", onboarded_at: iso(0) }).eq("user_id", both);
  const e1: any = await readIndividualAccess(admin, both);
  const land: any = decideLanding(e1.membership, e1.live);
  ok("E1. a live primary experience is where they land", land.kind === "experience" && land.experience === "professional");
  await admin.from("individual_membership").update({ primary_experience: "professional", onboarded_at: iso(0) }).eq("user_id", scholar);
  const ended = await endIndividualExperience(admin, scholar, "professional");
  const e2: any = await readIndividualAccess(admin, scholar);
  ok("E2. ending the primary experience falls back to the live one instead of stranding them",
    ended.ok && (ended as any).ended === 1 && effectivePrimary(e2.membership.primaryExperience, e2.live) === "scholar");

  // ── H. refusals ──
  ok("H1. a suspended membership is refused", JSON.stringify(await readIndividualAccess(admin, suspended)) === JSON.stringify({ state: "none", reason: "suspended" }));
  ok("H2. a revoked membership is refused", JSON.stringify(await readIndividualAccess(admin, revoked)) === JSON.stringify({ state: "none", reason: "revoked" }));
  const rr: any = await resolveProductDestinations(admin, revoked);
  ok("H3. a revoked member is not offered Individual at sign-in", rr.state === "none" || !(rr.destinations ?? [rr.destination]).some((x: any) => x?.code === "individual"));
  ok("H4. an ended experience is no longer live, and its rows remain for history", !e2.live.includes("professional")
    && ((await admin.from("individual_entitlement").select("id").eq("user_id", scholar).eq("experience_code", "professional")).data ?? []).length === 1);

  // ── J. terms (D2) ──
  const half = await admin.from("individual_entitlement").update({ terms_version: "x" }).eq("user_id", pro);
  ok("J1. ⚠ the schema refuses a terms version recorded without its acceptance time", !!half.error, half.error?.message ?? "update succeeded");
  const g0 = termsGate({ experience: "professional", foundationAcceptance: null, experienceAcceptance: undefined, legalOf: testLegal });
  ok("J2. with terms published but not accepted, the experience is not usable", !g0.usable && g0.foundation.state === "required");
  const now = iso(0);
  await admin.from("individual_membership").update({ foundation_terms_version: "harness-h-terms", foundation_privacy_version: "harness-h-privacy", foundation_accepted_at: now }).eq("user_id", both);
  await admin.from("individual_entitlement").update({ terms_version: "harness-s-terms", privacy_version: "harness-s-privacy", terms_accepted_at: now }).eq("user_id", both).eq("experience_code", "scholar");
  const j: any = await readIndividualAccess(admin, both);
  const gs = termsGate({ experience: "scholar", foundationAcceptance: j.membership.foundationAcceptance, experienceAcceptance: j.experienceAcceptance.scholar, legalOf: testLegal });
  const gp = termsGate({ experience: "professional", foundationAcceptance: j.membership.foundationAcceptance, experienceAcceptance: j.experienceAcceptance.professional, legalOf: testLegal });
  ok("J3. recorded acceptances, read back from the database, open Scholar (both documents) and Professional (foundation covers it)", gs.usable && gp.usable);
  const bumped = termsGate({ experience: "scholar", foundationAcceptance: j.membership.foundationAcceptance, experienceAcceptance: j.experienceAcceptance.scholar,
    legalOf: e => entityLegal(e, { ...TEST_LEGAL_ENV, INDIVIDUAL_LEGAL_SCHOLAR_OPERATOR_TERMS_VERSION: "harness-s-terms-2" }) });
  ok("J4. a newly published version closes the experience again until it is accepted", !bumped.usable && bumped.experience.state === "required");

  // ── F. product boundaries ──
  const ids = allIds;
  const [pm, prm, em, prof] = await Promise.all([
    admin.from("platform_membership").select("user_id").in("user_id", ids),
    admin.from("practice_membership").select("user_id").in("user_id", ids),
    admin.from("enterprise_membership").select("user_id").in("user_id", ids),
    admin.from("profiles").select("id, role, roles").in("id", ids),
  ]);
  ok("F1. no platform, practice or enterprise membership exists for any fixture",
    !pm.error && !prm.error && (pm.data ?? []).length === 0 && (prm.data ?? []).length === 0 && (!!em.error || (em.data ?? []).length === 0));
  ok("F2. ⚠ control: all six profiles exist, and no profiles.role or roles value changed after the trigger wrote it",
    (prof.data ?? []).length === 6 && roleSnapshot.size === 6
    && (prof.data ?? []).every((p: any) => roleSnapshot.get(p.id) === JSON.stringify([p.role, p.roles])), JSON.stringify(prof.data));

  // ── K. HQ authority (D9) ──
  const pos = await admin.from("hq_position").select("code, space, product_line_code, is_active").eq("code", "individual_product_administrator").maybeSingle();
  const posCaps = await admin.from("hq_position_capability").select("capability_code").eq("position_code", "individual_product_administrator").is("effective_to", null);
  ok("K1. D9: the Individual Product Administrator position exists in the platform space and the individual product line",
    pos.data?.space === "platform" && pos.data?.product_line_code === "individual" && pos.data?.is_active === true, JSON.stringify(pos.data));
  ok("K2. D9: it holds hq.individual.pilot.grant (and the HQ landing), and nothing else",
    (posCaps.data ?? []).map((c: any) => c.capability_code).sort().join() === "hq.individual.pilot.grant,hq.platform.home.view");
  const grantorCaps = await resolveHqPositions(admin, grantor);
  ok("K3. ⚠ a person with no HQ appointment does not hold the grant right", !grantorCaps.capabilities.includes("hq.individual.pilot.grant"));

  // ── L. Passport provenance and AI boundaries (D3) ──
  await admin.from("professional_credentials").insert([
    { nurse_id: both, title: "Harness verified licence", credential_type: "professional_license", issuing_body: "Harness Council", status: "active", verified: true, issue_date: "2025-01-01" },
    { nurse_id: both, title: "Harness declared certificate", credential_type: "cpd_certificate", status: "active", verified: false, issue_date: "2025-02-01" },
    { nurse_id: pro, title: "Harness OTHER person credential", credential_type: "cpd_certificate", status: "active", verified: false },
  ]);
  const pb = await loadIndividualPassport(admin, both, new Date().toISOString().slice(0, 10));
  const byTitle = new Map((pb.credentials ?? []).map(c => [c.title, c.evidence]));
  ok("L1. D3: an organisation-verified credential and a self-declared one carry different provenance",
    byTitle.get("Harness verified licence") === "institution_verified" && byTitle.get("Harness declared certificate") === "self_declared");
  const aiCtx = recordContext({ name: "Harness Both", experience: "professional", live: ["scholar", "professional"], passport: pb });
  ok("L2. the AI context carries the person's own record and no other person's",
    aiCtx.includes("Harness verified licence") && !aiCtx.includes("Harness OTHER person credential"));

  // ── M. employer visibility (D1) ──
  const estate = await Promise.all(ESTATE_LEARNING.map(t => admin.from(t).select("*", { count: "exact", head: true })
    .in(t === "cpd_logs" || t === "course_enrollments" || t === "learning_enrolments" || t === "quiz_attempts" ? "user_id" : "nurse_id", ids)));
  const written = ESTATE_LEARNING.filter((_, i) => !estate[i].error && (estate[i].count ?? 0) > 0);
  ok("M1. D1: no estate learning table that hospital analytics read holds a row for any fixture", written.length === 0, written.join(", "));

  // ── G. RLS (D6) ──
  const user = createClient(url!, anonKey!, { auth: { persistSession: false } }) as any;
  const signIn = await user.auth.signInWithPassword({ email: FIX.both, password: FIX_PASSWORD });
  if (signIn.error) ok("G0. the fixture can sign in for the RLS group", false, signIn.error.message);
  else {
    const own = await user.from("individual_membership").select("user_id");
    ok("G1. a signed-in person reads exactly one membership row: their own", (own.data ?? []).length === 1 && own.data[0].user_id === both, JSON.stringify(own));
    const other = await user.from("individual_entitlement").select("id").eq("user_id", pro);
    ok("G2. ⚠ cross-user isolation: another person's entitlements return nothing", (other.data ?? []).length === 0);
    const ownLive = await user.from("individual_live_entitlement").select("user_id");
    ok("G3. the live view honours the same policy (security_invoker)", (ownLive.data ?? []).length === 2 && (ownLive.data ?? []).every((x: any) => x.user_id === both));
    const selfGrant = await user.from("individual_entitlement").insert({ user_id: both, experience_code: "professional", source: "pilot", operating_entity: "competen_holdings" });
    const selfPrimary = await user.from("individual_membership").update({ status: "active", source: "signup" }).eq("user_id", both).select("id");
    ok("G4. ⚠ a browser session can neither grant an experience nor rewrite its own membership",
      !!selfGrant.error && (!!selfPrimary.error || (selfPrimary.data ?? []).length === 0));
    await user.auth.signOut();
  }

  await cleanup();
  const left = await admin.from("individual_membership").select("id").in("user_id", ids);
  ok("Z1. fixtures removed -- every Individual row cascaded with its profile", (left.data ?? []).length === 0);

  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
}

main().catch(async e => { console.error(e); try { await cleanup(); } catch { /* best effort */ } process.exit(1); });
