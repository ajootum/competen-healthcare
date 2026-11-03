/* eslint-disable @typescript-eslint/no-explicit-any */
import type { StageScale } from "../../core";
import { stageScaleViaRpc } from "./stage-scale-rpc";
import { buildStageView, latestPerRuleSet, type DecisionRow, type RuleSetFact, type StageView } from "./progression-view";
import { TARGET_KIND_COMPETENCY, TARGET_KIND_INSTRUMENT } from "./targets";

// ── THE LEARNER'S EVIDENCE-SUPPORTED STAGE: THE READ ── Checklist Studio S3 ───────────────────────────────────────────
//
// Server only. Reads the learner's OWN progression decisions (service role, always filtered by the learner), keeps the newest per rule set,
// names the stage with the stage scale's labels, and maps each decision to the competencies it speaks about:
//   a rule set that targets a competency -> that competency;
//   a rule set that targets an instrument -> the competencies that instrument's mappings ASSESS (the same reach the assessor step uses).
// Only the decision's own columns are selected. A decision is never written here.

type Admin = any;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (x: unknown): x is string => typeof x === "string" && UUID.test(x);

export type StageEntry = { view: StageView; competencyIds: string[]; instrumentId: string | null };
export type StageSide = { state: "unreadable" } | { state: "ready"; entries: StageEntry[] };

/** The competency a mapping row assesses: a competency mapping's own ref, or a criterion mapping's frozen competency (or its skill's). Pure. */
export function mappedCompetencyId(m: { kind: string; ref_id: string | null; ref_snapshot: any }, skillCompetency: ReadonlyMap<string, string>): string | null {
  if (!isUuid(m.ref_id)) return null;
  if (m.kind === "competency") return m.ref_id;
  if (m.kind === "competency_criterion") {
    const frozen = m.ref_snapshot?.competency_id;
    return isUuid(frozen) ? frozen : skillCompetency.get(m.ref_id) ?? null;
  }
  return null;
}

/** instrument id -> the competencies its versions' mappings assess. A definition read: nothing about a person. */
async function instrumentCompetencies(admin: Admin, instrumentIds: readonly string[]): Promise<Map<string, string[]> | null> {
  const out = new Map<string, string[]>();
  if (!instrumentIds.length) return out;
  const vers = await admin.from("asmt_instrument_version").select("id, instrument_id").in("instrument_id", instrumentIds).in("state", ["published", "retired"]);
  if (vers.error) return null;
  const versionOf = new Map<string, string>(((vers.data ?? []) as any[]).map(v => [v.id as string, v.instrument_id as string]));
  if (!versionOf.size) return out;
  const maps = await admin.from("asmt_mapping").select("version_id, kind, ref_id, ref_snapshot, relation").in("version_id", [...versionOf.keys()]).eq("relation", "assesses");
  if (maps.error) return null;
  const rows = (maps.data ?? []) as any[];
  const needSkill = [...new Set(rows.filter(m => m.kind === "competency_criterion" && !isUuid(m.ref_snapshot?.competency_id) && isUuid(m.ref_id)).map(m => m.ref_id as string))];
  const skillCompetency = new Map<string, string>();
  if (needSkill.length) {
    const s = await admin.from("competency_skills").select("id, competency_id").in("id", needSkill);
    if (s.error) return null;
    for (const x of (s.data ?? []) as any[]) skillCompetency.set(x.id, x.competency_id);
  }
  for (const m of rows) {
    const inst = versionOf.get(m.version_id);
    const c = mappedCompetencyId(m, skillCompetency);
    if (!inst || !c) continue;
    const list = out.get(inst) ?? [];
    if (!list.includes(c)) list.push(c);
    out.set(inst, list);
  }
  return out;
}

/**
 * The learner's evidence-supported stage per rule set. "unreadable" when any read failed, so a failure is never shown as "no stage".
 * An environment without the progression tables is simply unreadable here: the caller shows nothing for it.
 */
