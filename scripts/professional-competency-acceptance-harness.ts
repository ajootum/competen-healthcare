/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PROFESSIONAL COMPETENCIES ACCEPTANCE -- COMPETEN-PROFESSIONAL-COMPETENCY-01 Stage 5, owner GO s15 items 1-16, STAGING ONLY.
 *
 * The focused journey through the library the routes call (the same parsers, store, policy and share code), against
 * migration 520 on staging, for a competency close to ECG interpretation or respiratory assessment where the staging
 * catalogue offers one (else the first offered). Items 17-22 are the Verification Studio's (C5, COMPETEN-IND-007).
 *   1 open My Competencies   2 explore a published competency   3 its outcomes and expected proficiency
 *   4 self-assess   5 confidence and a private reflection   6 link existing CPD   7 map to learning outcomes
 *   8 add supporting evidence without duplication   9 self-assessment and evidence apart   10 a need and a goal from it
 *   11 earlier self-assessments   12 earlier records kept after reassessment   13 no published catalogue   14 no AI
 *   15 choose evidence for a Passport link   16 private information stays private
 *
 * ⚠ The CPD entry and the evidence item are FIXTURES written the way their own writers write them. STAGING ONLY
 * (assertSafeTarget). PEND until 520 is applied. Own harness-prof05-* identity, deleted after. Writes three policy rows
 * for steps 13 and 14 and restores them exactly.
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only professional-competency-acceptance
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertSafeTarget } from "./production-guard";
import { grantIndividualAccess, validateGrant, isGrantRefusal } from "../src/lib/individual/grants";
import { loadIndividualPolicy } from "../src/lib/individual/policy";
import { loadCatalogueFor } from "../src/lib/individual/catalogue";
import { loadIndividualPassport } from "../src/lib/individual/passport";
import { loadProfessionalRecord } from "../src/lib/individual/professional/record";
import { professionalContext } from "../src/lib/individual/professional/assistant";
import { profileContext } from "../src/lib/individual/professional/profile-ai";
import { loadProfessionalProfile } from "../src/lib/individual/professional/profile-store";
import { createNeed, linkCompetency, saveReflection } from "../src/lib/individual/professional/needs-store";
import { createGoal, linkPlanCompetency } from "../src/lib/individual/professional/plan-store";
import { parseEntry, parseEvidenceLink, parseEvidenceType, parseSelfAssessment } from "../src/lib/individual/professional/competency-form";
import { addEntry, addSelfAssessment, evidenceForVerification, linkEvidence, loadCompetencyWorkspace, loadPortfolio, loadScaleLevels, unlinkEvidence } from "../src/lib/individual/professional/competency-store";
import { checkShareCompetencies, loadSharedCompetencies, parseShareCompetencies } from "../src/lib/individual/professional/share-competency";
import { mintShare, parseShare } from "../src/lib/individual/professional/share";
import { loadSharedProfile } from "../src/lib/individual/professional/share-profile";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "professional-competency-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); } };
const EMAIL = "harness-prof05-competency@competen.test";
const SCOPE = { scope_type: "platform", scope_ref: "individual" };
const ROWS = ["individual.policy.professional_catalogues", "individual.policy.professional_competency_ai", "individual.policy.professional_competency_share_parts"];
const today = new Date().toISOString().slice(0, 10);
const SA_REFLECTION = "I hesitate on broad complex rhythms at night.";
const PRIVATE_REFLECTION = "Private: the arrest on ward 4 still worries me.";

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
  const { data: links } = await admin.from("individual_professional_share").select("share_token_id").eq("user_id", u.id);
  await admin.from("individual_professional_share").delete().eq("user_id", u.id);
  if (links?.length) await admin.from("passport_share_tokens").delete().in("id", links.map((l: any) => l.share_token_id));
  // 520's trails, assessments and links are deleted only by cascade: remove their parents.
  await admin.from("individual_professional_my_competency").delete().eq("user_id", u.id);
  await admin.from("individual_professional_goal_need").delete().eq("user_id", u.id);
  await admin.from("individual_professional_goal").delete().eq("user_id", u.id);
  await admin.from("individual_professional_need").delete().eq("user_id", u.id);
  for (const t of ["individual_professional_cpd", "individual_professional_evidence", "individual_professional_reflection", "individual_professional_profile_item",
    "individual_professional_profile_context", "individual_professional_profile", "individual_entitlement", "individual_membership"]) await admin.from(t).delete().eq("user_id", u.id);
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
const publish = (path: string, settings: unknown) => admin.from("workspace_config_overrides").upsert({ ...SCOPE, config_path: path, draft: settings, published: settings }, { onConflict: "scope_type,scope_ref,config_path" });
const cp = async () => (await loadIndividualPolicy(admin)).professionalCompetency;
const must = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => { if (!r.ok) throw new Error(r.error); return r.value; };

