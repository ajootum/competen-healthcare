import { audit } from "@/lib/practice/provisioning";
import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { type EngineResult } from "@/lib/practice/encounters";
import { LOCKED_STATUSES } from "@/lib/practice/encounter-constants";
import {
  MILESTONE_KIND_CODES, ALLERGY_SEVERITIES, ALLERGY_CERTAINTIES, BLOOD_GROUPS,
  allergyLine, bloodGroupLine, type SafetyLine,
} from "@/lib/practice/longitudinal-constants";

// CPR-ENC-003: the practitioner-owned longitudinal record.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THIS IS THE PRACTITIONER'S CUMULATIVE MEMORY, NOT AN EMR. It holds what one practitioner recorded
// about one patient across every hospital and clinic they saw them in. It does not claim to be complete,
// and every panel below is careful about the difference between "there is none" and "I could not read
// it" -- because a longitudinal record is exactly the screen where an empty list is taken as a fact
// about the patient rather than a fact about the query.
//
// ⚠ THREE REFUSALS ARE STRUCTURAL HERE AND ARE NOT NEGOTIABLE:
//
//  1. NOTHING DERIVES A MILESTONE. recordMilestone is the only writer of practice_patient_milestone in
//     this file or anywhere else. `significant_improvement` and `relapse` are clinical judgements; an
//     engine that inferred one from the timeline would put an unsigned clinical claim into a record that
//     looks, to every later reader, exactly like one a practitioner wrote. This is the same refusal as
//     the "Stable / Improving / Monitor" chip rejected on the Patients screen.
//
//  2. "NO KNOWN ALLERGIES" IS PRINTED ONLY FROM allergy_status = 'none_known'. Never from an empty list.
//     See allergyLine in longitudinal-constants.ts -- the sentence is chosen there, once, by a pure
//     function, so there is no second place for a screen to get it wrong.
//
//  3. NO RATES, NO TARGETS, NO TRENDS. There is no baseline in this product to trend against and no
//     denominator anybody agreed. The histories below are lists in date order.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const CAP_VIEW_PATIENT = "patient.view";
const CAP_LIST_ENCOUNTERS = "encounter.list";
const CAP_EDIT_PATIENT = "patient.edit";
const CAP_FOLLOWUP_VIEW = "followup.view";

/**
 * Every capability code this engine gates on, exported so a harness can prove each one EXISTS in
 * practice_role_capabilities rather than being a plausible invention.
 */
export const LONGITUDINAL_CAPABILITIES = [
  CAP_VIEW_PATIENT, CAP_LIST_ENCOUNTERS, CAP_EDIT_PATIENT, CAP_FOLLOWUP_VIEW,
] as const;

export type Panel<T> = { items: T[]; permitted: boolean; unavailable: boolean; detail: string | null };

const denied = <T>(): Panel<T> => ({ items: [], permitted: false, unavailable: false, detail: null });
const failed = <T>(detail: string): Panel<T> => ({ items: [], permitted: true, unavailable: true, detail });
const loaded = <T>(items: T[]): Panel<T> => ({ items, permitted: true, unavailable: false, detail: null });

// ── CPR-ENC-003 s3: THE CORE PATIENT RECORD ─────────────────────────────────────────────────────────

export type PatientSnapshot = {
  permitted: boolean;
  /** True when the patient row itself could not be read. Everything below is then meaningless. */
  unavailable: boolean;
  patient: {
    id: string; displayName: string; sex: string; birthDate: string | null;
    ageEstimateYears: number | null; status: string;
  } | null;
  /** CPR-ENC-003 s3 "multiple hospital identifiers". */
  identifiers: Panel<{ id: string; type: string; value: string; issuer: string | null }>;
  /** ⚠ The safety line. Only `tone: "none"` may be read as reassurance. */
  allergies: SafetyLine;
  allergyList: Panel<{ id: string; substance: string; reaction: string | null; severity: string | null; certainty: string }>;
  bloodGroup: SafetyLine;
  activeProblems: Panel<{ id: string; label: string; status: string; onsetDate: string | null }>;
  currentTreatments: Panel<{ id: string; label: string; treatmentType: string; dose: string | null; route: string | null; frequency: string | null; recordedAt: string }>;
  milestones: Panel<Milestone>;
};

export type Milestone = {
  id: string; kind: string; label: string; occurredOn: string; note: string | null;
  encounterId: string | null; createdBy: string | null; createdAt: string;
};