export async function loadStageSide(admin: Admin, userId: string, now: Date = new Date()): Promise<StageSide> {
  try {
    const dec = await admin.from("asmt_progression_decision")
      .select("id, rule_version_id, state, stage_code, target_stage_code, outstanding, valid_until, computed_at")
      .eq("subject_user_id", userId).order("computed_at", { ascending: false }).limit(200);
    if (dec.error) return { state: "unreadable" };
    const decisions: DecisionRow[] = ((dec.data ?? []) as any[]).map(d => ({
      id: d.id, ruleVersionId: d.rule_version_id, state: d.state, stageCode: d.stage_code ?? null, targetStageCode: d.target_stage_code ?? null,
      outstanding: d.outstanding, validUntil: d.valid_until ?? null, computedAt: d.computed_at,
    }));
    if (!decisions.length) return { state: "ready", entries: [] };

    const rv = await admin.from("asmt_progression_rule_version").select("id, rule_set_id, stage_scale_version_id").in("id", [...new Set(decisions.map(d => d.ruleVersionId))]);
    if (rv.error) return { state: "unreadable" };
    const ruleSetOf = new Map<string, string>(((rv.data ?? []) as any[]).map(r => [r.id as string, r.rule_set_id as string]));
    const scaleOfVersion = new Map<string, string>(((rv.data ?? []) as any[]).map(r => [r.id as string, r.stage_scale_version_id as string]));
    const latest = latestPerRuleSet(decisions, ruleSetOf);
    if (!latest.size) return { state: "ready", entries: [] };

    const rs = await admin.from("asmt_progression_rule_set").select("id, code, name, target_kind, target_ref").in("id", [...latest.keys()]);
    if (rs.error) return { state: "unreadable" };
    const sets = new Map<string, RuleSetFact>();
    for (const r of (rs.data ?? []) as any[]) sets.set(r.id, { ruleSetId: r.id, code: r.code, name: r.name, targetKind: r.target_kind, targetRef: r.target_ref ?? null, stageScaleVersionId: null });

    const scaleIds = [...new Set([...latest.values()].map(d => scaleOfVersion.get(d.ruleVersionId)).filter((x): x is string => !!x))];
    const scales = new Map<string, StageScale | null>();
    await Promise.all(scaleIds.map(async id => { scales.set(id, await stageScaleViaRpc(admin, id).catch(() => null)); }));

    const instrumentIds = [...sets.values()].filter(s => s.targetKind === TARGET_KIND_INSTRUMENT && isUuid(s.targetRef)).map(s => s.targetRef as string);
    const byInstrument = await instrumentCompetencies(admin, [...new Set(instrumentIds)]);
    if (!byInstrument) return { state: "unreadable" };

    const entries: StageEntry[] = [];
    for (const [setId, d] of latest) {
      const set = sets.get(setId);
      if (!set) continue;
      const scale = scales.get(scaleOfVersion.get(d.ruleVersionId) ?? "") ?? null;
      const competencyIds = set.targetKind === TARGET_KIND_COMPETENCY && isUuid(set.targetRef) ? [set.targetRef]
        : set.targetKind === TARGET_KIND_INSTRUMENT && isUuid(set.targetRef) ? byInstrument.get(set.targetRef) ?? [] : [];
      entries.push({ view: buildStageView(d, set, scale, now), competencyIds, instrumentId: set.targetKind === TARGET_KIND_INSTRUMENT && isUuid(set.targetRef) ? set.targetRef : null });
    }
    entries.sort((a, b) => b.view.computedAt.localeCompare(a.view.computedAt));
    return { state: "ready", entries };
  } catch { return { state: "unreadable" }; }
}

/** The entries that speak about one assessment report: a rule set on its instrument, or on a competency it assesses. Pure. */
export function entriesForReport(entries: readonly StageEntry[], instrumentId: string, competencyIds: readonly string[]): StageView[] {
  return entries.filter(e => e.instrumentId === instrumentId || e.competencyIds.some(c => competencyIds.includes(c))).map(e => e.view);
}
