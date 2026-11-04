/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LEARNING-CLOSE-2026-11 CE-04 / CE-05: THE SYNTHETIC DEMONSTRATION CASE ON STAGING, THROUGH THE REAL GOVERNANCE PATH -- STAGING ONLY.
 *
 *   npx tsx scripts/staging-seed-ce0405-demo.ts --status     read only: is the demo case there, in what state, and the switches
 *   npx tsx scripts/staging-seed-ce0405-demo.ts --publish    create it in Case Studio, submit, independent review, publish
 *   npx tsx scripts/staging-seed-ce0405-demo.ts --retire     retire it and remove the three synthetic staff identities
 *
 * ⚠ STAGING ONLY. It refuses unless STAGING_SUPABASE_URL is a confirmed non-production project (production-guard). It never reads
 * NEXT_PUBLIC_SUPABASE_URL, so a production-pointed .env cannot make it write there.
 * ⚠ A STAGING EXERCISE, NOT A CLINICAL APPROVAL. CE0405_DEMO (src/lib/cases/fixtures.ts) is SYNTHETIC and NOT clinically reviewed.
 * Three synthetic staff identities (ce0405-educator / -reviewer / -publisher @competen.test) take it through the SAME path a real
 * case takes: Case Studio draft by the educator (createCase, saveDraft, submitCase), approval by a DIFFERENT, in-scope reviewer
 * (decideReview: the database refuses the author), publication by a publisher (publishCase: the database refuses an unapproved
 * version). The review comment says "staging exercise". Retire it after the walk (--retire). It is never library content.
 * ⚠ The case library switch (practice_platform_flags case_library) must be ON on staging for a learner to find it; --status says.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { appointmentAuthority, fixtureOwnerId } from "./_hq-fixture-authority";
import { HQ_OFFICE_TYPE_PREFIX } from "../src/lib/hq/spaces";
import { createCase, publishCase, retireCase, saveDraft, submitCase } from "../src/lib/cases/studio";
import { decideReview } from "../src/lib/competency/clinical-review";
import { CASE_LIBRARY_FLAG } from "../src/lib/cases/policy";
import { CE0405_DEMO, CE0405_DEMO_CODE } from "../src/lib/cases/fixtures";
import { validateBlueprint, type Blueprint } from "../src/lib/cases/blueprint";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const EMAILS = { edu: "ce0405-educator@competen.test", rev: "ce0405-reviewer@competen.test", pub: "ce0405-publisher@competen.test" };

async function findUser(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === email);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
async function person(email: string, name: string): Promise<string> {
  const had = await findUser(email);
  if (had) return had.id;
  const { data, error } = await admin.auth.admin.createUser({ email, password: `ce0405-${Math.random().toString(36).slice(2)}-Aa1!`, email_confirm: true, user_metadata: { full_name: name, synthetic: true } });
  if (error || !data?.user) throw new Error(`createUser ${email}: ${error?.message}`);
  await admin.from("profiles").update({ full_name: name }).eq("id", data.user.id);
  return data.user.id;
}

async function status() {
  const { data: c } = await admin.from("case_library_case").select("id, code, status").eq("code", CE0405_DEMO_CODE).maybeSingle();
  const vs = c ? (await admin.from("case_library_version").select("id, version_no, state").eq("case_id", c.id).order("version_no")).data ?? [] : [];
  const flag = (await admin.from("practice_platform_flags").select("enabled").eq("flag", CASE_LIBRARY_FLAG).maybeSingle()).data;
  console.log(`${CE0405_DEMO_CODE}: ${c ? `${c.status} (case ${c.id}) ${vs.map((v: any) => `v${v.version_no} ${v.state} ${v.id}`).join(", ")}` : "absent"} on ${verdict.ok ? verdict.ref : "?"}`);
  console.log(`case_library switch: ${flag?.enabled === true ? "ON" : "OFF"}`);
  return { c, vs };
}

