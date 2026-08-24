import type { WorkspaceContext } from "@/lib/practice/access";
import { getConfiguration } from "@/lib/practice/configuration";
import { doseWithUnit } from "@/lib/practice/medication-constants";
import { practiceDayOf, zonedDayRange } from "@/lib/practice/practice-time";

// CPR-DOC-AUTO-001 sections 2, 9 and 15 -- THE FACT IS THE UNIT.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THIS MODULE EXISTS AT ALL, given that document generation already worked.
//
// The template engine's clinical reach is {{encounter.diagnoses}}, and that field is EVERY diagnosis on
// the consultation flattened into one string. A template takes all of them or none. So the question
// section 9 is built around -- "which of these facts goes in the letter" -- had no answer it was even
// possible to express, and the three acceptance tests that depend on it (grounding, disclosure control,
// regeneration not broadening scope) had nothing to test against.
//
// A merge FIELD is a hole in a sentence. A FACT is a recorded thing with a source row behind it. This
// module produces facts, and everything downstream -- selection, composition, provenance -- is defined
// on them.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// NOTHING HERE IS A SOURCE OF TRUTH. Every fact carries the table and row id it came from and is read
// live each time. This module holds no clinical state and section 19's "does not create a second
// clinical source of truth" is satisfied by construction, not by discipline.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const FACT_CATEGORIES = [
  "encounter", "diagnosis", "treatment", "procedure", "investigation", "medication", "follow_up",
] as const;
export type FactCategory = typeof FACT_CATEGORIES[number];

/** Where the fact came from relative to the consultation being documented. */
export type FactScope = "current_encounter" | "historical";

export type SelectableFact = {
  /** `<source_table>:<id>`. What the client sends back, and never a raw database id on its own. */
  key: string;
  category: FactCategory;
  sourceTable: string;
  sourceId: string;
  /** Section 18: "Show included clinical facts in readable human terms before issue." */
  label: string;
  detail: string | null;
  scope: FactScope;
  recordedOn: string | null;
  defaultSelected: boolean;
};

export type FactGroup = {
  category: FactCategory;
  title: string;
  facts: SelectableFact[];
  /** More existed than were offered. Stated, never silently dropped. */
  truncated: boolean;
  /**
   * The read FAILED. Distinct from an empty list, and the distinction is the house rule: an empty group
   * says "this patient has none recorded", an unreadable group says "I could not look". Rendering the
   * second as the first would tell a practitioner a patient is on no medication when the truth is that
   * the medication table did not answer.
   */
  unreadable: string | null;
};

const TITLES: Record<FactCategory, string> = {
  encounter: "This consultation",
  diagnosis: "Diagnoses",
  treatment: "Treatments",
  procedure: "Procedures",
  investigation: "Investigations",
  medication: "Medication",
  follow_up: "Follow-up",
};

/**
 * How many rows per category are offered.
 *
 * A cap is necessary -- a patient with nine years of history would otherwise produce a selection list
 * nobody reads, and PostgREST silently caps at 1000 rows anyway, which would truncate without saying so.
 * This limit truncates and SAYS SO, via FactGroup.truncated.
 */
export const CATEGORY_LIMIT = 25;

// ⚠ THE DOSE HELPER IS IMPORTED, NOT WRITTEN HERE, AND THAT IS A CORRECTION.
//
// This module briefly carried its own doseWithUnit, added on 2026-08-24 after a referral letter
// printed "Bisoprolol (3 - Oral)". The rule already existed in medication-constants.ts, where
// CPR-TREAT-001 put it, and the two did not agree: the older one knows that "500mg", "5 mg/kg" and a
// dose that spells its own unit already carry it, and the copy here used a plain substring test.
//
// Two implementations of one clinical formatting rule is the drift this codebase warns about in half
// a dozen other comments. There is one, and it is the older one.
const joinDetail = (parts: (string | null | undefined)[]): string | null => {
  const kept = parts.map(p => (p == null ? "" : String(p).trim())).filter(Boolean);
  return kept.length ? kept.join(" - ") : null;
};

