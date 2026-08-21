import { hasCapability, type WorkspaceContext } from "@/lib/practice/access";
import { LIVE_STATUSES } from "@/lib/practice/encounter-constants";
import { todaysPlan } from "@/lib/practice/activity";
import { zonedDayRange, practiceToday } from "@/lib/practice/practice-time";
import { searchPatients } from "@/lib/practice/patients";
import { logAccess } from "@/lib/practice/privacy";
import { toTsQuery } from "@/lib/practice/search";
import type { EncounterWarning } from "@/lib/practice/encounter-workspace-constants";
import {
  outstandingComponents, agingState, COMPONENT_LABEL, HISTORY_PAGE_SIZE,
  HISTORY_PERIODS, HISTORY_STATES, DEFAULT_HISTORY_PERIOD,
  historyPeriodRange, historyPeriodKeyFor,
  type AgingState, type ContextState, type HistoryPeriodKey, type HistoryStateKey,
} from "@/lib/practice/encounters-landing-constants";
import { periodFromParams, type PeriodRange } from "@/lib/practice/period-range";

// CPR-ENC-LANDING-001 -- the reads behind the Encounters landing page.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THREE STATES, EVERYWHERE, AND ON A BOARD OF COUNTS THE THIRD ONE IS THE ONE THAT MATTERS.
//
//   permitted: false   the caller holds no capability. NOTHING WAS READ.
//   unavailable: true  a read was attempted and FAILED. `items: []` is not an answer and `count: 0` is
//                      a lie -- "0" on this board says "nothing needs you", which is exactly the
//                      sentence a practitioner acts on by going home.
//   items: []          the read succeeded and there is genuinely nothing.
//
// ⚠ EVERY COUNT IN THIS FILE IS `number | null` AND NULL IS NEVER COERCED. PostgREST returns
// `count: null` on error, so the ERROR is what is checked -- the null-count-as-nought trap this
// codebase has now recorded three times.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS ENGINE DELIBERATELY DOES NOT READ (spec s0/s17, the frozen decision)
//
//   No queue. No waiting room. No appointment list. No arrival state. No per-session figure row.
//   The session is read ONCE, through todaysPlan, and only to say what a new encounter will inherit.
//
//   Current Session runs the live clinic. This is the clinical-record workbench, and the boundary is
//   kept in the reads as well as in the layout -- a loader that fetched the queue would be one edit away
//   from a page that drew it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const CAP_LIST = "encounter.list";
const CAP_SIGN = "encounter.sign";
const CAP_CREATE = "encounter.create";
const CAP_PATIENT = "patient.list";
/** The day's plan belongs to the home view's capability, not to encounters. Both are seeded codes. */
const CAP_PLAN_VIEW = "practice.home.view";

/**
 * Every capability code this engine gates on, exported so the harness can prove each one EXISTS in
 * practice_role_capabilities.
 *
 * ⚠ NO NEW CAPABILITY CODES. All five are already seeded; a plausible invented code costs nothing at
 * compile time and silently disables a feature at runtime, which has happened six times in this product.
 * The harness checks against THIS array rather than a list re-typed in the test, because a re-typed list
 * can invent the same fiction and agree with it forever.
 */
export const ENCOUNTERS_LANDING_CAPABILITIES = [
  CAP_LIST, CAP_SIGN, CAP_CREATE, CAP_PATIENT, CAP_PLAN_VIEW,
] as const;

/**
 * How many rows the work panels read.
 *
 * ⚠ IT IS A BOUND AND THE PAGE SAYS SO WHENEVER THE COUNT EXCEEDS IT. A panel showing fifty of sixty
 * open encounters without a word is how somebody concludes they have seen everything.
 */
export const BOARD_LIMIT = 50;

export type Panel<T> = {
  items: T[];
  permitted: boolean;
  unavailable: boolean;
  detail: string | null;
  /**
   * ⚠ TRUE WHEN THE LIST WAS CUT SHORT BY BOARD_LIMIT, and the screen MUST say so.
   *
   * A silently truncated work list reads as "that is all". Somebody looking for a consultation that is
   * not among the first fifty concludes it does not exist -- and a board is exactly where that is
   * believed, because it is meant to be the complete picture of what is outstanding.
   *
   * Default false, so every existing caller keeps its meaning: absent evidence of truncation is not
   * evidence of truncation.
   */
  capped: boolean;
};

const denied = <T,>(): Panel<T> => ({ items: [], permitted: false, unavailable: false, detail: null, capped: false });
const failed = <T,>(detail: string): Panel<T> => ({ items: [], permitted: true, unavailable: true, detail, capped: false });
const loaded = <T,>(items: T[], capped = false): Panel<T> => ({ items, permitted: true, unavailable: false, detail: null, capped });

// ── ROWS ────────────────────────────────────────────────────────────────────────────────────────────

