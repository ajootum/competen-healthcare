/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PROFESSIONAL PROFILE ACCEPTANCE -- COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1, owner GO s10, STAGING ONLY.
 *
 * The focused journey, against a real database, through the library the routes call (the same parse and the
 * same store), so what is under test is the schema (migration 450), the store and the policy, not a copy:
 *
 *   J1  an existing Individual (Scholar) user activates Professional: one auth user, one profiles row, one
 *       membership, Scholar still live beside Professional
 *   J2  a new INVITED Professional-only user (the 378 invitation, link delivery) accepts: Professional only
 *   J3  required professional context is saved; completion is refused without it, by the store AND the schema
 *   J4  optional fields can be skipped
 *   J5  the user enters Professional: registration complete, the home no longer shows the form
 *   J6  the profile is enriched later: overview, summary and records in every section
 *   J7  qualifications and employment keep earlier versions; context history keeps the earlier profession
 *   J8  verification states stay accurate: self-declared, document-supported, expired, superseded, withdrawn,
 *       and nothing can be stored as verified
 *   J9  Scholar history and the Passport are unchanged for the Scholar user
 *   J10 everything above ran with NO competency catalogue offered (the Professional allowlist)
 *   J11 no-code configuration controls the registration fields (the Individual policy, restored after)
 *   J12 privacy and entitlement: own-row RLS from a browser session, no browser write, no cross-person
 *       supersede or withdraw, a Scholar-only person does not hold Professional
 *
 * ⚠ STAGING ONLY: assertSafeTarget refuses production before any client is built. PEND (exit 0, nothing
 * created) until migration 450 is applied. It never writes individual_app. It writes the three policy rows of
 * J10 (allowlist) and J11 (form) and restores all three exactly, and creates and deletes its own harness-prof01-* identities.
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only professional-profile-acceptance
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { readIndividualAccess } from "../src/lib/individual/access";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { acceptIndividualInvitation, createIndividualInvitation, validateInvitation, isRefusal } from "../src/lib/individual/invitations";
import { loadIndividualPassport } from "../src/lib/individual/passport";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { parseContext, parseItem, registrationSteps } from "../src/lib/individual/professional/profile-form";
import { addItem, loadProfessionalProfile, registrationState, saveContext, withdrawItem } from "../src/lib/individual/professional/profile-store";
import { chainsOf, itemState } from "../src/lib/individual/professional/profile-records";
import { loadCatalogueSuggestions } from "../src/lib/individual/professional/catalogue-suggestions";
import { loadRegistration } from "../src/app/individual/_components/professional/registration";
import { storeDocument } from "../src/lib/individual/professional/documents";
import { DOCUMENT_BUCKET } from "../src/lib/individual/professional/vocabulary";
import { REQUIRED_FIELDS } from "../src/lib/individual/professional/profile-vocabulary";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "professional-profile-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const FIX = { grantor: "harness-prof01-grantor@competen.test", scholar: "harness-prof01-scholar@competen.test", invited: "harness-prof01-invited@competen.test", other: "harness-prof01-other@competen.test" };
const PW = `prof01-${Math.random().toString(36).slice(2)}-Aa1!`;
const SCOPE = { scope_type: "platform", scope_ref: "individual" };
const P_FIELDS = "individual.policy.professional_registration_fields";
const P_REQUIRED = "individual.policy.professional_registration_required";
const P_CATALOGUES = "individual.policy.professional_catalogues";
const POLICY_ROWS = [P_FIELDS, P_REQUIRED, P_CATALOGUES];
const today = () => new Date().toISOString().slice(0, 10);

