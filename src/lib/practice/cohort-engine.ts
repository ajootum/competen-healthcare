import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { audit } from "@/lib/practice/audit";
import { practiceToday } from "@/lib/practice/practice-time";
import {
  SEGMENT_REGISTRY, segmentById, isSegmentId, DEFAULT_NO_VISIT_DAYS, type SegmentDef,
} from "@/lib/practice/segment-registry";

// CPR-PI-001 v2 s6 -- THE COHORT ENGINE: authorized dynamic and saved populations.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// A SEGMENT IS COMPUTED FROM THE REGISTRY'S OWN DERIVATION, AT READ TIME, OVER LIVE ROWS -- nothing
// materialises a membership list, because a stored list is stale the day after it is written and
// nobody can see that it is. What CAN be saved (practice_cohort, migration 305) is a NAMED
// COMBINATION of registered segment ids -- the definition, never the members.
//
// PERMISSION-SCOPED (s6): counts need report.view like every intelligence figure; the patient LIST
// carries names only under patient.view, the same identified rule the whole product follows. A
// combined cohort is an INTERSECTION (every named segment must hold) -- stated on screen, because
// "and" versus "or" is exactly the ambiguity a human-readable filter exists to kill.
//
// ⚠ EVERY READ IS BOUNDED AND SAYS SO. Segment membership over an unbounded practice would be the
// PostgREST 1000-row silent cap wearing a cohort costume: reads fetch CAP+1 and a truncated result
// renders as "at least", never as an exact count.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SegmentResult = {
  segment: SegmentDef;
  count: number;
  /** Active (non-merged) patients -- the denominator every segment count renders beside. */
  denominator: number;
  /** Patients the derivation could not place (for the age segments: no birth date). Disclosed. */
  unplaceable: number;
  truncated: boolean;
  noVisitDays: number | null;
};

export type CohortPatientRow = { id: string; label: string; detail: string };

const CAP = 999;

/** Membership per segment, as id sets over bounded reads. The single derivation both entry points share. */
async function segmentMembers(admin: any, ctx: WorkspaceContext, segmentId: string, opts: {
  noVisitDays: number; today: string;
}): Promise<{ ids: Set<string>; denominator: number; unplaceable: number; truncated: boolean } | { error: string }> {
  const ws = ctx.workspaceId;
  const { data: patients, error: pErr } = await admin.from("practice_patient")
    .select("id, birth_date, age_estimate_years, status").eq("workspace_id", ws).neq("status", "merged").limit(CAP + 1);
  if (pErr) return { error: pErr.message };
  const pats = ((patients ?? []) as any[]);
  const truncated = pats.length > CAP;
  const active = pats.slice(0, CAP);
  const denominator = active.length;

  // Birth date first; else the REGISTRATION-TIME estimate (CPR-V2-005 allows either). The estimate
  // is used as recorded, not aged forward -- ageing a guess would be a second guess -- and the
  // registry definition says so. Neither recorded = unplaceable, disclosed.
  const ageOn = (p: any): number | null => {
    if (p.birth_date)
      return Math.floor((Date.parse(opts.today + "T00:00:00Z") - Date.parse(p.birth_date + "T00:00:00Z")) / (365.25 * 86400000));
    if (typeof p.age_estimate_years === "number") return p.age_estimate_years;
    return null;
  };

  if (segmentId === "seg.paediatric" || segmentId === "seg.older_adult") {
    const ids = new Set<string>();
    let unplaceable = 0;
    for (const p of active) {
      const age = ageOn(p);
      if (age === null) { unplaceable++; continue; }
      if (segmentId === "seg.paediatric" ? age < 18 : age >= 65) ids.add(p.id);
    }
    return { ids, denominator, unplaceable, truncated };
  }

  if (segmentId === "seg.no_recent_visit") {
    const { data: encs, error } = await admin.from("practice_encounter")
      .select("patient_id, started_at").eq("workspace_id", ws)
      .not("patient_id", "is", null).order("started_at", { ascending: false }).limit(CAP + 1);
    if (error) return { error: error.message };
    const lastSeen = new Map<string, string>();
    for (const e of ((encs ?? []) as any[]).slice(0, CAP))
      if (!lastSeen.has(e.patient_id)) lastSeen.set(e.patient_id, e.started_at);
    const cutoff = Date.parse(opts.today + "T00:00:00Z") - opts.noVisitDays * 86400000;
    const ids = new Set<string>();
    for (const p of active) {
      const seen = lastSeen.get(p.id);
      if (!seen || Date.parse(String(seen)) < cutoff) ids.add(p.id);
    }
    return { ids, denominator, unplaceable: 0, truncated: truncated || (encs ?? []).length > CAP };
  }

  if (segmentId === "seg.multiple_conditions") {
    const { data: dx, error } = await admin.from("practice_diagnosis")
      .select("patient_id, label").eq("workspace_id", ws).not("patient_id", "is", null).limit(CAP + 1);
    if (error) return { error: error.message };
    const labels = new Map<string, Set<string>>();
    for (const d of ((dx ?? []) as any[]).slice(0, CAP)) {
      const s = labels.get(d.patient_id) ?? new Set<string>();
      s.add(String(d.label).toLowerCase());
      labels.set(d.patient_id, s);
    }
    const activeIds = new Set(active.map(p => p.id));
    const ids = new Set<string>([...labels.entries()].filter(([pid, s]) => s.size >= 2 && activeIds.has(pid)).map(([pid]) => pid));
    return { ids, denominator, unplaceable: 0, truncated: truncated || (dx ?? []).length > CAP };
  }

  if (segmentId === "seg.long_term_treatment") {
    const { data: tx, error } = await admin.from("practice_treatment")
      .select("patient_id").eq("workspace_id", ws).eq("status", "in_progress").limit(CAP + 1);
    if (error) return { error: error.message };
    const activeIds = new Set(active.map(p => p.id));
    const ids = new Set<string>(((tx ?? []) as any[]).slice(0, CAP).map(t => t.patient_id).filter(id => activeIds.has(id)));
    return { ids, denominator, unplaceable: 0, truncated: truncated || (tx ?? []).length > CAP };
  }

  return { error: `unknown segment ${segmentId}` };
}