export type LandingEncounter = {
  id: string;
  patientId: string;
  /** Null when the name read failed. ⚠ "Unknown patient" is a claim about the RECORD, not about a read. */
  patientName: string | null;
  patientNameUnavailable: boolean;
  /** s11's "safe identifier": the practice's own number, never a national id. Null when there is none. */
  patientIdentifier: string | null;
  patientIdentifierUnavailable: boolean;
  status: string;
  entryPathway: string;
  encounterMode: string;
  reasonForVisit: string | null;
  startedAt: string;
  completedAt: string | null;
  signedAt: string | null;
  /** From practice_encounter_status_history. There is NO amended_at column -- see the loader's note. */
  amendedAt: string | null;
  amendedAtUnavailable: boolean;
  activityId: string | null;
  sessionTitle: string | null;
  sessionLocation: string | null;
  elapsedMinutes: number | null;
  aging: AgingState;
  /**
   * s4.4's "remaining required components".
   *
   * ⚠ NULL MEANS THE COMPONENT READS FAILED, AND AN EMPTY ARRAY MEANS NOTHING IS OUTSTANDING. A card
   * that drew both as "nothing left to do" would tell a practitioner a half-written consultation was
   * finished.
   */
  outstanding: EncounterWarning[] | null;
  /** s6's "last completed component, where useful". Null when nothing has been recorded yet. */
  lastComponent: { key: string; label: string; at: string } | null;
  lastComponentUnavailable: boolean;
};

export type AttentionRow = {
  key: string;
  label: string;
  detail: string;
  /** ⚠ null is "could not be counted" and MUST NOT render as nought. */
  count: number | null;
  permitted: boolean;
  href: string;
};

export type LandingContext = {
  state: ContextState;
  title: string | null;
  activityLabel: string | null;
  facility: string | null;
  location: string | null;
  room: string | null;
  plannedStartMinute: number | null;
  plannedEndMinute: number | null;
  activityId: string | null;
};

export type LandingCounts = {
  open: number | null;
  ready: number | null;
  completedToday: number | null;
  attention: number | null;
  all: number | null;
};

export type HistoryFilter = {
  period: HistoryPeriodKey;
  state: HistoryStateKey;
  /** ⚠ THE BOUNDS THE QUERY ACTUALLY APPLIED. Null on either side means that end is not bounded. */
  from: string | null;
  to: string | null;
  page: number;
  /**
   * The same window as the shared period control sees it, for the navigator on the page.
   *
   * ⚠ IT IS A DESCRIPTION, NOT THE QUERY'S SOURCE. `from` and `to` above are what bounded the read; a
   * one-sided custom range is expressible there and not here. Two fields rather than one because the
   * alternative is a control that draws a period the query did not use.
   */
  range: PeriodRange;
};

export type EncountersLanding = {
  today: string;
  timezone: string;
  context: LandingContext;
  counts: LandingCounts;
  /** True when a count query failed, so the tab row can say the figures are incomplete. */
  countsUnavailable: boolean;
  open: Panel<LandingEncounter>;
  ready: Panel<LandingEncounter>;
  /** Whatever the selected tab asks for. `open` and `ready` are always loaded; this is the tab's list. */
  tabList: Panel<LandingEncounter>;
  attention: AttentionRow[];
  history: Panel<LandingEncounter>;
  historyFilter: HistoryFilter;
  /** True when there is a further page of history behind this one. */
  historyHasMore: boolean;
  search: LandingSearch | null;
  can: { sign: boolean; create: boolean; patient: boolean };
};

// ── HELPERS ─────────────────────────────────────────────────────────────────────────────────────────

const ENCOUNTER_COLUMNS =
  "id, patient_id, status, entry_pathway, encounter_mode, reason_for_visit, " +
  "started_at, completed_at, signed_at, activity_id, outcome";

/** A count that knows it failed. ⚠ The ERROR is checked, not the nullness of `count`. */
async function countOf(q: any): Promise<number | null> {
  const { count, error } = await q;
  return error ? null : (count ?? 0);
}

/** Names for a set of patients, in ONE query rather than N (s15). */
async function patientNames(admin: any, workspaceId: string, ids: string[]) {
  if (ids.length === 0) return { byId: new Map<string, string>(), unavailable: false };
  const { data, error } = await admin.from("practice_patient")
    .select("id, display_name").eq("workspace_id", workspaceId).in("id", ids);
  if (error) return { byId: new Map<string, string>(), unavailable: true };
  return {
    byId: new Map(((data ?? []) as any[]).map(p => [p.id as string, p.display_name as string])),
    unavailable: false,
  };
}

/**
 * The practice's own patient number, in one query.
 *
 * ⚠ `practice_id` AND NOTHING ELSE. practice_patient_identifier also holds national ids, passports and
 * hospital numbers; s11 asks for a "safe identifier" and s9 for "data-minimization", and a national id
 * on a board anyone in the practice can read is neither.
 */
