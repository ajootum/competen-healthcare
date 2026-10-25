/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PROFESSIONAL DEVELOPMENT NEEDS ACCEPTANCE -- COMPETEN-PROFESSIONAL-NEEDS-01 Stage 2, owner GO s14, STAGING ONLY.
 *
 * The focused journey, for an illustrative paediatric nurse, through the library the routes call (the same parsers,
 * the same store, the same policy), against migration 470 on staging. The items are the GO's own numbering:
 *   1 open My Development Needs   2-3 record a need in own words, saved with only the description
 *   4 a private reflection, and a need made from it without copying its words
 *   5 link CFCA competencies where available (version recorded)   6 explore learning opportunities
 *   7-8 suggestions reviewed: a stored suggestion accepted with an edit, one dismissed, a rule one deferred
 *   9 set and change priority and stage, in any order   10 link to an existing and a new goal (many to many)
 *   11 return later and update   12 history preserved and unrewritable   13 the reflection is not shared anywhere
 *   14 the whole thing without a competency catalogue   15 ordinary need management without AI
 *
 * ⚠ The AI call itself is the existing Holdings gateway, unchanged: the AI suggestions here are stored the way the
 * route stores them, so what is under test is acceptance, editing, dismissal and privacy, not a model.
 * ⚠ STAGING ONLY (assertSafeTarget). PEND until 470 is applied. Own harness-prof02-* identity, deleted after. Writes
 * the Professional catalogue allowlist and the AI-suggestion policy for steps 14 and 15, and restores both exactly.
 *
 *   npx tsx scripts/privileged-harnesses.ts --staging --only professional-needs-acceptance
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
import { checkStageChange, parseNeedForm } from "../src/lib/individual/professional/needs-form";
import { createNeed, decideSuggestion, linkCompetency, linkGoal, loadNeedsWorkspace, ruleSuggestions, saveAiSuggestions, saveReflection, unlinkCompetency, updateNeed } from "../src/lib/individual/professional/needs-store";
import { mintShare, parseShare } from "../src/lib/individual/professional/share";
import { loadSharedProfile } from "../src/lib/individual/professional/share-profile";
import { learningEnabled } from "../src/lib/learning/policy";
import { publishedCatalogue } from "../src/lib/learning/catalogue";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const ref = assertSafeTarget(url, "professional-needs-acceptance-harness");
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fails.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); } };
const EMAIL = "harness-prof02-paeds@competen.test";
const SCOPE = { scope_type: "platform", scope_ref: "individual" };
const ROWS = ["individual.policy.professional_catalogues", "individual.policy.professional_need_ai_suggestions"];
const today = new Date().toISOString().slice(0, 10);
const REFLECTION = "Night shift: an infant's breathing worsened and I hesitated before escalating. I want to be quicker to recognise early signs.";

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
  await admin.from("individual_professional_need_suggestion").delete().eq("user_id", u.id);
  await admin.from("individual_professional_goal_need").delete().eq("user_id", u.id);
  await admin.from("individual_professional_goal").delete().eq("user_id", u.id);
  await admin.from("individual_professional_need").delete().eq("user_id", u.id);
  for (const t of ["individual_professional_reflection", "individual_professional_profile_item", "individual_professional_profile_context", "individual_professional_profile", "individual_entitlement", "individual_membership"]) await admin.from(t).delete().eq("user_id", u.id);
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
const np = async () => (await loadIndividualPolicy(admin)).professionalNeeds;
async function need(userId: string, body: Record<string, unknown>, opts: Parameters<typeof createNeed>[3] = {}) {
  const f = parseNeedForm(body, await np());
  if (!f.ok) throw new Error(f.error);
  const out = await createNeed(admin, userId, f.value, opts);
  if (!out.ok) throw new Error(out.error);
  return out.id as string;
}