/**
 * SECTION 9'S BASE DISCLOSURE DEFAULT. Facts recorded at the consultation being documented are offered
 * pre-selected. Everything else is offered unselected.
 */
const defaultFor = (scope: FactScope): boolean => scope === "current_encounter";

/**
 * ⚠ CATEGORIES WHOSE FACTS DESCRIBE A CURRENT STATE RATHER THAN A PAST EVENT.
 *
 * PHASE 1 WROTE HERE THAT THE SCOPE RULE HAD NO EXCEPTIONS, AND NAMED ACTIVE MEDICATION AS THE
 * TEMPTATION TO REFUSE. Phase 3 changes that deliberately, because section 5's priority 7 is a
 * MEDICATION LIST and under the unamended rule it would generate empty: a drug started at last
 * month's consultation is historical by scope, so every line of the document would default off and
 * the one-click output would be a page with no medication on it.
 *
 * The distinction that actually matters is not old-versus-new, it is EVENT versus STATE. A diagnosis
 * made in March is an event that happened once; disclosing it in an unrelated letter widens what that
 * letter says about a patient's past, which is what section 9 guards. An active prescription is not a
 * past event -- it is what the patient is taking now, and a document whose SUBJECT is the current
 * medication is not broadening disclosure by containing it. It is the document.
 *
 * TWO THINGS KEEP THIS HONEST AND BOTH ARE LOAD-BEARING:
 *
 *   1. Only the registry's already-filtered categories qualify. Medication is offered only when
 *      active or paused, follow-ups only when OPEN or SCHEDULED. "Every offered medication fact" and
 *      "the current medication" are therefore the same set. Widening the status filters would
 *      silently widen this too -- see the read() calls.
 *   2. A purpose must ASK for a category by name, and only its own subject. The medication list asks
 *      for medication. Nothing asks for diagnosis, and a purpose that did would be widening
 *      historical disclosure in exactly the way section 9 forbids.
 */
export const CURRENT_STATE_CATEGORIES: FactCategory[] = ["medication", "follow_up"];

const scopeOf = (rowEncounterId: string | null | undefined, encounterId: string | null): FactScope =>
  encounterId && rowEncounterId === encounterId ? "current_encounter" : "historical";

type Loaded = { rows: any[]; truncated: boolean; unreadable: string | null };

type ReadOptions = {
  /**
   * ⚠ FILTERED IN THE QUERY, NOT AFTER IT, AND THE DIFFERENCE IS NOT STYLISTIC.
   *
   * CATEGORY_LIMIT is applied by the database. Discarding rows in JavaScript afterwards means the
   * limit counted rows the practitioner will never see: a patient whose twenty-five most recent
   * medication rows are all discontinued would be offered an EMPTY medication list with truncated
   * false -- the registry stating, wrongly and confidently, that there is no current medication.
   */
  statusIn?: string[];
  /** Inclusive lower bound, already resolved from a practice day by the caller. */
  fromIso?: string | null;
  /**
   * ⚠ EXCLUSIVE UPPER BOUND, because zonedDayRange returns one.
   *
   * Its endIso is the NEXT midnight, deliberately: that function's own comment says a half-open range
   * "cannot drop the last millisecond of the day the way 23:59:59.999 does". Comparing with lte against
   * a next-midnight bound would reach one instant into the following day, so this is lt.
   */
  beforeIso?: string | null;
};