async function findUser(email: string) {
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
async function removeUser(email: string) {
  await admin.from("individual_invitation").delete().eq("pending_email", email);
  const u = await findUser(email);
  if (!u) return;
  await admin.from("individual_invitation").delete().eq("auth_user_id", u.id);
  // Items first: a version's link to the one it superseded is cleared by the FK, which the 450 trigger allows.
  await admin.from("individual_professional_profile_item").delete().eq("user_id", u.id);
  await admin.from("individual_professional_profile_context").delete().eq("user_id", u.id);
  await admin.from("individual_professional_profile").delete().eq("user_id", u.id);
  const { data: objs } = await admin.storage.from(DOCUMENT_BUCKET).list(u.id);
  if (objs?.length) await admin.storage.from(DOCUMENT_BUCKET).remove(objs.map((o: any) => `${u.id}/${o.name}`));
  for (const t of ["individual_scholar_learner", "individual_scholar_learner_context", "individual_entitlement", "individual_membership"]) await admin.from(t).delete().eq("user_id", u.id);
  await admin.from("audit_log").delete().eq("actor_id", u.id);
  await admin.from("profiles").delete().eq("id", u.id);
  await admin.auth.admin.deleteUser(u.id);
}
const cleanup = async () => { for (const e of Object.values(FIX)) await removeUser(e); };

async function makeUser(email: string, name: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { full_name: name } });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  await admin.from("profiles").update({ full_name: name, role: null }).eq("id", data.user.id);
  return data.user.id as string;
}
async function grant(target: string, by: string, experiences: ("scholar" | "professional")[]) {
  const req = validateGrant({ targetUserId: target, experiences, adultConfirmed: experiences.includes("scholar"), note: "PROF-PROFILE-01 acceptance" });
  if (isGrantRefusal(req)) throw new Error(`grant refused: ${req.message}`);
  const out = await grantIndividualAccess(admin, req, by);
  if (!out.ok) throw new Error(`grant failed: ${(out as any).message}`);
}
async function browser(email: string) {
  const c = createClient(url!, anonKey!, { auth: { persistSession: false } }) as any;
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return c;
}
const policyNow = async () => (await loadIndividualPolicy(admin)).professionalProfile;
/** What the context route does for one step: parse with the policy in force, then save. */
async function step(userId: string, s: "profession" | "practice" | "review" | "overview", body: Record<string, unknown>, opts: { skip?: boolean; complete?: boolean } = {}) {
  const policy = await policyNow();
  const fields = s === "profession" ? [...REQUIRED_FIELDS] : s === "practice" ? (opts.skip ? [] : policy.registrationFields)
    : s === "overview" ? [...REQUIRED_FIELDS, "specialty", "title", "years", "setting", "role"] as any[] : [];
  const parsed = parseContext(body, fields, policy);
  if (!parsed.ok) return { ok: false as const, status: 400, error: parsed.error };
  return saveContext(admin, userId, policy, { columns: parsed.value, summary: s === "overview" ? (body.summary as string ?? undefined) : undefined, step: s === "overview" ? undefined : s === "review" ? "review" : "practice", complete: opts.complete });
}
async function item(userId: string, kind: string, body: Record<string, unknown>, doc: Record<string, unknown> | null = null) {
  const parsed = parseItem(kind, body, await policyNow());
  if (!parsed.ok) throw new Error(`parseItem ${kind}: ${parsed.error}`);
  return addItem(admin, userId, parsed.value, doc);
}
const scholarSnapshot = async (userId: string) => {
  const [ent, learner, ctx, passport] = await Promise.all([
    admin.from("individual_entitlement").select("experience_code, status, starts_at, ends_at, source").eq("user_id", userId).eq("experience_code", "scholar"),
    admin.from("individual_scholar_learner").select("*").eq("user_id", userId),
    admin.from("individual_scholar_learner_context").select("*").eq("user_id", userId),
    loadIndividualPassport(admin, userId, today()),
  ]);
  // The Passport's organisation sections and Scholar study are compared exactly. `own` is the person's OWN
  // Professional records (the MVP shows a recorded profession as a self-declared registration item): returned apart.
  const { own, ...institutional } = passport;
  return { scholar: JSON.stringify({ ent: ent.data, learner: learner.data, ctx: ctx.data, institutional }), own: own ?? [] };
};

let priorPolicy: any[] = [];
async function restorePolicy() {
  for (const path of POLICY_ROWS) {
    const was = priorPolicy.find(r => r.config_path === path);
    if (was) await admin.from("workspace_config_overrides").upsert(was, { onConflict: "scope_type,scope_ref,config_path" });
    else await admin.from("workspace_config_overrides").delete().eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).eq("config_path", path);
  }
}