/**
 * The left-hand snapshot of CPR-ENC-002 and the header of CPR-ENC-003.
 *
 * ⚠ THE ALLERGY READ IS TWO QUERIES AND BOTH MATTER. The STATUS is on the patient row; the LIST is a
 * separate table. A list that failed to load under a `recorded` status is reported as unreadable, not as
 * "no allergies" -- allergyLine is given the null and says so.
 */
export async function patientSnapshot(
  admin: any, ctx: WorkspaceContext, patientId: string,
): Promise<PatientSnapshot> {
  const blank = (permitted: boolean, unavailable: boolean): PatientSnapshot => ({
    permitted, unavailable, patient: null,
    identifiers: permitted ? failed("not read") : denied(),
    allergies: allergyLine({ status: null, count: null, unavailable: true }),
    allergyList: permitted ? failed("not read") : denied(),
    bloodGroup: bloodGroupLine({ value: null, unavailable: true }),
    activeProblems: permitted ? failed("not read") : denied(),
    currentTreatments: permitted ? failed("not read") : denied(),
    milestones: permitted ? failed("not read") : denied(),
  });

  if (!hasCapability(ctx, CAP_VIEW_PATIENT)) return blank(false, false);

  const { data: p, error: pErr } = await admin.from("practice_patient")
    .select("id, display_name, sex, birth_date, age_estimate_years, status, allergy_status, allergy_reviewed_at, blood_group")
    .eq("id", patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (pErr) return blank(true, true);
  if (!p) return { ...blank(true, false), unavailable: false };

  const [identRes, allergyRes, problemRes, treatmentRes, milestoneRes] = await Promise.all([
    admin.from("practice_patient_identifier")
      .select("id, identifier_type, value, issuer")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).is("valid_to", null),
    admin.from("practice_patient_allergy")
      .select("id, substance, reaction, severity, certainty")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).neq("certainty", "refuted"),
    admin.from("practice_problem")
      .select("id, label, status, onset_date")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).eq("status", "active")
      .order("created_at"),
    // "Current treatments" is what has been recorded and not cancelled, newest first. There is no
    // stop-date in this schema, so this is deliberately named for what it is -- the treatments on the
    // record -- rather than being presented as an active medication list nobody reconciled.
    admin.from("practice_treatment")
      .select("id, label, treatment_type, dose, route, frequency, status, created_at")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).neq("status", "cancelled")
      .order("created_at", { ascending: false }).limit(30),
    admin.from("practice_patient_milestone")
      .select("id, kind, label, occurred_on, note, encounter_id, created_by, created_at")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
      .order("occurred_on", { ascending: false }),
  ]);

  const allergyCount = allergyRes.error ? null : ((allergyRes.data ?? []) as any[]).length;

  return {
    permitted: true,
    unavailable: false,
    patient: {
      id: p.id, displayName: p.display_name, sex: p.sex, birthDate: p.birth_date ?? null,
      ageEstimateYears: p.age_estimate_years ?? null, status: p.status,
    },
    identifiers: identRes.error ? failed(identRes.error.message)
      : loaded(((identRes.data ?? []) as any[]).map(i => ({
        id: i.id, type: i.identifier_type, value: i.value, issuer: i.issuer ?? null,
      }))),
    allergies: allergyLine({
      status: p.allergy_status, count: allergyCount,
      unavailable: false, reviewedAt: p.allergy_reviewed_at ?? null,
    }),
    allergyList: allergyRes.error ? failed(allergyRes.error.message)
      : loaded(((allergyRes.data ?? []) as any[]).map(a => ({
        id: a.id, substance: a.substance, reaction: a.reaction ?? null,
        severity: a.severity ?? null, certainty: a.certainty,
      }))),
    bloodGroup: bloodGroupLine({ value: p.blood_group ?? null, unavailable: false }),
    activeProblems: problemRes.error ? failed(problemRes.error.message)
      : loaded(((problemRes.data ?? []) as any[]).map(r => ({
        id: r.id, label: r.label, status: r.status, onsetDate: r.onset_date ?? null,
      }))),
    currentTreatments: treatmentRes.error ? failed(treatmentRes.error.message)
      : loaded(((treatmentRes.data ?? []) as any[]).map(t => ({
        id: t.id, label: t.label, treatmentType: t.treatment_type, dose: t.dose ?? null,
        route: t.route ?? null, frequency: t.frequency ?? null, recordedAt: t.created_at,
      }))),
    milestones: milestoneRes.error ? failed(milestoneRes.error.message)
      : loaded(((milestoneRes.data ?? []) as any[]).map(shapeMilestone)),
  };
}

