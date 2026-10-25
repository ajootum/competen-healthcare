/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PROFESSIONAL PROFILE PART B ACCEPTANCE -- COMPETEN-PROFESSIONAL-PROFILE-01, owner continuation GO part B,
 * STAGING ONLY. Migrations 451 (verification), 452 (reminder ledger), 453 (selective sharing).
 *
 *   V  verification: no verifier exists until one is appointed; a request comes first; a non-appointee, the
 *      person themself and an ended appointment are refused by the DATABASE; a verified version shows verified,
 *      a revocation, a dispute and a fresh outcome are history; a new version starts unverified; the queue
 *      holds only open requests, never the verifier's own; the document door opens only on an open request;
 *      own-row RLS and no browser write.
 *   R  reminders: the policy decides kinds, standings and offsets; one email for the tightest offset reached,
 *      never twice; a lapsed registration is not reminded; a failed send releases its claim.
 *   S  sharing: nothing by default; only the overview and record versions ticked for that link; each with its
 *      exact evidence class and verification state; a changed or withdrawn record drops off; a section the
 *      policy stops allowing drops off; another person's record cannot be put on a link.
 *
 * ⚠ STAGING ONLY (assertSafeTarget). PEND until 451-453 are applied. Fixtures: harness-prof01b-* identities and ONE
 * staging verifier appointment for the harness verifier, all deleted after. It turns individual_app ON only if it
 * was off, and restores it. It writes three policy rows and restores them exactly. No real email is sent: the
 * reminder scan runs with an injected sender, and every other person's claim it makes is released.
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only professional-profile-b-acceptance
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { parseItem } from "../src/lib/individual/professional/profile-form";
import { addItem, withdrawItem } from "../src/lib/individual/professional/profile-store";
import { hasOpenRequest, loadOpenRequests, loadVerifications, recordPersonEvent, recordVerdict } from "../src/lib/individual/professional/profile-verification";
import { scanProfessionalReminders, type ReminderSender } from "../src/lib/individual/professional/reminders";
import { mintShare, parseShare } from "../src/lib/individual/professional/share";
import { checkShareChoice, loadSharedProfile } from "../src/lib/individual/professional/share-profile";
import { INDIVIDUAL_APP_FLAG } from "../src/lib/individual/gate";
import { HQ_OFFICE_TYPE_PREFIX } from "../src/lib/hq/spaces";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "professional-profile-b-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};
const FIX = { person: "harness-prof01b-person@competen.test", other: "harness-prof01b-other@competen.test", verifier: "harness-prof01b-verifier@competen.test", plain: "harness-prof01b-plain@competen.test" };
const PW = `prof01b-${Math.random().toString(36).slice(2)}-Aa1!`;
const SCOPE = { scope_type: "platform", scope_ref: "individual" };
const ROWS = ["individual.policy.professional_reminder_offsets", "individual.policy.professional_reminder_kinds", "individual.policy.professional_share_sections"];
const ROLE = "individual_professional_verifier";
const today = new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

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
  const u = await findUser(email);
  if (!u) return;
  await admin.from("ogs_office_appointments").delete().eq("person_id", u.id).eq("role", ROLE);
  const { data: links } = await admin.from("individual_professional_share").select("share_token_id").eq("user_id", u.id);
  await admin.from("individual_professional_share").delete().eq("user_id", u.id);
  if (links?.length) await admin.from("passport_share_tokens").delete().in("id", links.map((l: any) => l.share_token_id));
  await admin.from("individual_professional_profile_item").delete().eq("user_id", u.id);
  for (const t of ["individual_professional_profile_context", "individual_professional_profile", "individual_entitlement", "individual_membership"]) await admin.from(t).delete().eq("user_id", u.id);
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
async function grantPro(target: string) {
  const req = validateGrant({ targetUserId: target, experiences: ["professional"], note: "PROF-PROFILE-01 part B acceptance" });
  if (isGrantRefusal(req)) throw new Error(req.message);
  const out = await grantIndividualAccess(admin, req, target);
  if (!out.ok) throw new Error(`grant: ${(out as any).message}`);
}
async function item(userId: string, kind: string, body: Record<string, unknown>) {
  const parsed = parseItem(kind, body, (await loadIndividualPolicy(admin)).professionalProfile);
  if (!parsed.ok) throw new Error(parsed.error);
  const out = await addItem(admin, userId, parsed.value, null);
  if (!out.ok) throw new Error(out.error);
  return out.id as string;
}
const state = async (userId: string, itemId: string) => (await loadVerifications(admin, userId, today))?.[itemId]?.state ?? "none";