async function main() {
  console.log(`PROFESSIONAL COMPETENCIES ACCEPTANCE (Stage 5, items 1-16) against ${ref}\n`);
  const probe = await admin.from("individual_professional_self_assessment").select("id").limit(0);
  if (probe.error) { console.log(`PEND -- migration 520 is not applied here (${probe.error.code}). Nothing created.`); return; }
  prior = (await admin.from("workspace_config_overrides").select("*").eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).in("config_path", ROWS)).data ?? [];
  await cleanup();
  try {
    const { data: created } = await admin.auth.admin.createUser({ email: EMAIL, password: `p5-${Math.random().toString(36).slice(2)}-Aa1!`, email_confirm: true, user_metadata: { full_name: "Harness Competency Learner" } });
    const me = created.user.id as string;
    await admin.from("profiles").update({ full_name: "Harness Competency Learner", role: null }).eq("id", me);
    const g = validateGrant({ targetUserId: me, experiences: ["professional"], note: "PROF-COMPETENCY-01 acceptance" });
    if (isGrantRefusal(g)) throw new Error(g.message);
    await grantIndividualAccess(admin, g, me);
    await admin.from("individual_professional_profile").insert({ user_id: me, experience_code: "professional", self_declared_profession: "Clinician", registration_completed_at: new Date().toISOString() });

    // 1
    const ws0 = await loadCompetencyWorkspace(admin, me);
    ok("1. My Competencies opens, provisioned and empty", ws0.provisioned && ws0.entries?.length === 0);

    // 2-3
    const offered = await loadCatalogueFor(admin, "professional");
    const c = offered?.find(o => /ecg|electrocardio|respirat/i.test(o.title)) ?? offered?.find(o => /deteriorat|clinical information/i.test(o.title)) ?? offered?.[0] ?? null;
    ok("2. a published competency is explored from an offered catalogue, its content status stated", !!c && ["approved", "draft", "unreviewed"].includes(c.contentStatus), c ? `${c.title} (${c.catalogue.name}, ${c.contentStatus})` : "no catalogue offered on staging");
    if (!c) throw new Error("staging offers no catalogue competency: items 2-12 need one");
    const levels = await loadScaleLevels(admin, c.expectedLevel?.id ?? null);
    ok("3. its learning outcomes and expected proficiency are read, and the CFCA scale offers levels", Array.isArray(c.outcomes) && !!levels?.length,
      `${c.outcomes.length} outcome(s), expected ${c.expectedLevel?.label ?? "not set"}, scale levels ${levels?.length ?? "unreadable"}`);

    // 4-5
    const entry = await addEntry(admin, me, must(parseEntry({ competencyId: c.competencyId }, await cp(), offered!)));
    const entryId = entry.ok ? entry.id! : "";
    const ctx = { levels: levels!, outcomes: c.outcomes, frameworkVersion: (await loadCompetencyWorkspace(admin, me)).entries?.[0]?.framework_version ?? null, policy: await cp() };
    const sa1 = await addSelfAssessment(admin, me, entryId, must(parseSelfAssessment({ levelId: levels![0].id, outcome: c.outcomes[0] ?? "", confidence: "unsure", reflection: SA_REFLECTION }, ctx)));
    const ws4 = await loadCompetencyWorkspace(admin, me);
    const a1 = ws4.assessments?.[0];
    ok("4. a self-assessment is recorded on the CFCA scale, against an outcome where the catalogue has one, as self-reported",
      entry.ok && sa1.ok && a1?.basis === "self_reported" && a1.level_label === levels![0].label && (c.outcomes.length ? a1.learning_outcome === c.outcomes[0] : true) && !!ws4.entries?.[0]?.framework_version);
    ok("5. confidence and an optional private reflection are kept with it", a1?.confidence_label === "Not sure yet" && a1.reflection === SA_REFLECTION);

    // 6-8
    const cpd = await admin.from("individual_professional_cpd").insert({ user_id: me, experience_code: "professional", activity_type: "course", title: `${c.title} workshop`, hours: 2, activity_date: today }).select("id").single();
    const ev = await admin.from("individual_professional_evidence").insert({ user_id: me, experience_code: "professional", kind: "competency", title: "Observed reading of a 12-lead", issued_on: today }).select("id").single();
    await admin.from("individual_professional_evidence").update(must(parseEvidenceType({ evidenceType: "observation", author: "A senior colleague" }, await cp()))).eq("id", ev.data.id).eq("user_id", me);
    const e0 = { id: entryId, framework_version: ctx.frameworkVersion };
    const l1 = await linkEvidence(admin, me, e0, must(parseEvidenceLink({ kind: "cpd", sourceId: cpd.data.id, relation: "knowledge" }, { outcomes: c.outcomes, policy: await cp() })));
    ok("6. an existing CPD entry is linked as evidence, referenced and not copied", l1.ok);
    const o1 = c.outcomes[0] ?? null, o2 = c.outcomes[1] ?? c.outcomes[0] ?? null;
    const l2 = await linkEvidence(admin, me, e0, must(parseEvidenceLink({ kind: "cpd", sourceId: cpd.data.id, outcome: o1 ?? "", relation: "application" }, { outcomes: c.outcomes, policy: await cp() })));
    const l3 = await linkEvidence(admin, me, e0, must(parseEvidenceLink({ kind: "evidence", sourceId: ev.data.id, outcome: o2 ?? "", relation: "practical" }, { outcomes: c.outcomes, policy: await cp() })));
    const ws7 = await loadCompetencyWorkspace(admin, me);
    ok("7. evidence is mapped to learning outcomes, many to many: one CPD entry to the whole and to an outcome, an observation to another",
      l2.ok && l3.ok && (ws7.links ?? []).filter(l => l.cpd_id === cpd.data.id).length === 2 && (ws7.links ?? []).every(l => l.framework_version === ctx.frameworkVersion),
      `${c.outcomes.length} outcomes on the competency`);
    const dup = await linkEvidence(admin, me, e0, must(parseEvidenceLink({ kind: "cpd", sourceId: cpd.data.id, relation: "knowledge" }, { outcomes: c.outcomes, policy: await cp() })));
    const port = await loadPortfolio(admin, me, today);
    const cpdInPortfolio = port.items.filter(i => i.kind === "cpd" && i.id === cpd.data.id).length;
    const evItem = port.items.find(i => i.kind === "evidence" && i.id === ev.data.id);
    const copies = (await admin.from("individual_professional_cpd").select("id").eq("user_id", me)).data?.length;
    ok("8. supporting evidence is added in the existing evidence record, typed; nothing is duplicated (the CPD entry appears once, a repeat link is refused)",
      !dup.ok && dup.status === 409 && cpdInPortfolio === 1 && copies === 1 && evItem?.typeLabel === "Practical observation" && evItem.issuer === "A senior colleague");

    // 9
    const sa = (ws7.assessments ?? [])[0], links = ws7.links ?? [];
    ok("9. self-assessment and evidence are separate records: the assessment names no evidence, each link keeps its own record's class",
      !!sa && !Object.keys(sa).some(k => /evidence|cpd|link/.test(k)) && links.length === 3
      && port.items.find(i => i.id === cpd.data.id)?.classText === "Self-declared");

    // 10
    const need = await createNeed(admin, me, { title: `Develop: ${c.title}`.slice(0, 200), origin: "competency_exploration" }, {});
    const nl = need.ok ? await linkCompetency(admin, me, need.id!, c.competencyId, offered!, null) : { ok: false };
    const goal = await createGoal(admin, me, { title: `Develop: ${c.title}`.slice(0, 200) }, { createdFrom: "competency", needId: null, competencyId: c.competencyId, offeringId: null, aspirationItemId: null, reflectionId: null });
    const gl = goal.ok ? await linkPlanCompetency(admin, me, { goalId: goal.id! }, c.competencyId, offered!, null) : { ok: false };
    const goalRow = goal.ok ? (await admin.from("individual_professional_goal").select("created_from").eq("id", goal.id).single()).data : null;
    ok("10. a development need and a goal are created from the competency, each linked to it", need.ok && nl.ok && goal.ok && gl.ok && goalRow?.created_from === "competency");

    // 11-12
    const sa2 = await addSelfAssessment(admin, me, entryId, must(parseSelfAssessment({ levelId: levels![levels!.length - 1].id, confidence: "fairly-sure" }, ctx)));
    const ws11 = await loadCompetencyWorkspace(admin, me);
    ok("11. earlier self-assessments are reviewable, newest first", sa2.ok && (ws11.assessments ?? []).length === 2 && ws11.assessments![1].reflection === SA_REFLECTION);
    const rewrite = await admin.from("individual_professional_self_assessment").update({ level_label: "Expert" }).eq("my_competency_id", entryId);
    const del = await admin.from("individual_professional_self_assessment").delete().eq("my_competency_id", entryId);
    const un = await unlinkEvidence(admin, me, (ws11.links ?? []).find(l => l.evidence_id)!.id);
    const relink = await admin.from("individual_professional_competency_evidence").update({ learning_outcome: "forged" }).eq("my_competency_id", entryId);
    const ws12 = await loadCompetencyWorkspace(admin, me);
    ok("12. after reassessment every earlier record is kept: assessments cannot be rewritten or deleted, an unlinked link stays as history, history rows exist",
      !!rewrite.error && !!del.error && un.ok && !!relink.error && (ws12.assessments ?? []).length === 2 && (ws12.links ?? []).some(l => l.unlinked_at) && (ws12.history ?? []).length >= 1);

    // 13
    await publish(ROWS[0], { ids: [] });
    const none = await loadCatalogueFor(admin, "professional");
    const own = await addEntry(admin, me, must(parseEntry({ title: "Respiratory assessment", category: "quality" }, await cp(), [])));
    const ownLevels = await loadScaleLevels(admin, null);
    const ownSa = own.ok && ownLevels?.length ? await addSelfAssessment(admin, me, own.id!, must(parseSelfAssessment({ levelId: ownLevels[0].id }, { levels: ownLevels, outcomes: [], frameworkVersion: null, policy: await cp() }))) : { ok: false };
    const ownLink = own.ok ? await linkEvidence(admin, me, { id: own.id!, framework_version: null }, must(parseEvidenceLink({ kind: "evidence", sourceId: ev.data.id, relation: "experience" }, { outcomes: [], policy: await cp() }))) : { ok: false };
    const refusedCat = !parseEntry({ competencyId: c.competencyId }, await cp(), none ?? []).ok;
    const ownC5 = own.ok ? await evidenceForVerification(admin, me, own.id!) : "x";
    ok("13. with no published catalogue the portfolio still works: a competency in own words, self-assessed on the default scale, evidenced; never verifiable",
      Array.isArray(none) && none.length === 0 && own.ok && ownSa.ok && ownLink.ok && refusedCat && ownC5 === null);

    // 14
    await publish(ROWS[1], { value: "off" });
    const aiOff = (await cp()).ai;
    const again = await addSelfAssessment(admin, me, own.ok ? own.id! : entryId, must(parseSelfAssessment({ levelId: ownLevels![0].id }, { levels: ownLevels!, outcomes: [], frameworkVersion: null, policy: await cp() })));
    ok("14. with AI off, the core experience works: entries, self-assessment, evidence and mapping", aiOff === "off" && again.ok);

    // 15-16
    const refl = await saveReflection(admin, me, null, { body: PRIVATE_REFLECTION, template_code: null, template_label: null });
    const reflLink = await linkEvidence(admin, me, e0, must(parseEvidenceLink({ kind: "reflection", sourceId: (refl as any).id, relation: "experience" }, { outcomes: c.outcomes, policy: await cp() })));
    const choices = parseShareCompetencies({ [`competency:${entryId}:self_assessment`]: "true", [`competency:${entryId}:evidence`]: "true" });
    const check = await checkShareCompetencies(admin, me, choices, (await cp()).shareParts);
    await publish(ROWS[2], { enabled: ["evidence"] });
    const narrowed = await checkShareCompetencies(admin, me, choices, (await cp()).shareParts);
    await publish(ROWS[2], { enabled: ["self_assessment", "evidence", "assessed_outcomes"] });
    const link = await mintShare(admin, me, parseShare({ scope: "full", days: 7 }), { overview: false, itemIds: [] }, [], choices);
    const shared = link ? await loadSharedCompetencies(admin, link.id, me, (await cp()).shareParts, today) : null;
    const s0 = shared?.[0];
    ok("15. evidence and a self-assessment are chosen for one Passport link, part by part; the configuration can withhold a part; the self-assessment is labelled self-reported",
      reflLink.ok && check === null && narrowed !== null && !!link && s0?.selfAssessment?.label === "Self-reported" && (s0?.evidence?.length ?? 0) >= 1 && s0?.assessed === null,
      JSON.stringify({ check, narrowed, items: shared?.length }));
    const sharedText = JSON.stringify(shared);
    const record = await loadProfessionalRecord(admin, me);
    const grounding = `${professionalContext(record, today)}\n${profileContext(await loadProfessionalProfile(admin, me))}`;
    const passport = JSON.stringify(await loadIndividualPassport(admin, me, today));
    const profileShare = link ? JSON.stringify(await loadSharedProfile(admin, link.id, me, (await loadIndividualPolicy(admin)).professionalProfile.shareSections, today)) : "";
    const c5 = await evidenceForVerification(admin, me, entryId);
    const leaks = [sharedText, grounding, passport, profileShare, JSON.stringify(c5)].filter(t => t.includes(PRIVATE_REFLECTION) || t.includes(SA_REFLECTION));
    ok("16. private information stays private: neither reflection reaches the link, the Passport, AI grounding or a verification hand-over; the linked reflection is not shown as evidence",
      leaks.length === 0 && !(s0?.evidence ?? []).some(e => /reflection/i.test(e.title)) && !(c5?.evidence ?? []).some(e => (e.kind as string) === "reflection"), `${leaks.length} leak(s)`);
  } finally {
    await restore();
    await cleanup();
    const pol = (await admin.from("workspace_config_overrides").select("*").eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).in("config_path", ROWS)).data ?? [];
    const sort = (x: any[]) => JSON.stringify([...x].sort((a, b) => a.config_path.localeCompare(b.config_path)));
    ok("Z1. cleanup: no harness identity left, and the three policy rows exactly as they were", !(await findUser(EMAIL)) && sort(pol) === sort(prior));
  }
  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); try { await restore(); await cleanup(); } catch { /* best effort */ } process.exit(1); });
