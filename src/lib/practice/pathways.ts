import { audit } from "@/lib/practice/provisioning";
import type { EngineResult } from "@/lib/practice/encounters";
import { createFollowUp, closeFollowUp, rescheduleFollowUp } from "@/lib/practice/follow-ups";
import { CLOSED_FOLLOW_UP_STATUSES, FOLLOW_UP_KINDS, FOLLOW_UP_PRIORITIES } from "@/lib/practice/follow-up-constants";
import { workspaceClock } from "@/lib/practice/practice-time";
import {
  PATHWAY_TRIGGERS, STAGE_COMPLETION_RULES, PATHWAY_DEVIATIONS,
  pathwayProgress, addDays, dayGap, type PathwayProgressState,
} from "@/lib/practice/pathways-constants";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-FUP-003 -- THE CONTINUITY PATHWAYS & CARE PLANNING ENGINE (migration 239 s4-s7)
//
// The Follow-ups engine manages ONE obligation. This manages a JOURNEY: a practitioner's planned
// sequence of reviews for a patient across many consultations, which raises the individual obligations
// as it goes.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ A PATHWAY IS A PLAN, NOT A PROTOCOL, AND THAT SENTENCE DECIDED THE SHAPE OF THIS FILE.
//
// s2: "not protocol enforcement", "supports deviations", "practitioner-controlled". So:
//
//   NOTHING IN HERE REFUSES A DEVIATION. skipStage, repeatStage, delayStage, cancelStage and
//   stopPathway are available from any live stage, always, and none of them has a condition on it. The
//   only thing they require is a REASON -- because s10 and s14 both say every deviation is audited, and
//   an unaudited deviation is the feature without the thing that makes it safe.
//
//   ENTRY CRITERIA ARE NEVER EVALUATED. They are text a practitioner reads before deciding. There is no
//   code path in this file that reads entry_criteria and acts on it, and there must not be one: a
//   machine-evaluated criterion would decide who goes on a pathway, and s2 says a practitioner does.
//
//   COMPLETION RULES ARE AN EXPECTATION, NOT A GATE. A stage whose completion_rule is "encounter" can
//   still be advanced by hand. s8 lists "practitioner manually advances stage" alongside the three
//   automatic routes, as a peer of them and not as an override of them.
//
//   AI OWNS NOTHING HERE (s15, "AI never modifies pathways automatically"). There is no generation, no
//   suggestion and no inference in this module -- every row it writes is the direct consequence of an
//   act somebody performed.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ "DUE", "OVERDUE" AND "ON TRACK" ARE DERIVED HERE TOO, NEVER STORED. Same decision as migration 196
// and for the same reason: a stored progress state needs something to run to become true, and a practice
// that has stopped opening the app is exactly the one whose pathways have stopped progressing. The
// derivation is pathwayProgress() in pathways-constants.ts -- pure, over dates, against the PRACTICE's
// today. "At risk" is refused there, with the reasoning.

/* eslint-disable @typescript-eslint/no-explicit-any */

const nowIso = () => new Date().toISOString();

/** A read that failed is never an empty list. Same contract as FollowUpList, for the same reason. */
export type PathwayList<T> = { items: T[]; unavailable: boolean; detail: string | null };

const failed = <T>(detail: string): PathwayList<T> => ({ items: [], unavailable: true, detail });
const listed = <T>(items: T[]): PathwayList<T> => ({ items, unavailable: false, detail: null });

async function recordPathwayEvent(admin: any, args: {
  workspaceId: string; patientPathwayId: string; stageId?: string | null;
  eventType: string; reason?: string | null; actorId: string;
}) {
  const { error } = await admin.from("practice_pathway_event").insert({
    workspace_id: args.workspaceId, patient_pathway_id: args.patientPathwayId,
    stage_id: args.stageId ?? null, event_type: args.eventType,
    reason: args.reason?.trim() || null, actor_id: args.actorId,
  });
  // ⚠ THE ERROR IS NOT DISCARDED. s10/s14 say every deviation is audited; a deviation whose audit row
  // silently failed to write is a deviation that was not audited, and the caller has to be able to say so.
  return error ? error.message : null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. TEMPLATES (s5)
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type StageInput = {
  name: string;
  /** Days after the PREVIOUS stage was reached. s6's "review after 2 weeks", relative to reality. */
  offsetDays: number;
  requiredAction?: string | null;
  completionRule?: string;
  /** The obligation this stage raises when it is entered. Null means it raises none. */
  followUpKind?: string | null;
  followUpPriority?: string | null;
};

export async function createPathwayTemplate(admin: any, args: {
  workspaceId: string; name: string; specialty?: string | null; description?: string | null;
  entryCriteria?: string | null; exitCriteria?: string | null;
  stages: StageInput[]; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; version: number; stages: number }>> {
  if (!args.name.trim())
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a pathway needs a name" };
  // A TEMPLATE WITH NO STAGES IS NOT A PLAN. It would assign, raise nothing, and sit on a patient's
  // record claiming a journey that has no steps -- which reads as care being tracked when none is.
  if (args.stages.length === 0)
    return { ok: false, status: 400, code: "NO_STAGES", message: "a pathway needs at least one stage" };

  for (const [i, s] of args.stages.entries()) {
    if (!s.name.trim())
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `stage ${i + 1} needs a name` };
    if (!Number.isInteger(s.offsetDays) || s.offsetDays < 0 || s.offsetDays > 3650)
      return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `stage ${i + 1}: timing must be 0-3650 days after the previous stage` };
    if (s.completionRule && !STAGE_COMPLETION_RULES.some(([c]) => c === s.completionRule))
      return { ok: false, status: 400, code: "UNKNOWN_COMPLETION_RULE", message: `stage ${i + 1}: ${s.completionRule} is not a completion rule` };
    if (s.followUpKind && !FOLLOW_UP_KINDS.some(([k]) => k === s.followUpKind))
      return { ok: false, status: 400, code: "UNKNOWN_FOLLOW_UP_KIND", message: `stage ${i + 1}: ${s.followUpKind} is not a follow-up kind` };
    if (s.followUpPriority && !(FOLLOW_UP_PRIORITIES as readonly string[]).includes(s.followUpPriority))
      return { ok: false, status: 400, code: "UNKNOWN_PRIORITY", message: `stage ${i + 1}: ${s.followUpPriority} is not a priority` };
  }

  const { data: t, error } = await admin.from("practice_pathway_template").insert({
    workspace_id: args.workspaceId, name: args.name.trim(),
    specialty: args.specialty?.trim() || null, description: args.description?.trim() || null,
    entry_criteria: args.entryCriteria?.trim() || null, exit_criteria: args.exitCriteria?.trim() || null,
    created_by: args.actorId, updated_by: args.actorId,
  }).select("id, version").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  const { error: stageErr } = await admin.from("practice_pathway_stage").insert(
    args.stages.map((s, i) => ({
      workspace_id: args.workspaceId, template_id: t.id, position: i + 1,
      name: s.name.trim(), offset_days: s.offsetDays,
      required_action: s.requiredAction?.trim() || null,
      completion_rule: s.completionRule ?? "encounter",
      follow_up_kind: s.followUpKind ?? null,
      follow_up_priority: s.followUpPriority ?? null,
      created_by: args.actorId,
    })),
  );
  if (stageErr) {
    // A template whose stages did not write is worse than no template: it would assign and do nothing.
    await admin.from("practice_pathway_template").delete().eq("id", t.id);
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: stageErr.message };
  }

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.pathway_template_created",
    payload: { templateId: t.id, name: args.name.trim(), stages: args.stages.length },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: t.id as string, version: t.version as number, stages: args.stages.length } };
}