const shapeMilestone = (m: any): Milestone => ({
  id: m.id, kind: m.kind, label: m.label, occurredOn: m.occurred_on, note: m.note ?? null,
  encounterId: m.encounter_id ?? null, createdBy: m.created_by ?? null, createdAt: m.created_at,
});

// ── CPR-ENC-003 s4 + s7: THE CLINICAL TIMELINE AND THE JOURNEY VIEW ─────────────────────────────────

export type JourneyEvent = {
  key: string;
  /** One of JOURNEY_FILTER_CODES, minus `all`. What the filter matches on. */
  kind: "encounters" | "problems" | "treatments" | "procedures" | "investigations" | "referrals" | "follow_ups" | "milestones";
  /** ISO date (YYYY-MM-DD). Everything is placed on a DATE, because that is what a journey is read by. */
  on: string;
  /** The full timestamp where there is one, for ordering within a day. */
  at: string | null;
  title: string;
  detail: string | null;
  /** Chips: encounter type, location, status. Rendered, never computed into a judgement. */
  tags: string[];
  encounterId: string | null;
  status: string | null;
};

export type ClinicalTimeline = {
  events: JourneyEvent[];
  /** Which sources were readable. A source that failed is NAMED, so the screen can say what is missing. */
  sourcesUnavailable: string[];
  /** Which sources the caller may not see at all. Different sentence, different action. */
  sourcesDenied: string[];
  /**
   * ⚠ TRUE WHEN THE ENCOUNTER READ ITSELF FAILED. An empty timeline reads as A PATIENT WITH NO HISTORY,
   * which is the most dangerous empty list in this product: it is read during a consultation by somebody
   * deciding how much history to take, and it is indistinguishable from the truth.
   */
  unavailable: boolean;
  /** True when the caller cannot see encounters at all. */
  permitted: boolean;
  detail: string | null;
};

const dateOf = (iso: string | null | undefined): string => String(iso ?? "").slice(0, 10);

/**
 * Every closed and open encounter with what happened in it, plus the other six longitudinal streams,
 * merged into one date-ordered list.
 *
 * ⚠ EACH STREAM IS READ SEPARATELY AND FAILS SEPARATELY. A referral table that times out must not empty
 * the encounter timeline, and a timeline missing its referrals must SAY it is missing them rather than
 * reading as a patient who was never referred anywhere.
 */