async function patientIdentifiers(admin: any, workspaceId: string, ids: string[]) {
  if (ids.length === 0) return { byId: new Map<string, string>(), unavailable: false };
  const { data, error } = await admin.from("practice_patient_identifier")
    .select("patient_id, value").eq("workspace_id", workspaceId)
    .eq("identifier_type", "practice_id").in("patient_id", ids).is("valid_to", null);
  if (error) return { byId: new Map<string, string>(), unavailable: true };
  return {
    byId: new Map(((data ?? []) as any[]).map(r => [r.patient_id as string, r.value as string])),
    unavailable: false,
  };
}

type ComponentFacts = {
  /** Per encounter: the counts encounterWarnings needs. Null inside means that table could not be read. */
  counts: Map<string, { diagnoses: number | null; treatments: number | null; decisions: number | null }>;
  last: Map<string, { key: string; label: string; at: string }>;
  /** True when ANY of the component reads failed -- so no card may claim "nothing outstanding". */
  unavailable: boolean;
};

/**
 * What has been recorded inside a set of encounters.
 *
 * ⚠ FOUR QUERIES FOR N ENCOUNTERS, NOT FOUR PER ENCOUNTER. s15: "Avoid N+1 requests for patient and
 * completion summaries." Each table is read once with `.in("encounter_id", ids)`.
 *
 * ⚠ AND A TABLE THAT FAILED CONTRIBUTES `null`, NOT `0`. A refused diagnosis read that became a zero
 * would make every card on the board announce "Still required: Diagnosis" over consultations that have
 * one -- and the same arithmetic in reverse is what makes a finished-looking card out of a half-written
 * record.
 */
async function componentFacts(admin: any, workspaceId: string, encounterIds: string[]): Promise<ComponentFacts> {
  const counts = new Map<string, { diagnoses: number | null; treatments: number | null; decisions: number | null }>();
  const last = new Map<string, { key: string; label: string; at: string }>();
  if (encounterIds.length === 0) return { counts, last, unavailable: false };

  const [diagRes, treatRes, decRes, noteRes, procRes] = await Promise.all([
    admin.from("practice_diagnosis").select("encounter_id, created_at")
      .eq("workspace_id", workspaceId).in("encounter_id", encounterIds),
    admin.from("practice_treatment").select("encounter_id, treatment_type, created_at")
      .eq("workspace_id", workspaceId).in("encounter_id", encounterIds),
    admin.from("practice_encounter_decision").select("encounter_id, created_at")
      .eq("workspace_id", workspaceId).in("encounter_id", encounterIds),
    // ⚠ `body` COMES BACK BECAUSE AN EMPTY SEGMENT IS NOT A WRITTEN ONE. migration 194:82 defaults body
    // to '', so a row exists the moment a template is applied; counting rows would report an untouched
    // encounter as documented.
    admin.from("practice_encounter_note").select("encounter_id, note_type, body, updated_at")
      .eq("workspace_id", workspaceId).in("encounter_id", encounterIds),
    admin.from("practice_procedure").select("encounter_id, performed_at")
      .eq("workspace_id", workspaceId).in("encounter_id", encounterIds),
  ]);

  const unavailable = !!(diagRes.error || treatRes.error || decRes.error || noteRes.error || procRes.error);

  for (const id of encounterIds) {
    counts.set(id, {
      diagnoses: diagRes.error ? null : 0,
      treatments: treatRes.error ? null : 0,
      decisions: decRes.error ? null : 0,
    });
  }

  const note = (id: string, key: string, at: string | null) => {
    if (!at) return;
    const cur = last.get(id);
    if (!cur || Date.parse(at) > Date.parse(cur.at)) {
      last.set(id, { key, label: COMPONENT_LABEL[key] ?? key, at });
    }
  };

  for (const r of ((diagRes.data ?? []) as any[])) {
    const c = counts.get(r.encounter_id); if (c && c.diagnoses !== null) c.diagnoses++;
    note(r.encounter_id, "diagnosis", r.created_at);
  }
  for (const r of ((treatRes.data ?? []) as any[])) {
    const c = counts.get(r.encounter_id); if (c && c.treatments !== null) c.treatments++;
    // The comp's own example is "Medication entered", and a medication IS a treatment row of that type.
    note(r.encounter_id, r.treatment_type === "medication" ? "medication" : "treatment", r.created_at);
  }
  for (const r of ((decRes.data ?? []) as any[])) {
    const c = counts.get(r.encounter_id); if (c && c.decisions !== null) c.decisions++;
    note(r.encounter_id, "decision", r.created_at);
  }
  for (const r of ((noteRes.data ?? []) as any[])) {
    if (!String(r.body ?? "").trim()) continue;
    note(r.encounter_id, `note_${r.note_type}`, r.updated_at);
  }
  for (const r of ((procRes.data ?? []) as any[])) {
    note(r.encounter_id, "procedure", r.performed_at);
  }

  return { counts, last, unavailable };
}