/**
 * s13's version history.
 *
 * ⚠ A TEMPLATE IN USE IS NEVER EDITED IN PLACE. Patients are already walking the old one; changing its
 * stages underneath them would rewrite the plan they are halfway through, and the history would then
 * describe a journey nobody was ever actually sent on. Publishing a change makes a NEW row with the next
 * version, pointing back at the one it supersedes, and deactivates the old one so nothing new is
 * assigned to it. Existing enrolments keep their template_id and keep working.
 */
export async function publishPathwayVersion(admin: any, args: {
  workspaceId: string; templateId: string;
  name?: string; specialty?: string | null; description?: string | null;
  entryCriteria?: string | null; exitCriteria?: string | null;
  stages: StageInput[]; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; version: number; supersedes: string }>> {
  const { data: old } = await admin.from("practice_pathway_template")
    .select("id, name, specialty, description, entry_criteria, exit_criteria, version")
    .eq("id", args.templateId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!old) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const created = await createPathwayTemplate(admin, {
    workspaceId: args.workspaceId,
    name: args.name ?? old.name,
    specialty: args.specialty !== undefined ? args.specialty : old.specialty,
    description: args.description !== undefined ? args.description : old.description,
    entryCriteria: args.entryCriteria !== undefined ? args.entryCriteria : old.entry_criteria,
    exitCriteria: args.exitCriteria !== undefined ? args.exitCriteria : old.exit_criteria,
    stages: args.stages, actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!created.ok) return created;

  const { error } = await admin.from("practice_pathway_template")
    .update({ version: old.version + 1, supersedes_template_id: old.id, updated_at: nowIso(), updated_by: args.actorId })
    .eq("id", created.data.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  await admin.from("practice_pathway_template")
    .update({ is_active: false, updated_at: nowIso(), updated_by: args.actorId }).eq("id", old.id);

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.pathway_template_versioned",
    payload: { templateId: created.data.id, supersedes: old.id, version: old.version + 1 },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: created.data.id, version: old.version + 1, supersedes: old.id as string } };
}

export async function setTemplateActive(admin: any, args: {
  workspaceId: string; templateId: string; active: boolean; actorId: string; correlationId: string;
}): Promise<EngineResult<{ active: boolean }>> {
  const { data: updated } = await admin.from("practice_pathway_template")
    .update({ is_active: args.active, updated_at: nowIso(), updated_by: args.actorId })
    .eq("id", args.templateId).eq("workspace_id", args.workspaceId).select("id").maybeSingle();
  if (!updated) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: args.active ? "practice.pathway_template_activated" : "practice.pathway_template_retired",
    payload: { templateId: args.templateId }, correlationId: args.correlationId,
  });
  return { ok: true, data: { active: args.active } };
}

export type TemplateStage = {
  id: string; position: number; name: string; offset_days: number;
  required_action: string | null; completion_rule: string;
  follow_up_kind: string | null; follow_up_priority: string | null;
};

export type PathwayTemplate = {
  id: string; name: string; specialty: string | null; description: string | null;
  version: number; is_active: boolean; supersedes_template_id: string | null;
  entry_criteria: string | null; exit_criteria: string | null;
  stages: TemplateStage[];
  /** How many patients are on this template right now. The length of a list, not an estimate. */
  activePatientIds: string[];
};