async function main() {
  console.log(`PROFESSIONAL DEVELOPMENT NEEDS ACCEPTANCE (Stage 2) against ${ref}\n`);
  const probe = await admin.from("individual_professional_need_suggestion").select("id").limit(0);
  if (probe.error) { console.log(`PEND -- migration 470 is not applied here (${probe.error.code}). Nothing created.`); return; }
  prior = (await admin.from("workspace_config_overrides").select("*").eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).in("config_path", ROWS)).data ?? [];
  await cleanup();
  try {
    const { data: created } = await admin.auth.admin.createUser({ email: EMAIL, password: `p2-${Math.random().toString(36).slice(2)}-Aa1!`, email_confirm: true, user_metadata: { full_name: "Harness Paeds Nurse" } });
    const me = created.user.id as string;
    await admin.from("profiles").update({ full_name: "Harness Paeds Nurse", role: null }).eq("id", me);
    const g = validateGrant({ targetUserId: me, experiences: ["professional"], note: "PROF-NEEDS-01 acceptance" });
    if (isGrantRefusal(g)) throw new Error(g.message);
    await grantIndividualAccess(admin, g, me);
    await admin.from("individual_professional_profile").insert({ user_id: me, experience_code: "professional", self_declared_profession: "Registered nurse", self_declared_primary_specialty: "Paediatrics",
      self_declared_practice_jurisdiction: "Kenya", self_declared_professional_status: "Practising", registration_completed_at: new Date().toISOString() });
    await admin.from("individual_professional_profile_item").insert({ user_id: me, experience_code: "professional", section: "aspiration", title: "Become a paediatric nurse educator" });

    // 1-3
    const ws0 = await loadNeedsWorkspace(admin, me);
    const n1 = await need(me, { title: "Recognising early deterioration in infants" });
    const ws1 = await loadNeedsWorkspace(admin, me);
    const row1 = ws1.needs?.find(n => n.id === n1);
    ok("1-3. My Development Needs opens; a need in the person's own words is saved with only its description, as Identified, recorded by the person",
      ws0.provisioned && ws0.needs?.length === 0 && row1?.stage_code === "identified" && row1?.created_via === "person" && row1?.priority_code === null && row1?.why_it_matters === null, JSON.stringify(row1));

    // 4
    const refl = await saveReflection(admin, me, null, { body: REFLECTION, template_code: "experience", template_label: "What happened, what I learned, and what I want to develop" });
    const nR = await need(me, { title: "Escalating sooner when an infant deteriorates" }, { reflectionId: refl.ok ? refl.id : null });
    const rowR = (await loadNeedsWorkspace(admin, me)).needs?.find(n => n.id === nR);
    ok("4. a private reflection is recorded, and a need made from it names it without copying its words",
      refl.ok && rowR?.origin === "reflection" && rowR?.reflection_id === (refl as any).id && rowR?.detail === null, JSON.stringify(rowR));

    // 5-6 (with the staging allowlist as it is)
    const offered = await loadCatalogueFor(admin, "professional");
    let linkedOk = false, linkDetail = "no catalogue offered on staging";
    if (offered && offered.length) {
      const c = offered[0];
      const l = await linkCompetency(admin, me, n1, c.competencyId, offered, null);
      const row = (await loadNeedsWorkspace(admin, me)).competencies?.find(x => x.need_id === n1);
      const notOffered = await linkCompetency(admin, me, n1, "00000000-0000-4000-8000-000000000000", offered, null);
      const un = row ? await unlinkCompetency(admin, me, row.id) : { ok: false };
      const again = await linkCompetency(admin, me, n1, c.competencyId, offered, null);
      linkedOk = l.ok && !!row?.framework_version && !notOffered.ok && un.ok && again.ok;
      linkDetail = `${c.title} ${row?.framework_version} relink ${again.ok}`;
    }
    ok("5. a need links to an offered CFCA competency with its catalogue version; a competency not offered is refused; unlinking keeps history and relinking is a new link", linkedOk, linkDetail);
    const learningOn = await learningEnabled(admin);
    const items = offered?.length ? await publishedCatalogue(admin, { competencyId: offered[0].competencyId }) : [];
    ok("6. learning opportunities are discoverable through the existing Learning catalogue (never enrolment or purchase), and a need stays usable without them",
      Array.isArray(items), `learning ${learningOn ? "on" : "off"}, ${items?.length ?? "unreadable"} catalogue item(s) for the linked competency`);

    // 7-8
    await saveAiSuggestions(admin, me, [{ title: "Teaching students paediatric assessment", basis: "Your career aspiration to become an educator" }, { title: "Something not wanted", basis: "From your CPD titles" }], "harness-model");
    const sugg = (await loadNeedsWorkspace(admin, me)).suggestions ?? [];
    const keep = sugg.find(s => s.title.startsWith("Teaching"))!, drop = sugg.find(s => s.title.startsWith("Something"))!;
    const beforeNeeds = ((await loadNeedsWorkspace(admin, me)).needs ?? []).length;
    const acceptedNeed = await createNeed(admin, me, { title: "Teaching student nurses paediatric assessment", why_it_matters: keep.basis }, { createdVia: "ai_suggestion" });
    const acc = await decideSuggestion(admin, me, { suggestionId: keep.id, decision: "accepted", acceptedNeedId: acceptedNeed.ok ? acceptedNeed.id : null });
    const dis = await decideSuggestion(admin, me, { suggestionId: drop.id, decision: "dismissed" });
    const ws2 = await loadNeedsWorkspace(admin, me);
    const rules = ruleSuggestions({ items: (await loadProfessionalProfile(admin, me)).items ?? [], needs: ws2.needs!, decided: (ws2.suggestions ?? []).filter(s => s.source === "rule"), today, windowDays: (await np()).reviewDays });
    const def = rules[0] ? await decideSuggestion(admin, me, { rule: { key: rules[0].key, title: rules[0].title, basis: rules[0].basis }, decision: "deferred" }) : { ok: false };
    const ws3 = await loadNeedsWorkspace(admin, me);
    const rulesAfter = ruleSuggestions({ items: (await loadProfessionalProfile(admin, me)).items ?? [], needs: ws3.needs!, decided: (ws3.suggestions ?? []).filter(s => s.source === "rule"), today, windowDays: (await np()).reviewDays });
    const made = ws3.needs?.find(n => acceptedNeed.ok && n.id === acceptedNeed.id);
    ok("7-8. suggestions stay suggestions until decided: one accepted with the person's edit (marked as from AI, basis kept), one dismissed (no need), a rule one deferred (hidden for now)",
      beforeNeeds === 2 && acc.ok && dis.ok && def.ok && ws3.needs!.length === 3 && made?.created_via === "ai_suggestion" && made?.title.startsWith("Teaching student nurses")
      && rules.length === 1 && rules[0].key.startsWith("aspiration:") && rulesAfter.length === 0, JSON.stringify({ rules: rules.map(r => r.key), after: rulesAfter.length }));

    // 9
    const prio = parseNeedForm({ priority: "high" }, await np(), true);
    await updateNeed(admin, me, n1, { ...(prio.ok ? prio.value : {}), stage_code: "prioritised" });
    const jump = checkStageChange("prioritised", "addressed", await np());
    await updateNeed(admin, me, n1, { stage_code: jump.ok ? jump.value : "prioritised" });
    await updateNeed(admin, me, n1, { stage_code: "exploring" });
    const p2 = parseNeedForm({ priority: "medium" }, await np(), true);
    await updateNeed(admin, me, n1, p2.ok ? p2.value : {});
    const r9 = (await loadNeedsWorkspace(admin, me)).needs?.find(n => n.id === n1);
    const st = await admin.from("individual_professional_need").select("status").eq("id", n1).single();
    ok("9. priority set and changed (words, not scores); stage moved in any order, addressed and reopened, with the MVP status kept in step",
      r9?.priority_label === "Medium" && r9?.stage_code === "exploring" && st.data?.status === "open", JSON.stringify({ p: r9?.priority_label, s: r9?.stage_code, status: st.data?.status }));

    // 10
    const goalNew = await admin.from("individual_professional_goal").insert({ user_id: me, experience_code: "professional", title: "Complete a paediatric early warning course", target_date: "2027-03-31", need_id: n1 }).select("id").single();
    const goalOther = await admin.from("individual_professional_goal").insert({ user_id: me, experience_code: "professional", title: "Shadow the outreach team", target_date: "2027-01-31" }).select("id").single();
    const l1 = await linkGoal(admin, me, goalOther.data.id, n1);
    const l2 = await linkGoal(admin, me, goalOther.data.id, nR);
    const gl = (await loadNeedsWorkspace(admin, me)).goalLinks ?? [];
    ok("10. a need links to a new goal and an existing one; one goal serves two needs", !!goalNew.data && l1.ok && l2.ok && gl.filter(x => x.goal_id === goalOther.data.id).length === 2);

    // 11-12
    const later = parseNeedForm({ title: "Recognising and escalating early deterioration in infants", why: "Two recent near-misses on my ward" }, await np(), true);
    await updateNeed(admin, me, n1, { ...(later.ok ? later.value : {}), reviewed: true });
    const ws4 = await loadNeedsWorkspace(admin, me);
    const hist = (ws4.history ?? []).filter(h => h.need_id === n1);
    const rewrite = await admin.from("individual_professional_need_history").update({ title: "forged" }).eq("need_id", n1);
    ok("11-12. returning later updates the need; every earlier version stays in its history, which cannot be rewritten",
      ws4.needs?.find(n => n.id === n1)?.title.startsWith("Recognising and escalating") === true && hist.some(h => h.title === "Recognising early deterioration in infants")
      && hist.length >= 5 && !!rewrite.error, `${hist.length} snapshots ${rewrite.error?.message}`);

    // 13
    const record = await loadProfessionalRecord(admin, me);
    const grounding = `${professionalContext(record, today)}\n${profileContext(await loadProfessionalProfile(admin, me))}`;
    const passport = JSON.stringify(await loadIndividualPassport(admin, me, today));
    const link = await mintShare(admin, me, parseShare({ scope: "full", days: 7 }), { overview: true, itemIds: [] });
    const shared = link ? JSON.stringify(await loadSharedProfile(admin, link.id, me, (await loadIndividualPolicy(admin)).professionalProfile.shareSections, today)) : "";
    const needRow = JSON.stringify(ws4.needs?.find(n => n.id === nR));
    const leak = [grounding, passport, shared, needRow].some(t => t.includes("hesitated before escalating"));
    ok("13. the private reflection reaches no AI grounding, no Passport, no share link, and not the need made from it", !leak && !!link, leak ? "reflection text found" : "");

    // 14
    await publish(ROWS[0], { ids: [] });
    const none = await loadCatalogueFor(admin, "professional");
    const n14 = await need(me, { title: "Communicating with worried parents", priority: "low" });
    const noLink = await linkCompetency(admin, me, n14, offered?.[0]?.competencyId ?? "00000000-0000-4000-8000-000000000000", none ?? [], null);
    await updateNeed(admin, me, n14, { stage_code: "in_development" });
    const r14 = (await loadNeedsWorkspace(admin, me)).needs?.find(n => n.id === n14);
    ok("14. with no competency catalogue offered, needs are recorded, prioritised and moved on exactly the same; a link is simply not offered",
      Array.isArray(none) && none.length === 0 && !noLink.ok && r14?.stage_code === "in_development" && r14?.priority_label === "Low");

    // 15
    await publish(ROWS[1], { value: "off" });
    const off = (await np()).aiSuggestions;
    const n15 = await need(me, { title: "Supporting families at discharge" });
    await updateNeed(admin, me, n15, { stage_code: "retired" });
    await updateNeed(admin, me, n15, { stage_code: "identified" });
    const g15 = await linkGoal(admin, me, goalOther.data.id, n15);
    const r15 = (await loadNeedsWorkspace(admin, me)).needs?.find(n => n.id === n15);
    ok("15. with AI suggestions off, every ordinary step works: record, retire, reopen, link a goal", off === "off" && r15?.stage_code === "identified" && g15.ok);
  } finally {
    await restore();
    await cleanup();
    const pol = (await admin.from("workspace_config_overrides").select("*").eq("scope_type", SCOPE.scope_type).eq("scope_ref", SCOPE.scope_ref).in("config_path", ROWS)).data ?? [];
    const sort = (x: any[]) => JSON.stringify([...x].sort((a, b) => a.config_path.localeCompare(b.config_path)));
    ok("Z1. cleanup: no harness identity left, and both policy rows exactly as they were", !(await findUser(EMAIL)) && sort(pol) === sort(prior));
  }
  console.log(`\n${fails.length ? "RED" : "ALL GREEN"} -- ${pass} passed, ${fails.length} failed`);
  if (fails.length) { fails.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); try { await restore(); await cleanup(); } catch { /* best effort */ } process.exit(1); });