/**
 * When each of these encounters was amended.
 *
 * ⚠ THERE IS NO `amended_at` COLUMN, AND s11 ASKS FOR ONE. migration 194 gives practice_encounter
 * `completed_at` and `signed_at` and no third stamp; the amendment time lives in
 * practice_encounter_status_history, which 194:94 makes the immutable transition log. So it is DERIVED
 * here, in one query for the whole page, rather than invented as a column or faked from `updated_at` --
 * which moves on any write and would date an amendment to whatever happened last.
 */
async function amendedTimes(admin: any, workspaceId: string, encounterIds: string[]) {
  if (encounterIds.length === 0) return { byId: new Map<string, string>(), unavailable: false };
  const { data, error } = await admin.from("practice_encounter_status_history")
    .select("encounter_id, occurred_at").eq("workspace_id", workspaceId)
    .in("encounter_id", encounterIds).eq("to_status", "AMENDED")
    .order("occurred_at", { ascending: false });
  if (error) return { byId: new Map<string, string>(), unavailable: true };
  const byId = new Map<string, string>();
  for (const r of ((data ?? []) as any[])) {
    if (!byId.has(r.encounter_id)) byId.set(r.encounter_id, r.occurred_at);
  }
  return { byId, unavailable: false };
}

type ShapeInput = {
  names: Map<string, string>; namesUnavailable: boolean;
  identifiers: Map<string, string>; identifiersUnavailable: boolean;
  sessions: Map<string, { title: string; location: string | null }>;
  components: ComponentFacts | null;
  amended: { byId: Map<string, string>; unavailable: boolean };
  nowMs: number;
};

function shape(row: any, s: ShapeInput): LandingEncounter {
  const startedMs = Date.parse(row.started_at);
  const elapsedMinutes = Number.isNaN(startedMs) ? null : Math.max(0, Math.floor((s.nowMs - startedMs) / 60000));
  const session = row.activity_id ? s.sessions.get(row.activity_id) ?? null : null;
  const facts = s.components?.counts.get(row.id) ?? null;

  return {
    id: row.id,
    patientId: row.patient_id,
    patientName: s.namesUnavailable ? null : (s.names.get(row.patient_id) ?? null),
    patientNameUnavailable: s.namesUnavailable,
    patientIdentifier: s.identifiersUnavailable ? null : (s.identifiers.get(row.patient_id) ?? null),
    patientIdentifierUnavailable: s.identifiersUnavailable,
    status: row.status,
    entryPathway: row.entry_pathway,
    encounterMode: row.encounter_mode,
    reasonForVisit: row.reason_for_visit ?? null,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? null,
    signedAt: row.signed_at ?? null,
    amendedAt: s.amended.unavailable ? null : (s.amended.byId.get(row.id) ?? null),
    amendedAtUnavailable: s.amended.unavailable,
    activityId: row.activity_id ?? null,
    sessionTitle: session?.title ?? null,
    sessionLocation: session?.location ?? null,
    elapsedMinutes,
    aging: agingState(elapsedMinutes),
    // ⚠ NULL WHEN THE COMPONENT READS WERE NOT DONE OR FAILED. Not an empty array: an empty array is the
    // claim that nothing is outstanding.
    outstanding: !s.components || s.components.unavailable || !facts
      ? null
      : outstandingComponents({ ...facts, outcome: row.outcome ?? null }),
    lastComponent: s.components?.last.get(row.id) ?? null,
    lastComponentUnavailable: !!s.components?.unavailable,
  };
}

// ── SEARCH (s4.1, s9) ───────────────────────────────────────────────────────────────────────────────

export type LandingSearch = {
  query: string;
  ran: boolean;
  // ⚠ patientNumber IS THE IDENTIFIER AND WAS BEING DROPPED HERE. searchPatients has returned it since
  // migration 289 made YY-NNNNNN the patient identifier and retired P-XXXXXX to a legacy alias; this
  // type declared only the retired one, so the search results on /practice/encounters showed a bare
  // NAME for every patient registered since. Naming a patient without a number is the thing the
  // register exists to prevent.
  patients: {
    id: string; displayName: string;
    patientNumber: string | null; practiceId: string | null; matchedBy: string;
  }[];
  /** ⚠ False when a probe failed. A caller must NOT then say "nobody matches". */
  patientsComplete: boolean;
  patientsDetail: string | null;
  patientsPermitted: boolean;
  encounters: LandingEncounter[];
  encountersUnavailable: boolean;
  encountersDetail: string | null;
  encountersPermitted: boolean;
};