export async function clinicalTimeline(
  admin: any, ctx: WorkspaceContext, patientId: string, opts: { limit?: number } = {},
): Promise<ClinicalTimeline> {
  const sourcesUnavailable: string[] = [];
  const sourcesDenied: string[] = [];

  if (!hasCapability(ctx, CAP_LIST_ENCOUNTERS)) {
    return {
      events: [], sourcesUnavailable: [], sourcesDenied: ["encounters"],
      unavailable: false, permitted: false, detail: null,
    };
  }

  const limit = opts.limit ?? 50;

  const { data: encRows, error: encErr } = await admin.from("practice_encounter")
    .select("id, status, entry_pathway, encounter_mode, reason_for_visit, started_at, completed_at, signed_at, outcome, outcome_note, activity_id")
    .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
    .order("started_at", { ascending: false }).limit(limit);

  if (encErr) {
    return {
      events: [], sourcesUnavailable: ["encounters"], sourcesDenied: [],
      unavailable: true, permitted: true, detail: encErr.message,
    };
  }

  const encounters = (encRows ?? []) as any[];
  const encounterIds = encounters.map(e => e.id);

  const [diagRes, treatRes, procRes, invRes, refRes, fuRes, msRes] = await Promise.all([
    encounterIds.length
      ? admin.from("practice_diagnosis").select("id, encounter_id, label, certainty, is_primary, created_at").in("encounter_id", encounterIds)
      : Promise.resolve({ data: [], error: null }),
    encounterIds.length
      ? admin.from("practice_treatment").select("id, encounter_id, label, treatment_type, dose, frequency, created_at").in("encounter_id", encounterIds)
      : Promise.resolve({ data: [], error: null }),
    admin.from("practice_procedure")
      .select("id, encounter_id, label, site, laterality, status, performed_at")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).order("performed_at", { ascending: false }),
    admin.from("practice_encounter_investigation")
      .select("id, encounter_id, label, status, summary, requested_at, reviewed_at")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).order("requested_at", { ascending: false }),
    admin.from("practice_referral")
      .select("id, encounter_id, referred_to, reason, status, referred_on")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).order("referred_on", { ascending: false }),
    hasCapability(ctx, CAP_FOLLOWUP_VIEW)
      ? admin.from("practice_follow_up")
        .select("id, origin_encounter_id, reason, kind, due_on, status, outcome")
        .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).order("due_on", { ascending: false })
      : Promise.resolve({ data: null, error: null, denied: true }),
    admin.from("practice_patient_milestone")
      .select("id, kind, label, occurred_on, note, encounter_id")
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).order("occurred_on", { ascending: false }),
  ]);

  if (!hasCapability(ctx, CAP_FOLLOWUP_VIEW)) sourcesDenied.push("follow_ups");
  for (const [name, res] of [
    ["diagnoses", diagRes], ["treatments", treatRes], ["procedures", procRes],
    ["investigations", invRes], ["referrals", refRes], ["follow_ups", fuRes], ["milestones", msRes],
  ] as [string, any][]) {
    if (res?.error) sourcesUnavailable.push(name);
  }

  const diagByEnc = new Map<string, any[]>();
  for (const d of ((diagRes as any).data ?? []) as any[]) {
    const list = diagByEnc.get(d.encounter_id) ?? [];
    list.push(d);
    diagByEnc.set(d.encounter_id, list);
  }
  const treatByEnc = new Map<string, any[]>();
  for (const t of ((treatRes as any).data ?? []) as any[]) {
    const list = treatByEnc.get(t.encounter_id) ?? [];
    list.push(t);
    treatByEnc.set(t.encounter_id, list);
  }

  const events: JourneyEvent[] = [];

  for (const e of encounters) {
    const dx = diagByEnc.get(e.id) ?? [];
    const tx = treatByEnc.get(e.id) ?? [];
    const tags = [
      String(e.entry_pathway).replace(/_/g, " "),
      String(e.encounter_mode).replace(/_/g, " "),
    ];
    // ⚠ THE OUTCOME IS SHOWN ONLY WHEN ONE WAS RECORDED. A missing outcome is not "stable".
    if (e.outcome) tags.push(`outcome: ${e.outcome}`);
    events.push({
      key: `enc:${e.id}`,
      kind: "encounters",
      on: dateOf(e.started_at),
      at: e.started_at,
      title: e.reason_for_visit || "Encounter",
      detail: [
        dx.length ? `Diagnoses: ${dx.map((d: any) => d.label).join(", ")}` : null,
        tx.length ? `Treatment: ${tx.map((t: any) => t.label).join(", ")}` : null,
        // The unavailability of a sub-read is stated in the event rather than silently omitted.
        (diagRes as any).error ? "Diagnoses for this encounter could not be read" : null,
        (treatRes as any).error ? "Treatment for this encounter could not be read" : null,
        e.outcome === "other" && e.outcome_note ? `Outcome: ${e.outcome_note}` : null,
      ].filter(Boolean).join(" · ") || null,
      tags,
      encounterId: e.id,
      status: e.status,
    });
  }

  for (const p of (((procRes as any).data ?? []) as any[])) {
    events.push({
      key: `proc:${p.id}`, kind: "procedures", on: dateOf(p.performed_at), at: p.performed_at,
      title: p.label,
      detail: [p.site, p.laterality !== "not_applicable" ? p.laterality : null].filter(Boolean).join(" · ") || null,
      tags: p.status === "ABANDONED" ? ["abandoned"] : [], encounterId: p.encounter_id ?? null, status: p.status,
    });
  }

  for (const i of (((invRes as any).data ?? []) as any[])) {
    // ⚠ TYPE ONLY. The title is what was ASKED FOR and the summary is what the practitioner made of it.
    // Neither is a result and nothing here claims the test was performed.
    events.push({
      key: `inv:${i.id}`, kind: "investigations",
      on: dateOf(i.status === "reviewed" ? (i.reviewed_at ?? i.requested_at) : i.requested_at),
      at: i.status === "reviewed" ? (i.reviewed_at ?? i.requested_at) : i.requested_at,
      title: i.label, detail: i.summary ?? null, tags: [i.status],
      encounterId: i.encounter_id ?? null, status: i.status,
    });
  }

  for (const r of (((refRes as any).data ?? []) as any[])) {
    events.push({
      key: `ref:${r.id}`, kind: "referrals", on: r.referred_on, at: null,
      title: `Referred to ${r.referred_to}`, detail: r.reason, tags: [r.status],
      encounterId: r.encounter_id ?? null, status: r.status,
    });
  }

  for (const f of (((fuRes as any).data ?? []) as any[])) {
    events.push({
      key: `fu:${f.id}`, kind: "follow_ups", on: f.due_on, at: null,
      title: f.reason, detail: f.outcome ?? null, tags: [String(f.kind).replace(/_/g, " "), f.status],
      encounterId: f.origin_encounter_id ?? null, status: f.status,
    });
  }

  for (const m of (((msRes as any).data ?? []) as any[])) {
    events.push({
      key: `ms:${m.id}`, kind: "milestones", on: m.occurred_on, at: null,
      title: m.label, detail: m.note ?? null, tags: [String(m.kind).replace(/_/g, " ")],
      encounterId: m.encounter_id ?? null, status: null,
    });
  }

  // Newest first, ties broken by the timestamp where one exists.
  events.sort((a, b) => {
    if (a.on !== b.on) return a.on < b.on ? 1 : -1;
    return String(b.at ?? "") < String(a.at ?? "") ? -1 : 1;
  });

  return { events, sourcesUnavailable, sourcesDenied, unavailable: false, permitted: true, detail: null };
}

