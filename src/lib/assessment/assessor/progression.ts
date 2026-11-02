// Assessor workspace: the progression step after a submit.
//
// ⚠ EVERY STEP IS GUARDED AND NONE OF THEM CAN FAIL A SUBMIT. By the time this runs the outcome is recorded and the
// instance is closed. A missing migration, a checklist that maps to nothing, no rule set, no published rule version, a
// stage scale that cannot be read, a rule document that does not validate: each is a recorded SKIP with its reason, never
// an error that undoes or hides the submit.
//
// ⚠ THIS IS THE ONE FILE THAT READS A SUBJECT'S OWN EVIDENCE ACROSS ASSESSORS. A stage rests on several assessments, so
// the evidence is the subject's submitted, assessor-evaluated outcomes (filtered by subject_user_id, status submitted,
// attestation assessor_evaluated), read on the server, turned into evidence records and handed to the engine. Nothing of
// it is returned to the browser. Self-led work is not read at all, and the engine and the database both refuse it again.
//
// ⚠ DECISIONS ARE NEVER READ HERE. asmt_record_progression is the only door and it supersedes the previous decision itself.
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ENGINE_VERSION, evaluateProgression, groupMinOrdinals, validateProgression,
  type OutcomeClass, type ProgressionDoc, type ProgressionEvidence, type Responses, type StageScale,
} from "@/lib/assessment/core";
import { type Admin, type OwnedInstance, isMissingRelation, isUuid } from "./common";
import { loadDefinition } from "./definition";
import { responsesFromRows } from "./instances";

/** Supplies the stage scale (stages and bands) of a stage scale version. Injected: the bands belong to the adapter, not here. */
export type StageScaleLoader = (admin: Admin, stageScaleVersionId: string) => Promise<StageScale | null>;

export interface ProgressionNote {
  status: "recorded" | "skipped";
  reason?: string;
  decisions: { ruleSet: string; state: string; stage: string | null; target: string | null }[];
}

const DAY = 86_400_000;

/** Every uuid a version could be targeted by: what its mappings point at, ids inside the frozen snapshots, and the instrument. */
export function targetRefs(instrumentId: string, mappings: { ref_id: string | null; ref_snapshot: any }[]): string[] {
  const out = new Set<string>([instrumentId]);
  for (const m of mappings) {
    if (isUuid(m.ref_id)) out.add(m.ref_id);
    const snap = m.ref_snapshot;
    if (snap && typeof snap === "object") for (const [k, v] of Object.entries(snap)) if (k.endsWith("_id") && isUuid(v)) out.add(v as string);
  }
  return [...out];
}

/** The evidence record of one submitted outcome (design s7). Pure. */
export function evidenceRecord(args: {
  outcomeId: string; attestation: string; methods: string[]; assessorId: string | null; submittedAt: string;
  outcomeClass: string; outcomeCode: string; groupMin: Record<string, number | null>; trace: any; backstopDetail: any;
}): ProgressionEvidence {
  const steps: any[] = Array.isArray(args.trace?.steps) ? args.trace.steps : [];
  const gateHit = steps.some(s => s?.kind === "gate" && s?.gate === "criticalFail" && s?.triggered === true)
    || (Array.isArray(args.backstopDetail?.criticalFailed) && args.backstopDetail.criticalFailed.length > 0)
    || args.trace?.gates?.criticalFail?.triggered === true;
  return {
    id: args.outcomeId, attestation: args.attestation as ProgressionEvidence["attestation"], methods: args.methods, assessor_id: args.assessorId,
    submitted_at: args.submittedAt, outcome_class: args.outcomeClass as OutcomeClass, outcome_code: args.outcomeCode,
    group_min_ordinal: args.groupMin, critical_failed: gateHit,
  };
}

export function validUntil(rules: ProgressionDoc, qualifying: ProgressionEvidence[]): string | null {
  const days = rules.evidence?.withinDays;
  if (days === undefined || !qualifying.length) return null;
  const oldest = Math.min(...qualifying.map(e => new Date(e.submitted_at).getTime()));
  return new Date(oldest + days * DAY).toISOString();
}

const skip = (reason: string): ProgressionNote => ({ status: "skipped", reason, decisions: [] });