let priorPolicy: any[] = []; let priorFlag: any = null; let flagTouched = false;
async function restore() {
  for (const path of ROWS) {
    const was = priorPolicy.find(r => r.config_path === path);
    if (was) await admin.from("workspace_config_overrides").upsert(was, { onConflict: "scope_type,scope_ref,config_path" });
    else await admin.from("workspace_config_overrides").delete().eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).eq("config_path", path);
  }
  if (flagTouched) { if (priorFlag) await admin.from("practice_platform_flags").upsert(priorFlag); else await admin.from("practice_platform_flags").delete().eq("flag", INDIVIDUAL_APP_FLAG); }
}
const publish = (path: string, settings: unknown) => admin.from("workspace_config_overrides").upsert({ ...SCOPE, config_path: path, draft: settings, published: settings }, { onConflict: "scope_type,scope_ref,config_path" });

async function main() {
  console.log(`PROFESSIONAL PROFILE PART B ACCEPTANCE against ${ref}\n`);
  for (const t of ["individual_professional_item_verification", "individual_professional_reminder_log", "individual_professional_share_item"]) {
    const p = await admin.from(t).select("*").limit(0);
    if (p.error) { console.log(`PEND -- ${t} is not on this project (${p.error.code}). Nothing created.`); return; }
  }
  const office = (await admin.from("ogs_offices").select("id, office_type, is_active, status").like("office_type", `${HQ_OFFICE_TYPE_PREFIX}%`).limit(50)).data
    ?.find((o: any) => o.is_active !== false && o.status !== "dissolved" && o.status !== "archived");
  if (!office) { console.log("PEND -- staging has no active HQ office to appoint a harness verifier to."); return; }
  priorPolicy = (await admin.from("workspace_config_overrides").select("*").eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).in("config_path", ROWS)).data ?? [];
  priorFlag = (await admin.from("practice_platform_flags").select("*").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle()).data ?? null;
  await cleanup();

  try {
    const before = (await admin.from("ogs_office_appointments").select("id").eq("role", ROLE)).data ?? [];
    ok("V0. no verifier is appointed on this project before the run (451 appoints nobody)", before.length === 0, `${before.length} appointment(s)`);

    const person = await makeUser(FIX.person, "B Person"), other = await makeUser(FIX.other, "B Other"), verifier = await makeUser(FIX.verifier, "B Verifier"), plain = await makeUser(FIX.plain, "B Plain");
    for (const u of [person, other]) await grantPro(u);
    const reg = await item(person, "registration", { title: "General register", type: "active", organisation: "Harness Council", identifier: "RN-9", expiresOn: inDays(20) });
    const qual = await item(person, "qualification", { title: "BSc", type: "bachelors" });

    // ── V. verification ──
    const early = await recordVerdict(admin, verifier, { itemId: reg, userId: person, event: "verified", method: "register_check", validUntil: null, reason: null });
    const req = await recordPersonEvent(admin, person, reg, "requested", null);
    const byPlain = await recordVerdict(admin, plain, { itemId: reg, userId: person, event: "verified", method: "register_check", validUntil: null, reason: null });
    ok("V1. before any appointment nobody can verify; a request comes first; a non-appointee is refused by the database",
      !early.ok && req.ok && !byPlain.ok && /appointment/.test((byPlain as any).error), `${JSON.stringify(early)} ${JSON.stringify(byPlain)}`);
    await admin.from("ogs_office_appointments").insert([{ office_id: office.id, person_id: verifier, role: ROLE, status: "active" }, { office_id: office.id, person_id: person, role: ROLE, status: "active" }]);
    const self = await recordVerdict(admin, person, { itemId: reg, userId: person, event: "verified", method: "register_check", validUntil: null, reason: null });
    const own = await recordPersonEvent(admin, verifier, reg, "requested", null);
    const queue = await loadOpenRequests(admin, person, today);
    ok("V2. independence: the person, though appointed, cannot verify their own record, nor can the verifier act as the person; their own request is not in their queue",
      !self.ok && !own.ok && !!queue && !queue.some(q => q.itemId === reg), `${JSON.stringify(self)} ${JSON.stringify(own)}`);
    const vq = await loadOpenRequests(admin, verifier, today);
    const noDoor = await hasOpenRequest(admin, qual, today);
    const done = await recordVerdict(admin, verifier, { itemId: reg, userId: person, event: "verified", method: "register_check", validUntil: inDays(365), reason: null });
    ok("V3. the verifier's queue holds the open request only; the unsubmitted record has no document door; an appointed, independent verifier verifies it",
      !!vq?.some(q => q.itemId === reg) && !vq?.some(q => q.itemId === qual) && noDoor === null && done.ok && await state(person, reg) === "verified", JSON.stringify(done));
    const rev = await recordVerdict(admin, verifier, { itemId: reg, userId: person, event: "revoked", method: null, validUntil: null, reason: "Register shows a lapse" });
    const s1 = await state(person, reg);
    const dis = await recordPersonEvent(admin, person, reg, "disputed", "Renewed, see the register again");
    const s2 = await state(person, reg);
    const again = await recordVerdict(admin, verifier, { itemId: reg, userId: person, event: "verified", method: "issuer_confirmation", validUntil: null, reason: null });
    const hist = ((await loadVerifications(admin, person, today)) ?? {})[reg]?.history.map(h => h.event).join(">");
    const rewrite = await admin.from("individual_professional_item_verification").update({ method: "document_review" }).eq("item_id", reg);
    ok("V4. revoked, disputed and verified again are kept as history, and the history cannot be rewritten",
      rev.ok && s1 === "revoked" && dis.ok && s2 === "disputed" && again.ok && hist === "requested>verified>revoked>disputed>verified" && !!rewrite.error, `${s1} ${s2} ${hist} ${rewrite.error?.message}`);
    const reg2 = await item(person, "registration", { title: "General register", type: "active", organisation: "Harness Council", identifier: "RN-9", expiresOn: inDays(20), supersedesId: reg });
    ok("V5. a changed record is a new version that starts unverified; the earlier version keeps its verification",
      await state(person, reg2) === "none" && await state(person, reg) === "verified");
    await admin.from("ogs_office_appointments").update({ status: "ended" }).eq("person_id", verifier).eq("role", ROLE);
    await recordPersonEvent(admin, person, reg2, "requested", null);
    const ended = await recordVerdict(admin, verifier, { itemId: reg2, userId: person, event: "verified", method: "register_check", validUntil: null, reason: null });
    ok("V6. an ended appointment can no longer verify", !ended.ok, JSON.stringify(ended));
    const b = createClient(url!, anonKey!, { auth: { persistSession: false } }) as any;
    await b.auth.signInWithPassword({ email: FIX.other, password: PW });
    const peek = await b.from("individual_professional_item_verification").select("id").eq("user_id", person);
    const forge = await b.from("individual_professional_item_verification").insert({ user_id: other, item_id: reg2, event: "verified", actor_id: other, method: "register_check" });
    ok("V7. RLS: another person reads none of these rows, and a browser session cannot write one", (peek.data ?? []).length === 0 && !!forge.error, `${peek.data?.length} ${forge.error?.code}`);

    // ── R. reminders ──
    if (priorFlag?.enabled !== true) { flagTouched = true; await admin.from("practice_platform_flags").upsert({ flag: INDIVIDUAL_APP_FLAG, enabled: true, note: "prof01b acceptance (staging), restored after" }); }
    await admin.from("individual_professional_profile").upsert({ user_id: person, experience_code: "professional", reminder_email: true }, { onConflict: "user_id" });
    await item(person, "registration", { title: "Old lapsed licence", type: "lapsed", expiresOn: inDays(10) });
    await publish(ROWS[0], { enabled: ["60", "30"] });
    const mine: string[] = [];
    let fail = true;
    const sender: ReminderSender = async (_a, userId, message) => {
      if (userId !== person) return { sent: false, error: "harness: not this run's person" };
      if (fail) return { sent: false, error: "harness: planted failure" };
      mine.push(message.title + " | " + message.body.split(" expires")[0]); return { sent: true };
    };
    const r0 = await scanProfessionalReminders(admin, new Date(), sender);
    const logAfterFail = (await admin.from("individual_professional_reminder_log").select("id").eq("user_id", person)).data ?? [];
    fail = false;
    const r1 = await scanProfessionalReminders(admin, new Date(), sender);
    const r2 = await scanProfessionalReminders(admin, new Date(), sender);
    const log = (await admin.from("individual_professional_reminder_log").select("item_id, offset_days").eq("user_id", person)).data ?? [];
    ok("R1. a failed send releases its claim; then ONE email at the tightest offset reached (30 of 60 and 30), never twice; the lapsed licence is not reminded",
      r0.failed >= 1 && logAfterFail.length === 0 && mine.filter(m => /General register/.test(m)).length === 1 && log.length === 1 && log[0].offset_days === 30
      && !mine.some(m => /Old lapsed licence/.test(m)) && r2.sent === 0, `${JSON.stringify(mine)} log=${JSON.stringify(log)} r1=${r1.sent} r2=${r2.sent}`);
    await publish(ROWS[1], { enabled: ["credentials"] });
    const before3 = mine.length;
    await item(person, "qualification", { title: "ALS provider", type: "certificate", expiresOn: inDays(5) });
    await scanProfessionalReminders(admin, new Date(), sender);
    ok("R2. with profile records switched off in the policy, nothing about them is sent", mine.length === before3, JSON.stringify(mine.slice(before3)));

    // ── S. sharing ──
    const noChoice = await mintShare(admin, person, parseShare({ scope: "full", days: 7 }));
    const sp0 = noChoice ? await loadSharedProfile(admin, noChoice.id, person, (await loadIndividualPolicy(admin)).professionalProfile.shareSections, today) : null;
    const stealErr = await checkShareChoice(admin, person, { overview: false, itemIds: [await item(other, "qualification", { title: "Other's BSc" })] }, (await loadIndividualPolicy(admin)).professionalProfile.shareSections);
    const link = await mintShare(admin, person, parseShare({ scope: "full", days: 7 }), { overview: true, itemIds: [reg2, qual] });
    const sections = (await loadIndividualPolicy(admin)).professionalProfile.shareSections;
    const sp1 = link ? await loadSharedProfile(admin, link.id, person, sections, today) : null;
    ok("S1. a link carries nothing of the profile by default, and another person's record cannot be put on a link",
      !!sp0 && !sp0.overview && sp0.records.length === 0 && !!stealErr, `${JSON.stringify(sp0)} ${stealErr}`);
    const r = (t: string) => sp1?.records.find(x => x.title === t);
    ok("S2. a link carries exactly the ticked overview and records, each with its own evidence class and verification state, no number, no reasons",
      !!sp1?.overview && sp1.records.length === 2 && r("General register")?.verification.state === "requested" && r("BSc")?.verification.state === "none"
      && r("BSc")?.evidenceClass === "self_declared" && !JSON.stringify(sp1).includes("RN-9") && !JSON.stringify(sp1).includes("Renewed, see"), JSON.stringify(sp1));
    await withdrawItem(admin, person, qual, "recorded_in_error");
    await item(person, "registration", { title: "General register (renewed)", type: "active", supersedesId: reg2 });
    const sp2 = link ? await loadSharedProfile(admin, link.id, person, sections, today) : null;
    await publish(ROWS[2], { enabled: ["qualifications"] });
    const sp3 = link ? await loadSharedProfile(admin, link.id, person, (await loadIndividualPolicy(admin)).professionalProfile.shareSections, today) : null;
    ok("S3. a withdrawn or changed record drops off the link (the newer version was never chosen), and a section the policy stops allowing is hidden",
      sp2?.records.length === 0 && !!sp2?.overview && sp3?.overview === null, `${JSON.stringify(sp2)} ${JSON.stringify(sp3)}`);
  } finally {
    await restore();
    await cleanup();
    const left = await Promise.all(Object.values(FIX).map(findUser));
    const pol = (await admin.from("workspace_config_overrides").select("*").eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).in("config_path", ROWS)).data ?? [];
    const flag = (await admin.from("practice_platform_flags").select("*").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle()).data ?? null;
    const appts = (await admin.from("ogs_office_appointments").select("id").eq("role", ROLE)).data ?? [];
    const sort = (x: any[]) => JSON.stringify([...x].sort((a, b) => a.config_path.localeCompare(b.config_path)));
    ok("Z1. cleanup: no harness identity, no verifier appointment, the three policy rows and the release flag exactly as they were",
      left.every(u => !u) && appts.length === 0 && sort(pol) === sort(priorPolicy) && JSON.stringify(flag) === JSON.stringify(priorFlag));
  }
  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); try { await restore(); await cleanup(); } catch { /* best effort */ } process.exit(1); });