async function read(admin: any, table: string, columns: string, workspaceId: string,
                    patientId: string, orderBy: string, opts: ReadOptions = {}): Promise<Loaded> {
  let query = admin.from(table).select(columns)
    .eq("workspace_id", workspaceId).eq("patient_id", patientId);
  if (opts.statusIn) query = query.in("status", opts.statusIn);
  if (opts.fromIso) query = query.gte(orderBy, opts.fromIso);
  if (opts.beforeIso) query = query.lt(orderBy, opts.beforeIso);

  const { data, error } = await query.order(orderBy, { ascending: false }).limit(CATEGORY_LIMIT + 1);
  if (error) return { rows: [], truncated: false, unreadable: error.message };
  const rows = (data ?? []) as any[];
  return { rows: rows.slice(0, CATEGORY_LIMIT), truncated: rows.length > CATEGORY_LIMIT, unreadable: null };
}

/**
 * Everything this patient's record can offer a document, grouped and with section 9's defaults applied.
 *
 * Returns null when the patient does not belong to this workspace -- the same refusal shape the rest of
 * the practice engines use, so a caller cannot accidentally treat "not yours" as "nothing recorded".
 *
 * UPLOADED DOCUMENTS ARE ABSENT BY CONSTRUCTION. Section 9: "uploaded documents never auto-disclosed".
 * They are not filtered out further down, they are never read, so no future change to a default can
 * bring them into a letter by accident.
 */
