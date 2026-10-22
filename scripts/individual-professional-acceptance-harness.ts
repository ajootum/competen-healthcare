/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * INDIVIDUAL PROFESSIONAL ACCEPTANCE HARNESS -- COMPETEN-IND-007 against a real database, STAGING ONLY.
 *
 *   A. Direct entry: a Professional-only person (no Scholar row ever written) holds Professional live, and
 *      every step of the journey writes and reads back: profile, need, goal, CPD, evidence, Passport,
 *      progress, share.
 *   B. Evidence classes are the database's: no document gives self_declared, a document gives
 *      source_linked, a writer cannot store a class, and nothing can be stored as verified.
 *   C. Cross-person links are unrepresentable: a goal on another person's need, and a document path under
 *      another person's id, are refused by the schema.
 *   D. RLS (D6): own rows readable from a browser session, another person's not, and no writes at all.
 *   E. Reminders: an expiring credential is reminded once, recorded on the person's own row, and a second
 *      run sends nothing. No cdp_reminders and no notifications row is written.
 *   F. Share: a Professional link carries the person's own records; an estate-minted link for the same
 *      person does not; revoke works on the person's own link only.
 *   G. Shared frameworks only: the framework list has no hospital framework, and a hospital framework is
 *      refused as a reference.
 *   R. Release gate: the reminder job is silent while `individual_app` is OFF. The run switches it ON and
 *      restores the row it found (Z2), as individual-acceptance-harness does. Never production.
 *   M. Employer visibility (D1): no fixture row in cpd_logs, professional_credentials, evidence,
 *      cdp_reminders or notifications.
 *
 * ⚠ IT IMPORTS THE RULES IT TESTS. ⚠ MIGRATIONS 370 AND 373 FIRST: until 373 is applied every group
 * reports PEND, the run exits 0 and nothing is created. ⚠ STAGING ONLY -- assertSafeTarget refuses
 * production before any client is built:
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only individual-professional-acceptance
 *
 * ⚠ WALK-THROUGH IDENTITY. With IND007_PILOT_CREDENTIALS=<file> set, the run finishes by creating ONE
 * Professional-only pilot identity (harness-ind007-pilot@competen.test, granted through the foundation's
 * grant service, no Scholar row) and writes its generated password to that file -- never to the output.
 * A later run removes it first. Without the variable nothing is left behind.
 */
import { loadEnvConfig } from "@next/env";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { readIndividualAccess, isNotProvisioned } from "../src/lib/individual/access";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPassport } from "../src/lib/individual/passport";
import { loadProfessionalRecord } from "../src/lib/individual/professional/record";
import { evidenceCoverage, planProgress, cpdHoursByYear } from "../src/lib/individual/professional/progress";
import { mintShare, listShares, revokeShare, shareCarriesOwnRecords } from "../src/lib/individual/professional/share";
import { scanProfessionalReminders } from "../src/lib/individual/professional/reminders";
import { loadSharedFrameworks, checkSharedReference } from "../src/lib/individual/professional/frameworks";
import { DOCUMENT_BUCKET } from "../src/lib/individual/professional/vocabulary";
import { individualAppEnabled, INDIVIDUAL_APP_FLAG } from "../src/lib/individual/gate";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key || !anonKey) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "individual-professional-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const FIX = {
  grantor: "harness-ind007-grantor@competen.test",
  pro: "harness-ind007-pro@competen.test",
  other: "harness-ind007-other@competen.test",
  pilot: "harness-ind007-pilot@competen.test",
};
const FIX_PASSWORD = `ind007-${Math.random().toString(36).slice(2)}-Aa1!`;
const PRO_TABLES = ["individual_professional_share", "individual_professional_cpd", "individual_professional_evidence",
  "individual_professional_goal", "individual_professional_need", "individual_professional_profile"];

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
  for (const t of PRO_TABLES) await admin.from(t).delete().eq("user_id", u.id);
  const { data: objs } = await admin.storage.from(DOCUMENT_BUCKET).list(u.id);
  if (objs?.length) await admin.storage.from(DOCUMENT_BUCKET).remove(objs.map((o: any) => `${u.id}/${o.name}`));
  await admin.from("passport_share_tokens").delete().eq("nurse_id", u.id);
  await admin.from("individual_entitlement").delete().eq("user_id", u.id);
  await admin.from("individual_membership").delete().eq("user_id", u.id);
  await admin.from("audit_log").delete().eq("actor_id", u.id);
  await admin.from("profiles").delete().eq("id", u.id);
  await admin.auth.admin.deleteUser(u.id);
}
const cleanup = async () => { for (const e of Object.values(FIX)) await removeUser(e); };

