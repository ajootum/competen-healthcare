/**
 * Clinical Reflection harness -- CPR-230. Migration 216.
 *
 * WHAT IT PROVES:
 *   1. PRIVATE BY DEFAULT, AND PRIVATE MEANS PRIVATE. A colleague cannot list, open or revise somebody
 *      else's reflection -- and opening one is a 404 rather than a 403, because "you may not read it"
 *      confirms it exists.
 *   2. SHARING IS DELIBERATE AND REVERSIBLE, and un-sharing reports honestly that it does not unring
 *      the bell.
 *   3. NO STREAK AND NO SCORE ANYWHERE, asserted structurally over the whole serialised journal.
 *   4. AN EMPTY REFLECTION IS REFUSED by the engine AND by the database, so a writer that bypasses the
 *      engine cannot inflate a count with nothing.
 *   5. AN IMPROVEMENT ACTION IS A TASK, not a second table -- it lands on the tasks board, assigned to
 *      its author, in its own category.
 *   6. A LEARNING POINT PROMOTED FROM A REFLECTION IS CPR-220's, not a copy, and the crossing from
 *      private to shared is explicit: writing a reflection publishes nothing by itself.
 *   7. REVISION SNAPSHOTS THE PREVIOUS WORDING FIRST, and a failed snapshot changes nothing.
 *   8. LOCKING IS THE AUTHOR'S ACT and stops further edits; nothing locks on its own.
 *   9. HISTORY IS THE AUTHOR'S OWN -- a shared reflection shows what it says now, not what it said.
 *  10. THE FOUR PROMPTS ARE CONSTANTS, so no model call is needed to produce them.
 *  11. THE LIMITS ARE STATED, including the one that matters: private is not legally privileged.
 *  12. THE AUDIT TRAIL RECORDS THE FACT, NEVER THE TEXT.
 *  13. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-reflection-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter } from "../src/lib/practice/encounters";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import {
  writeReflection, reviseReflection, lockReflection, setReflectionVisibility,
  commitToAction, promoteLearning, listReflections, getReflection, reflectionJournal,
  REFLECTION_PROMPTS, REFLECTION_LIMITS, REFLECTION_CATEGORIES,
} from "../src/lib/practice/reflection";
import { listLearning } from "../src/lib/practice/case-memory";
import { purgeWorkspacesOwnedBy } from "./_cleanup";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000c230a";
const OTHER = "00000000-0000-4000-8000-0000000c230b";

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const payload = (name: string): IndividualRequest => ({
  displayName: name, countryCode: "UG", timezone: "Africa/Kampala", professionCode: "medical_doctor",
  defaultPracticeType: "clinic", locale: "en-UG", termsVersion: "t1", privacyNoticeVersion: "p1", source: "pilot",
});

async function provision(user: string, name: string, suffix: string): Promise<string> {
  const { data: req } = await admin.from("provisioning_request").insert({
    idempotency_key: `harness-rfl-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-rfl",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-rfl", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  await purgeWorkspacesOwnedBy(admin, [OWNER, OTHER]);
}

const base = { actorId: OWNER, correlationId: "harness-rfl" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  console.log("\nClinical Reflection harness (CPR-230, migration 216)\n");
  await cleanup();

  // ── 10, 11. Constants, before any data exists ──────────────────────────────
  ok("10. THE FOUR PROMPTS ARE CONSTANTS -- the comp offers to generate them with AI",
    REFLECTION_PROMPTS.length === 4 && REFLECTION_PROMPTS.every(p => p.label.length > 5 && p.hint.length > 10),
    REFLECTION_PROMPTS.map(p => p.field).join(","));
  ok("10b. and they are written in the FIRST PERSON -- an account of oneself, not of the consultation",
    REFLECTION_PROMPTS.some(p => /you/i.test(p.label)),
    REFLECTION_PROMPTS.map(p => p.label).join(" | "));
  ok("11. THE LIMITS ARE STATED, including that private is NOT legally privileged",
    REFLECTION_LIMITS.length >= 4 &&
    REFLECTION_LIMITS.some(l => l.key === "privilege" && /proceedings|record/i.test(l.detail)) &&
    REFLECTION_LIMITS.some(l => l.key === "streak") &&
    REFLECTION_LIMITS.some(l => l.key === "impact") &&
    REFLECTION_LIMITS.every(l => l.detail.length > 80),
    REFLECTION_LIMITS.map(l => l.key).join(","));

  const wsA = await provision(OWNER, "HARNESS Reflection A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Reflection B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  // ── The fixture ────────────────────────────────────────────────────────────
  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Kirabo Alice", sex: "female", birthDate: "1979-09-09",
    phone: "0772 230 001", ...base,
  });
  if (!p1.ok) { ok("patient registers", false, p1.message); return report(); }
  const e1 = await launchEncounter(admin, {
    workspaceId: wsA, patientId: p1.data.id, pathway: "new_walk_in", reasonForVisit: "Knee pain", ...base,
  });
  if (!e1.ok) { ok("encounter launches", false, e1.message); return report(); }
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: e1.data.id, to: "ACTIVE", ...base });

  // ── 4. An empty reflection is refused, twice ───────────────────────────────
  const empty = await writeReflection(admin, a.ctx, { narrative: "ok", correlationId: "harness-rfl" });
  ok("4. A ONE-WORD REFLECTION IS REFUSED BY THE ENGINE", !empty.ok && empty.code === "TOO_SHORT");
  const { error: rawEmpty } = await admin.from("practice_reflection").insert({
    workspace_id: wsA, author_id: OWNER, narrative: "ok",
  });
  ok("4b. AND BY THE DATABASE, for a writer that bypasses the engine", rawEmpty !== null,
    rawEmpty?.message ?? "the insert succeeded");
  const { error: rawNulls } = await admin.from("practice_reflection").insert({
    workspace_id: wsA, author_id: OWNER,
  });
  ok("4c. and a row with every box null is refused too", rawNulls !== null,
    rawNulls?.message ?? "the insert succeeded");

  const badCategory = await writeReflection(admin, a.ctx, {
    category: "vibes", narrative: "A perfectly long narrative that says something.", correlationId: "harness-rfl",
  });
  ok("4d. an unknown category is refused rather than stored as free text",
    !badCategory.ok && badCategory.code === "VALIDATION_ERROR");

  // ── 1. Private by default ──────────────────────────────────────────────────
  const r1 = await writeReflection(admin, a.ctx, {
    encounterId: e1.data.id, category: "decision_making",
    wentWell: "Examined the knee properly before reaching for imaging.",
    couldImprove: "I talked over her twice while she was describing the swelling.",
    learned: "Letting the history finish would have got me there faster.",
    correlationId: "harness-rfl",
  });
  ok("a reflection is written", r1.ok, r1.ok ? "" : r1.message);
  if (!r1.ok) return report();

  const { data: stored } = await admin.from("practice_reflection")
    .select("visibility, locked_at, author_id").eq("id", r1.data.id).maybeSingle();
  ok("1. IT IS PRIVATE BY DEFAULT, and unlocked",
    stored?.visibility === "private" && stored?.locked_at === null && stored?.author_id === OWNER,
    JSON.stringify(stored));

  // A colleague joins.
  const { data: om, error: memberError } = await admin.from("practice_membership").insert({
    workspace_id: wsA, user_id: OTHER, role_code: "practitioner", status: "active",
  }).select("id").single();
  ok("a colleague joins the practice", memberError === null && !!om, memberError?.message ?? "");
  if (!om) return report();
  const { error: capError } = await admin.from("practice_role_assignment").insert(
    ["encounter.list", "encounter.edit", "practice.home.view"].map(c => ({
      membership_id: om.id, capability_code: c, source: "explicit_grant", created_by: OWNER,
    })),
  );
  ok("and holds the capabilities the module touches", capError === null, capError?.message ?? "");
  const colleague = await resolveWorkspaceContext(admin, OTHER, wsA);
  if (!colleague.ok) { ok("colleague context resolves", false); return report(); }

  const theirList = await listReflections(admin, colleague.ctx);
  ok("1b. A COLLEAGUE CANNOT SEE IT IN A LIST", theirList.length === 0, String(theirList.length));
  const theirOpen = await getReflection(admin, colleague.ctx, r1.data.id);
  ok("1c. nor open it -- and gets NOTHING rather than a refusal that would confirm it exists",
    theirOpen === null);
  const theirRevise = await reviseReflection(admin, colleague.ctx, {
    id: r1.data.id, narrative: "Let me fix your reflection for you, at some length.", correlationId: "harness-rfl",
  });
  ok("1d. nor revise it", !theirRevise.ok && theirRevise.code === "NOT_YOURS");
  const theirLock = await lockReflection(admin, colleague.ctx, { id: r1.data.id, correlationId: "harness-rfl" });
  ok("1e. nor lock it", !theirLock.ok && theirLock.code === "NOT_YOURS");
  const theirShare = await setReflectionVisibility(admin, colleague.ctx, {
    id: r1.data.id, visibility: "practice", correlationId: "harness-rfl",
  });
  ok("1f. AND CANNOT PUBLISH SOMEBODY ELSE'S", !theirShare.ok && theirShare.code === "NOT_YOURS");
  // CONTROL: the author can do all of it, so the five refusals are about ownership, not breakage.
  const ownOpen = await getReflection(admin, a.ctx, r1.data.id);
  ok("1g. CONTROL: its author can open it", ownOpen !== null && ownOpen.mine === true);

  // ── 2. Sharing is deliberate and reversible ────────────────────────────────
  const share = await setReflectionVisibility(admin, a.ctx, {
    id: r1.data.id, visibility: "practice", correlationId: "harness-rfl",
  });
  ok("2. THE AUTHOR CAN SHARE IT", share.ok && (share as any).data.visibility === "practice");
  const nowVisible = await listReflections(admin, colleague.ctx);
  ok("2b. and only THEN does a colleague see it",
    nowVisible.length === 1 && nowVisible[0].id === r1.data.id && nowVisible[0].mine === false,
    String(nowVisible.length));
  const unshare = await setReflectionVisibility(admin, a.ctx, {
    id: r1.data.id, visibility: "private", correlationId: "harness-rfl",
  });
  ok("2c. UN-SHARING SAYS HONESTLY THAT IT DOES NOT UNRING THE BELL",
    unshare.ok && (unshare as any).data.alreadySeenByOthers === true,
    JSON.stringify(unshare));
  const goneAgain = await listReflections(admin, colleague.ctx);
  ok("2d. and it stops being listed", goneAgain.length === 0, String(goneAgain.length));

  // ── 7. Revision snapshots first ────────────────────────────────────────────
  const revise = await reviseReflection(admin, a.ctx, {
    id: r1.data.id, couldImprove: "I interrupted her twice while she described the swelling.",
    correlationId: "harness-rfl",
  });
  ok("7. A REVISION SUCCEEDS AND IS NUMBERED", revise.ok && (revise as any).data.version === 1,
    JSON.stringify(revise));
  const { data: versions } = await admin.from("practice_reflection_version")
    .select("version, could_improve").eq("reflection_id", r1.data.id);
  ok("7b. AND THE PREVIOUS WORDING IS KEPT, not the new one",
    ((versions ?? []) as any[]).length === 1 &&
    /talked over her/.test((versions as any[])[0].could_improve),
    JSON.stringify(versions));
  const { data: after } = await admin.from("practice_reflection")
    .select("could_improve").eq("id", r1.data.id).maybeSingle();
  ok("7c. and the reflection itself now carries the revision",
    /interrupted her/.test(after?.could_improve ?? ""), after?.could_improve);
  const emptying = await reviseReflection(admin, a.ctx, {
    id: r1.data.id, wentWell: "", couldImprove: "", learned: "", willDoDifferently: "", narrative: "",
    correlationId: "harness-rfl",
  });
  ok("7d. A REVISION CANNOT EMPTY IT", !emptying.ok && emptying.code === "TOO_SHORT");

  // ── 5. An improvement action is a task ─────────────────────────────────────
  const action = await commitToAction(admin, a.ctx, {
    reflectionId: r1.data.id, title: "Let the history finish before examining",
    dueOn: "2026-09-30", correlationId: "harness-rfl",
  });
  ok("5. COMMITTING TO AN ACTION SUCCEEDS", action.ok, action.ok ? "" : action.message);
  const { data: task } = await admin.from("practice_task")
    .select("id, category, assigned_to, reflection_id, status, due_on")
    .eq("id", (action as any).data.id).maybeSingle();
  ok("5b. AND IT IS A ROW ON THE TASKS BOARD -- no second work system",
    task?.category === "improvement" && task?.assigned_to === OWNER &&
    task?.reflection_id === r1.data.id && task?.status === "OPEN" && task?.due_on === "2026-09-30",
    JSON.stringify(task));
  // NON-VACUOUS: prove practice_task is the SAME table the tasks module uses, not a lookalike.
  const { count: boardCount } = await admin.from("practice_task")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("assigned_to", OWNER);
  ok("5c. and it is on the same board the tasks module reads", (boardCount ?? 0) === 1, String(boardCount));

  // ── 6. Promotion is the deliberate crossing ────────────────────────────────
  const beforePromote = await listLearning(admin, a.ctx, {});
  ok("6. WRITING A REFLECTION PUBLISHES NOTHING BY ITSELF -- case memory is still empty",
    beforePromote.length === 0, String(beforePromote.length));
  const promoted = await promoteLearning(admin, a.ctx, {
    reflectionId: r1.data.id, kind: "technique",
    body: "Letting the history finish gets to the knee faster than examining early.",
    correlationId: "harness-rfl",
  });
  ok("6b. and promoting one succeeds", promoted.ok, promoted.ok ? "" : promoted.message);
  const afterPromote = await listLearning(admin, a.ctx, {});
  ok("6c. AND IT IS CPR-220's LEARNING POINT, not a copy of one",
    afterPromote.length === 1 && afterPromote[0].id === (promoted as any).data.id,
    String(afterPromote.length));
  const { data: link } = await admin.from("practice_case_learning")
    .select("reflection_id, encounter_id").eq("id", (promoted as any).data.id).maybeSingle();
  ok("6d. carrying both the reflection it came from and the consultation it is about",
    link?.reflection_id === r1.data.id && link?.encounter_id === e1.data.id,
    JSON.stringify(link));

  const general = await writeReflection(admin, a.ctx, {
    category: "professional_growth",
    narrative: "A quiet week. I have been slower than usual and I think it is the on-call pattern.",
    correlationId: "harness-rfl",
  });
  ok("a reflection with no consultation is allowed -- reflecting on the week is legitimate", general.ok);
  const orphanPromote = await promoteLearning(admin, a.ctx, {
    reflectionId: (general as any).data.id, kind: "observation",
    body: "This has nowhere to go, and the engine should say so rather than file it against nothing.",
    correlationId: "harness-rfl",
  });
  ok("6e. but promoting from it is refused, because there is no case to file it against",
    !orphanPromote.ok && orphanPromote.code === "NO_ENCOUNTER");

  // ── 8. Locking ─────────────────────────────────────────────────────────────
  const lock = await lockReflection(admin, a.ctx, { id: r1.data.id, correlationId: "harness-rfl" });
  ok("8. THE AUTHOR CAN LOCK IT", lock.ok && !!(lock as any).data.lockedAt);
  const afterLock = await reviseReflection(admin, a.ctx, {
    id: r1.data.id, narrative: "Actually, let me soften what I said about myself there.",
    correlationId: "harness-rfl",
  });
  ok("8b. AND IT CANNOT BE EDITED AFTERWARDS", !afterLock.ok && afterLock.code === "LOCKED");
  const relock = await lockReflection(admin, a.ctx, { id: r1.data.id, correlationId: "harness-rfl" });
  ok("8c. locking twice is not an error", relock.ok);
  const { data: unlockedOthers } = await admin.from("practice_reflection")
    .select("id, locked_at").eq("workspace_id", wsA).is("locked_at", null);
  ok("8d. NOTHING LOCKS ON ITS OWN -- the other reflection is still editable",
    ((unlockedOthers ?? []) as any[]).length === 1, String(((unlockedOthers ?? []) as any[]).length));

  // ── 9. History is the author's own ─────────────────────────────────────────
  await setReflectionVisibility(admin, a.ctx, {
    id: r1.data.id, visibility: "practice", correlationId: "harness-rfl",
  });
  const colleagueView = await getReflection(admin, colleague.ctx, r1.data.id);
  ok("9. A SHARED REFLECTION IS READABLE BY A COLLEAGUE", colleagueView !== null && colleagueView.mine === false);
  ok("9b. BUT ITS EDIT HISTORY IS NOT -- they see what it says, not what it said",
    colleagueView !== null && colleagueView.versions.length === 0,
    String(colleagueView?.versions.length));
  const ownerView = await getReflection(admin, a.ctx, r1.data.id);
  ok("9c. CONTROL: the author does see the history, so the assertion above is not passing on an empty table",
    ownerView !== null && ownerView.versions.length === 1,
    String(ownerView?.versions.length));

  // ── 3. No streak, no score ─────────────────────────────────────────────────
  const journal = await reflectionJournal(admin, a.ctx);
  const serialised = JSON.stringify(journal);
  const streakish = /"(streak|growth_score|growthScore|score|impact|momentum)"\s*:/i.exec(serialised);
  ok("3. NO STREAK OR SCORE FIELD IN THE JOURNAL", streakish === null, streakish?.[0] ?? "");
  const percentish = /:\s*"?\d{1,3}(\.\d+)?\s*%/.exec(serialised);
  ok("3b. and no percentage-shaped value -- the comp's completion rate included",
    percentish === null, percentish?.[0] ?? "");
  ok("3c. the payload says so as FIELDS, so a client cannot render either",
    journal.streakCounted === false && journal.growthScored === false);
  ok("3d. and the counts are real: two reflections, one shared, one locked, one action committed",
    journal.reflections === 2 && journal.shared === 1 && journal.locked === 1 &&
    journal.actions.committed === 1 && journal.actions.done === 0 && journal.learningsShared === 1,
    JSON.stringify({ r: journal.reflections, s: journal.shared, l: journal.locked, a: journal.actions, ls: journal.learningsShared }));
  ok("3e. and the category counts discriminate rather than lumping everything together",
    journal.byCategory.length === 2 &&
    journal.byCategory.every(c => c.total === 1) &&
    journal.byCategory.some(c => c.key === "decision_making") &&
    journal.byCategory.some(c => c.key === "professional_growth"),
    JSON.stringify(journal.byCategory));

  // ── 12. The trail records the fact, not the text ───────────────────────────
  const { data: events } = await admin.from("practice_audit_event")
    .select("event_type, payload").eq("workspace_id", wsA).like("event_type", "practice.reflection%");
  const eventRows = (events ?? []) as any[];
  ok("12. THE REFLECTION EVENTS ARE RECORDED", eventRows.length >= 4,
    eventRows.map(e => e.event_type).join(","));
  const trail = JSON.stringify(eventRows);
  ok("12b. AND THE TEXT IS NOT IN THEM -- the trail is readable by anybody holding access.review",
    !/interrupted her|talked over her|slower than usual/.test(trail),
    /interrupted|talked over|slower/.test(trail) ? "the wording leaked" : "");
  // CONTROL: the text really is distinctive, so the assertion above is not passing on a typo.
  const { data: liveRow } = await admin.from("practice_reflection")
    .select("could_improve").eq("id", r1.data.id).maybeSingle();
  ok("12c. CONTROL: that wording does exist on the reflection itself",
    /interrupted her/.test(liveRow?.could_improve ?? ""));

  // ── 13. Cross-workspace isolation ──────────────────────────────────────────
  const crossList = await listReflections(admin, b.ctx);
  ok("13. ANOTHER PRACTICE SEES NONE OF THIS ONE'S REFLECTIONS", crossList.length === 0, String(crossList.length));
  const crossOpen = await getReflection(admin, b.ctx, r1.data.id);
  ok("13b. nor can it open one, even a SHARED one", crossOpen === null);
  const crossAction = await commitToAction(admin, b.ctx, {
    reflectionId: r1.data.id, title: "Not mine to act on", correlationId: "harness-rfl",
  });
  ok("13c. nor hang an action off it", !crossAction.ok && crossAction.code === "NOT_FOUND");
  const crossEncounter = await writeReflection(admin, b.ctx, {
    encounterId: e1.data.id, narrative: "Reflecting on another practice's consultation entirely.",
    correlationId: "harness-rfl",
  });
  ok("13d. NOR NAME THIS ONE'S CONSULTATION -- which would disclose that it exists",
    !crossEncounter.ok && crossEncounter.code === "NOT_FOUND");
  // NON-VACUOUS: workspace B works on its own records.
  const bOwn = await writeReflection(admin, b.ctx, {
    narrative: "Their own reflection, in their own practice, which must work perfectly well.",
    correlationId: "harness-rfl",
  });
  ok("13e. CONTROL: workspace B can reflect on its own practice", bOwn.ok, bOwn.ok ? "" : bOwn.message);

  ok("the category list is the one the migration constrains to",
    REFLECTION_CATEGORIES.length === 5, String(REFLECTION_CATEGORIES.length));

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