// ── CPR-ENC-003 s5: THE LONGITUDINAL ENGINES ────────────────────────────────────────────────────────
//
// Each is a list in date order. None of them computes an average, a rate, or a direction of travel: the
// product has no baseline and no agreed denominator, and a "improving" arrow drawn from four data points
// is the chip that was already refused once on the Patients screen.

export async function problemHistory(admin: any, ctx: WorkspaceContext, patientId: string) {
  if (!hasCapability(ctx, CAP_VIEW_PATIENT)) return denied<{ id: string; label: string; status: string; onsetDate: string | null; resolvedDate: string | null }>();
  const { data, error } = await admin.from("practice_problem")
    .select("id, label, status, onset_date, resolved_date")
    .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).order("created_at", { ascending: false });
  if (error) return failed<{ id: string; label: string; status: string; onsetDate: string | null; resolvedDate: string | null }>(error.message);
  return loaded(((data ?? []) as any[]).map(r => ({
    id: r.id, label: r.label, status: r.status, onsetDate: r.onset_date ?? null, resolvedDate: r.resolved_date ?? null,
  })));
}

export async function treatmentHistory(admin: any, ctx: WorkspaceContext, patientId: string) {
  type Row = { id: string; label: string; treatmentType: string; dose: string | null; frequency: string | null; status: string; encounterId: string; recordedAt: string };
  if (!hasCapability(ctx, CAP_LIST_ENCOUNTERS)) return denied<Row>();
  const { data, error } = await admin.from("practice_treatment")
    .select("id, label, treatment_type, dose, frequency, status, encounter_id, created_at")
    .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).order("created_at", { ascending: false });
  if (error) return failed<Row>(error.message);
  return loaded(((data ?? []) as any[]).map(t => ({
    id: t.id, label: t.label, treatmentType: t.treatment_type, dose: t.dose ?? null,
    frequency: t.frequency ?? null, status: t.status, encounterId: t.encounter_id, recordedAt: t.created_at,
  })));
}