/**
 * The board's own search box.
 *
 * ⚠ IT IS NOT searchPractice, AND THE REASON IS A DEFECT IN THAT FUNCTION RATHER THAN A PREFERENCE.
 * search.ts's `push` helper drops a group whose row array is empty, and its per-domain reads discard the
 * PostgREST error -- so an encounter query that FAILED renders identically to one that matched nobody.
 * On a global search page that is a poor result; on a clinical-record workbench it is the sentence that
 * sends somebody to open a second consultation for a patient who already has one. That defect is
 * reported rather than fixed here (it is not this screen's file), and this box does its own two reads
 * with the errors kept.
 *
 * WHAT IS REUSED: searchPatients -- the identity ranking migration 193 built, which puts an exact
 * identifier above an exact phone above a name, and which already reports `complete: false` when a probe
 * failed. Re-implementing that here would give the practice two answers to "is this person registered"
 * and the looser one would win at a busy desk.
 *
 * s12: the search itself is a read across the practice, so it is logged before it returns.
 */
async function landingSearch(
  admin: any, ctx: WorkspaceContext, rawQuery: string, s: Omit<ShapeInput, "components"> ,
): Promise<LandingSearch> {
  const query = rawQuery.trim();
  const canPatients = hasCapability(ctx, CAP_PATIENT);
  const canEncounters = hasCapability(ctx, CAP_LIST);

  const empty: LandingSearch = {
    query, ran: false,
    patients: [], patientsComplete: true, patientsDetail: null, patientsPermitted: canPatients,
    encounters: [], encountersUnavailable: false, encountersDetail: null, encountersPermitted: canEncounters,
  };
  if (query.length < 2) return empty;

  const ts = toTsQuery(query);

  const [people, encRes] = await Promise.all([
    canPatients ? searchPatients(admin, ctx.workspaceId, query, 10) : Promise.resolve(null),
    canEncounters && ts
      ? admin.from("practice_encounter").select(ENCOUNTER_COLUMNS)
        .eq("workspace_id", ctx.workspaceId).textSearch("search_vector", ts)
        .order("started_at", { ascending: false }).limit(10)
      : Promise.resolve(null),
  ]);

  const encRows = encRes && !encRes.error ? ((encRes.data ?? []) as any[]) : [];
  const encIds = [...new Set(encRows.map(r => r.patient_id))];
  const names = await patientNames(admin, ctx.workspaceId, encIds);

  await logAccess(admin, {
    workspaceId: ctx.workspaceId, actorId: ctx.userId, subjectKind: "search", action: "search",
    route: "/practice/encounters", detail: query,
  });

  return {
    query, ran: true,
    patients: people
      ? people.results.map(p => ({
        id: p.id, displayName: p.displayName,
        patientNumber: p.patientNumber ?? null, practiceId: p.practiceId ?? null, matchedBy: p.matchedBy,
      }))
      : [],
    patientsComplete: people ? people.complete : true,
    patientsDetail: people ? people.detail : null,
    patientsPermitted: canPatients,
    encounters: encRows.map(r => shape(r, {
      ...s, components: null,
      names: names.byId, namesUnavailable: names.unavailable,
    })),
    // ⚠ THE ERROR IS KEPT. Without this the whole point of writing this function instead of calling
    // searchPractice is thrown away on the line that matters.
    encountersUnavailable: !!(encRes && encRes.error),
    encountersDetail: encRes?.error?.message ?? null,
    encountersPermitted: canEncounters,
  };
}

// ── THE LOADER ──────────────────────────────────────────────────────────────────────────────────────

export type LandingOptions = {
  at?: Date;
  tab?: string;
  session?: string | null;
  q?: string | null;
  historyPeriod?: string | null;
  historyState?: string | null;
  historyFrom?: string | null;
  historyTo?: string | null;
  historyPage?: number;
  /**
   * The SHARED period contract's query values (period-range.ts's PERIOD_PARAMS), when the URL carries
   * them. They take precedence over hperiod/hfrom/hto; those keep working when these are absent.
   */
  periodParams?: Record<string, string | null | undefined>;
};

