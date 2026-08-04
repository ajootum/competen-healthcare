/**
 * AI Clinical Assistant harness -- CPR-210. Migration 215.
 *
 * WHAT A HARNESS CAN AND CANNOT PROVE HERE, said before the list rather than discovered afterwards:
 * it CANNOT prove that a language model obeyed its instructions. Nothing below asserts that an answer
 * was correct, or that the model refrained from inventing a drug. What it proves is everything AROUND
 * the model -- the gate in front of it, the grounding fed to it, and the fact that nothing it says can
 * reach a patient record on its own. That limit is also stated on the page, for the same reason.
 *
 * WHAT IT PROVES:
 *   1. OFF BY DEFAULT. A newly provisioned practice cannot use it, because using it discloses record
 *      content to a third party and a migration must never switch that on.
 *   2. ENABLING REQUIRES ACKNOWLEDGING THE CURRENT DISCLOSURE, by version. A bare `enabled: true` is
 *      refused, so the consent record cannot become a decoration.
 *   3. ENABLING TAKES practice.settings.manage -- with a control proving the holder can.
 *   4. STALE CONSENT IS NOT CONSENT. A practice that agreed to an older disclosure is refused until it
 *      agrees again.
 *   5. THE GATE COMES BEFORE ANY DISCLOSURE. With the assistant off, a call writes no session, no
 *      message and no access-log row -- proving the check runs before the record is assembled, not after.
 *   6. THERE IS NO UNGROUNDED MODE. Without a consultation the engine refuses rather than answering
 *      from the model's own memory.
 *   7. NOTHING REACHES THE CLINICAL RECORD. Counted across notes, diagnoses, treatments and drafts,
 *      before and after a real answer.
 *   8. THE SYSTEM PROMPT CARRIES THE CONSTRAINTS, for every task -- no drugs, no guidelines, no
 *      confidence, no unrecorded diagnoses.
 *   9. NO CONFIDENCE FIGURE ANYWHERE, asserted structurally over the payload.
 *  10. GROUNDING IS INTERNAL ONLY, and every source is a row in this practice.
 *  11. THE REAL MODEL ID IS RECORDED, not a product name.
 *  12. SENDING RECORD CONTENT OUT IS LOGGED AS AN EXPORT, distinctly from an ordinary view.
 *  13. A SUPERSEDED CONFIGURATION ROW DOES NOT BREAK THE GATE -- practice_configuration is versioned.
 *  14. CONVERSATIONS ARE PRIVATE TO THE PERSON WHO HELD THEM.
 *  15. Cross-workspace isolation, non-vacuously.
 *
 *   npx --yes tsx scripts/practice-assistant-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { runProvisioning, type IndividualRequest } from "../src/lib/practice/provisioning";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter, recordDiagnosis, recordTreatment } from "../src/lib/practice/encounters";
import { resolveWorkspaceContext, type WorkspaceContext } from "../src/lib/practice/access";
import {
  runAssistant, assistantSettings, setAssistantEnabled, listSessions, sessionMessages,
  rateMessage, assistantUsage, systemPrompt, ASSISTANT_TASKS, REFUSED, AI_NOTICE_VERSION,
} from "../src/lib/practice/ai-assistant";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const OWNER = "00000000-0000-4000-8000-0000000c210a";
const OTHER = "00000000-0000-4000-8000-0000000c210b";

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
    idempotency_key: `harness-ai-${suffix}`, request_type: "pilot",
    actor_user_id: user, target_user_id: user, payload_hash: "harness", correlation_id: "harness-ai",
  }).select("id").single();
  const run = await runProvisioning(admin, { id: req!.id, target_user_id: user, correlation_id: "harness-ai", workspace_id: null }, payload(name));
  if (!run.ok || !run.workspaceId) throw new Error(`provisioning failed: ${run.errorCode}`);
  return run.workspaceId;
}

async function cleanup() {
  for (const u of [OWNER, OTHER]) {
    const { data: ws } = await admin.from("practice_workspace").select("id").eq("owner_person_id", u);
    for (const w of (ws ?? []) as { id: string }[]) await admin.from("practice_workspace").delete().eq("id", w.id);
    await admin.from("provisioning_request").delete().eq("target_user_id", u);
    await admin.from("practice_audit_event").delete().eq("actor_id", u);
  }
}

const base = { actorId: OWNER, correlationId: "harness-ai" };

/* eslint-disable @typescript-eslint/no-explicit-any */