export async function procedureHistory(admin: any, ctx: WorkspaceContext, patientId: string) {
  type Row = { id: string; label: string; site: string | null; laterality: string; status: string; performedAt: string; encounterId: string; outcomes: { id: string; outcomeType: string; severity: string | null; detail: string; observedOn: string }[] };
  if (!hasCapability(ctx, CAP_LIST_ENCOUNTERS)) return denied<Row>();
  const { data, error } = await admin.from("practice_procedure")
    .select("id, label, site, laterality, status, performed_at, encounter_id")
    .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).order("performed_at", { ascending: false });
  if (error) return failed<Row>(error.message);

  const rows = (data ?? []) as any[];
  const ids = rows.map(r => r.id);
  const { data: outcomes, error: outErr } = ids.length
    ? await admin.from("practice_procedure_outcome")
      .select("id, procedure_id, outcome_type, severity, detail, observed_on")
      .eq("workspace_id", ctx.workspaceId).in("procedure_id", ids).order("observed_on")
    : { data: [], error: null };

  const byProc = new Map<string, any[]>();
  for (const o of ((outcomes ?? []) as any[])) {
    const list = byProc.get(o.procedure_id) ?? [];
    list.push(o);
    byProc.set(o.procedure_id, list);
  }

  const panel = loaded(rows.map(p => ({
    id: p.id, label: p.label, site: p.site ?? null, laterality: p.laterality, status: p.status,
    performedAt: p.performed_at, encounterId: p.encounter_id,
    outcomes: (byProc.get(p.id) ?? []).map((o: any) => ({
      id: o.id, outcomeType: o.outcome_type, severity: o.severity ?? null,
      detail: o.detail, observedOn: o.observed_on,
    })),
  })));
  // A procedure list whose OUTCOMES failed to load is still worth showing -- and a procedure drawn with
  // no complications listed, when the complication read failed, is the wrong thing to show silently.
  return outErr ? { ...panel, detail: "outcomes could not be read" } : panel;
}

/** The encounter outcome history (CPR-ENC-003 s5 "outcome history"). Only encounters that HAVE one. */
export async function outcomeHistory(admin: any, ctx: WorkspaceContext, patientId: string) {
  type Row = { encounterId: string; outcome: string; outcomeNote: string | null; on: string; status: string };
  if (!hasCapability(ctx, CAP_LIST_ENCOUNTERS)) return denied<Row>();
  const { data, error } = await admin.from("practice_encounter")
    .select("id, outcome, outcome_note, started_at, status")
    .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
    .not("outcome", "is", null).order("started_at", { ascending: false });
  if (error) return failed<Row>(error.message);
  return loaded(((data ?? []) as any[]).map(e => ({
    encounterId: e.id, outcome: e.outcome, outcomeNote: e.outcome_note ?? null,
    on: dateOf(e.started_at), status: e.status,
  })));
}

export async function followUpHistory(admin: any, ctx: WorkspaceContext, patientId: string) {
  type Row = { id: string; reason: string; kind: string; dueOn: string; status: string; outcome: string | null; originEncounterId: string | null };
  if (!hasCapability(ctx, CAP_FOLLOWUP_VIEW)) return denied<Row>();
  const { data, error } = await admin.from("practice_follow_up")
    .select("id, reason, kind, due_on, status, outcome, origin_encounter_id")
    .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId).order("due_on", { ascending: false });
  if (error) return failed<Row>(error.message);
  return loaded(((data ?? []) as any[]).map(f => ({
    id: f.id, reason: f.reason, kind: f.kind, dueOn: f.due_on, status: f.status,
    outcome: f.outcome ?? null, originEncounterId: f.origin_encounter_id ?? null,
  })));
}

// ── CPR-ENC-003 s6: CLINICAL MILESTONES ─────────────────────────────────────────────────────────────

export async function listMilestones(admin: any, ctx: WorkspaceContext, patientId: string): Promise<Panel<Milestone>> {
  if (!hasCapability(ctx, CAP_VIEW_PATIENT)) return denied();
  const { data, error } = await admin.from("practice_patient_milestone")
    .select("id, kind, label, occurred_on, note, encounter_id, created_by, created_at")
    .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
    .order("occurred_on", { ascending: false });
  if (error) return failed(error.message);
  return loaded(((data ?? []) as any[]).map(shapeMilestone));
}

/**
 * ⚠ THE ONLY WRITER OF practice_patient_milestone IN THIS PRODUCT.
 *
 * A milestone is a clinical judgement with a person's name on it. Every field comes from the caller:
 * the kind, the words, the date it happened, and the actor. Nothing is inferred from the timeline, and
 * no other function in this file -- or in encounter-workspace.ts, or in encounters.ts -- writes this
 * table. The harness asserts that a complete encounter lifecycle, diagnoses, treatments, procedures,
 * referrals, investigations, outcome and signature included, produces ZERO milestone rows.
 *
 * It is gated on patient.edit rather than encounter.edit because it is a fact about the person, not
 * about a consultation: "transitioned to adult care" may be recorded outside any encounter, which is why
 * encounterId is optional.
 */