/**
 * s4.7's filter, resolved.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THE ARITHMETIC MOVED TO period-range.ts AND THE ANSWER DID NOT MOVE WITH IT.
 *
 * This function used to subtract days from `today` itself. It now asks the shared module for a ROLLING
 * period, because the practice owner asked for the same period control on every screen that reviews data
 * over time and a second copy of "what does last week mean" is how two screens come to disagree.
 *
 * The shared module expresses BOTH anchorings. It had to: "last 30 days" is not "this month", and a
 * calendar-only module would have quietly turned a clinician's month of records into three days on the
 * third of August. `historyPeriodRange` asks for rolling, gets rolling, and returns the SAME two dates
 * this function used to compute -- proved by running both implementations side by side in the harness
 * rather than by asserting the label.
 *
 * ⚠ A ONE-SIDED CUSTOM RANGE IS UNTOUCHED AND IS STILL ONE-SIDED. `?hperiod=custom&hfrom=2026-01-01`
 * with no `hto` bounds the register at one end only, exactly as it always has. A PeriodRange has two
 * ends, so it cannot say that; filling the missing end would put a ceiling on somebody's register that
 * they did not ask for, and the page prints the one-sided bound in words instead.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
function resolveHistoryFilter(opts: LandingOptions, today: string): HistoryFilter {
  const state = (HISTORY_STATES.find(s => s.key === opts.historyState)?.key ?? "all");
  const page = Number.isFinite(opts.historyPage) && (opts.historyPage ?? 0) > 0 ? Math.floor(opts.historyPage!) : 0;

  // ── The generic period contract, when the URL carries it. ────────────────────────────────────────
  //
  // Six screens now share one spelling of "which days am I looking at" (PERIOD_PARAMS). s4.7's own
  // hperiod / hfrom / hto keep working underneath it, because a link somebody sent a colleague last week
  // has to open what it opened last week.
  const generic = opts.periodParams
    ? periodFromParams(k => opts.periodParams?.[k] ?? null, today,
      { view: "agenda", anchorDate: today, from: null, to: null, anchoring: "rolling", backDays: 30 })
    : null;
  const usedGeneric = !!(opts.periodParams && Object.values(opts.periodParams).some(v => !!v));

  if (usedGeneric && generic) {
    return {
      period: historyPeriodKeyFor(generic), state, page, range: generic,
      from: generic.bounded ? generic.fromDate : null,
      to: generic.bounded ? generic.toDate : null,
    };
  }

  const period = (HISTORY_PERIODS.find(p => p.key === opts.historyPeriod)?.key ?? DEFAULT_HISTORY_PERIOD);
  const range = historyPeriodRange(period, today, { from: opts.historyFrom, to: opts.historyTo });

  if (period === "custom") {
    // ⚠ THE RAW VALUES, NOT THE RANGE'S. This is the branch that keeps a one-sided custom one-sided.
    return { period, state, from: opts.historyFrom ?? null, to: opts.historyTo ?? null, page, range };
  }
  return { period, state, from: range.fromDate, to: range.toDate, page, range };
}

/**
 * Everything the Encounters landing page draws.
 *
 * ORDER OF WORK, WHICH IS s15's ORDER: open and ready-to-sign are read first and always; history is
 * bounded and paginated behind them; search runs only when somebody typed something.
 */
