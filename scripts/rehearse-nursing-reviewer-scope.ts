/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * REHEARSAL (STAGING ONLY) of the first Nursing clinical content reviewer's appointment and scope, as prepared in
 * docs/evidence/CLINICAL/first-nursing-reviewer-appointment.md. Owner direction 2026-10-24: prepare only, with a
 * synthetic, clearly labelled reviewer on staging, removed afterwards. NO real person is appointed, and NO
 * decision is recorded: nothing is approved or rejected.
 *
 *   npx tsx scripts/rehearse-nursing-reviewer-scope.ts
 *
 * What it proves, against the real 395 triggers and clinical_scope_covers:
 *   R1  the clinical_content_reviewer position grants hq.quality.clinical.approve (and home.view), nothing else
 *   R2  a Nursing PROFESSION scope covers a Nursing-profession framework (NUR-RESP) but NOT CF-FOUND, whose
 *       profession is null (foundational, cross-professional)
 *   R3  adding the CF-FOUND FRAMEWORK scope covers every CF-FOUND competency
 *   R4  a scope must name a record of its kind (a framework id given as a profession is refused)
 *   R5  an ended scope stops covering
 *   Z1  everything it made is gone, and the reviewer recorded no decision
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { HQ_OFFICE_TYPE_PREFIX } from "../src/lib/hq/spaces";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const EMAIL = "rehearsal-nursing-reviewer@competen.test";
const NAME = "REHEARSAL Nursing reviewer (synthetic, IND-007, removed after)";
let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };

async function findUser() {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = (data?.users ?? []).find((u: any) => u.email === EMAIL);
    if (hit) return hit;
    if ((data?.users ?? []).length < 200) return null;
  }
  return null;
}
async function cleanup() {
  const u = await findUser();
  if (!u) return;
  // Scopes go with the appointment (on delete cascade through the 395 guard's cascade path).
  await admin.from("ogs_office_appointments").delete().eq("person_id", u.id);
  await admin.from("profiles").delete().eq("id", u.id);
  await admin.auth.admin.deleteUser(u.id);
}
const covers = async (appointment: string, competency: string) => {
  const r = await admin.rpc("clinical_scope_covers", { p_appointment: appointment, p_competency: competency });
  if (r.error) throw new Error(`clinical_scope_covers: ${r.error.message}`);
  return r.data === true;
};
const firstCompetency = async (frameworkId: string) => {
  const doms = (await admin.from("framework_domains").select("id").eq("framework_id", frameworkId)).data ?? [];
  return ((await admin.from("framework_competencies").select("id, code").in("domain_id", doms.map((d: any) => d.id)).order("code")).data ?? []) as { id: string; code: string }[];
};