export async function selectableFacts(admin: any, ctx: WorkspaceContext, args: {
  patientId: string; encounterId?: string | null;
  /**
   * Section 13's date range, for the longitudinal clinical summary. Practice days (YYYY-MM-DD),
   * inclusive at both ends.
   *
   * ⚠ RESOLVED THROUGH THE PRACTICE'S TIMEZONE, NOT THE SERVER'S. Comparing a date against a
   * timestamptz directly takes the UTC day, so "everything up to the 31st" would silently drop a
   * consultation held on the evening of the 31st in Kampala. zonedDayRange exists for this and this
   * codebase has already fixed the same bug once, one merge field at a time, in buildMergeContext.
   */
  from?: string | null;
  to?: string | null;
}): Promise<{ groups: FactGroup[]; encounterId: string | null } | null> {
  const { data: patient } = await admin.from("practice_patient")
    .select("id").eq("id", args.patientId).eq("workspace_id", ctx.workspaceId).maybeSingle();
  if (!patient) return null;

  // A consultation belonging to somebody else must not decide what counts as "current" for this
  // patient -- and must not appear as a fact. Same check buildMergeContext makes, for the same reason.
  let encounterId: string | null = null;
  let encounterRow: any = null;
  if (args.encounterId) {
    const { data: enc } = await admin.from("practice_encounter")
      .select("id, patient_id, started_at, reason_for_visit")
      .eq("id", args.encounterId).eq("workspace_id", ctx.workspaceId).maybeSingle();
    if (enc && enc.patient_id === args.patientId) { encounterId = enc.id; encounterRow = enc; }
  }

  // THE CONFIGURATION IS READ FIRST, not alongside the rest, because the date range cannot be turned
  // into instants without the practice's timezone. One extra round trip on a path that already makes
  // eight, in exchange for a range that means what the practitioner chose.
  const config = await getConfiguration(admin, ctx.workspaceId);
  const tz = (config as any)?.workspace?.timezone;
  const fromIso = args.from ? zonedDayRange(args.from, tz).startIso : null;
  const beforeIso = args.to ? zonedDayRange(args.to, tz).endIso : null;
  const window: ReadOptions = { fromIso, beforeIso };

  const [dx, tx, proc, inv, med, fu, planNote] = await Promise.all([
    read(admin, "practice_diagnosis", "id, label, certainty, is_primary, encounter_id, created_at", ctx.workspaceId, args.patientId, "created_at", window),
    read(admin, "practice_treatment", "id, label, treatment_type, dose, dose_unit, route, frequency, duration, encounter_id, created_at", ctx.workspaceId, args.patientId, "created_at", window),
    read(admin, "practice_procedure", "id, label, site, laterality, indication, encounter_id, created_at", ctx.workspaceId, args.patientId, "created_at", window),
    read(admin, "practice_encounter_investigation", "id, label, status, summary, encounter_id, requested_at", ctx.workspaceId, args.patientId, "requested_at", window),
    // ONLY CURRENT MEDICATION IS OFFERED. Section 13 names the medication document's input as "confirm
    // current treatment list", and a discontinued drug in a letter reads as a prescription. Widening
    // this to stopped medication is a product decision, not a tweak -- it changes what a document
    // discloses by default about a patient's past.
    read(admin, "practice_medication", "id, generic_name, brand_name, dose_text, dose_unit, route, frequency, status, encounter_id, created_at", ctx.workspaceId, args.patientId, "created_at", { ...window, statusIn: ["active", "paused"] }),
    // ⚠ ONLY OUTSTANDING FOLLOW-UPS, AND PHASE 1 SHIPPED WITHOUT THIS FILTER. The section heading a
    // follow-up prints under is "Follow-up arranged" / "Next steps", and practice_follow_up carries
    // COMPLETED, MISSED and CANCELLED alongside OPEN and SCHEDULED. A cancelled follow-up rendered
    // under either heading tells a patient to attend something that was called off.
    read(admin, "practice_follow_up", "id, kind, reason, due_on, priority, status, origin_encounter_id, created_at", ctx.workspaceId, args.patientId, "created_at", { ...window, statusIn: ["OPEN", "SCHEDULED"] }),
    encounterId
      ? admin.from("practice_encounter_note").select("id, body")
          .eq("workspace_id", ctx.workspaceId).eq("encounter_id", encounterId).eq("note_type", "plan").limit(1)
      : Promise.resolve({ data: [] }),
  ]);

  const day = (v: string | null | undefined) => (v ? practiceDayOf(tz, v) : null);

  const build = (
    category: FactCategory, table: string, loaded: Loaded,
    map: (r: any) => { id: string; label: string; detail: string | null; encounterId: string | null; recordedOn: string | null },
  ): FactGroup => ({
    category, title: TITLES[category], truncated: loaded.truncated, unreadable: loaded.unreadable,
    facts: loaded.rows.map(r => {
      const m = map(r);
      const scope = scopeOf(m.encounterId, encounterId);
      return {
        key: `${table}:${m.id}`, category, sourceTable: table, sourceId: m.id,
        label: m.label, detail: m.detail, scope, recordedOn: m.recordedOn,
        defaultSelected: defaultFor(scope),
      };
    }),
  });

  // The consultation itself. Only ever current, and only when there is one.
  const encounterFacts: SelectableFact[] = [];
  if (encounterRow) {
    const on = day(encounterRow.started_at);
    if (encounterRow.reason_for_visit?.trim())
      encounterFacts.push({
        key: `practice_encounter:${encounterRow.id}`, category: "encounter",
        sourceTable: "practice_encounter", sourceId: encounterRow.id,
        label: "Reason for visit", detail: encounterRow.reason_for_visit.trim(),
        scope: "current_encounter", recordedOn: on, defaultSelected: true,
      });
    const plan = ((planNote as any)?.data ?? [])[0];
    if (plan?.body?.trim())
      encounterFacts.push({
        key: `practice_encounter_note:${plan.id}`, category: "encounter",
        sourceTable: "practice_encounter_note", sourceId: plan.id,
        label: "Plan", detail: plan.body.trim(),
        scope: "current_encounter", recordedOn: on, defaultSelected: true,
      });
  }

  const groups: FactGroup[] = [
    { category: "encounter", title: TITLES.encounter, facts: encounterFacts, truncated: false, unreadable: null },
    build("diagnosis", "practice_diagnosis", dx, r => ({
      id: r.id, label: r.label, encounterId: r.encounter_id, recordedOn: day(r.created_at),
      detail: joinDetail([r.certainty, r.is_primary ? "primary" : null]),
    })),
    build("treatment", "practice_treatment", tx, r => ({
      id: r.id, label: r.label, encounterId: r.encounter_id, recordedOn: day(r.created_at),
      // Migration 359. The same helper as medication, so a dose reads the same wherever it appears.
      detail: joinDetail([r.treatment_type, doseWithUnit(r.dose, r.dose_unit), r.route, r.frequency, r.duration]),
    })),
    build("procedure", "practice_procedure", proc, r => ({
      id: r.id, label: r.label, encounterId: r.encounter_id, recordedOn: day(r.created_at),
      // 'not_applicable' is the column default and means nothing to a reader, so it is not printed.
      detail: joinDetail([r.site, r.laterality !== "not_applicable" ? r.laterality : null, r.indication]),
    })),
    build("investigation", "practice_encounter_investigation", inv, r => ({
      id: r.id, label: r.label, encounterId: r.encounter_id, recordedOn: day(r.requested_at),
      detail: joinDetail([r.status, r.summary]),
    })),
    // The active/paused filter is applied in the query -- see the read() call and ReadOptions.
    build("medication", "practice_medication", med,
      r => ({
        id: r.id, label: [r.generic_name, r.brand_name ? `(${r.brand_name})` : null].filter(Boolean).join(" "),
        encounterId: r.encounter_id, recordedOn: day(r.created_at),
        detail: joinDetail([doseWithUnit(r.dose_text, r.dose_unit), r.route, r.frequency, r.status === "paused" ? "paused" : null]),
      })),
    build("follow_up", "practice_follow_up", fu, r => ({
      id: r.id, label: r.reason, encounterId: r.origin_encounter_id, recordedOn: day(r.created_at),
      detail: joinDetail([r.kind, r.due_on ? `due ${r.due_on}` : null, r.priority !== "routine" ? r.priority : null]),
    })),
  ];

  return { groups, encounterId };
}