export async function encountersLanding(
  admin: any, ctx: WorkspaceContext, opts: LandingOptions = {},
): Promise<EncountersLanding> {
  const clock = { timezone: ctx.workspaceTimezone, today: practiceToday(ctx.workspaceTimezone) };
  const nowMs = (opts.at ?? new Date()).getTime();
  const can = (c: string) => hasCapability(ctx, c);
  const canList = can(CAP_LIST);
  const historyFilter = resolveHistoryFilter(opts, clock.today);

  const abilities = { sign: can(CAP_SIGN), create: can(CAP_CREATE), patient: can(CAP_PATIENT) };

  // ── s4.2: the inherited context, read ONCE ────────────────────────────────────────────────────────
  //
  // ⚠ todaysPlan REPORTS A MISSING CAPABILITY AS `unavailable`, which is right for its own screen and
  // wrong for this one: "you may not see the day" and "the day could not be read" are the two states
  // this strip exists to keep apart. So the capability is checked HERE, before the call.
  const canSeePlan = can(CAP_PLAN_VIEW);
  const plan = canSeePlan
    ? await todaysPlan(admin, ctx, { at: opts.at })
    : null;

  const current = plan?.current ?? null;
  const context: LandingContext = {
    state: !canSeePlan ? "not_permitted"
      : plan?.unavailable ? "unreadable"
        : current ? "running" : "none",
    title: current?.title ?? null,
    activityLabel: current?.label ?? null,
    facility: current?.facilityName ?? null,
    location: current?.locationName ?? null,
    room: current?.room ?? null,
    plannedStartMinute: current?.plannedStartMinute ?? null,
    plannedEndMinute: current?.plannedEndMinute ?? null,
    activityId: current?.id ?? null,
  };

  if (!canList) {
    return {
      today: clock.today, timezone: clock.timezone, context,
      counts: { open: null, ready: null, completedToday: null, attention: null, all: null },
      countsUnavailable: false,
      open: denied(), ready: denied(), tabList: denied(),
      attention: attentionRows(null, null, null, false),
      history: denied(), historyFilter, historyHasMore: false,
      search: null, can: abilities,
    };
  }

  const { startIso, endIso } = zonedDayRange(clock.today, clock.timezone);
  const sessionFilter = opts.session || null;
  const withSession = (q: any) => (sessionFilter ? q.eq("activity_id", sessionFilter) : q);

  // ── the counts (s4.3: each tab is a filter with a figure) ─────────────────────────────────────────
  const [openCount, readyCount, completedTodayCount, allCount] = await Promise.all([
    countOf(withSession(admin.from("practice_encounter").select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).in("status", LIVE_STATUSES))),
    countOf(withSession(admin.from("practice_encounter").select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).eq("status", "COMPLETED"))),
    countOf(withSession(admin.from("practice_encounter").select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).not("completed_at", "is", null)
      .gte("completed_at", startIso).lt("completed_at", endIso))),
    countOf(withSession(admin.from("practice_encounter").select("id", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId))),
  ]);

  // ⚠ THE SUM IS NULL IF EITHER HALF IS. An attention figure computed as `(open ?? 0) + (ready ?? 0)`
  // would render a failed read as a smaller number -- the most dangerous shape this bug takes, because
  // it is plausible rather than obviously broken.
  const attentionCount = openCount === null || readyCount === null ? null : openCount + readyCount;
  const counts: LandingCounts = {
    open: openCount, ready: readyCount, completedToday: completedTodayCount,
    attention: attentionCount, all: allCount,
  };
  const countsUnavailable = [openCount, readyCount, completedTodayCount, allCount].some(c => c === null);

  // ── the work lists ────────────────────────────────────────────────────────────────────────────────
  const [openRes, readyRes] = await Promise.all([
    withSession(admin.from("practice_encounter").select(ENCOUNTER_COLUMNS)
      .eq("workspace_id", ctx.workspaceId).in("status", LIVE_STATUSES)
      // ⚠ ONE MORE THAN THE BOUND. Fetching exactly BOARD_LIMIT makes "50 rows" ambiguous -- it could be
      // everything, or the first fifty of three hundred -- and the screen cannot tell which. The extra
      // row is trimmed and never rendered; its only job is to answer that question.
      .order("started_at", { ascending: false }).limit(BOARD_LIMIT + 1)),
    withSession(admin.from("practice_encounter").select(ENCOUNTER_COLUMNS)
      .eq("workspace_id", ctx.workspaceId).eq("status", "COMPLETED")
      .order("completed_at", { ascending: false, nullsFirst: false }).limit(BOARD_LIMIT + 1)),
  ]);

  // ── history (s4.7), filtered and paginated ────────────────────────────────────────────────────────
  //
  // ⚠ THE PERIOD FILTERS ON started_at, WHICH IS WHEN THE CONSULTATION HAPPENED. Filtering on signed_at
  // would be defensible and is wrong for the commoner question -- "what did I see last week" -- and it
  // is impossible for AMENDED rows, which have no stamp of their own on the encounter at all. The panel
  // prints which column it filtered.
  const statuses = HISTORY_STATES.find(s => s.key === historyFilter.state)?.statuses ?? ["SIGNED", "AMENDED"];
  let historyQuery = admin.from("practice_encounter").select(ENCOUNTER_COLUMNS)
    .eq("workspace_id", ctx.workspaceId).in("status", statuses);
  historyQuery = withSession(historyQuery);
  if (historyFilter.from) historyQuery = historyQuery.gte("started_at", `${historyFilter.from}T00:00:00Z`);
  if (historyFilter.to) historyQuery = historyQuery.lte("started_at", `${historyFilter.to}T23:59:59Z`);
  const offset = historyFilter.page * HISTORY_PAGE_SIZE;
  const historyRes = await historyQuery
    .order("started_at", { ascending: false })
    // ONE OVER THE PAGE, so "there is more" is knowable rather than guessed.
    .range(offset, offset + HISTORY_PAGE_SIZE);

  // ⚠ THE EXTRA ROW IS DETECTED, THEN DROPPED. It is never shaped and never rendered -- it exists only
  // so the panel can say whether there is more behind it.
  const openAll = openRes.error ? [] : ((openRes.data ?? []) as any[]);
  const readyAll = readyRes.error ? [] : ((readyRes.data ?? []) as any[]);
  const openCapped = openAll.length > BOARD_LIMIT;
  const readyCapped = readyAll.length > BOARD_LIMIT;
  const openRows = openAll.slice(0, BOARD_LIMIT);
  const readyRows = readyAll.slice(0, BOARD_LIMIT);
  const historyRowsRaw = historyRes.error ? [] : ((historyRes.data ?? []) as any[]);
  const historyHasMore = historyRowsRaw.length > HISTORY_PAGE_SIZE;
  const historyRows = historyRowsRaw.slice(0, HISTORY_PAGE_SIZE);

  const allRows = [...openRows, ...readyRows, ...historyRows];
  const patientIds = [...new Set(allRows.map(r => r.patient_id))];
  const [names, identifiers, components, amended] = await Promise.all([
    patientNames(admin, ctx.workspaceId, patientIds),
    patientIdentifiers(admin, ctx.workspaceId, patientIds),
    // Completion facts are needed for the WORK lists only. A signed encounter's outstanding components
    // are a question about a closed record, and the register is not where that is asked.
    componentFacts(admin, ctx.workspaceId, [...openRows, ...readyRows].map(r => r.id)),
    amendedTimes(admin, ctx.workspaceId, historyRows.filter(r => r.status === "AMENDED").map(r => r.id)),
  ]);

  const sessions = new Map<string, { title: string; location: string | null }>(
    (plan?.activities ?? []).map(a => [a.id, { title: a.title, location: a.locationName ?? a.facilityName ?? null }]),
  );

  const shapeInput: ShapeInput = {
    names: names.byId, namesUnavailable: names.unavailable,
    identifiers: identifiers.byId, identifiersUnavailable: identifiers.unavailable,
    sessions, components, amended, nowMs,
  };

  const open = openRes.error
    ? failed<LandingEncounter>(openRes.error.message)
    : loaded(openRows.map(r => shape(r, shapeInput)), openCapped);
  const ready = readyRes.error
    ? failed<LandingEncounter>(readyRes.error.message)
    : loaded(readyRows.map(r => shape(r, shapeInput)), readyCapped);
  const history = historyRes.error
    ? failed<LandingEncounter>(historyRes.error.message)
    : loaded(historyRows.map(r => shape(r, { ...shapeInput, components: null })));

  // ── the tab's own list ────────────────────────────────────────────────────────────────────────────
  const tab = opts.tab ?? "open";
  let tabList: Panel<LandingEncounter>;
  if (tab === "ready") tabList = ready;
  else if (tab === "attention") {
    tabList = open.unavailable || ready.unavailable
      ? failed<LandingEncounter>(open.detail ?? ready.detail ?? "encounter work could not be read")
      : loaded([...open.items, ...ready.items]);
  } else if (tab === "completed_today" || tab === "all") {
    let q = admin.from("practice_encounter").select(ENCOUNTER_COLUMNS).eq("workspace_id", ctx.workspaceId);
    if (tab === "completed_today") {
      q = q.not("completed_at", "is", null).gte("completed_at", startIso).lt("completed_at", endIso);
    }
    const res = await withSession(q).order("started_at", { ascending: false }).limit(BOARD_LIMIT);
    const rows = res.error ? [] : ((res.data ?? []) as any[]);
    const extra = await patientNames(admin, ctx.workspaceId, [...new Set(rows.map(r => r.patient_id))]);
    tabList = res.error
      ? failed<LandingEncounter>(res.error.message)
      : loaded(rows.map(r => shape(r, {
        ...shapeInput, components: null,
        names: extra.byId, namesUnavailable: extra.unavailable,
      })));
  } else tabList = open;

  // ── attention (s4.6), encounter-specific only ─────────────────────────────────────────────────────
  //
  // ⚠ AN "INCOMPLETE" ENCOUNTER IS ONE WITH AN OUTSTANDING COMPONENT, AND THAT IS ONLY KNOWABLE WHEN THE
  // COMPONENT READS SUCCEEDED. Both figures below are null the moment they did not.
  const incomplete = open.unavailable || components.unavailable
    ? null
    : open.items.filter(e => (e.outstanding?.length ?? 0) > 0).length;
  const missingItems = open.unavailable || components.unavailable
    ? null
    : open.items.reduce((n, e) => n + (e.outstanding?.length ?? 0), 0);

  const search = opts.q ? await landingSearch(admin, ctx, opts.q, shapeInput) : null;

  return {
    today: clock.today, timezone: clock.timezone, context,
    counts, countsUnavailable,
    open, ready, tabList,
    attention: attentionRows(incomplete, readyCount, missingItems, canList),
    history, historyFilter, historyHasMore,
    search, can: abilities,
  };
}