async function main() {
  console.log(`NURSING REVIEWER SCOPE REHEARSAL -- target ${(verdict as any).ref}\n`);
  const nursing = (await admin.from("taxonomy_terms").select("id, value, taxonomies!inner(kind)").eq("value", "Nursing").eq("taxonomies.kind", "profession").maybeSingle()).data;
  const fws = (await admin.from("frameworks").select("id, code, profession_term_id").is("hospital_id", null).in("code", ["CF-FOUND", "NUR-RESP"])).data ?? [];
  const cf = fws.find((f: any) => f.code === "CF-FOUND"), nr = fws.find((f: any) => f.code === "NUR-RESP");
  const office = ((await admin.from("ogs_offices").select("id, office_type, is_active, status").eq("office_type", `${HQ_OFFICE_TYPE_PREFIX}quality`)).data ?? [])
    .find((o: any) => o.is_active !== false && o.status !== "dissolved" && o.status !== "archived");
  if (!nursing || !cf || !nr || !office) { console.error(`Missing on this environment: ${[!nursing && "Nursing profession term", !cf && "CF-FOUND", !nr && "NUR-RESP", !office && "the HQ Quality office"].filter(Boolean).join(", ")}. Nothing created.`); process.exit(1); }
  const cfComps = await firstCompetency(cf.id), nrComps = await firstCompetency(nr.id);
  await cleanup();
  try {
    const grants = ((await admin.from("hq_position_capability").select("capability_code").eq("position_code", "clinical_content_reviewer").is("effective_to", null)).data ?? []).map((g: any) => g.capability_code).sort();
    ok("R1. the Clinical Content Reviewer position grants clinical approval and the HQ home, nothing else",
      JSON.stringify(grants) === JSON.stringify(["hq.platform.home.view", "hq.quality.clinical.approve"]), JSON.stringify(grants));

    const { data: u, error } = await admin.auth.admin.createUser({ email: EMAIL, password: `rh-${Math.random().toString(36).slice(2)}-Aa1!`, email_confirm: true, user_metadata: { full_name: NAME, synthetic: true } });
    if (error || !u?.user) throw new Error(`createUser: ${error?.message}`);
    await admin.from("profiles").update({ full_name: NAME }).eq("id", u.user.id);
    const appt = await admin.from("ogs_office_appointments").insert({ office_id: office.id, person_id: u.user.id, person_name: NAME, role: "clinical_content_reviewer", status: "active" }).select("id").single();
    if (appt.error) throw new Error(`appointment: ${appt.error.message}`);
    const a = appt.data.id as string;

    const prof = await admin.from("clinical_reviewer_scope").insert({ appointment_id: a, scope_kind: "profession", scope_ref: nursing.id }).select("id").single();
    if (prof.error) throw new Error(`profession scope: ${prof.error.message}`);
    const cfByProfession = await Promise.all(cfComps.map(c => covers(a, c.id)));
    const nrByProfession = await covers(a, nrComps[0].id);
    ok("R2. a Nursing profession scope covers a Nursing framework (NUR-RESP) and NONE of CF-FOUND (its profession is null)",
      nrByProfession && cfByProfession.every(x => !x), JSON.stringify({ nurResp: nrByProfession, cfFound: cfByProfession }));

    const fwScope = await admin.from("clinical_reviewer_scope").insert({ appointment_id: a, scope_kind: "framework", scope_ref: cf.id }).select("id").single();
    if (fwScope.error) throw new Error(`framework scope: ${fwScope.error.message}`);
    const cfByFramework = await Promise.all(cfComps.map(c => covers(a, c.id)));
    ok(`R3. adding the CF-FOUND framework scope covers all ${cfComps.length} CF-FOUND competencies`, cfComps.length > 0 && cfByFramework.every(Boolean), JSON.stringify(cfByFramework));

    const wrong = await admin.from("clinical_reviewer_scope").insert({ appointment_id: a, scope_kind: "profession", scope_ref: cf.id }).select("id");
    ok("R4. a scope must name a record of its kind: a framework id given as a profession is refused", !!wrong.error, wrong.error?.message ?? "accepted");

    await admin.from("clinical_reviewer_scope").update({ ended_at: new Date().toISOString() }).eq("id", fwScope.data.id);
    const afterEnd = await covers(a, cfComps[0].id);
    ok("R5. an ended scope stops covering", !afterEnd);

    const decisions = (await admin.from("clinical_review_decision").select("id").eq("reviewer_id", u.user.id)).data ?? [];
    ok("R6. the rehearsal recorded no review decision", decisions.length === 0, `${decisions.length} decisions`);
  } finally {
    await cleanup();
  }
  const left = await findUser();
  const scopesLeft = (await admin.from("clinical_reviewer_scope").select("id").eq("scope_ref", cf.id).is("ended_at", null)).data ?? [];
  ok("Z1. the synthetic reviewer, its appointment and its scopes are gone", !left && scopesLeft.length === 0, JSON.stringify({ user: !!left, openCfScopes: scopesLeft.length }));
}

main().then(() => {
  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  process.exit(fails.length ? 1 : 0);
}, async e => { console.error(e.message ?? e); try { await cleanup(); } catch { /* best effort */ } process.exit(1); });