async function main() {
  console.log(`PROFESSIONAL PROFILE ACCEPTANCE (COMPETEN-PROFESSIONAL-PROFILE-01 Stage 1) against ${ref}\n`);
  const probe = await admin.from("individual_professional_profile_item").select("id").limit(0);
  const probe2 = await admin.from("individual_professional_profile").select("registration_completed_at").limit(0);
  if (probe.error || probe2.error) { console.log(`PEND -- migration 450 is not applied here (${probe.error?.code ?? probe2.error?.code}). Nothing created.`); return; }
  const pp = await admin.from("workspace_config_overrides").select("*").eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).in("config_path", POLICY_ROWS);
  priorPolicy = pp.data ?? [];
  const stagingAllowlist = (await loadIndividualPolicy(admin)).professionalCatalogues;
  // GO s10 item 10: the whole journey runs with NO catalogue offered -- the Professional allowlist published empty
  // for the run, then restored exactly. The registration form defaults apply (the two form rows absent).
  for (const path of [P_FIELDS, P_REQUIRED]) await admin.from("workspace_config_overrides").delete().eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).eq("config_path", path);
  await admin.from("workspace_config_overrides").upsert({ ...SCOPE, config_path: P_CATALOGUES, draft: { ids: [] }, published: { ids: [] } }, { onConflict: "scope_type,scope_ref,config_path" });
  await cleanup();

  try {
    const grantor = await makeUser(FIX.grantor, "Harness Grantor");

    // ── J1. An existing Scholar user adds Professional on the SAME identity ──
    const scholar = await makeUser(FIX.scholar, "Harness Scholar");
    await grant(scholar, grantor, ["scholar"]);
    const { data: prog } = await admin.from("individual_scholar_programme").select("code").eq("is_active", true).limit(1);
    if (prog?.[0]) await admin.from("individual_scholar_learner").insert({ user_id: scholar, programme_code: prog[0].code });
    const before = await scholarSnapshot(scholar);
    const profilesBefore = (await admin.from("profiles").select("id").eq("email", FIX.scholar)).data ?? [];
    await grant(scholar, grantor, ["professional"]);
    const acc = await readIndividualAccess(admin, scholar);
    const authCount = (await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })).data?.users?.filter((u: any) => u.email === FIX.scholar).length;
    const memberships = (await admin.from("individual_membership").select("id").eq("user_id", scholar)).data?.length;
    ok("J1. an existing Scholar user activates Professional: one auth user, one profiles row, one membership, both experiences live",
      acc.state === "member" && acc.live.includes("scholar") && acc.live.includes("professional") && authCount === 1 && profilesBefore.length === 1 && memberships === 1,
      `${acc.state} ${(acc as any).live} auth=${authCount} profiles=${profilesBefore.length} memberships=${memberships}`);

    // ── J2. A new invited Professional-only user ──
    const inv = validateInvitation({ email: FIX.invited, name: "Harness Invited", experiences: ["professional"] });
    if (isRefusal(inv)) throw new Error(inv.message);
    const created = await createIndividualInvitation(admin, inv, { id: grantor }, { origin: "http://localhost:3000", delivery: "link" });
    if (!created.ok) throw new Error(`invitation: ${created.message}`);
    const invited = created.authUserId;
    await admin.auth.admin.updateUserById(invited, { password: PW, email_confirm: true });
    const authUser = (await admin.auth.admin.getUserById(invited)).data?.user;
    const accepted = await acceptIndividualInvitation(admin, { id: invited, email: authUser?.email ?? null, emailConfirmedAt: authUser?.email_confirmed_at ?? null });
    const accI = await readIndividualAccess(admin, invited);
    ok("J2. a new invited user accepts a Professional-only invitation: Professional live, Scholar not, the Professional email marker set",
      accepted.ok && accI.state === "member" && accI.live.length === 1 && accI.live[0] === "professional" && authUser?.user_metadata?.competen_invite_professional === true,
      `${JSON.stringify(accepted).slice(0, 120)} ${(accI as any).live}`);
    ok("J2b. before registering, the Professional home shows the registration form, resuming at the first step",
      (await loadRegistration(admin, invited))?.resumeAt === "profession");

    // ── J3. Required professional context ──
    const p1 = await step(invited, "profession", { profession: "", professionText: "Physiotherapist" });
    const early = await step(invited, "review", {}, { complete: true });
    const direct = await admin.from("individual_professional_profile").update({ registration_completed_at: new Date().toISOString() }).eq("user_id", invited);
    ok("J3a. completion is refused without jurisdiction and status: by the store (names what is missing) and by the 450 CHECK",
      p1.ok && !early.ok && JSON.stringify((early as any).missing) === JSON.stringify(["jurisdiction", "status"]) && !!direct.error, `${JSON.stringify(early)} ${direct.error?.message}`);
    const pol = await policyNow();
    const jur = pol.jurisdictions.find(j => j.label === "Kenya") ?? pol.jurisdictions[0];
    const p2 = await step(invited, "profession", { profession: "", professionText: "Physiotherapist", jurisdiction: jur.code, status: "practising" });
    const v2 = (await loadProfessionalProfile(admin, invited)).pointer!;
    ok("J3b. the three required facts are saved, a chosen option with its code and the label copied, a typed one as typed",
      p2.ok && v2.self_declared_profession === "Physiotherapist" && v2.profession_code === null && v2.practice_jurisdiction_code === jur.code
      && v2.self_declared_practice_jurisdiction === jur.label && v2.professional_status_code === "practising" && v2.self_declared_professional_status === "Practising",
      JSON.stringify(v2).slice(0, 200));

    // ── J4 / J5. Optional skipped, then enter ──
    const skip = await step(invited, "practice", {}, { skip: true });
    const done = await step(invited, "review", {}, { complete: true });
    const v3 = await loadProfessionalProfile(admin, invited);
    ok("J4. optional fields can be skipped: registration completes with specialty, title, years, setting and role all empty",
      skip.ok && done.ok && [v3.pointer!.self_declared_primary_specialty, v3.pointer!.self_declared_professional_title, v3.pointer!.self_declared_years_experience,
        v3.pointer!.self_declared_practice_setting, v3.pointer!.self_declared_current_role].every(v => v === null), JSON.stringify(done));
    ok("J5. the user enters Professional: registration is complete and the home shows the workspace, not the form",
      registrationState(v3) === "complete" && (await loadRegistration(admin, invited)) === null && !!v3.pointer!.registration_completed_at);

    // ── J6. Enrichment later ──
    const ov = await step(invited, "overview", { profession: "", professionText: "Physiotherapist", jurisdiction: jur.code, status: "practising", titleText: "Senior physiotherapist", years: "9", summary: "Musculoskeletal practice." });
    const file = new File([Buffer.from("%PDF-1.4 harness")], "degree.pdf", { type: "application/pdf" });
    const stored = await storeDocument(admin, invited, file);
    const q1 = await item(invited, "qualification", { title: "BSc Physiotherapy", type: "bachelors", organisation: "Harness University", startedOn: "2015-07-01" }, stored.ok ? stored.doc : null);
    const r1 = await item(invited, "registration", { title: "Physiotherapy register", type: "active", organisation: "Harness Board", identifier: "PT-001", expiresOn: "2025-01-31" });
    const e1 = await item(invited, "employment", { title: "Physiotherapist", organisation: "Harness Hospital", type: "hospital", startedOn: "2016-01-01" });
    const s1 = await item(invited, "specialty", { title: "Musculoskeletal" });
    const i1 = await item(invited, "interest", { title: "Education" });
    const a1 = await item(invited, "aspiration", { title: "Lead a rehabilitation service", targetOn: "2029-12-31" });
    const v4 = await loadProfessionalProfile(admin, invited);
    ok("J6. the profile is enriched after registration: overview facts and summary, and a record in each of the six kinds",
      ov.ok && v4.pointer!.self_declared_professional_title === "Senior physiotherapist" && v4.pointer!.self_declared_years_experience === 9 && v4.pointer!.self_declared_summary === "Musculoskeletal practice."
      && [q1, r1, e1, s1, i1, a1].every(x => x.ok) && new Set((v4.items ?? []).map(i => i.section)).size === 6, JSON.stringify([q1, r1, e1, s1, i1, a1].map(x => x.ok)));

    // ── J7. Earlier records retained ──
    const e2 = await item(invited, "employment", { title: "Physiotherapist", organisation: "Harness Hospital", type: "hospital", startedOn: "2016-01-01", endedOn: "2022-06-30", supersedesId: (e1 as any).id });
    const e3 = await item(invited, "employment", { title: "Senior physiotherapist", organisation: "Harness Clinic", type: "private-practice", startedOn: "2022-07-01" });
    const q2 = await item(invited, "qualification", { title: "BSc (Hons) Physiotherapy", type: "bachelors", organisation: "Harness University", startedOn: "2015-07-01", supersedesId: (q1 as any).id },
      (await admin.from("individual_professional_profile_item").select("document_path, document_name, document_mime, document_bytes").eq("id", (q1 as any).id).single()).data);
    await step(invited, "overview", { profession: "", professionText: "Sports physiotherapist", jurisdiction: jur.code, status: "practising", titleText: "Senior physiotherapist", years: "9", summary: "Musculoskeletal practice." });
    const v5 = await loadProfessionalProfile(admin, invited);
    const emp = chainsOf(v5.items, "employment").live;
    const qual = chainsOf(v5.items, "qualification").live;
    const oldE1 = (v5.items ?? []).find(i => i.id === (e1 as any).id);
    const rewrite = await admin.from("individual_professional_profile_item").update({ title: "Forged" }).eq("id", (e1 as any).id);
    const histRewrite = await admin.from("individual_professional_profile_context").update({ self_declared_profession: "Forged" }).eq("user_id", invited);
    const profs = (v5.history ?? []).map(h => h.self_declared_profession);
    ok("J7a. employment: ending a role is a new version (the earlier kept unchanged), and a new role is a second record",
      e2.ok && e3.ok && emp.length === 2 && emp.some(c => c.current.id === (e2 as any).id && c.earlier[0]?.id === (e1 as any).id) && oldE1?.ended_on === null && !!oldE1?.superseded_at,
      JSON.stringify(emp.map(c => [c.current.title, c.earlier.length])));
    ok("J7b. qualifications: a corrected title is a new version carrying its document, the earlier version kept",
      q2.ok && qual.length === 1 && qual[0].earlier[0]?.title === "BSc Physiotherapy" && qual[0].current.document_name === "degree.pdf");
    ok("J7c. a change of profession keeps the earlier profession in the history, and neither records nor history can be rewritten",
      profs[0] === "Sports physiotherapist" && profs.includes("Physiotherapist") && (v5.history ?? []).filter(h => !h.effective_to).length === 1 && !!rewrite.error && !!histRewrite.error,
      `${profs.join(" | ")} ${rewrite.error?.message} ${histRewrite.error?.message}`);

    // ── J8. Verification states ──
    const w = await withdrawItem(admin, invited, (i1 as any).id, "recorded_in_error");
    const v6 = await loadProfessionalProfile(admin, invited);
    const st = (id: string) => itemState((v6.items ?? []).find(i => i.id === id)!, today());
    const forge = await admin.from("individual_professional_profile_item").insert({ user_id: invited, experience_code: "professional", section: "qualification", title: "Forged", evidence_class: "independently_verified" });
    const verifiedCol = await admin.from("individual_professional_profile_item").select("verified").limit(1);
    ok("J8. states are accurate: document-supported, self-declared, expired, superseded, withdrawn -- and a verified class cannot be stored",
      w.ok && st((q2 as any).id) === "document_supported" && st((s1 as any).id) === "self_declared" && st((r1 as any).id) === "expired"
      && st((q1 as any).id) === "superseded" && st((i1 as any).id) === "withdrawn" && !!forge.error && !!verifiedCol.error,
      `${[q2, s1, r1, q1, i1].map(x => st((x as any).id)).join(",")} forge=${forge.error?.code} col=${verifiedCol.error?.code}`);

    // ── J9. Scholar history and the Passport for the Scholar user who registered Professional ──
    await step(scholar, "profession", { profession: "", professionText: "Nurse", jurisdiction: jur.code, status: "newly-qualified" });
    await step(scholar, "review", {}, { complete: true });
    await item(scholar, "qualification", { title: "Diploma", type: "diploma" });
    const after = await scholarSnapshot(scholar);
    const accS = await readIndividualAccess(admin, scholar);
    const added = after.own.filter((o: any) => !before.own.some((b: any) => JSON.stringify(b) === JSON.stringify(o)));
    ok("J9. Scholar entitlement, study context, Scholar study and every organisation Passport section are byte-identical after registering Professional; Scholar still live",
      before.scholar === after.scholar && accS.state === "member" && accS.live.includes("scholar"), before.scholar === after.scholar ? "" : "snapshot differs");
    ok("J9b. the only Passport change is the person's own record, labelled self-declared (the MVP registration item)",
      before.own.length === 0 && added.length === after.own.length && added.every((o: any) => o.kind === "registration" && o.evidence === "self_declared"), JSON.stringify(added));

    // ── J10. No catalogue, then the staging allowlist back ──
    const allow = (await loadIndividualPolicy(admin)).professionalCatalogues;
    const sugg = await loadCatalogueSuggestions(admin, { profession: "Physiotherapist", specialties: ["Musculoskeletal"] });
    ok("J10. the journey above ran with no competency catalogue: the Professional allowlist was empty and nothing was suggested",
      allow.length === 0 && Array.isArray(sugg) && sugg.length === 0, `allowlist=${allow.length} suggestions=${JSON.stringify(sugg)}`);
    await restorePolicy();
    const real = await loadCatalogueSuggestions(admin, { profession: "Physiotherapist", specialties: ["Musculoskeletal"] });
    ok("J10b. with the staging allowlist restored, suggestions come only from it (an unlisted framework is never suggested)",
      Array.isArray(real) && real.every(c => stagingAllowlist.includes(c.frameworkId)), `allowlist=${stagingAllowlist.length} suggested=${JSON.stringify(real?.map(c => [c.name, c.reasons]))}`);

    // ── J11. No-code configuration controls the registration fields ──
    const other = await makeUser(FIX.other, "Harness Other");
    await grant(other, grantor, ["professional"]);
    await admin.from("workspace_config_overrides").upsert([
      { ...SCOPE, config_path: P_FIELDS, draft: { order: ["years", "title"] }, published: { order: ["years", "title"] } },
      { ...SCOPE, config_path: P_REQUIRED, draft: { enabled: ["years"] }, published: { enabled: ["years"] } },
    ], { onConflict: "scope_type,scope_ref,config_path" });
    const cfg = await policyNow();
    const steps = registrationSteps(cfg);
    await step(other, "profession", { profession: "", professionText: "Pharmacist", jurisdiction: jur.code, status: "practising" });
    const noYears = await step(other, "review", {}, { complete: true });
    await step(other, "practice", { years: "3" });
    const withYears = await step(other, "review", {}, { complete: true });
    await restorePolicy();
    const back = registrationSteps(await policyNow());
    ok("J11. configuration sets which optional questions are asked, their order and which are required -- and completion follows it",
      JSON.stringify(steps[1].fields.map(f => [f.key, f.required])) === JSON.stringify([["years", true], ["title", false]])
      && !noYears.ok && JSON.stringify((noYears as any).missing) === JSON.stringify(["years"]) && withYears.ok
      && back[1].fields.map(f => f.key).join(",") === "specialty,title,years,setting,role", JSON.stringify({ steps: steps[1].fields.map(f => f.key), noYears, withYears: withYears.ok }));

    // ── J12. Privacy and entitlement ──
    const bInv = await browser(FIX.invited);
    const own = await bInv.from("individual_professional_profile_item").select("id").eq("user_id", invited);
    const theirs = await bInv.from("individual_professional_profile_item").select("id").eq("user_id", other);
    const allRows = await bInv.from("individual_professional_profile_item").select("user_id");
    const hist = await bInv.from("individual_professional_profile_context").select("user_id");
    const ins = await bInv.from("individual_professional_profile_item").insert({ user_id: invited, experience_code: "professional", section: "interest", title: "Browser write" });
    const upd = await bInv.from("individual_professional_profile_item").update({ withdrawn_at: new Date().toISOString(), withdrawn_reason: "no_longer_held" }).eq("id", (s1 as any).id).select("id");
    const cross = await withdrawItem(admin, other, (s1 as any).id, "no_longer_held");
    const crossSup = await item(other, "specialty", { title: "Hijack", supersedesId: (s1 as any).id });
    await grant(grantor, grantor, ["scholar"]);
    const scholarOnly = await readIndividualAccess(admin, grantor);
    ok("J12a. own-row RLS: a browser session reads its own records and history only, and cannot write at all",
      (own.data ?? []).length > 0 && (theirs.data ?? []).length === 0 && (allRows.data ?? []).every((r: any) => r.user_id === invited)
      && (hist.data ?? []).every((r: any) => r.user_id === invited) && !!ins.error && (upd.data ?? []).length === 0,
      `own=${own.data?.length} theirs=${theirs.data?.length} ins=${ins.error?.code} upd=${upd.data?.length}`);
    ok("J12b. another person cannot withdraw or supersede someone's record, and a person without the entitlement does not hold Professional",
      !cross.ok && !crossSup.ok && scholarOnly.state === "member" && scholarOnly.live.includes("scholar") && !scholarOnly.live.includes("professional"), `${JSON.stringify(cross)} ${JSON.stringify(crossSup)}`);
  } finally {
    await restorePolicy();
    await cleanup();
    const left = await Promise.all(Object.values(FIX).map(findUser));
    const pol = await admin.from("workspace_config_overrides").select("*").eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).in("config_path", POLICY_ROWS);
    ok("Z1. cleanup: no harness identity is left, and the three policy rows are exactly as they were",
      left.every(u => !u) && JSON.stringify((pol.data ?? []).sort((a: any, b: any) => a.config_path.localeCompare(b.config_path)))
        === JSON.stringify([...priorPolicy].sort((a: any, b: any) => a.config_path.localeCompare(b.config_path))));
  }

  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); try { await restorePolicy(); await cleanup(); } catch { /* best effort */ } process.exit(1); });