async function withoutCapability(workspaceId: string, userId: string, capability: string): Promise<WorkspaceContext> {
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", workspaceId).eq("user_id", userId);
  await admin.from("practice_role_assignment").update({ effective_to: new Date().toISOString() })
    .in("membership_id", ((mine ?? []) as any[]).map(m => m.id))
    .eq("capability_code", capability).is("effective_to", null);
  const res = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!res.ok) throw new Error("context failed");
  return res.ctx;
}

/** Every clinical table the assistant must never touch, counted. */
async function clinicalFootprint(workspaceId: string) {
  const tables = ["practice_encounter_note", "practice_diagnosis", "practice_treatment", "practice_note_draft"];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const { count, error } = await admin.from(t).select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    // A MISSING TABLE MUST NOT READ AS ZERO. PostgREST answers a head+count against a table that is not
    // there with a null count and an error -- and a footprint of "0" would then look like proof that
    // nothing was written. The trap recorded against the QIE build.
    if (error) throw new Error(`footprint table ${t} unreadable: ${error.message}`);
    counts[t] = count ?? 0;
  }
  return counts;
}

async function main() {
  console.log("\nAI Clinical Assistant harness (CPR-210, migration 215)\n");
  await cleanup();

  // ── 8. The system prompt carries the constraints, before any data exists ───
  for (const t of ASSISTANT_TASKS) {
    const p = systemPrompt(t.key).toLowerCase();
    ok(`8. the "${t.key}" prompt forbids originating clinical facts`,
      p.includes("never introduce a clinical fact") &&
      p.includes("drug") && p.includes("guideline") &&
      p.includes("confident") && p.includes("diagnosis"),
      p.slice(0, 60));
  }
  ok("8b. and it tells the model to admit a gap rather than fill it",
    /honest gap|say exactly that/i.test(systemPrompt("ask")));
  ok("9. the refusal list names the confidence score and the citations, each with a reason",
    REFUSED.some(r => r.key === "confidence") && REFUSED.some(r => r.key === "citations") &&
    REFUSED.every(r => r.reason.length > 60),
    REFUSED.map(r => r.key).join(","));

  const wsA = await provision(OWNER, "HARNESS Assistant A (synthetic)", "a");
  const wsB = await provision(OTHER, "HARNESS Assistant B (synthetic)", "b");
  const a = await resolveWorkspaceContext(admin, OWNER, wsA);
  const b = await resolveWorkspaceContext(admin, OTHER, wsB);
  if (!a.ok || !b.ok) { ok("workspace contexts resolve", false); return report(); }

  // ── 1. Off by default ──────────────────────────────────────────────────────
  const fresh = await assistantSettings(admin, wsA);
  ok("1. A NEWLY PROVISIONED PRACTICE HAS THE ASSISTANT OFF", fresh.enabled === false);
  ok("1b. and it has agreed to nothing", fresh.enabledAt === null && fresh.noticeVersion === null);
  ok("1c. and whether a provider is configured is reported as a fact, not a status dot",
    typeof fresh.configured === "boolean" && (fresh.configured ? !!fresh.model : fresh.model === null),
    JSON.stringify({ c: fresh.configured, m: fresh.model }));
  ok("1d. and the model reported is the REAL one, not a product name",
    !/competen/i.test(String(fresh.model ?? "")), String(fresh.model));

  // ── The fixture: a consultation with real content ──────────────────────────
  const p1 = await registerPatient(admin, {
    workspaceId: wsA, displayName: "Nabirye Joy", sex: "female", birthDate: "1986-03-11",
    phone: "0772 210 001", ...base,
  });
  if (!p1.ok) { ok("patient registers", false, p1.message); return report(); }

  const e1 = await launchEncounter(admin, {
    workspaceId: wsA, patientId: p1.data.id, pathway: "new_walk_in",
    reasonForVisit: "Persistent lower back pain for two weeks", ...base,
  });
  if (!e1.ok) { ok("encounter launches", false, e1.message); return report(); }
  const dx = await recordDiagnosis(admin, {
    workspaceId: wsA, encounterId: e1.data.id, label: "Mechanical low back pain",
    certainty: "provisional", ...base,
  });
  const tx = await recordTreatment(admin, {
    workspaceId: wsA, encounterId: e1.data.id, treatmentType: "medication",
    label: "Paracetamol", dose: "1g", route: "oral", frequency: "TDS PRN", ...base,
  });
  ok("the fixture consultation carries a diagnosis and a treatment",
    dx.ok && tx.ok, [dx.ok ? "" : dx.message, tx.ok ? "" : tx.message].join(" | "));
  await transitionEncounter(admin, { workspaceId: wsA, encounterId: e1.data.id, to: "ACTIVE", ...base });

  // ── 5. The gate comes before any disclosure ────────────────────────────────
  const blocked = await runAssistant(admin, a.ctx, {
    task: "summarise_encounter", encounterId: e1.data.id, correlationId: "harness-ai",
  });
  ok("5. WITH THE ASSISTANT OFF, A CALL IS REFUSED", !blocked.ok && blocked.code === "AI_NOT_ENABLED");
  const { count: sessionsAfterBlock } = await admin.from("practice_ai_session")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA);
  const { count: exportsAfterBlock } = await admin.from("practice_access_log")
    .select("*", { count: "exact", head: true }).eq("workspace_id", wsA).eq("action", "export");
  ok("5b. AND NOTHING WAS ASSEMBLED OR LOGGED -- the gate runs before the record is read",
    sessionsAfterBlock === 0 && exportsAfterBlock === 0,
    JSON.stringify({ s: sessionsAfterBlock, x: exportsAfterBlock }));

  // ── 2, 3. Enabling ─────────────────────────────────────────────────────────
  const bare = await setAssistantEnabled(admin, a.ctx, { enabled: true, correlationId: "harness-ai" });
  ok("2. ENABLING WITHOUT ACKNOWLEDGING THE DISCLOSURE IS REFUSED",
    !bare.ok && bare.code === "NOTICE_NOT_ACKNOWLEDGED");
  const wrongVersion = await setAssistantEnabled(admin, a.ctx, {
    enabled: true, acknowledgedNoticeVersion: "some-older-notice", correlationId: "harness-ai",
  });
  ok("2b. and acknowledging a DIFFERENT disclosure does not count",
    !wrongVersion.ok && wrongVersion.code === "NOTICE_NOT_ACKNOWLEDGED");

  const noPermission = await withoutCapability(wsA, OWNER, "practice.settings.manage");
  const refusedByRole = await setAssistantEnabled(admin, noPermission, {
    enabled: true, acknowledgedNoticeVersion: AI_NOTICE_VERSION, correlationId: "harness-ai",
  });
  ok("3. TURNING IT ON TAKES practice.settings.manage",
    !refusedByRole.ok && refusedByRole.code === "FORBIDDEN");

  // Restore the capability for the control.
  //
  // THE INSERT'S ERROR IS CHECKED. An unchecked re-grant that silently failed would make every
  // assertion after this one report "turning this on is a practice setting" and look like a bug in the
  // gate -- which is exactly what happened on the first run of this file.
  const { data: mine } = await admin.from("practice_membership")
    .select("id").eq("workspace_id", wsA).eq("user_id", OWNER).eq("status", "active");
  // Provisioning gives the owner more than one active membership (owner and practitioner), so the
  // re-grant covers every one -- the same set resolveWorkspaceContext reads from.
  const memberships = (mine ?? []) as any[];
  ok("the owner has active memberships to re-grant against", memberships.length > 0,
    String(memberships.length));
  const { data: regranted, error: regrantError } = await admin.from("practice_role_assignment").insert(
    memberships.map(m => ({
      membership_id: m.id, capability_code: "practice.settings.manage",
      source: "explicit_grant", created_by: OWNER,
    })),
  ).select("effective_from");
  ok("and the capability is re-granted", regrantError === null, regrantError?.message ?? "");
  const restored = await resolveWorkspaceContext(admin, OWNER, wsA);
  if (!restored.ok) { ok("context restores", false); return report(); }

  // A GRANT MADE A MOMENT AGO IS VISIBLE IMMEDIATELY.
  //
  // This is not a formality. effective_from defaults to the DATABASE's now(), and the resolver used to
  // compare it against THIS PROCESS's clock -- so wherever the database ran ahead (~800ms on the machine
  // this was found on) a capability granted to a colleague was invisible until the app clock caught up.
  // Grant access, watch them reload, watch it not be there. The assertion below fails on that bug, and
  // the one after it proves the skew is real rather than assumed.
  ok("A GRANT MADE A MOMENT AGO IS LIVE IMMEDIATELY -- clocks compared on one side, not two",
    restored.ctx.capabilities.includes("practice.settings.manage"),
    restored.ctx.capabilities.filter(c => c.startsWith("practice.")).join(","));
  void regranted;

  // THE PAIR THAT MAKES THE ASSERTION ABOVE MEAN SOMETHING. On its own it would also pass if the time
  // bound had simply been deleted, so here is a grant dated an hour ahead that must NOT be live.
  //
  // Deliberately NOT an assertion that this deployment has clock skew: skew is an environmental
  // condition, and a harness that fails when two clocks happen to agree reports an environment as a
  // defect. This pair is deterministic either way.
  // A SYNTHETIC CAPABILITY NOTHING ELSE GRANTS. The first draft of this used data.export, which the
  // owner already holds by role default -- so the assertion was passing on a grant it was not testing.
  const FUTURE_ONLY = "harness.future.only";
  ok("the probe capability is one the owner does not already hold",
    !restored.ctx.capabilities.includes(FUTURE_ONLY));
  const { data: futureGrant } = await admin.from("practice_role_assignment").insert({
    membership_id: memberships[0].id, capability_code: FUTURE_ONLY,
    source: "explicit_grant", created_by: OWNER,
    effective_from: new Date(Date.now() + 3600_000).toISOString(),
  }).select("id").single();
  const withFuture = await resolveWorkspaceContext(admin, OWNER, wsA);
  ok("and a grant dated an hour ahead is NOT live -- the time bound is still enforced",
    withFuture.ok && !withFuture.ctx.capabilities.includes(FUTURE_ONLY),
    withFuture.ok ? "it was live" : "context failed");
  // CONTROL: the same grant, backdated, IS live -- so the refusal above is about the date and not about
  // the capability being unknown to the resolver.
  if (futureGrant) {
    await admin.from("practice_role_assignment")
      .update({ effective_from: new Date(Date.now() - 3600_000).toISOString() }).eq("id", futureGrant.id);
    const backdated = await resolveWorkspaceContext(admin, OWNER, wsA);
    ok("CONTROL: backdated, the same grant IS live", backdated.ok && backdated.ctx.capabilities.includes(FUTURE_ONLY));
  }
  if (futureGrant) await admin.from("practice_role_assignment").delete().eq("id", futureGrant.id);

  const enabled = await setAssistantEnabled(admin, restored.ctx, {
    enabled: true, acknowledgedNoticeVersion: AI_NOTICE_VERSION, correlationId: "harness-ai",
  });
  ok("3b. CONTROL: with the capability AND the acknowledgement, it turns on",
    enabled.ok, enabled.ok ? "" : enabled.message);
  const afterEnable = await assistantSettings(admin, wsA);
  ok("3c. and the agreement is dated and attributed, not merely true",
    afterEnable.enabled && afterEnable.enabledBy === OWNER && !!afterEnable.enabledAt &&
    afterEnable.noticeVersion === AI_NOTICE_VERSION,
    JSON.stringify({ by: afterEnable.enabledBy, at: afterEnable.enabledAt }));

  // ── 6. No ungrounded mode ──────────────────────────────────────────────────
  const ungrounded = await runAssistant(admin, restored.ctx, {
    task: "ask", question: "What are the red flags for low back pain?", correlationId: "harness-ai",
  });
  ok("6. WITHOUT A RECORD THE ASSISTANT REFUSES rather than answering from its own memory",
    !ungrounded.ok && ungrounded.code === "NOTHING_TO_GROUND_IN",
    ungrounded.ok ? "it answered" : ungrounded.code);

  // ── 7, 10, 11, 12. A real call ─────────────────────────────────────────────
  const before = await clinicalFootprint(wsA);
  const answered = await runAssistant(admin, restored.ctx, {
    task: "summarise_encounter", encounterId: e1.data.id, correlationId: "harness-ai",
  });

  if (!answered.ok && answered.code === "AI_NOT_CONFIGURED") {
    // HONEST BRANCH. If no provider key is present the generation path cannot be exercised, and that is
    // reported rather than passed over in silence.
    ok("7-12. SKIPPED: no model provider is configured, so the generation path was not exercised", false,
      "set ANTHROPIC_API_KEY to run these");
  } else if (!answered.ok) {
    ok("the assistant answers", false, `${answered.code}: ${answered.message}`);
  } else {
    const after = await clinicalFootprint(wsA);
    ok("7. NOTHING REACHED THE CLINICAL RECORD -- notes, diagnoses, treatments and drafts all unchanged",
      JSON.stringify(before) === JSON.stringify(after),
      `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
    // NON-VACUOUS: the footprint has to be counting something, or "unchanged" is trivially true.
    ok("7b. and the footprint was counting real rows, so 'unchanged' means something",
      Object.values(before).some(n => n > 0), JSON.stringify(before));

    ok("the assistant answered", answered.data.answer.length > 20, String(answered.data.answer.length));
    ok("10. EVERY SOURCE IS A ROW IN THIS PRACTICE -- no external citation is possible",
      answered.data.grounding.length > 0 &&
      answered.data.grounding.every(g => ["patient", "encounter", "note", "diagnosis", "treatment"].includes(g.kind)),
      JSON.stringify(answered.data.grounding.map(g => g.kind)));
    ok("10b. and the ones that open, open into this practice",
      answered.data.grounding.filter(g => g.href).every(g => g.href!.startsWith("/practice/")),
      JSON.stringify(answered.data.grounding.map(g => g.href).filter(Boolean)));

    ok("11. THE REAL MODEL ID IS RECORDED, not a product name",
      !!answered.data.model && !/competen/i.test(answered.data.model),
      String(answered.data.model));

    const { data: stored } = await admin.from("practice_ai_message")
      .select("model, provider, grounding, input_tokens, output_tokens, status")
      .eq("session_id", answered.data.sessionId).eq("role", "assistant").maybeSingle();
    ok("11b. and it is stored on the message, with the tokens it cost",
      stored?.model === answered.data.model && (stored?.input_tokens ?? 0) > 0,
      JSON.stringify(stored));

    const { data: exported } = await admin.from("practice_access_log")
      .select("action, detail, patient_id").eq("workspace_id", wsA).eq("action", "export");
    ok("12. SENDING RECORD CONTENT OUT IS LOGGED AS AN EXPORT, not as an ordinary view",
      (exported ?? []).length === 1 && /assistant/i.test((exported as any[])[0].detail) &&
      (exported as any[])[0].patient_id === p1.data.id,
      JSON.stringify(exported));

    // ── 9. No confidence anywhere ────────────────────────────────────────────
    const serialised = JSON.stringify({ answered: answered.data, stored });
    const conf = /"(confidence|certainty_score|reliability|score)"\s*:/i.exec(serialised);
    ok("9. NO CONFIDENCE FIELD IN THE PAYLOAD -- the comp's 92% could not be rendered from it",
      conf === null, conf?.[0] ?? "");

    // ── 14. Conversations are private ────────────────────────────────────────
    await admin.from("practice_membership").insert({
      workspace_id: wsA, user_id: OTHER, role_code: "practitioner", status: "active",
    });
    const { data: om } = await admin.from("practice_membership")
      .select("id").eq("workspace_id", wsA).eq("user_id", OTHER).maybeSingle();
    await admin.from("practice_role_assignment").insert({
      membership_id: om!.id, capability_code: "encounter.list", source: "explicit_grant", created_by: OWNER,
    });
    const colleague = await resolveWorkspaceContext(admin, OTHER, wsA);
    if (colleague.ok) {
      const theirView = await sessionMessages(admin, colleague.ctx, answered.data.sessionId);
      ok("14. A COLLEAGUE CANNOT READ SOMEBODY ELSE'S CONVERSATION", theirView === null);
      const theirList = await listSessions(admin, colleague.ctx);
      ok("14b. nor does it appear in their list", theirList.length === 0, String(theirList.length));
      const theirRating = await rateMessage(admin, colleague.ctx, {
        messageId: answered.data.messageId, helpful: true,
      });
      ok("14c. nor can they rate an answer in it", !theirRating.ok && theirRating.code === "NOT_YOURS");
      // CONTROL: the owner can do all three, so the refusals are about ownership rather than breakage.
      const ownView = await sessionMessages(admin, restored.ctx, answered.data.sessionId);
      const ownRating = await rateMessage(admin, restored.ctx, {
        messageId: answered.data.messageId, helpful: true, note: "Useful summary",
      });
      ok("14d. CONTROL: its owner can read and rate it",
        ownView !== null && ownView.messages.length === 2 && ownRating.ok);
    }

    const usage = await assistantUsage(admin, restored.ctx);
    ok("usage counts what happened, and says it measures no accuracy",
      usage.sessions === 1 && usage.answers === 1 && usage.ratedHelpful === 1 &&
      usage.accuracyMeasured === false && usage.accuracyNote.length > 30,
      JSON.stringify(usage));
  }

  // ── 4. Stale consent is not consent ────────────────────────────────────────
  await admin.from("practice_configuration")
    .update({ ai_assistant_notice_version: "practice-ai-0" })
    .eq("workspace_id", wsA).eq("is_effective", true);
  const staleSettings = await assistantSettings(admin, wsA);
  ok("4. A PRACTICE THAT AGREED TO AN OLDER DISCLOSURE READS AS NOT CURRENT",
    staleSettings.enabled === true && staleSettings.noticeCurrent === false);
  const staleCall = await runAssistant(admin, restored.ctx, {
    task: "summarise_encounter", encounterId: e1.data.id, correlationId: "harness-ai",
  });
  ok("4b. and is refused until it agrees again -- even though the flag is still on",
    !staleCall.ok && staleCall.code === "NOTICE_CHANGED",
    staleCall.ok ? "it answered" : staleCall.code);
  await admin.from("practice_configuration")
    .update({ ai_assistant_notice_version: AI_NOTICE_VERSION })
    .eq("workspace_id", wsA).eq("is_effective", true);

  // ── 13. A superseded configuration row does not break the gate ─────────────
  //
  // practice_configuration is VERSIONED (migration 191): superseded rows stay and only a partial unique
  // index keeps one effective. A query without is_effective returns two rows, maybeSingle() errors, and
  // the gate fails in whichever direction the error handling happens to take. This asserts the filter.
  const { error: supersededError } = await admin.from("practice_configuration").insert({
    workspace_id: wsA, config_version: 0, is_effective: false, locale: "en-UG",
  });
  ok("13. a superseded configuration row can be created", supersededError === null, supersededError?.message ?? "");
  const withHistory = await assistantSettings(admin, wsA);
  ok("13b. AND THE GATE STILL READS THE EFFECTIVE ROW, not an arbitrary one",
    withHistory.enabled === true && withHistory.noticeCurrent === true,
    JSON.stringify({ e: withHistory.enabled, c: withHistory.noticeCurrent }));
  const toggleWithHistory = await setAssistantEnabled(admin, restored.ctx, {
    enabled: false, correlationId: "harness-ai",
  });
  ok("13c. and writing to it still lands on the effective row", toggleWithHistory.ok,
    toggleWithHistory.ok ? "" : toggleWithHistory.message);
  const { data: rows } = await admin.from("practice_configuration")
    .select("is_effective, ai_assistant_enabled").eq("workspace_id", wsA);
  ok("13d. leaving the superseded row untouched -- history is not rewritten",
    ((rows ?? []) as any[]).length === 2 &&
    ((rows ?? []) as any[]).filter(r => r.is_effective).every(r => r.ai_assistant_enabled === false),
    JSON.stringify(rows));

  // ── 15. Cross-workspace isolation ──────────────────────────────────────────
  const crossSettings = await assistantSettings(admin, wsB);
  ok("15. ANOTHER PRACTICE'S ASSISTANT IS SEPARATELY OFF", crossSettings.enabled === false);
  const crossSessions = await listSessions(admin, b.ctx);
  ok("15b. and it sees none of this one's conversations", crossSessions.length === 0, String(crossSessions.length));
  const crossCall = await runAssistant(admin, b.ctx, {
    task: "summarise_encounter", encounterId: e1.data.id, correlationId: "harness-ai",
  });
  ok("15c. nor can it ask about this one's consultation",
    !crossCall.ok && ["AI_NOT_ENABLED", "NOTHING_TO_GROUND_IN"].includes(crossCall.code),
    crossCall.ok ? "it answered" : crossCall.code);
  // NON-VACUOUS: workspace B is a working practice, so the refusals are about isolation.
  const bEnable = await setAssistantEnabled(admin, b.ctx, {
    enabled: true, acknowledgedNoticeVersion: AI_NOTICE_VERSION, correlationId: "harness-ai",
  });
  ok("15d. CONTROL: workspace B can enable its own assistant perfectly well", bEnable.ok,
    bEnable.ok ? "" : bEnable.message);

  await cleanup();
  return report();
}

function report() {
  console.log(`\n  ${pass} passed, ${fails.length} failed\n`);
  if (fails.length) { fails.forEach(f => console.log(`   - ${f}`)); process.exit(1); }
}

main().catch(async e => { console.error(e); await cleanup(); process.exit(1); });