/** The release flag's row before this run, or null when there was none. Restored by restoreFlag(). Staging
 *  only -- assertSafeTarget above has already refused production. */
let priorFlag: { flag: string; enabled: boolean; note: string | null } | null = null;
let flagTouched = false;
async function restoreFlag() {
  if (!flagTouched) return;
  if (priorFlag) await admin.from("practice_platform_flags").upsert(priorFlag);
  else await admin.from("practice_platform_flags").delete().eq("flag", INDIVIDUAL_APP_FLAG);
}

async function makeUser(email: string, name: string, password = FIX_PASSWORD) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  await admin.from("profiles").update({ full_name: name }).eq("id", data.user.id);
  return data.user.id as string;
}

async function grantProfessional(target: string, by: string) {
  const req = validateGrant({ targetUserId: target, experiences: ["professional"], note: "IND-007 acceptance" });
  if (isGrantRefusal(req)) throw new Error(`grant refused: ${req.message}`);
  const out = await grantIndividualAccess(admin, req, by);
  if (!out.ok) throw new Error(`grant failed: ${out.message}`);
}

async function main() {
  console.log(`\nIndividual Professional acceptance harness -- COMPETEN-IND-007 -- target ${ref}\n`);
  const probe = await admin.from("individual_professional_cpd").select("id").limit(1);
  const pilotFile = process.env.IND007_PILOT_CREDENTIALS ?? null;
  if (probe.error && isNotProvisioned(probe.error)) {
    console.log("  PEND  A-M: migration 373 is not applied on this project. No Professional row was created.");
    if (pilotFile) await makePilot(pilotFile);
    console.log("\nPENDING -- 0 passed, 8 groups pending (apply 373, then re-run)");
    process.exit(0);
  }
  if (probe.error) { console.error(`store unreadable: ${probe.error.message}`); process.exit(1); }

  await cleanup();
  // ── R. the release gate (src/lib/individual/gate.ts): saved, OFF phase, ON for the run, restored in Z2 ──
  const flagRead = await admin.from("practice_platform_flags").select("flag, enabled, note").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle();
  if (flagRead.error) { console.error(`release flag unreadable: ${flagRead.error.message}`); process.exit(1); }
  priorFlag = flagRead.data ?? null;
  flagTouched = true;
  await admin.from("practice_platform_flags").upsert({ flag: INDIVIDUAL_APP_FLAG, enabled: false, note: "individual-professional-acceptance-harness: OFF phase" });
  const off = await scanProfessionalReminders(admin);
  ok("R1. gate OFF: the reminder job sends nothing -- Individual does not exist", off.disabled === true && off.sent === 0);
  await admin.from("practice_platform_flags").upsert({ flag: INDIVIDUAL_APP_FLAG, enabled: true, note: "individual-professional-acceptance-harness: ON phase (restored after run)" });
  ok("R2. gate ON for the run", (await individualAppEnabled(admin)) === true);

  const today = new Date().toISOString().slice(0, 10);
  const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const grantor = await makeUser(FIX.grantor, "IND-007 Grantor");
  const pro = await makeUser(FIX.pro, "Harness Professional");
  const other = await makeUser(FIX.other, "Harness Other");
  await grantProfessional(pro, grantor);
  await grantProfessional(other, grantor);
  const ids = [grantor, pro, other];

  // ── A. direct entry and the journey ──
  const a: any = await readIndividualAccess(admin, pro);
  const scholarRows = await admin.from("individual_entitlement").select("id").eq("user_id", pro).eq("experience_code", "scholar");
  ok("A1. direct entry: Professional live with no Scholar row ever written", a.state === "member" && a.live.join() === "professional" && (scholarRows.data ?? []).length === 0, JSON.stringify(a.live));

  const prof = await admin.from("individual_professional_profile").insert({ user_id: pro, experience_code: "professional",
    self_declared_profession: "Registered nurse", self_declared_registration_body: "Harness Council", self_declared_registration_number: "H-1",
    self_declared_registration_country: "Uganda" }).select("id").single();
  const need = await admin.from("individual_professional_need").insert({ user_id: pro, experience_code: "professional", title: "Harness need: resuscitation", origin: "self_identified" }).select("id").single();
  const goal = await admin.from("individual_professional_goal").insert({ user_id: pro, experience_code: "professional", need_id: need.data?.id, title: "Harness goal: ALS", target_date: inDays(90) }).select("id").single();
  const cpdPlain = await admin.from("individual_professional_cpd").insert({ user_id: pro, experience_code: "professional", goal_id: goal.data?.id, activity_type: "course", title: "Harness ALS course", hours: 7.5, activity_date: today, reflection: "Harness private reflection" }).select("id, evidence_class").single();
  const docPath = `${pro}/harness-cert.pdf`;
  await admin.storage.from(DOCUMENT_BUCKET).upload(docPath, Buffer.from("%PDF-1.4 harness"), { contentType: "application/pdf" });
  const cpdDoc = await admin.from("individual_professional_cpd").insert({ user_id: pro, experience_code: "professional", activity_type: "workshop", title: "Harness workshop", hours: 2, activity_date: today,
    document_path: docPath, document_name: "harness-cert.pdf", document_mime: "application/pdf", document_bytes: 16 }).select("id, evidence_class").single();
  const cred = await admin.from("individual_professional_evidence").insert({ user_id: pro, experience_code: "professional", kind: "credential", need_id: need.data?.id, title: "Harness licence", issuing_body: "Harness Council", expires_on: inDays(10) }).select("id, evidence_class").single();
  ok("A2. every journey step writes: profile, need, goal, CPD, evidence", [prof, need, goal, cpdPlain, cpdDoc, cred].every(r => !r.error && r.data), [prof, need, goal, cpdPlain, cpdDoc, cred].map(r => r.error?.message).filter(Boolean).join("; "));

  const record = await loadProfessionalRecord(admin, pro);
  ok("A3. the record reads back by the person's own id", record.provisioned && record.needs?.length === 1 && record.goals?.length === 1 && record.cpd?.length === 2 && record.evidence?.length === 1);
  const passport = await loadIndividualPassport(admin, pro, today);
  const classes = (passport.own ?? []).map(o => `${o.kind}:${o.evidence}`).sort().join(",");
  ok("A4. the Passport shows the own records, each by provenance", classes === "cpd:self_declared,cpd:source_linked,credential:self_declared,registration:self_declared", classes);
  ok("A5. the Passport never carries the private reflection", !JSON.stringify(passport.own).includes("Harness private reflection"));
  const plan = planProgress(record.goals!, today), years = cpdHoursByYear(record.cpd!), cov = evidenceCoverage(record.needs!, record.goals!, record.cpd!, record.evidence!);
  ok("A6. progress: plan measured, hours by year, coverage through the goal and the evidence link",
    plan.completion === 0 && years[0]?.hours === 9.5 && cov.ratio === 1 && cov.needs[0].cpd === 2 && cov.needs[0].evidence === 1, JSON.stringify({ plan, years, cov: cov.needs }));

  // ── B. evidence classes are the database's ──
  ok("B1. no document gives self_declared, a document gives source_linked -- computed by the schema", cpdPlain.data?.evidence_class === "self_declared" && cpdDoc.data?.evidence_class === "source_linked");
  const forced = await admin.from("individual_professional_cpd").insert({ user_id: pro, experience_code: "professional", activity_type: "course", title: "Harness forced", hours: 1, activity_date: today, evidence_class: "independently_verified" });
  ok("B2. ⚠ a writer cannot store a class", !!forced.error, forced.error?.message ?? "insert succeeded");
  const verifiedCol = await admin.from("individual_professional_evidence").insert({ user_id: pro, experience_code: "professional", kind: "credential", title: "Harness verified", verified: true });
  ok("B3. ⚠ nothing can be stored as verified -- there is no such column", !!verifiedCol.error, verifiedCol.error?.message ?? "insert succeeded");
  const noOrigin = await admin.from("individual_professional_need").insert({ user_id: pro, title: "Harness no origin", origin: "self_identified" });
  ok("B4. experience_code has no default: a writer that does not say where a record came from fails", !!noOrigin.error);

  // ── C. cross-person links ──
  const crossGoal = await admin.from("individual_professional_goal").insert({ user_id: other, experience_code: "professional", need_id: need.data?.id, title: "Harness cross goal", target_date: inDays(30) });
  ok("C1. ⚠ a goal cannot point at another person's need (composite foreign key)", !!crossGoal.error, crossGoal.error?.message ?? "insert succeeded");
  const crossDoc = await admin.from("individual_professional_evidence").insert({ user_id: other, experience_code: "professional", kind: "competency", title: "Harness cross doc",
    document_path: docPath, document_name: "x.pdf", document_mime: "application/pdf", document_bytes: 1 });
  ok("C2. ⚠ a row cannot name a document under another person's id", !!crossDoc.error, crossDoc.error?.message ?? "insert succeeded");
  const delNeed = await admin.from("individual_professional_need").insert({ user_id: pro, experience_code: "professional", title: "Harness need to delete", origin: "self_identified" }).select("id").single();
  const linked = await admin.from("individual_professional_goal").insert({ user_id: pro, experience_code: "professional", need_id: delNeed.data?.id, title: "Harness goal survives", target_date: inDays(30) }).select("id").single();
  await admin.from("individual_professional_need").delete().eq("id", delNeed.data?.id);
  const survived = await admin.from("individual_professional_goal").select("need_id, user_id").eq("id", linked.data?.id).single();
  ok("C3. deleting a need keeps its goal and clears only the link (set null on need_id alone)", survived.data?.need_id === null && survived.data?.user_id === pro, JSON.stringify(survived));

  // ── D. RLS ──
  const user = createClient(url!, anonKey!, { auth: { persistSession: false } }) as any;
  const signIn = await user.auth.signInWithPassword({ email: FIX.pro, password: FIX_PASSWORD });
  if (signIn.error) ok("D0. the fixture can sign in for the RLS group", false, signIn.error.message);
  else {
    const own = await user.from("individual_professional_cpd").select("user_id");
    ok("D1. a signed-in person reads their own CPD", (own.data ?? []).length === 2 && own.data.every((r: any) => r.user_id === pro), JSON.stringify(own.error ?? own.data?.length));
    await admin.from("individual_professional_need").insert({ user_id: other, experience_code: "professional", title: "Harness OTHER need", origin: "self_identified" });
    const theirs = await user.from("individual_professional_need").select("id").eq("user_id", other);
    ok("D2. ⚠ cross-user isolation: another person's needs return nothing", (theirs.data ?? []).length === 0);
    const write = await user.from("individual_professional_cpd").insert({ user_id: pro, experience_code: "professional", activity_type: "course", title: "Harness browser write", hours: 1, activity_date: today });
    const upd = await user.from("individual_professional_profile").update({ self_declared_profession: "Harness changed" }).eq("user_id", pro).select("id");
    ok("D3. ⚠ a browser session can write nothing -- no insert, no update", !!write.error && (!!upd.error || (upd.data ?? []).length === 0));
    await user.auth.signOut();
  }

  // ── E. reminders ──
  // No real mail from a harness: with the provider unset, dispatch records the email as skipped. What is under
  // test is who is chosen and the once-only mark, not Resend.
  delete process.env.RESEND_API_KEY;
  const r1 = await scanProfessionalReminders(admin);
  const marked = await admin.from("individual_professional_evidence").select("expiry_reminded_for, expires_on").eq("id", cred.data?.id).single();
  const r2 = await scanProfessionalReminders(admin);
  ok("E1. an expiring credential is reminded once, recorded on the person's own row", r1.sent >= 1 && marked.data?.expiry_reminded_for === marked.data?.expires_on, JSON.stringify({ r1, marked: marked.data }));
  const again = await admin.from("individual_professional_evidence").select("expiry_reminded_for").eq("id", cred.data?.id).single();
  ok("E2. a second run does not remind the same date again", again.data?.expiry_reminded_for === marked.data?.expires_on && r2.sent === 0, JSON.stringify(r2));
  const badMark = await admin.from("individual_professional_evidence").update({ expiry_reminded_for: inDays(400) }).eq("id", cred.data?.id);
  ok("E3. ⚠ a reminder mark can only name the expiry date it was for", !!badMark.error);

  // ── F. share ──
  const link = await mintShare(admin, pro, { scope: "full", label: "Harness link", days: 7 });
  ok("F1. a Professional link is minted on passport_share_tokens with no hospital stamp", !!link && (await admin.from("passport_share_tokens").select("hospital_id").eq("id", link!.id).single()).data?.hospital_id === null);
  ok("F2. the Professional link carries the person's own records", !!link && await shareCarriesOwnRecords(admin, link!.id, pro));
  const estate = await admin.from("passport_share_tokens").insert({ token: `harness-ind007-${Date.now()}`, nurse_id: pro, scope: "full", consent: true, revoked: false }).select("id").single();
  ok("F3. ⚠ an estate-minted link for the same person does NOT carry them", !!estate.data && !(await shareCarriesOwnRecords(admin, estate.data.id, pro)));
  const listed = await listShares(admin, pro);
  ok("F4. the person's Professional links list excludes the estate link", (listed ?? []).length === 1 && listed![0].id === link?.id);
  ok("F5. ⚠ another person cannot revoke it", !(await revokeShare(admin, other, link!.id)));
  ok("F6. the person can revoke it", await revokeShare(admin, pro, link!.id));

  // ── G. shared frameworks only ──
  const fws = await loadSharedFrameworks(admin);
  const fwIds = (fws ?? []).map(f => f.id);
  const leak = fwIds.length ? await admin.from("frameworks").select("id").in("id", fwIds).not("hospital_id", "is", null) : { data: [] };
  ok("G1. the framework list holds shared frameworks only", fws !== null && (leak.data ?? []).length === 0, `${fwIds.length} shared`);
  const hospFw = await admin.from("frameworks").select("id").not("hospital_id", "is", null).limit(1).maybeSingle();
  if (hospFw.data) ok("G2. ⚠ a hospital framework is refused as a reference", (await checkSharedReference(admin, hospFw.data.id, null)) !== null);
  else console.log("  PEND  G2. staging has no hospital-owned framework to refuse");

  // ── M. employer visibility ──
  const estateTables: [string, string][] = [["cpd_logs", "user_id"], ["professional_credentials", "nurse_id"], ["evidence", "owner_id"], ["cdp_reminders", "recipient_id"], ["notifications", "user_id"]];
  const counts = await Promise.all(estateTables.map(([t, c]) => admin.from(t).select("*", { count: "exact", head: true }).in(c, ids)));
  const written = estateTables.filter((_, i) => !counts[i].error && (counts[i].count ?? 0) > 0).map(([t]) => t);
  const unread = estateTables.filter((_, i) => !!counts[i].error).map(([t]) => t);
  ok("M1. D1: no fixture row in cpd_logs, professional_credentials, evidence, cdp_reminders or notifications", written.length === 0 && unread.length === 0, `written: ${written.join(",")} unreadable: ${unread.join(",")}`);

  await admin.from("passport_share_tokens").delete().eq("id", estate.data?.id);
  await cleanup();
  const left = await Promise.all(PRO_TABLES.map(t => admin.from(t).select("*", { count: "exact", head: true }).in("user_id", ids)));
  ok("Z1. fixtures removed -- no Professional row left for any fixture", left.every(r => !r.error && (r.count ?? 0) === 0));
  await restoreFlag();
  const flagAfter = await admin.from("practice_platform_flags").select("enabled").eq("flag", INDIVIDUAL_APP_FLAG).maybeSingle();
  ok("Z2. the release flag is restored to its state before the run",
    priorFlag ? flagAfter.data?.enabled === priorFlag.enabled : flagAfter.data === null);

  if (pilotFile) await makePilot(pilotFile);
  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
}

/** The walk-through identity: Professional only, through the grant service. Password to a file only. */
async function makePilot(file: string) {
  await removeUser(FIX.pilot);
  let grantor = (await findUser(FIX.grantor))?.id as string | undefined;
  if (!grantor) grantor = await makeUser(FIX.grantor, "IND-007 Grantor", `ind007-${Math.random().toString(36).slice(2)}-Aa1!`);
  const password = `ind007-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}-Aa1!`;
  const pilot = await makeUser(FIX.pilot, "Amara Okello", password);
  await grantProfessional(pilot, grantor);
  writeFileSync(file, `${FIX.pilot}\n${password}\n`);
  console.log(`  pilot: ${FIX.pilot} created, Professional only. Password written to the IND007_PILOT_CREDENTIALS file.`);
}

main().catch(async e => { console.error(e); try { await cleanup(); await restoreFlag(); } catch { /* best effort */ } process.exit(1); });