export async function computeSegments(admin: any, ctx: WorkspaceContext, opts: {
  noVisitDays?: number;
} = {}): Promise<
  | { ok: true; results: SegmentResult[]; timezoneNote: string }
  | { ok: false; status: number; code: string; message: string }
> {
  if (!hasCapability(ctx, "report.view"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "segment counts need report.view" };
  const noVisitDays = Math.min(3650, Math.max(1, Math.round(opts.noVisitDays ?? DEFAULT_NO_VISIT_DAYS)));
  const { data: wsRow } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  const today = practiceToday(wsRow?.timezone ?? null);

  const results: SegmentResult[] = [];
  for (const seg of SEGMENT_REGISTRY) {
    // A gate-failed segment is never computed: its count would be a statement about a missing
    // writer wearing a population's clothes. The screen renders the registry's refusal instead.
    if (seg.gateFailed) continue;
    const m = await segmentMembers(admin, ctx, seg.segmentId, { noVisitDays, today });
    if ("error" in m)
      return { ok: false, status: 502, code: "SEGMENT_UNREADABLE", message: `${seg.displayName}: ${m.error}` };
    results.push({
      segment: seg, count: m.ids.size, denominator: m.denominator,
      unplaceable: m.unplaceable, truncated: m.truncated,
      noVisitDays: seg.parameterised ? noVisitDays : null,
    });
  }
  return { ok: true, results, timezoneNote: `ages and intervals computed against the practice's today (${today})` };
}

/**
 * The filtered patient list a segment (or a saved combination) drills into -- v2's own drill-through
 * target: "Patient segment -> Patient Intelligence filtered list". INTERSECTION across segments.
 */
export async function cohortPatients(admin: any, ctx: WorkspaceContext, args: {
  segmentIds: string[]; noVisitDays?: number; limit?: number;
}): Promise<
  | { ok: true; rows: CohortPatientRow[]; total: number; identified: boolean; truncated: boolean; definitionSentences: string[] }
  | { ok: false; status: number; code: string; message: string }
> {
  if (!hasCapability(ctx, "report.view"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "cohort lists need report.view" };
  const segs = args.segmentIds.filter(isSegmentId);
  if (segs.length === 0)
    return { ok: false, status: 422, code: "NO_SEGMENTS", message: "a cohort names at least one registered segment" };
  const failed = segs.map(id => segmentById(id)!).find(s => s.gateFailed);
  if (failed)
    return { ok: false, status: 422, code: "SEGMENT_GATE_FAILED", message: `${failed.displayName}: ${failed.gateFailed}` };

  const noVisitDays = Math.min(3650, Math.max(1, Math.round(args.noVisitDays ?? DEFAULT_NO_VISIT_DAYS)));
  const { data: wsRow } = await admin.from("practice_workspace")
    .select("timezone").eq("id", ctx.workspaceId).maybeSingle();
  const today = practiceToday(wsRow?.timezone ?? null);

  let members: Set<string> | null = null;
  let truncated = false;
  for (const id of segs) {
    const m = await segmentMembers(admin, ctx, id, { noVisitDays, today });
    if ("error" in m)
      return { ok: false, status: 502, code: "SEGMENT_UNREADABLE", message: `${id}: ${m.error}` };
    truncated = truncated || m.truncated;
    if (members === null) members = m.ids;
    else {
      const prev: Set<string> = members;
      members = new Set([...prev].filter(x => m.ids.has(x)));
    }
  }

  const identified = hasCapability(ctx, "patient.view");
  const idList = [...(members ?? new Set<string>())];
  const shown = idList.slice(0, Math.min(args.limit ?? 50, 200));
  let rows: CohortPatientRow[] = shown.map(id => ({
    id, label: "A patient (name needs patient.view)", detail: "",
  }));
  if (identified && shown.length > 0) {
    const { data: pats } = await admin.from("practice_patient")
      .select("id, display_name, birth_date").in("id", shown);
    const byId = new Map(((pats ?? []) as any[]).map(p => [p.id, p]));
    rows = shown.map(id => {
      const p = byId.get(id);
      return {
        id, label: p?.display_name ?? "(name unavailable)",
        detail: p?.birth_date ? `born ${p.birth_date}` : "no date of birth recorded",
      };
    });
  }

  // Reading a population is worth remembering -- same reasoning as report generation.
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, eventType: "practice.cohort_viewed",
    payload: { segmentIds: segs, noVisitDays, total: idList.length, identified },
  });

  return {
    ok: true, rows, total: idList.length, identified, truncated,
    definitionSentences: segs.map(id => `${segmentById(id)!.displayName}: ${segmentById(id)!.definition}`),
  };
}