export async function recordProgression(admin: Admin, inst: OwnedInstance, deps: { stageScale?: StageScaleLoader; now?: Date } = {}): Promise<ProgressionNote> {
  try {
    if (!deps.stageScale) return skip("no stage scale source");
    if (!inst.subject_user_id) return skip("the subject is not a person");
    const subject = inst.subject_user_id;

    const ver = await admin.from("asmt_instrument_version").select("instrument_id").eq("id", inst.instrument_version_id).maybeSingle();
    if (ver.error || !ver.data) return skip("the checklist version could not be read");
    const map = await admin.from("asmt_mapping").select("ref_id, ref_snapshot, relation").eq("version_id", inst.instrument_version_id);
    if (map.error) return skip("mappings not readable");
    const refs = targetRefs(ver.data.instrument_id, ((map.data ?? []) as any[]).filter(m => m.relation === "assesses"));

    const sets = await admin.from("asmt_progression_rule_set").select("id, code, target_ref").in("target_ref", refs);
    if (sets.error) return skip(isMissingRelation(sets.error) ? "progression is not set up on this environment" : "rule sets not readable");
    if (!sets.data || !sets.data.length) return skip("no rule set targets this checklist");

    const note: ProgressionNote = { status: "skipped", reason: "no published rule version", decisions: [] };
    for (const set of sets.data as any[]) {
      const rv = await admin.from("asmt_progression_rule_version").select("id, rules, rules_hash, stage_scale_version_id, version_no")
        .eq("rule_set_id", set.id).eq("state", "published").order("version_no", { ascending: false }).limit(1).maybeSingle();
      if (rv.error || !rv.data) continue;
      const scale = await deps.stageScale(admin, rv.data.stage_scale_version_id);
      if (!scale) { note.reason = "the stage scale could not be read"; continue; }
      const rules = rv.data.rules as ProgressionDoc;
      const v = validateProgression(rules, scale);
      if (v.errors.length) { note.reason = "the rule version does not validate"; continue; }

      const evidence = await subjectEvidence(admin, subject, set.target_ref as string, deps.now);
      if (!evidence) { note.reason = "the evidence could not be read"; continue; }
      const result = evaluateProgression(rules, scale, evidence, deps.now ?? new Date());
      const qualifying = evidence.filter(e => result.qualifying_ids.includes(e.id));
      const rec = await admin.rpc("asmt_record_progression", {
        p_subject: subject, p_rule_version: rv.data.id, p_state: result.state, p_stage: result.stage, p_target: result.target,
        p_outstanding: result.outstanding, p_evidence: result.qualifying_ids,
        p_trace: { steps: result.trace, traceHash: result.trace_hash, conflict: result.conflict, excluded: result.excluded },
        p_engine: ENGINE_VERSION, p_trigger: "instance_submitted", p_valid_until: validUntil(rules, qualifying),
      });
      if (rec.error) { note.reason = "the decision was refused"; continue; }
      note.status = "recorded"; delete note.reason;
      note.decisions.push({ ruleSet: set.code as string, state: result.state, stage: result.stage, target: result.target });
    }
    return note;
  } catch {
    return skip("progression could not be computed");
  }
}

/** The subject's submitted assessor-evaluated outcomes whose checklist version maps to the target. Null when unreadable. */
async function subjectEvidence(admin: Admin, subject: string, targetRef: string, _now?: Date): Promise<ProgressionEvidence[] | null> {
  const insts = await admin.from("asmt_instance").select("id, instrument_version_id, respondent_id, submitted_at, attestation")
    .eq("subject_user_id", subject).eq("status", "submitted").eq("attestation", "assessor_evaluated");
  if (insts.error) return null;
  const rows = (insts.data ?? []) as any[];
  if (!rows.length) return [];
  const versionIds = [...new Set(rows.map(r => r.instrument_version_id as string))];
  const [maps, vers] = await Promise.all([
    admin.from("asmt_mapping").select("version_id, ref_id, ref_snapshot, relation").in("version_id", versionIds),
    admin.from("asmt_instrument_version").select("id, instrument_id, method_codes").in("id", versionIds),
  ]);
  if (maps.error || vers.error) return null;
  const versionInfo = new Map<string, { instrumentId: string; methods: string[] }>((vers.data ?? []).map((v: any) => [v.id as string, { instrumentId: v.instrument_id as string, methods: (v.method_codes ?? []) as string[] }]));
  const applies = new Set<string>();
  for (const vid of versionIds) {
    const vm = ((maps.data ?? []) as any[]).filter(m => m.version_id === vid && m.relation === "assesses");
    const instId = versionInfo.get(vid)?.instrumentId;
    if (instId && targetRefs(instId, vm).includes(targetRef)) applies.add(vid);
  }
  const mine = rows.filter(r => applies.has(r.instrument_version_id));
  if (!mine.length) return [];
  const outs = await admin.from("asmt_outcome").select("id, instance_id, outcome_code, outcome_class, trace, backstop_detail").in("instance_id", mine.map(r => r.id));
  if (outs.error) return null;
  const defs = new Map<string, Awaited<ReturnType<typeof loadDefinition>>>();
  const out: ProgressionEvidence[] = [];
  for (const o of (outs.data ?? []) as any[]) {
    const r = mine.find(x => x.id === o.instance_id);
    if (!r) continue;
    let d = defs.get(r.instrument_version_id);
    if (!d) { d = await loadDefinition(admin, r.instrument_version_id); defs.set(r.instrument_version_id, d); }
    if (!d.ok) return null;
    const ans = await admin.from("asmt_response").select("item_id, field_key, value, revision").eq("instance_id", r.id);
    if (ans.error) return null;
    const responses: Responses = responsesFromRows((ans.data ?? []) as any[], d.value.itemKeyById).responses;
    out.push(evidenceRecord({
      outcomeId: o.id, attestation: r.attestation, methods: versionInfo.get(r.instrument_version_id)?.methods ?? [], assessorId: r.respondent_id ?? null,
      submittedAt: r.submitted_at, outcomeClass: o.outcome_class, outcomeCode: o.outcome_code, groupMin: groupMinOrdinals(d.value.def, responses),
      trace: o.trace, backstopDetail: o.backstop_detail,
    }));
  }
  return out;
}