/**
 * s4.6's four rows.
 *
 * ⚠ ONLY THREE OF THEM CARRY A FIGURE. The fourth -- medication safety -- has no count field at all and
 * is rendered from MEDICATION_SAFETY_ROW as a permanently not-checked line. See the long note there.
 *
 * ⚠ AND FOUR THINGS THE OLD BOARD SHOWED HERE ARE GONE: overdue follow-ups, unreviewed incoming
 * documents and draft letters. s4.6 excludes each by name ("Do not include overdue follow-ups,
 * unreviewed general documents or draft letters") and s17 repeats it. They are real work and they are
 * not ENCOUNTER work; the command centre and the Documents workspace own them.
 */
function attentionRows(
  incomplete: number | null, readyCount: number | null, missingItems: number | null, permitted: boolean,
): AttentionRow[] {
  return [
    {
      key: "incomplete", label: "Incomplete encounters",
      detail: "Open records with a required component still outstanding.",
      count: permitted ? incomplete : null, permitted, href: "/practice/encounters?tab=open",
    },
    {
      key: "ready_to_sign", label: "Ready to sign",
      detail: "Clinically completed, awaiting your signature.",
      count: permitted ? readyCount : null, permitted, href: "/practice/encounters?tab=ready",
    },
    {
      key: "missing_required_data", label: "Required clinical data not recorded",
      // ⚠ SAYS WHAT IT COUNTS, BECAUSE IT COUNTS A DIFFERENT THING FROM THE ROW ABOVE IT. Items, not
      // encounters -- two outstanding components on one record are two here and one there. Left
      // unstated, the pair reads as two separate populations of work.
      detail: "Outstanding components across those same open encounters -- items, not encounters.",
      count: permitted ? missingItems : null, permitted, href: "/practice/encounters?tab=open",
    },
  ];
}