export async function recordMilestone(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; kind: string; label: string; occurredOn: string;
  note?: string | null; encounterId?: string | null; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!hasCapability(ctx, CAP_EDIT_PATIENT))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "Forbidden" };

  if (!MILESTONE_KIND_CODES.includes(args.kind))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown milestone kind ${args.kind}` };

  const label = (args.label ?? "").trim();
  if (!label) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a milestone needs a label" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.occurredOn ?? ""))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "a milestone needs the date it happened (YYYY-MM-DD)" };

  // The patient must exist HERE. A milestone filed against another practice's patient would be a
  // cross-tenant write, which is the bug class migrations 074 and 103 closed.
  const { data: patient, error: pErr } = await admin.from("practice_patient")
    .select("id").eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (pErr) return { ok: false, status: 500, code: "READ_FAILED", message: pErr.message };
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  // A named encounter must belong to this workspace AND this patient.
  if (args.encounterId) {
    const { data: enc, error: eErr } = await admin.from("practice_encounter")
      .select("id, patient_id").eq("id", args.encounterId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (eErr) return { ok: false, status: 500, code: "READ_FAILED", message: eErr.message };
    if (!enc) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };
    if (enc.patient_id !== args.patientId)
      return { ok: false, status: 422, code: "ENCOUNTER_PATIENT_MISMATCH", message: "that encounter belongs to a different patient" };
  }

  const { data, error } = await admin.from("practice_patient_milestone").insert({
    workspace_id: ctx.workspaceId, patient_id: args.patientId,
    encounter_id: args.encounterId ?? null, kind: args.kind, label,
    occurred_on: args.occurredOn, note: args.note?.trim() || null, created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.milestone_recorded",
    payload: { patientId: args.patientId, milestoneId: data.id, kind: args.kind },
    correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

// ── CPR-ENC-003 s3: ALLERGIES AND BLOOD GROUP ───────────────────────────────────────────────────────

/**
 * Record the answer to "does this patient have any allergies".
 *
 * ⚠ THIS IS THE ONLY WAY `none_known` CAN EVER BE SET, and that is deliberate: the reassuring sentence
 * on the screen must be traceable to a moment when somebody asked. The reviewer and the time are stamped
 * with it, so "reviewed in March" stays distinguishable from "reviewed this morning".
 *
 * Setting `none_known` while allergies are listed is refused. It is the one combination that would put
 * the reassuring sentence on top of contradicting evidence.
 */
export async function recordAllergyReview(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; status: "none_known" | "recorded" | "not_recorded";
  actorId: string; correlationId: string;
}): Promise<EngineResult<{ status: string }>> {
  if (!hasCapability(ctx, CAP_EDIT_PATIENT))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "Forbidden" };
  if (!["none_known", "recorded", "not_recorded"].includes(args.status))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown allergy status ${args.status}` };

  const { data: patient, error: pErr } = await admin.from("practice_patient")
    .select("id").eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (pErr) return { ok: false, status: 500, code: "READ_FAILED", message: pErr.message };
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  if (args.status === "none_known") {
    const { count, error } = await admin.from("practice_patient_allergy")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("patient_id", args.patientId).neq("certainty", "refuted");
    // ⚠ THE ERROR IS CHECKED. A failed count is not nought, and treating it as one would let "no known
    // allergies" be written over a list nobody could read.
    if (error) return { ok: false, status: 500, code: "READ_FAILED", message: error.message };
    if ((count ?? 0) > 0)
      return { ok: false, status: 422, code: "ALLERGIES_LISTED",
        message: "this patient has recorded allergies. Remove or refute them before marking none known" };
  }

  const { error } = await admin.from("practice_patient").update({
    allergy_status: args.status,
    allergy_reviewed_at: args.status === "not_recorded" ? null : new Date().toISOString(),
    allergy_reviewed_by: args.status === "not_recorded" ? null : args.actorId,
  }).eq("id", args.patientId).eq("workspace_id", ctx.workspaceId);
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.allergy_review_recorded",
    payload: { patientId: args.patientId, status: args.status }, correlationId: args.correlationId,
  });
  return { ok: true, data: { status: args.status } };
}

/**
 * Add an allergy, and move the patient's status to `recorded` in the same act.
 *
 * The status move is not a convenience. A patient with an allergy row and a status of `not_recorded`
 * would print "nobody has asked" over evidence that somebody did.
 */