// ── SAVED COHORTS (practice_cohort, migration 305) -- the DEFINITION is saved, never the members ────

export type SavedCohort = {
  id: string; name: string; description: string | null;
  segmentIds: string[]; noVisitDays: number | null;
};

export async function listCohorts(admin: any, ctx: WorkspaceContext): Promise<
  | { ok: true; cohorts: SavedCohort[] }
  | { ok: false; status: number; code: string; message: string }
> {
  if (!hasCapability(ctx, "report.view"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "listing cohorts needs report.view" };
  const { data, error } = await admin.from("practice_cohort")
    .select("id, name, description, segment_ids, no_visit_days")
    .eq("workspace_id", ctx.workspaceId).eq("status", "active").order("name");
  if (error) return { ok: false, status: 502, code: "COHORTS_UNREADABLE", message: error.message };
  return {
    ok: true,
    cohorts: ((data ?? []) as any[]).map(r => ({
      id: r.id, name: r.name, description: r.description ?? null,
      // ⚠ Validated on READ as well as on save: a stale row cannot quietly widen a population if
      // the registry later renames a segment -- unknown ids are dropped and the list stays honest.
      segmentIds: (r.segment_ids ?? []).filter(isSegmentId),
      noVisitDays: r.no_visit_days ?? null,
    })),
  };
}

export async function saveCohort(admin: any, ctx: WorkspaceContext, args: {
  name: string; description?: string | null; segmentIds: string[]; noVisitDays?: number | null;
  actorId: string; correlationId: string;
}): Promise<
  | { ok: true; id: string }
  | { ok: false; status: number; code: string; message: string }
> {
  if (!hasCapability(ctx, "cohort.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "saving a cohort needs cohort.manage" };
  const name = args.name.trim();
  if (name.length < 1 || name.length > 80)
    return { ok: false, status: 422, code: "BAD_NAME", message: "a cohort name is 1 to 80 characters" };
  const segs = [...new Set(args.segmentIds)];
  if (segs.length === 0 || !segs.every(isSegmentId))
    return {
      ok: false, status: 422, code: "UNREGISTERED_SEGMENT",
      message: "a cohort names only registered segments -- free-form filters do not exist on purpose",
    };
  const gateFailed = segs.map(id => segmentById(id)!).find(s => s.gateFailed);
  if (gateFailed)
    return { ok: false, status: 422, code: "SEGMENT_GATE_FAILED", message: `${gateFailed.displayName}: ${gateFailed.gateFailed}` };
  const { data, error } = await admin.from("practice_cohort").insert({
    workspace_id: ctx.workspaceId, name, description: args.description?.trim() || null,
    segment_ids: segs, no_visit_days: args.noVisitDays ?? null, created_by: args.actorId,
  }).select("id").single();
  if (error) {
    if (String(error.code) === "23505")
      return { ok: false, status: 409, code: "COHORT_NAME_TAKEN", message: `an active cohort is already named "${name}"` };
    return { ok: false, status: 502, code: "COHORT_SAVE_FAILED", message: error.message };
  }
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.cohort_saved",
    payload: { cohortId: data.id, name, segmentIds: segs, noVisitDays: args.noVisitDays ?? null },
    correlationId: args.correlationId,
  });
  return { ok: true, id: data.id };
}

export async function retireCohort(admin: any, ctx: WorkspaceContext, args: {
  cohortId: string; actorId: string; correlationId: string;
}): Promise<
  | { ok: true }
  | { ok: false; status: number; code: string; message: string }
> {
  if (!hasCapability(ctx, "cohort.manage"))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "retiring a cohort needs cohort.manage" };
  const { data, error } = await admin.from("practice_cohort")
    .update({ status: "retired", updated_by: args.actorId, updated_at: new Date().toISOString() })
    .eq("id", args.cohortId).eq("workspace_id", ctx.workspaceId).eq("status", "active").select("id");
  if (error) return { ok: false, status: 502, code: "COHORT_RETIRE_FAILED", message: error.message };
  if (!data || data.length === 0)
    return { ok: false, status: 404, code: "NOT_FOUND", message: "no active cohort with that id in this practice" };
  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.cohort_retired",
    payload: { cohortId: args.cohortId }, correlationId: args.correlationId,
  });
  return { ok: true };
}