export async function listPathwayTemplates(admin: any, workspaceId: string, options: { includeInactive?: boolean } = {}): Promise<PathwayList<PathwayTemplate>> {
  let q = admin.from("practice_pathway_template")
    .select("id, name, specialty, description, version, is_active, supersedes_template_id, entry_criteria, exit_criteria, created_at")
    .eq("workspace_id", workspaceId);
  if (!options.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q.order("name");
  if (error) return failed(error.message);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return listed([]);

  const ids = rows.map(r => r.id);
  const [{ data: stages, error: stageErr }, { data: enrolments, error: enrolErr }] = await Promise.all([
    admin.from("practice_pathway_stage")
      .select("id, template_id, position, name, offset_days, required_action, completion_rule, follow_up_kind, follow_up_priority")
      .in("template_id", ids).order("position"),
    admin.from("practice_patient_pathway")
      .select("template_id, patient_id").in("template_id", ids).eq("status", "active"),
  ]);
  // ⚠ A TEMPLATE WITH NO STAGES BECAUSE THE STAGE READ FAILED LOOKS EXACTLY LIKE A TEMPLATE WITH NO
  // STAGES. Reported as unavailable rather than returned half-read.
  if (stageErr) return failed(stageErr.message);
  if (enrolErr) return failed(enrolErr.message);

  const byTemplate = new Map<string, TemplateStage[]>();
  for (const s of (stages ?? []) as any[]) {
    if (!byTemplate.has(s.template_id)) byTemplate.set(s.template_id, []);
    byTemplate.get(s.template_id)!.push(s);
  }
  // ⚠ PATIENTS, NOT ENROLMENTS. The comp's "47 patients" beside a template is a count of PEOPLE, and a
  // patient re-enrolled on the same pathway years later would make an enrolment count say 48 for 47
  // people. Named ids rather than a number so the figure IS the list.
  const patientsByTemplate = new Map<string, Set<string>>();
  for (const e of (enrolments ?? []) as any[]) {
    if (!patientsByTemplate.has(e.template_id)) patientsByTemplate.set(e.template_id, new Set());
    patientsByTemplate.get(e.template_id)!.add(e.patient_id);
  }

  return listed(rows.map(r => ({
    ...r,
    stages: byTemplate.get(r.id) ?? [],
    activePatientIds: [...(patientsByTemplate.get(r.id) ?? [])],
  })) as PathwayTemplate[]);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. PUTTING A PATIENT ON ONE (s4, s7, s10)
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Raise the obligation a stage asks for -- ONCE.
 *
 * ⚠ s9: "NO DUPLICATE ACTIVE FOLLOW-UPS SHOULD BE CREATED." The guard is over the stage's own history:
 * if any earlier visit to this stage of this enrolment left a follow-up that is still live, that one IS
 * the obligation and a second is not raised. It looks at STATUS, not at existence -- so a stage whose
 * follow-up was completed and which is then repeated raises a fresh one, which is the whole point of
 * being able to repeat a stage.
 */
// Exported so the harness can assert the rule DIRECTLY -- twice in a row against the same stage, with a
// control after the first obligation is closed. Through the product's own paths the guard almost never
// fires (repeatStage closes the live one before re-entering), which is exactly the shape of rule that
// passes a test vacuously if it is only exercised where it does nothing.
export async function raiseStageFollowUp(admin: any, args: {
  workspaceId: string; patientPathwayId: string; patientId: string; stage: TemplateStage;
  templateName: string; dueOn: string; actorId: string; correlationId: string;
}): Promise<{ followUpId: string | null; reused: boolean; error: string | null }> {
  if (!args.stage.follow_up_kind) return { followUpId: null, reused: false, error: null };

  const { data: priorRows, error: priorErr } = await admin.from("practice_patient_pathway_stage")
    .select("follow_up_id")
    .eq("patient_pathway_id", args.patientPathwayId).eq("stage_id", args.stage.id);
  if (priorErr) return { followUpId: null, reused: false, error: priorErr.message };

  const priorIds = ((priorRows ?? []) as any[]).map(r => r.follow_up_id).filter(Boolean);
  if (priorIds.length > 0) {
    const { data: prior, error } = await admin.from("practice_follow_up")
      .select("id, status").in("id", priorIds);
    if (error) return { followUpId: null, reused: false, error: error.message };
    const live = ((prior ?? []) as any[]).find(f => !CLOSED_FOLLOW_UP_STATUSES.includes(f.status));
    if (live) return { followUpId: live.id as string, reused: true, error: null };
  }

  const raised = await createFollowUp(admin, {
    workspaceId: args.workspaceId, patientId: args.patientId,
    kind: args.stage.follow_up_kind, dueOn: args.dueOn,
    priority: args.stage.follow_up_priority ?? "routine",
    // THE REASON NAMES THE PLAN IT CAME FROM. A follow-up on the board reading "review" with no context
    // is one a practitioner has to open a patient record to understand.
    reason: `${args.templateName}: ${args.stage.name}`,
    source: "pathway", originWorkspace: "pathways",
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!raised.ok) return { followUpId: null, reused: false, error: raised.message };
  return { followUpId: raised.data.id, reused: false, error: null };
}

/** Put the patient on a stage: a history row, its due date, and the obligation it raises. */
async function enterStage(admin: any, args: {
  workspaceId: string; patientPathwayId: string; patientId: string; templateName: string;
  stage: TemplateStage; from: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ stageRowId: string; dueOn: string; followUpId: string | null; reusedFollowUp: boolean }>> {
  // TIMING IS AN OFFSET FROM WHEN THE PATIENT ACTUALLY GOT HERE, not from when the pathway started.
  // A patient who reached stage 2 three weeks late is due stage 3 two weeks after that, not two weeks
  // after a date on a template that describes an idealised journey nobody took.
  const dueOn = addDays(args.from, args.stage.offset_days);

  const { data: row, error } = await admin.from("practice_patient_pathway_stage").insert({
    workspace_id: args.workspaceId, patient_pathway_id: args.patientPathwayId,
    stage_id: args.stage.id, state: "entered", entered_on: args.from, due_on: dueOn,
    created_by: args.actorId,
  }).select("id").single();
  if (error) {
    // ux_practice_pathway_stage_one_live: a patient cannot be at two points of one pathway at once.
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "STAGE_ALREADY_LIVE", message: "this pathway already has a live stage; close it before entering another" };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  const raised = await raiseStageFollowUp(admin, {
    workspaceId: args.workspaceId, patientPathwayId: args.patientPathwayId, patientId: args.patientId,
    stage: args.stage, templateName: args.templateName, dueOn,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (raised.followUpId) await admin.from("practice_patient_pathway_stage").update({ follow_up_id: raised.followUpId }).eq("id", row.id);

  await recordPathwayEvent(admin, {
    workspaceId: args.workspaceId, patientPathwayId: args.patientPathwayId, stageId: args.stage.id,
    eventType: "stage_entered", actorId: args.actorId,
    reason: raised.error ? `the follow-up for this stage was NOT raised: ${raised.error}` : null,
  });
  return { ok: true, data: { stageRowId: row.id as string, dueOn, followUpId: raised.followUpId, reusedFollowUp: raised.reused } };
}

export async function assignPathway(admin: any, args: {
  workspaceId: string; patientId: string; templateId: string;
  trigger?: string; originEncounterId?: string | null; note?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string; stageRowId: string; dueOn: string; followUpId: string | null }>> {
  const { data: patient } = await admin.from("practice_patient")
    .select("id, status").eq("id", args.patientId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (patient.status !== "active")
    return { ok: false, status: 422, code: "PATIENT_NOT_ACTIVE", message: "this patient record is not active (archived or merged)" };

  const { data: template } = await admin.from("practice_pathway_template")
    .select("id, name, is_active").eq("id", args.templateId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!template) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  // A retired template may not take new patients. The ones already on it stay on it -- see
  // publishPathwayVersion: the plan somebody is halfway through is not rewritten underneath them.
  if (!template.is_active)
    return { ok: false, status: 422, code: "TEMPLATE_RETIRED", message: `"${template.name}" has been retired; assign the current version` };

  const trigger = args.trigger ?? "manual";
  if (!PATHWAY_TRIGGERS.some(([c]) => c === trigger))
    return { ok: false, status: 400, code: "UNKNOWN_TRIGGER", message: `a trigger must be one of: ${PATHWAY_TRIGGERS.map(([c]) => c).join(", ")}` };

  let originEncounterId: string | null = null;
  if (args.originEncounterId) {
    const { data: enc } = await admin.from("practice_encounter")
      .select("id, patient_id").eq("id", args.originEncounterId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (enc.patient_id !== args.patientId)
      return { ok: false, status: 422, code: "ENCOUNTER_PATIENT_MISMATCH", message: "that encounter belongs to a different patient" };
    originEncounterId = enc.id;
  }

  const { data: stages, error: stageErr } = await admin.from("practice_pathway_stage")
    .select("id, position, name, offset_days, required_action, completion_rule, follow_up_kind, follow_up_priority")
    .eq("template_id", template.id).order("position");
  if (stageErr) return { ok: false, status: 500, code: "READ_FAILED", message: stageErr.message };
  const stageRows = (stages ?? []) as TemplateStage[];
  if (stageRows.length === 0)
    return { ok: false, status: 422, code: "NO_STAGES", message: "this pathway has no stages, so there is nothing to put the patient on" };

  const { today } = await workspaceClock(admin, args.workspaceId);

  const { data: enrol, error } = await admin.from("practice_patient_pathway").insert({
    workspace_id: args.workspaceId, patient_id: args.patientId, template_id: template.id,
    origin_encounter_id: originEncounterId, trigger, status: "active", started_on: today,
    created_by: args.actorId, updated_by: args.actorId,
  }).select("id").single();
  if (error) {
    // ux_practice_patient_pathway_live. s11 permits concurrent pathways; what is refused is the SAME
    // plan twice, which is a double-booking rather than concurrent care.
    if (/duplicate|unique/i.test(error.message))
      return { ok: false, status: 409, code: "ALREADY_ON_PATHWAY", message: `this patient is already on "${template.name}"` };
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  }

  await recordPathwayEvent(admin, {
    workspaceId: args.workspaceId, patientPathwayId: enrol.id, stageId: null,
    eventType: "assigned", reason: args.note ?? null, actorId: args.actorId,
  });

  const entered = await enterStage(admin, {
    workspaceId: args.workspaceId, patientPathwayId: enrol.id, patientId: args.patientId,
    templateName: template.name, stage: stageRows[0], from: today,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!entered.ok) return entered;

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.pathway_assigned",
    payload: { patientPathwayId: enrol.id, patientId: args.patientId, templateId: template.id, trigger },
    correlationId: args.correlationId,
  });
  return {
    ok: true,
    data: { id: enrol.id as string, stageRowId: entered.data.stageRowId, dueOn: entered.data.dueOn, followUpId: entered.data.followUpId },
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. MOVING THROUGH IT, AND DEPARTING FROM IT (s8, s9, s10)
// ════════════════════════════════════════════════════════════════════════════════════════════════════

type LiveContext = {
  enrolment: any; template: any; stages: TemplateStage[]; liveRow: any; liveStage: TemplateStage; today: string;
};

/** Everything an act on a live stage needs, read once. */
async function loadLive(admin: any, workspaceId: string, patientPathwayId: string): Promise<EngineResult<LiveContext>> {
  const { data: enrolment } = await admin.from("practice_patient_pathway")
    .select("id, patient_id, template_id, status, started_on").eq("id", patientPathwayId).eq("workspace_id", workspaceId).maybeSingle();
  if (!enrolment) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (enrolment.status !== "active")
    return { ok: false, status: 422, code: "PATHWAY_NOT_ACTIVE", message: `this pathway is ${enrolment.status}` };

  const [{ data: template }, { data: stages, error: stageErr }, { data: liveRow, error: liveErr }] = await Promise.all([
    admin.from("practice_pathway_template").select("id, name").eq("id", enrolment.template_id).maybeSingle(),
    admin.from("practice_pathway_stage")
      .select("id, position, name, offset_days, required_action, completion_rule, follow_up_kind, follow_up_priority")
      .eq("template_id", enrolment.template_id).order("position"),
    admin.from("practice_patient_pathway_stage")
      .select("id, stage_id, state, entered_on, due_on, follow_up_id")
      .eq("patient_pathway_id", patientPathwayId).eq("state", "entered").maybeSingle(),
  ]);
  if (stageErr) return { ok: false, status: 500, code: "READ_FAILED", message: stageErr.message };
  if (liveErr) return { ok: false, status: 500, code: "READ_FAILED", message: liveErr.message };
  if (!liveRow) return { ok: false, status: 422, code: "NO_LIVE_STAGE", message: "this pathway has no stage in progress" };

  const stageRows = (stages ?? []) as TemplateStage[];
  const liveStage = stageRows.find(s => s.id === liveRow.stage_id);
  if (!liveStage) return { ok: false, status: 500, code: "STAGE_MISSING", message: "the live stage is not in the template" };

  const { today } = await workspaceClock(admin, workspaceId);
  return { ok: true, data: { enrolment, template, stages: stageRows, liveRow, liveStage, today } };
}

/** Settle the obligation a stage raised, however the stage ended. Never refuses the stage's own move. */
async function settleStageFollowUp(admin: any, args: {
  workspaceId: string; followUpId: string | null; to: "COMPLETED" | "CANCELLED";
  outcome: string; closingEncounterId?: string | null; actorId: string; correlationId: string;
}): Promise<string | null> {
  if (!args.followUpId) return null;
  const { data: f } = await admin.from("practice_follow_up").select("id, status").eq("id", args.followUpId).maybeSingle();
  if (!f || CLOSED_FOLLOW_UP_STATUSES.includes(f.status)) return null;
  const done = await closeFollowUp(admin, {
    workspaceId: args.workspaceId, followUpId: args.followUpId, to: args.to,
    outcome: args.outcome, closingEncounterId: args.closingEncounterId ?? null,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  return done.ok ? null : done.message;
}

/** The next stage after a position, or null when the plan is finished. */
const nextAfter = (stages: TemplateStage[], position: number) =>
  stages.find(s => s.position > position) ?? null;

async function finishPathway(admin: any, args: {
  workspaceId: string; patientPathwayId: string; today: string; status: "completed" | "stopped";
  reason?: string | null; actorId: string; correlationId: string;
}) {
  await admin.from("practice_patient_pathway").update({
    status: args.status, ended_on: args.today,
    stopped_reason: args.status === "stopped" ? (args.reason?.trim() || null) : null,
    updated_at: nowIso(), updated_by: args.actorId,
  }).eq("id", args.patientPathwayId);
  await recordPathwayEvent(admin, {
    workspaceId: args.workspaceId, patientPathwayId: args.patientPathwayId,
    eventType: args.status === "completed" ? "pathway_completed" : "pathway_stopped",
    reason: args.reason ?? null, actorId: args.actorId,
  });
  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId,
    eventType: `practice.pathway_${args.status}`,
    payload: { patientPathwayId: args.patientPathwayId, reason: args.reason ?? null },
    correlationId: args.correlationId,
  });
}

export type StageMoveResult = {
  /** What the stage that was live became. */
  closedAs: string;
  /** The stage now in progress, or null when the pathway finished. */
  nextStageName: string | null;
  nextDueOn: string | null;
  nextFollowUpId: string | null;
  pathwayStatus: string;
  /** Anything that did not write. Never swallowed: a deviation whose audit failed is not audited. */
  warnings: string[];
};

/**
 * One function for every way a live stage ends, because they differ only in three things: the word
 * written on the closed row, the event recorded, and whether the obligation was met or abandoned.
 *
 * ⚠ NONE OF THE DEVIATIONS IS EVER REFUSED. There is no condition anywhere below that can stop a skip,
 * a repeat or a cancel. The only requirement is a reason, and that is s10 and s14's requirement, not a
 * gate on the act.
 */
async function moveStage(admin: any, args: {
  workspaceId: string; patientPathwayId: string;
  action: "complete" | "skip" | "cancel" | "repeat";
  reason?: string | null; note?: string | null; closingEncounterId?: string | null;
  actorId: string; correlationId: string;
}): Promise<EngineResult<StageMoveResult>> {
  const ctx = await loadLive(admin, args.workspaceId, args.patientPathwayId);
  if (!ctx.ok) return ctx;
  const { enrolment, template, stages, liveRow, liveStage, today } = ctx.data;

  const deviation = PATHWAY_DEVIATIONS.find(d => d.key === args.action);
  const reason = (args.reason ?? "").trim();
  // ⚠ THE REASON IS REQUIRED FOR A DEVIATION AND ONLY FOR A DEVIATION. Completing a stage the way the
  // plan expected needs no explanation; departing from the plan is the thing s14 exists to record, and a
  // skipped stage with no reason is the record of a decision without the decision.
  if (deviation?.needsReason && !reason)
    return {
      ok: false, status: 400, code: "REASON_REQUIRED",
      message: `say why this stage is being ${args.action === "skip" ? "skipped" : args.action === "cancel" ? "cancelled" : "repeated"}`,
    };

  if (args.closingEncounterId) {
    const { data: enc } = await admin.from("practice_encounter")
      .select("id, patient_id").eq("id", args.closingEncounterId).eq("workspace_id", args.workspaceId).maybeSingle();
    if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (enc.patient_id !== enrolment.patient_id)
      return { ok: false, status: 422, code: "ENCOUNTER_PATIENT_MISMATCH", message: "that encounter belongs to a different patient" };
  }

  const warnings: string[] = [];
  // A repeat closes the attempt as completed: the visit HAPPENED, and it is being done again. Marking it
  // cancelled would erase the fact that it took place, which is exactly the history s4 asks to preserve.
  const closedAs = args.action === "skip" ? "skipped" : args.action === "cancel" ? "cancelled" : "completed";

  const { error: closeErr } = await admin.from("practice_patient_pathway_stage").update({
    state: closedAs, ended_on: today,
    closing_encounter_id: args.closingEncounterId ?? null,
    note: (args.note ?? reason)?.trim() || null,
  }).eq("id", liveRow.id);
  if (closeErr) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: closeErr.message };

  const settleWarning = await settleStageFollowUp(admin, {
    workspaceId: args.workspaceId, followUpId: liveRow.follow_up_id,
    to: args.action === "complete" || args.action === "repeat" ? "COMPLETED" : "CANCELLED",
    outcome: args.action === "complete"
      ? (args.note?.trim() || `"${liveStage.name}" was completed on the ${template?.name ?? "pathway"} plan`)
      : args.action === "repeat"
        ? `this stage is being repeated: ${reason}`
        : `the "${liveStage.name}" stage was ${closedAs}: ${reason}`,
    closingEncounterId: args.closingEncounterId ?? null,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (settleWarning) warnings.push(`the obligation this stage raised was not closed: ${settleWarning}`);

  const eventWarning = await recordPathwayEvent(admin, {
    workspaceId: args.workspaceId, patientPathwayId: args.patientPathwayId, stageId: liveStage.id,
    eventType: deviation?.event ?? "stage_completed", reason: reason || null, actorId: args.actorId,
  });
  if (eventWarning) warnings.push(`⚠ the pathway audit row was NOT written: ${eventWarning}`);

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: `practice.pathway_stage_${closedAs}`,
    payload: { patientPathwayId: args.patientPathwayId, stageId: liveStage.id, action: args.action, reason: reason || null },
    correlationId: args.correlationId,
  });

  // REPEAT RE-ENTERS THE SAME STAGE. Everything else moves to the next one, and s9 is explicit that a
  // skipped stage does not stop the plan -- "the pathway moves to the next one".
  const target = args.action === "repeat" ? liveStage : nextAfter(stages, liveStage.position);
  if (!target) {
    await finishPathway(admin, {
      workspaceId: args.workspaceId, patientPathwayId: args.patientPathwayId, today,
      status: "completed", actorId: args.actorId, correlationId: args.correlationId,
    });
    return { ok: true, data: { closedAs, nextStageName: null, nextDueOn: null, nextFollowUpId: null, pathwayStatus: "completed", warnings } };
  }

  const entered = await enterStage(admin, {
    workspaceId: args.workspaceId, patientPathwayId: args.patientPathwayId, patientId: enrolment.patient_id,
    templateName: template?.name ?? "pathway", stage: target, from: today,
    actorId: args.actorId, correlationId: args.correlationId,
  });
  if (!entered.ok) return entered;

  return {
    ok: true,
    data: {
      closedAs, nextStageName: target.name, nextDueOn: entered.data.dueOn,
      nextFollowUpId: entered.data.followUpId, pathwayStatus: "active", warnings,
    },
  };
}

export const completeStage = (admin: any, args: {
  workspaceId: string; patientPathwayId: string; note?: string | null; closingEncounterId?: string | null;
  actorId: string; correlationId: string;
}) => moveStage(admin, { ...args, action: "complete" });

export const skipStage = (admin: any, args: {
  workspaceId: string; patientPathwayId: string; reason: string; actorId: string; correlationId: string;
}) => moveStage(admin, { ...args, action: "skip" });

export const cancelStage = (admin: any, args: {
  workspaceId: string; patientPathwayId: string; reason: string; actorId: string; correlationId: string;
}) => moveStage(admin, { ...args, action: "cancel" });

export const repeatStage = (admin: any, args: {
  workspaceId: string; patientPathwayId: string; reason: string; actorId: string; correlationId: string;
}) => moveStage(admin, { ...args, action: "repeat" });

/**
 * s10's "delay stage". The stage KEEPS ITS PLACE and moves its date, and any obligation it raised moves
 * with it -- through rescheduleFollowUp, so the original date survives in the follow-up's own trail.
 * A delay that left the follow-up on the old date would put the patient back on the overdue board the
 * next morning, which is the opposite of what the practitioner just decided.
 */
export async function delayStage(admin: any, args: {
  workspaceId: string; patientPathwayId: string; dueOn?: string; days?: number; reason: string;
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ from: string | null; to: string; followUpMoved: boolean; warnings: string[] }>> {
  const reason = (args.reason ?? "").trim();
  if (!reason) return { ok: false, status: 400, code: "REASON_REQUIRED", message: "say why this stage is being delayed" };

  const ctx = await loadLive(admin, args.workspaceId, args.patientPathwayId);
  if (!ctx.ok) return ctx;
  const { liveRow, liveStage, today } = ctx.data;

  const from = liveRow.due_on as string | null;
  const to = args.dueOn ?? (args.days !== undefined ? addDays(from ?? today, args.days) : null);
  if (!to || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "give a new date (dueOn) or a number of days" };
  if (from && to <= from)
    return { ok: false, status: 422, code: "NOT_A_DELAY", message: "a delay moves the date later; use the pathway's dates to bring it forward" };

  const { error } = await admin.from("practice_patient_pathway_stage").update({ due_on: to }).eq("id", liveRow.id);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  const warnings: string[] = [];
  let followUpMoved = false;
  if (liveRow.follow_up_id) {
    const moved = await rescheduleFollowUp(admin, {
      workspaceId: args.workspaceId, followUpId: liveRow.follow_up_id, dueOn: to,
      reason: `the pathway stage was delayed: ${reason}`,
      actorId: args.actorId, correlationId: args.correlationId,
    });
    followUpMoved = moved.ok;
    if (!moved.ok) warnings.push(`the obligation this stage raised did not move: ${moved.message}`);
  }

  const eventWarning = await recordPathwayEvent(admin, {
    workspaceId: args.workspaceId, patientPathwayId: args.patientPathwayId, stageId: liveStage.id,
    eventType: "stage_delayed", reason, actorId: args.actorId,
  });
  if (eventWarning) warnings.push(`⚠ the pathway audit row was NOT written: ${eventWarning}`);

  await audit(admin, {
    workspaceId: args.workspaceId, actorId: args.actorId, eventType: "practice.pathway_stage_delayed",
    payload: { patientPathwayId: args.patientPathwayId, stageId: liveStage.id, from, to, reason },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { from, to, followUpMoved, warnings } };
}

/** s10's "end pathway early". Never refused; the reason is required and the history is kept forever. */
export async function stopPathway(admin: any, args: {
  workspaceId: string; patientPathwayId: string; reason: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string; warnings: string[] }>> {
  const reason = (args.reason ?? "").trim();
  if (!reason) return { ok: false, status: 400, code: "REASON_REQUIRED", message: "say why this pathway is ending early" };

  const { data: enrolment } = await admin.from("practice_patient_pathway")
    .select("id, status").eq("id", args.patientPathwayId).eq("workspace_id", args.workspaceId).maybeSingle();
  if (!enrolment) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
  if (enrolment.status !== "active")
    return { ok: false, status: 422, code: "PATHWAY_NOT_ACTIVE", message: `this pathway is already ${enrolment.status}` };

  const { today } = await workspaceClock(admin, args.workspaceId);
  const warnings: string[] = [];

  const { data: liveRow } = await admin.from("practice_patient_pathway_stage")
    .select("id, stage_id, follow_up_id").eq("patient_pathway_id", args.patientPathwayId).eq("state", "entered").maybeSingle();
  if (liveRow) {
    await admin.from("practice_patient_pathway_stage")
      .update({ state: "cancelled", ended_on: today, note: `the pathway ended early: ${reason}` }).eq("id", liveRow.id);
    const settleWarning = await settleStageFollowUp(admin, {
      workspaceId: args.workspaceId, followUpId: liveRow.follow_up_id, to: "CANCELLED",
      outcome: `the pathway ended early: ${reason}`, actorId: args.actorId, correlationId: args.correlationId,
    });
    if (settleWarning) warnings.push(`the obligation this stage raised was not closed: ${settleWarning}`);
    const ev = await recordPathwayEvent(admin, {
      workspaceId: args.workspaceId, patientPathwayId: args.patientPathwayId, stageId: liveRow.stage_id,
      eventType: "stage_cancelled", reason, actorId: args.actorId,
    });
    if (ev) warnings.push(`⚠ the pathway audit row was NOT written: ${ev}`);
  }

  await finishPathway(admin, {
    workspaceId: args.workspaceId, patientPathwayId: args.patientPathwayId, today,
    status: "stopped", reason, actorId: args.actorId, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: "stopped", warnings } };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// 4. READING IT BACK (s11 the patient panel, s12 the workspace, s14 the permanent history)
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type PatientPathwayView = {
  id: string;
  patient_id: string;
  patient_name: string | null;
  template_id: string;
  template_name: string;
  template_version: number;
  specialty: string | null;
  status: string;
  trigger: string;
  started_on: string;
  ended_on: string | null;
  stopped_reason: string | null;
  /** "Stage 3 of 5" -- the live stage's position, and how many the template has. */
  stagePosition: number | null;
  stageCount: number;
  stageName: string | null;
  /** The live stage's own due date, which is what progress is derived from. */
  stageDueOn: string | null;
  stageDueInDays: number | null;
  /** The obligation the live stage raised, when it raised one. */
  followUpId: string | null;
  /** ⚠ DERIVED from stageDueOn against the practice's today. Never stored. "At risk" is refused. */
  progress: PathwayProgressState;
  /** Every stage the patient has actually reached, oldest first. Permanent (s16). */
  history: {
    id: string; stage_id: string; stageName: string; position: number | null;
    state: string; entered_on: string; due_on: string | null; ended_on: string | null;
    note: string | null; follow_up_id: string | null; closing_encounter_id: string | null;
  }[];
};

async function buildPathwayViews(admin: any, workspaceId: string, enrolments: any[], today: string): Promise<PathwayList<PatientPathwayView>> {
  if (enrolments.length === 0) return listed([]);

  const templateIds = [...new Set(enrolments.map(e => e.template_id))];
  const patientIds = [...new Set(enrolments.map(e => e.patient_id))];
  const enrolIds = enrolments.map(e => e.id);

  const [templates, stages, progress, patients] = await Promise.all([
    admin.from("practice_pathway_template").select("id, name, version, specialty").in("id", templateIds),
    admin.from("practice_pathway_stage").select("id, template_id, position, name").in("template_id", templateIds).order("position"),
    admin.from("practice_patient_pathway_stage")
      .select("id, patient_pathway_id, stage_id, state, entered_on, due_on, ended_on, note, follow_up_id, closing_encounter_id")
      .in("patient_pathway_id", enrolIds).order("entered_on"),
    admin.from("practice_patient").select("id, display_name").in("id", patientIds),
  ]);
  for (const r of [templates, stages, progress, patients]) {
    // ⚠ ANY ONE OF THESE FAILING MAKES EVERY FIGURE BELOW WRONG IN A WAY THAT LOOKS FINE: a failed stage
    // read would render every pathway as "stage - of 0", which reads as a data problem with the pathways
    // rather than with the screen.
    if ((r as any).error) return failed((r as any).error.message);
  }

  const templateById = new Map(((templates as any).data ?? []).map((t: any) => [t.id, t]));
  const nameById = new Map(((patients as any).data ?? []).map((p: any) => [p.id, p.display_name]));
  const stagesByTemplate = new Map<string, any[]>();
  for (const s of ((stages as any).data ?? []) as any[]) {
    if (!stagesByTemplate.has(s.template_id)) stagesByTemplate.set(s.template_id, []);
    stagesByTemplate.get(s.template_id)!.push(s);
  }
  const stageById = new Map(((stages as any).data ?? []).map((s: any) => [s.id, s]));
  const progressByEnrolment = new Map<string, any[]>();
  for (const p of ((progress as any).data ?? []) as any[]) {
    if (!progressByEnrolment.has(p.patient_pathway_id)) progressByEnrolment.set(p.patient_pathway_id, []);
    progressByEnrolment.get(p.patient_pathway_id)!.push(p);
  }

  return listed(enrolments.map(e => {
    const t = templateById.get(e.template_id) as any;
    const templateStages = stagesByTemplate.get(e.template_id) ?? [];
    const rows = progressByEnrolment.get(e.id) ?? [];
    const live = rows.find(r => r.state === "entered") ?? null;
    const liveStage = live ? (stageById.get(live.stage_id) as any) : null;
    const stageDueOn = live?.due_on ?? null;

    return {
      id: e.id, patient_id: e.patient_id, patient_name: (nameById.get(e.patient_id) as string) ?? null,
      template_id: e.template_id, template_name: t?.name ?? "Unknown pathway",
      template_version: t?.version ?? 1, specialty: t?.specialty ?? null,
      status: e.status, trigger: e.trigger, started_on: e.started_on,
      ended_on: e.ended_on ?? null, stopped_reason: e.stopped_reason ?? null,
      stagePosition: liveStage?.position ?? null,
      stageCount: templateStages.length,
      stageName: liveStage?.name ?? null,
      stageDueOn,
      stageDueInDays: stageDueOn ? dayGap(today, stageDueOn) : null,
      followUpId: live?.follow_up_id ?? null,
      progress: pathwayProgress({ pathwayStatus: e.status, stageDueOn, today }),
      history: rows.map(r => ({
        id: r.id, stage_id: r.stage_id,
        stageName: (stageById.get(r.stage_id) as any)?.name ?? "Unknown stage",
        position: (stageById.get(r.stage_id) as any)?.position ?? null,
        state: r.state, entered_on: r.entered_on, due_on: r.due_on, ended_on: r.ended_on,
        note: r.note, follow_up_id: r.follow_up_id, closing_encounter_id: r.closing_encounter_id,
      })),
    };
  }));
}

/**
 * s11's patient-record panel: every pathway this patient is on, and every one they have ever been on.
 *
 * ⚠ ENDED PATHWAYS ARE RETURNED TOO (s16: "pathway history remains permanently available"). A panel that
 * showed only the live ones would answer "is this patient on a plan" and lose "what was tried before",
 * which is the question a new practitioner opening the record actually has.
 */
export async function listPatientPathways(admin: any, workspaceId: string, patientId: string): Promise<PathwayList<PatientPathwayView>> {
  const { data, error } = await admin.from("practice_patient_pathway")
    .select("id, patient_id, template_id, status, trigger, started_on, ended_on, stopped_reason")
    .eq("workspace_id", workspaceId).eq("patient_id", patientId).order("started_on", { ascending: false });
  if (error) return failed(error.message);
  const { today } = await workspaceClock(admin, workspaceId);
  return buildPathwayViews(admin, workspaceId, (data ?? []) as any[], today);
}

export async function getPatientPathway(admin: any, workspaceId: string, patientPathwayId: string): Promise<{
  pathway: PatientPathwayView | null; events: any[]; unavailable: boolean; detail: string | null;
}> {
  const { data, error } = await admin.from("practice_patient_pathway")
    .select("id, patient_id, template_id, status, trigger, started_on, ended_on, stopped_reason")
    .eq("workspace_id", workspaceId).eq("id", patientPathwayId).maybeSingle();
  if (error) return { pathway: null, events: [], unavailable: true, detail: error.message };
  if (!data) return { pathway: null, events: [], unavailable: false, detail: null };

  const { today } = await workspaceClock(admin, workspaceId);
  const [views, { data: events, error: eventErr }] = await Promise.all([
    buildPathwayViews(admin, workspaceId, [data], today),
    admin.from("practice_pathway_event")
      .select("id, stage_id, event_type, reason, occurred_at, actor_id")
      .eq("patient_pathway_id", patientPathwayId).order("occurred_at", { ascending: false }),
  ]);
  if (views.unavailable) return { pathway: null, events: [], unavailable: true, detail: views.detail };
  if (eventErr) return { pathway: views.items[0] ?? null, events: [], unavailable: true, detail: eventErr.message };
  return { pathway: views.items[0] ?? null, events: (events ?? []) as any[], unavailable: false, detail: null };
}

export type PathwayCard = { key: string; label: string; blurb: string; count: number | null; ids: string[] };

export type PathwayWorkspace = {
  cards: PathwayCard[];
  pathways: PatientPathwayView[];
  templates: PathwayTemplate[];
  today: string;
  timezone: string;
  unavailable: boolean;
  detail: string | null;
  templatesUnavailable: boolean;
  templatesDetail: string | null;
};

/**
 * The Care Pathways screen.
 *
 * ⚠ THE CARDS' FIGURES ARE LENGTHS OF LISTS, AND THE LISTS ARE HERE. Same rule as the follow-ups
 * workspace, and the "Active Pathways" card is the one that would have broken it: the design labels it
 * "24 Active Pathways / Across 18 patients", which is TWO figures over two different things. Both are
 * carried, both as named ids, because a single number under an ambiguous label is how a card counting
 * rows ends up beside a list counting people.
 *
 * ⚠ THERE IS NO "AT RISK" CARD. The design has one between On Track and Overdue. See AT_RISK_REFUSAL.
 */
export async function pathwayWorkspace(admin: any, workspaceId: string, options: {
  templateId?: string | null; status?: string | null; search?: string | null; activeOnly?: boolean;
} = {}): Promise<PathwayWorkspace> {
  const { timezone, today } = await workspaceClock(admin, workspaceId);

  const [{ data, error }, templates] = await Promise.all([
    admin.from("practice_patient_pathway")
      .select("id, patient_id, template_id, status, trigger, started_on, ended_on, stopped_reason")
      .eq("workspace_id", workspaceId).order("started_on", { ascending: false }).limit(500),
    listPathwayTemplates(admin, workspaceId, { includeInactive: true }),
  ]);

  const emptyCards = (): PathwayCard[] => PATHWAY_CARD_SHAPE.map(c => ({ ...c, count: null, ids: [] }));
  if (error) {
    return {
      cards: emptyCards(), pathways: [], templates: templates.items, today, timezone,
      unavailable: true, detail: error.message,
      templatesUnavailable: templates.unavailable, templatesDetail: templates.detail,
    };
  }

  const built = await buildPathwayViews(admin, workspaceId, (data ?? []) as any[], today);
  if (built.unavailable) {
    return {
      cards: emptyCards(), pathways: [], templates: templates.items, today, timezone,
      unavailable: true, detail: built.detail,
      templatesUnavailable: templates.unavailable, templatesDetail: templates.detail,
    };
  }

  const needle = (options.search ?? "").trim().toLowerCase();
  const filtered = built.items.filter(p => {
    if (options.templateId && p.template_id !== options.templateId) return false;
    if (options.status && p.status !== options.status) return false;
    if (options.activeOnly && p.status !== "active") return false;
    if (!needle) return true;
    return `${p.patient_name ?? ""} ${p.template_name}`.toLowerCase().includes(needle);
  });

  const active = filtered.filter(p => p.status === "active");
  const cards: PathwayCard[] = [
    { ...PATHWAY_CARD_SHAPE[0], count: active.length, ids: active.map(p => p.id) },
    {
      ...PATHWAY_CARD_SHAPE[1],
      count: new Set(active.map(p => p.patient_id)).size,
      ids: [...new Set(active.map(p => p.patient_id))],
    },
    {
      ...PATHWAY_CARD_SHAPE[2],
      count: active.filter(p => p.progress === "on_track").length,
      ids: active.filter(p => p.progress === "on_track").map(p => p.id),
    },
    {
      ...PATHWAY_CARD_SHAPE[3],
      count: active.filter(p => p.progress === "overdue").length,
      ids: active.filter(p => p.progress === "overdue").map(p => p.id),
    },
    {
      ...PATHWAY_CARD_SHAPE[4],
      count: filtered.filter(p => p.status === "completed").length,
      ids: filtered.filter(p => p.status === "completed").map(p => p.id),
    },
  ];

  return {
    cards, pathways: filtered, templates: templates.items, today, timezone,
    unavailable: false, detail: null,
    templatesUnavailable: templates.unavailable, templatesDetail: templates.detail,
  };
}

/** The five cards' identities, declared once so the unavailable case draws the same row as the live one. */
export const PATHWAY_CARD_SHAPE: { key: string; label: string; blurb: string }[] = [
  { key: "active", label: "Active pathways", blurb: "Enrolments still running. A patient on three plans counts three times here - the card beside this one counts the people." },
  { key: "patients", label: "Patients on a pathway", blurb: "Distinct people with at least one active pathway. Always the smaller of the two figures, or equal to it." },
  { key: "on_track", label: "On track", blurb: "The current stage's due date has not passed. Derived from the date against this practice's today." },
  { key: "overdue", label: "Overdue", blurb: "The current stage's due date has passed. The same arithmetic as On track, the other way round." },
  { key: "completed", label: "Completed", blurb: "Pathways that reached their last stage. Stopped ones are not counted here - ending early is not finishing." },
];