export async function addAllergy(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; substance: string; reaction?: string | null;
  severity?: string | null; certainty?: string; actorId: string; correlationId: string;
}): Promise<EngineResult<{ id: string }>> {
  if (!hasCapability(ctx, CAP_EDIT_PATIENT))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "Forbidden" };

  const substance = (args.substance ?? "").trim();
  if (!substance) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "name the substance" };
  if (args.severity && !ALLERGY_SEVERITIES.includes(args.severity as typeof ALLERGY_SEVERITIES[number]))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown severity ${args.severity}` };
  const certainty = args.certainty ?? "suspected";
  if (!ALLERGY_CERTAINTIES.includes(certainty as typeof ALLERGY_CERTAINTIES[number]))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown certainty ${certainty}` };

  const { data: patient, error: pErr } = await admin.from("practice_patient")
    .select("id").eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (pErr) return { ok: false, status: 500, code: "READ_FAILED", message: pErr.message };
  if (!patient) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  const { data, error } = await admin.from("practice_patient_allergy").insert({
    workspace_id: ctx.workspaceId, patient_id: args.patientId, substance,
    reaction: args.reaction?.trim() || null, severity: args.severity || null,
    certainty, created_by: args.actorId,
  }).select("id").single();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };

  if (certainty !== "refuted") {
    await admin.from("practice_patient").update({
      allergy_status: "recorded", allergy_reviewed_at: new Date().toISOString(),
      allergy_reviewed_by: args.actorId,
    }).eq("id", args.patientId).eq("workspace_id", ctx.workspaceId);
  }

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.allergy_recorded",
    payload: { patientId: args.patientId, allergyId: data.id }, correlationId: args.correlationId,
  });
  return { ok: true, data: { id: data.id as string } };
}

/** Blood group. Null clears it back to "not recorded", which is a real answer somebody may need to give. */
export async function setBloodGroup(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; bloodGroup: string | null; actorId: string; correlationId: string;
}): Promise<EngineResult<{ bloodGroup: string | null }>> {
  if (!hasCapability(ctx, CAP_EDIT_PATIENT))
    return { ok: false, status: 403, code: "FORBIDDEN", message: "Forbidden" };
  const value = args.bloodGroup === null || args.bloodGroup === "" ? null : args.bloodGroup;
  if (value !== null && !BLOOD_GROUPS.includes(value as typeof BLOOD_GROUPS[number]))
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: `unknown blood group ${value}` };

  const { data, error } = await admin.from("practice_patient")
    .update({ blood_group: value })
    .eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).select("blood_group").maybeSingle();
  if (error) return { ok: false, status: 400, code: "VALIDATION_ERROR", message: error.message };
  if (!data) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" };

  await audit(admin, {
    workspaceId: ctx.workspaceId, actorId: args.actorId, eventType: "practice.blood_group_recorded",
    payload: { patientId: args.patientId }, correlationId: args.correlationId,
  });
  return { ok: true, data: { bloodGroup: data.blood_group ?? null } };
}

/**
 * The counts on the journey header: how many encounters, when first seen, when last seen.
 *
 * ⚠ NO RATES AND NO AVERAGES. "18 encounters" is a count of rows; "one every six weeks" would be a
 * clinical characterisation of a person's illness derived from arithmetic, and nobody asked for it.
 */
export async function journeyCounts(admin: any, ctx: WorkspaceContext, patientId: string): Promise<{
  permitted: boolean; unavailable: boolean;
  encounters: number | null; firstSeen: string | null; lastSeen: string | null; closed: number | null;
}> {
  if (!hasCapability(ctx, CAP_LIST_ENCOUNTERS))
    return { permitted: false, unavailable: false, encounters: null, firstSeen: null, lastSeen: null, closed: null };

  const { data, error } = await admin.from("practice_encounter")
    .select("id, started_at, status")
    .eq("workspace_id", ctx.workspaceId).eq("patient_id", patientId)
    .order("started_at", { ascending: true });
  if (error) return { permitted: true, unavailable: true, encounters: null, firstSeen: null, lastSeen: null, closed: null };

  const rows = (data ?? []) as any[];
  return {
    permitted: true, unavailable: false,
    encounters: rows.length,
    firstSeen: rows.length ? dateOf(rows[0].started_at) : null,
    lastSeen: rows.length ? dateOf(rows[rows.length - 1].started_at) : null,
    closed: rows.filter(r => LOCKED_STATUSES.includes(r.status)).length,
  };
}