async function publish() {
  const { c } = await status();
  if (c) { console.log("It exists already: nothing created."); return; }
  const owner = await fixtureOwnerId(admin);
  const office = (await admin.from("ogs_offices").select("id, office_type, is_active, status").like("office_type", `${HQ_OFFICE_TYPE_PREFIX}%`).limit(50)).data
    ?.find((o: any) => o.is_active !== false && o.status !== "dissolved" && o.status !== "archived");
  const fw = (await admin.from("frameworks").select("id").eq("code", "CF-FOUND").is("hospital_id", null).maybeSingle()).data;
  const comp = fw ? (await admin.from("framework_competencies").select("id, framework_domains!inner(framework_id)").eq("framework_domains.framework_id", fw.id).eq("code", "CF-PS-001").maybeSingle()).data : null;
  if (!owner || !office || !fw || !comp) throw new Error("staging needs a platform owner, an active HQ office and CF-FOUND's CF-PS-001");
  const content: Blueprint = { ...CE0405_DEMO, learningObjectives: CE0405_DEMO.learningObjectives.map(l => ({ ...l, competencyIds: [comp.id] })) };
  const problems = validateBlueprint(content, "library");
  if (problems.length) throw new Error(`the demo case is not a sound library case: ${problems.join("; ")}`);
  const [edu, rev, pub] = [await person(EMAILS.edu, "CE0405 Educator (synthetic)"), await person(EMAILS.rev, "CE0405 Reviewer (synthetic, staging exercise)"), await person(EMAILS.pub, "CE0405 Publisher (synthetic)")];
  const appoint = async (p: string, role: string) => (await admin.from("ogs_office_appointments").insert({ ...appointmentAuthority(owner), office_id: office.id, person_id: p, role, status: "active" }).select("id").single()).data?.id as string;
  await appoint(edu, "clinical_case_educator"); await appoint(pub, "quality_council_member");
  const revAppt = await appoint(rev, "clinical_content_reviewer");
  await admin.from("clinical_reviewer_scope").insert({ granted_by: owner, appointment_id: revAppt, scope_kind: "framework", scope_ref: fw.id });
  const made = await createCase(admin, edu, { code: CE0405_DEMO_CODE, title: content.title, content });
  if (!made.ok) throw new Error(`createCase: ${made.error}`);
  const saved = await saveDraft(admin, edu, made.versionId, content);
  if (!saved.ok || saved.problems.length) throw new Error(`saveDraft: ${JSON.stringify(saved)}`);
  const sub = await submitCase(admin, edu, made.versionId);
  if (!sub.ok) throw new Error(`submitCase: ${JSON.stringify(sub)}`);
  const early = await publishCase(admin, pub, made.versionId);
  console.log(`publish before approval refused: ${!early.ok}`);
  const approved = await decideReview(admin, sub.reviewVersionId, rev, revAppt, "approved", "staging exercise (CE-04/CE-05 walk): synthetic case, not a clinical approval");
  if (!approved.ok) throw new Error(`decideReview: ${approved.error}`);
  const published = await publishCase(admin, pub, made.versionId);
  if (!published.ok) throw new Error(`publishCase: ${published.error}`);
  const deliverable = (await admin.rpc("case_library_deliverable", { p_version: made.versionId })).data;
  console.log(`PUBLISHED (staging exercise): case ${made.caseId}, version ${made.versionId}, deliverable=${deliverable}`);
}

async function retire() {
  const { c } = await status();
  if (c && c.status !== "retired") { const r = await retireCase(admin, c.id); console.log(`retire: ${r.ok ? "ok" : (r as any).error}`); }
  for (const e of Object.values(EMAILS)) {
    const u = await findUser(e);
    if (!u) continue;
    await admin.from("ogs_office_appointments").update({ status: "removed", ...appointmentAuthority(await fixtureOwnerId(admin)) }).eq("person_id", u.id).eq("status", "active");
    console.log(`ended the appointments of ${e} (the identity is kept: it authored a kept, retired version)`);
  }
}

const mode = process.argv.includes("--publish") ? publish : process.argv.includes("--retire") ? retire : status;
mode().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