/**
 * Turn the keys a client sent back into facts.
 *
 * ⚠ THIS IS THE PATIENT-ISOLATION BOUNDARY (section 17), and it works by only ever looking INSIDE the
 * offered set. A key naming another patient's diagnosis is not rejected by a check that could be
 * forgotten -- it is simply not found, because the only facts that exist here are the ones
 * selectableFacts produced for this patient. Never "resolve" a key by reading it back from the database.
 *
 * Order comes from the OFFERED list, not from the client's array, so the document's fact order is a
 * property of the record rather than of whatever sequence a form submitted.
 */
export function resolveSelection(groups: FactGroup[], keys: string[]): {
  selected: SelectableFact[]; unknown: string[];
} {
  const wanted = new Set(keys);
  const selected: SelectableFact[] = [];
  const found = new Set<string>();
  for (const g of groups) {
    for (const f of g.facts) {
      if (!wanted.has(f.key)) continue;
      selected.push(f);
      found.add(f.key);
    }
  }
  return { selected, unknown: [...wanted].filter(k => !found.has(k)) };
}

/**
 * The keys to offer pre-selected, for a form that has not been touched yet.
 *
 * `alsoCurrent` names categories whose facts come in regardless of scope, because for that document
 * they ARE the subject -- see CURRENT_STATE_CATEGORIES for why that is not a hole in section 9. A
 * purpose passes only its own subject, never a category it merely finds useful.
 *
 * ⚠ THIS CAN RETURN KEYS WHOSE fact.defaultSelected IS FALSE, and that is intended rather than
 * inconsistent. defaultSelected describes the fact -- "was this recorded at the consultation being
 * documented" -- and stays a property of the record. What a particular document defaults to is a
 * property of the document, and belongs to the caller asking.
 */
export function defaultSelection(groups: FactGroup[], opts: { alsoCurrent?: FactCategory[] } = {}): string[] {
  const also = new Set(opts.alsoCurrent ?? []);
  return groups.flatMap(g => g.facts
    .filter(f => f.defaultSelected || also.has(f.category))
    .map(f => f.key));
}
