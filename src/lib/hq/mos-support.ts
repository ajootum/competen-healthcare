// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-009 — THE FIVE SUPPORT RECORD TYPES, read side. Migration 318, corrected by 319.
//
// ⚠ EVERY READ HERE RETURNS null ON FAILURE AND NEVER AN EMPTY ARRAY. The distinction is the whole
// reason this module exists separately from the screens: [] means "nobody has recorded one" and null
// means "the store could not be read". A screen that cannot tell them apart renders a reassuring blank
// for a database that is down, which is the failure this build has already made twice.
//
// ⚠ AND NOTHING WRITES TO ANY OF THESE TABLES YET. There is no intake — no form, no API, no channel.
// Every count below is therefore a MEASURED ZERO with a caveat attached in the metric registry, not an
// absence. The difference matters on screen: a reader must not take "no open cases" for "practitioners
// are not hitting problems" when it means "a practitioner has nowhere to report one".
//
// ⚠ NO READ IN THIS FILE TOUCHES A PATIENT. §1: "Do not treat individual clinical concerns or patient
// records as product support data." The schema removed the temptation — there is no patient column to
// select — and this file does not reach for one through a join either.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/**
 * ⚠ THE POSTGREST DEFAULT CEILING, NAMED ONCE.
 *
 * A fetch that silently stops at 1000 rows and is then counted, averaged or percentiled is a lie that
 * looks like arithmetic. Every list read here asks for one more row than it will show; when it gets
 * that row it reports the list as truncated rather than quietly cutting it off.
 */
const PAGE = 500;

export type ReadResult<T> = { rows: T[]; truncated: boolean } | null;

/**
 * ⚠ THIS TAKES A BUILT QUERY, NOT A TABLE NAME AND A COLUMN STRING, AND THAT IS A BOUNDARY REQUIREMENT
 * RATHER THAN A STYLE PREFERENCE.
 *
 * The first version was `readList(admin, table, columns, …)` and did `admin.from(table).select(columns)`
 * inside. It read cleanly and it defeated the plane-boundary scanner completely: a `.select()` whose
 * argument is a PARAMETER cannot be resolved to a column list, so all five callers were refused as
 * UNRESOLVED_SELECT — one helper turning five auditable reads into five unauditable ones.
 *
 * The scanner is right to refuse it. A column list that only exists at runtime cannot be checked against
 * an allowlist by anything, ever, and the whole point of the boundary is that it is checkable without
 * running the product. So the literal lives at each call site where a reader — and the scanner — can see
 * exactly which columns that read takes, and this helper keeps only the paging and the null-on-failure
 * rule, which are the parts worth sharing.
 */
async function readList<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  shape: (r: Record<string, unknown>) => T,
): Promise<ReadResult<T>> {
  const res = await query.limit(PAGE + 1);
  if (res.error) return null;
  const raw = (res.data ?? []) as Record<string, unknown>[];
  return { rows: raw.slice(0, PAGE).map(shape), truncated: raw.length > PAGE };
}

// ── §4's vocabularies ───────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ §4: "Priority and incident severity are separate concepts." They are separate columns in the
 * schema and separate label maps here, so nothing can render a case's priority using an incident's
 * severity words and imply the two were ever compared.
 */
export const PRIORITY_LABEL: Record<string, string> = {
  p1: "P1 Urgent", p2: "P2 High", p3: "P3 Normal", p4: "P4 Low",
};
export const PRIORITY_ORDER = ["p1", "p2", "p3", "p4"];

export const CASE_STATUSES = [
  "new", "triage", "in_progress", "waiting_user", "waiting_internal", "resolved", "closed",
] as const;
export const CASE_STATUS_LABEL: Record<string, string> = {
  new: "New", triage: "Triage", in_progress: "In progress",
  waiting_user: "Waiting on reporter", waiting_internal: "Waiting internally",
  resolved: "Resolved", closed: "Closed",
};
/** ⚠ WAITING IS OPEN. A case parked on somebody else is still the practice's problem, and dropping the
 *  two waiting states out of "open" is how a queue looks shorter than it is. */
export const CASE_TERMINAL = ["resolved", "closed"];

export const CASE_SOURCE_LABEL: Record<string, string> = {
  practitioner: "Practitioner", practice_owner: "Practice owner",
  internal: "Internal", health_rule: "Health rule", other: "Other",
};

// ── §12, §9, §13, §14 ───────────────────────────────────────────────────────────────────────────────

export const PROBLEM_STATUS_LABEL: Record<string, string> = {
  identified: "Identified", investigating: "Investigating", cause_confirmed: "Cause confirmed",
  fix_planned: "Fix planned", fix_in_progress: "Fix in progress", monitoring: "Monitoring",
  resolved: "Resolved", closed: "Closed",
};
export const PROBLEM_ORDER = [
  "identified", "investigating", "cause_confirmed", "fix_planned",
  "fix_in_progress", "monitoring", "resolved", "closed",
];
export const PROBLEM_TERMINAL = ["resolved", "closed"];

/** §9's eight triggers, as a vocabulary so escalations can be counted by cause rather than read by eye. */
export const ESCALATION_TRIGGER_LABEL: Record<string, string> = {
  severity: "Severity",
  response_target_breach: "Response target breached",
  communication_target_breach: "Communication target breached",
  unresolved_blocker: "Unresolved blocker",
  recurring_failure: "Recurring failure",
  wide_scope: "Wide scope",
  security_or_data: "Security or data",
  governance_threshold: "Governance threshold",
};
export const ESCALATION_STATUS_LABEL: Record<string, string> = {
  open: "Open", acknowledged: "Acknowledged", actioned: "Actioned",
  withdrawn: "Withdrawn", closed: "Closed",
};
export const ESCALATION_TERMINAL = ["actioned", "withdrawn", "closed"];

export const POSTMORTEM_STATUS_LABEL: Record<string, string> = {
  draft: "Draft", in_review: "In review", approved: "Approved", published: "Published",
};
export const POSTMORTEM_ORDER = ["draft", "in_review", "approved", "published"];

export const ACTION_STATE_LABEL: Record<string, string> = {
  open: "Open", in_progress: "In progress", blocked: "Blocked",
  done: "Done", accepted_risk: "Accepted risk", cancelled: "Cancelled",
};
export const ACTION_ORDER = ["open", "in_progress", "blocked", "done", "accepted_risk", "cancelled"];
/** ⚠ ACCEPTED RISK IS TERMINAL BUT IT IS NOT DONE. §14 requires a named authority and a rationale for
 *  it precisely so it cannot be used as a quiet close, and folding it into "done" would undo that. */
export const ACTION_TERMINAL = ["done", "cancelled", "accepted_risk"];
export const ACTION_SOURCE_LABEL: Record<string, string> = {
  incident: "Incident", problem: "Problem", postmortem: "Postmortem",
  governance_review: "Governance review",
};

// ── the record shapes ───────────────────────────────────────────────────────────────────────────────

export type SupportCase = {
  caseId: string; title: string; description: string | null;
  practiceId: string | null; reporterName: string | null; source: string;
  category: string | null; productArea: string | null;
  priority: string; status: string; ownerName: string | null;
  incidentId: string | null; problemId: string | null; duplicateOf: string | null;
  journeyKey: string | null;
  createdAt: string; firstResponseAt: string | null; resolvedAt: string | null;
  resolutionCategory: string | null;
  /** Derived at read time — hours from raised to first response, or null if there has not been one. */
  responseHours: number | null;
  ageHours: number;
  isOpen: boolean;
};

export type Problem = {
  problemId: string; title: string; ownerName: string | null;
  status: string; priority: string;
  patternEvidence: string | null;
  suspectedCause: string | null; confirmedCause: string | null;
  workaround: string | null; targetOutcome: string | null;
  journeyKey: string | null; subjectType: string | null;
  createdAt: string; resolvedAt: string | null;
  isOpen: boolean;
};

export type Escalation = {
  escalationId: string; trigger: string;
  incidentId: string | null; caseId: string | null;
  sourceName: string | null; targetTeam: string; reason: string;
  requestedAction: string | null;
  status: string; dueAt: string | null; createdAt: string; resolvedAt: string | null;
  isOpen: boolean;
  /** ⚠ Derived, and only where a due date exists. Nothing without one can be late. */
  overdue: boolean;
};

export type Postmortem = {
  postmortemId: string; incidentId: string; status: string;
  executiveSummary: string | null; impact: string | null;
  detection: string | null; response: string | null;
  rootCause: string | null; contributingFactors: string | null; openHypotheses: string | null;
  whatWorked: string | null; whatDidNot: string | null;
  recovery: string | null; learning: string | null;
  approvedBy: string | null; approvedAt: string | null;
  createdAt: string;
  /** §13's three claims, counted so a reader can see which of them a postmortem actually makes. */
  hasConfirmedCause: boolean;
  hasOpenHypotheses: boolean;
};

export type CorrectiveAction = {
  actionId: string; action: string; source: string;
  incidentId: string | null; problemId: string | null; postmortemId: string | null;
  ownerName: string; priority: string; dueOn: string | null; state: string;
  blocker: string | null; evidence: string | null; effectiveness: string | null;
  acceptedBy: string | null; acceptedRationale: string | null;
  changeRef: string | null; completedAt: string | null; createdAt: string;
  isOpen: boolean;
  overdue: boolean;
  daysLate: number | null;
};

const HOURS = (from: string, to: string | Date = new Date()) =>
  Math.max(0, Math.round(((to instanceof Date ? to : new Date(to)).getTime() - new Date(from).getTime()) / 3_600_000));

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

// ── the readers ─────────────────────────────────────────────────────────────────────────────────────

export const loadCases = (admin: Admin): Promise<ReadResult<SupportCase>> =>
  readList(
    admin.from("mos_support_case")
      .select("case_id,title,description,practice_id,reporter_name,source,category,product_area,priority,status,owner_name,incident_id,problem_id,duplicate_of,journey_key,created_at,first_response_at,resolved_at,resolution_category")
      .order("created_at", { ascending: false, nullsFirst: false }),
    r => {
      const createdAt = String(r.created_at);
      const first = s(r.first_response_at);
      return {
        caseId: String(r.case_id), title: String(r.title), description: s(r.description),
        practiceId: s(r.practice_id), reporterName: s(r.reporter_name), source: String(r.source),
        category: s(r.category), productArea: s(r.product_area),
        priority: String(r.priority), status: String(r.status), ownerName: s(r.owner_name),
        incidentId: s(r.incident_id), problemId: s(r.problem_id), duplicateOf: s(r.duplicate_of),
        journeyKey: s(r.journey_key),
        createdAt, firstResponseAt: first, resolvedAt: s(r.resolved_at),
        resolutionCategory: s(r.resolution_category),
        responseHours: first ? HOURS(createdAt, first) : null,
        ageHours: HOURS(createdAt),
        isOpen: !CASE_TERMINAL.includes(String(r.status)),
      };
    },
  );

export const loadProblems = (admin: Admin): Promise<ReadResult<Problem>> =>
  readList(
    admin.from("mos_problem")
      .select("problem_id,title,owner_name,status,priority,pattern_evidence,suspected_cause,confirmed_cause,workaround,target_outcome,journey_key,subject_type,created_at,resolved_at")
      .order("created_at", { ascending: false, nullsFirst: false }),
    r => ({
      problemId: String(r.problem_id), title: String(r.title), ownerName: s(r.owner_name),
      status: String(r.status), priority: String(r.priority),
      patternEvidence: s(r.pattern_evidence),
      suspectedCause: s(r.suspected_cause), confirmedCause: s(r.confirmed_cause),
      workaround: s(r.workaround), targetOutcome: s(r.target_outcome),
      journeyKey: s(r.journey_key), subjectType: s(r.subject_type),
      createdAt: String(r.created_at), resolvedAt: s(r.resolved_at),
      isOpen: !PROBLEM_TERMINAL.includes(String(r.status)),
    }),
  );

export const loadEscalations = (admin: Admin): Promise<ReadResult<Escalation>> =>
  readList(
    admin.from("mos_escalation")
      .select("escalation_id,trigger,incident_id,case_id,source_name,target_team,reason,requested_action,status,due_at,created_at,resolved_at")
      .order("created_at", { ascending: false, nullsFirst: false }),
    r => {
      const status = String(r.status);
      const due = s(r.due_at);
      const open = !ESCALATION_TERMINAL.includes(status);
      return {
        escalationId: String(r.escalation_id), trigger: String(r.trigger),
        incidentId: s(r.incident_id), caseId: s(r.case_id),
        sourceName: s(r.source_name), targetTeam: String(r.target_team), reason: String(r.reason),
        requestedAction: s(r.requested_action),
        status, dueAt: due, createdAt: String(r.created_at), resolvedAt: s(r.resolved_at),
        isOpen: open,
        overdue: open && due !== null && new Date(due) < new Date(),
      };
    },
  );

export const loadPostmortems = (admin: Admin): Promise<ReadResult<Postmortem>> =>
  readList(
    admin.from("mos_postmortem")
      .select("postmortem_id,incident_id,status,executive_summary,impact,detection,response,root_cause,contributing_factors,open_hypotheses,what_worked,what_did_not,recovery,learning,approved_by,approved_at,created_at")
      .order("created_at", { ascending: false, nullsFirst: false }),
    r => ({
      postmortemId: String(r.postmortem_id), incidentId: String(r.incident_id),
      status: String(r.status),
      executiveSummary: s(r.executive_summary), impact: s(r.impact),
      detection: s(r.detection), response: s(r.response),
      rootCause: s(r.root_cause), contributingFactors: s(r.contributing_factors),
      openHypotheses: s(r.open_hypotheses),
      whatWorked: s(r.what_worked), whatDidNot: s(r.what_did_not),
      recovery: s(r.recovery), learning: s(r.learning),
      approvedBy: s(r.approved_by), approvedAt: s(r.approved_at),
      createdAt: String(r.created_at),
      hasConfirmedCause: s(r.root_cause) !== null,
      hasOpenHypotheses: s(r.open_hypotheses) !== null,
    }),
  );

export const loadActions = (admin: Admin): Promise<ReadResult<CorrectiveAction>> =>
  readList(
    admin.from("mos_corrective_action")
      .select("action_id,action,source,incident_id,problem_id,postmortem_id,owner_name,priority,due_on,state,blocker,evidence,effectiveness,accepted_by,accepted_rationale,change_ref,completed_at,created_at")
      .order("created_at", { ascending: false, nullsFirst: false }),
    r => {
      const state = String(r.state);
      const due = s(r.due_on);
      const open = !ACTION_TERMINAL.includes(state);
      // ⚠ DATE, NOT TIMESTAMP. due_on is a date, so "late" starts the day AFTER it, and comparing it to
      // a wall clock would make everything due today read as overdue from one minute past midnight.
      const today = new Date().toISOString().slice(0, 10);
      const late = open && due !== null && due < today;
      return {
        actionId: String(r.action_id), action: String(r.action), source: String(r.source),
        incidentId: s(r.incident_id), problemId: s(r.problem_id), postmortemId: s(r.postmortem_id),
        ownerName: String(r.owner_name), priority: String(r.priority),
        dueOn: due, state,
        blocker: s(r.blocker), evidence: s(r.evidence), effectiveness: s(r.effectiveness),
        acceptedBy: s(r.accepted_by), acceptedRationale: s(r.accepted_rationale),
        changeRef: s(r.change_ref), completedAt: s(r.completed_at), createdAt: String(r.created_at),
        isOpen: open,
        overdue: late,
        daysLate: late && due
          ? Math.floor((new Date(today).getTime() - new Date(due).getTime()) / 86_400_000)
          : null,
      };
    },
  );

/** §12's link table, read as problem id → incident ids. Null on failure, on the rule at the top. */
export async function loadProblemIncidents(admin: Admin): Promise<Map<string, string[]> | null> {
  const res = await admin.from("mos_problem_incident").select("problem_id,incident_id").limit(PAGE + 1);
  if (res.error) return null;
  const map = new Map<string, string[]>();
  for (const r of (res.data ?? []) as Record<string, unknown>[]) {
    const p = String(r.problem_id);
    map.set(p, [...(map.get(p) ?? []), String(r.incident_id)]);
  }
  return map;
}

/**
 * The §5 lifecycle trail for one record, newest first.
 *
 * ⚠ TYPED PARENT, NOT A POLYMORPHIC ID. Migration 319 replaced the record_type-plus-uuid pair with five
 * nullable foreign keys, because the pair had no cascade and the trail is append-only — which between
 * them made a trail row impossible for anyone to remove. The column name is derived from the type here
 * so a caller cannot pass a case id under the word "problem".
 */
const TRAIL_COLUMN: Record<string, string> = {
  case: "case_id", problem: "problem_id", escalation: "escalation_id",
  postmortem: "postmortem_id", corrective_action: "action_id",
};

export type TrailEntry = {
  at: string; actorName: string | null;
  fromState: string | null; toState: string | null;
  reason: string | null; note: string | null;
};

export async function loadTrail(
  admin: Admin, recordType: keyof typeof TRAIL_COLUMN | string, recordId: string,
): Promise<TrailEntry[] | null> {
  const column = TRAIL_COLUMN[recordType];
  if (!column) return null;
  const res = await admin.from("mos_support_event")
    .select("at,actor_name,from_state,to_state,reason,note")
    .eq(column, recordId).order("at", { ascending: false }).limit(200);
  if (res.error) return null;
  return ((res.data ?? []) as Record<string, unknown>[]).map(r => ({
    at: String(r.at), actorName: s(r.actor_name),
    fromState: s(r.from_state), toState: s(r.to_state),
    reason: s(r.reason), note: s(r.note),
  }));
}

/** Count by a vocabulary, in the vocabulary's own order rather than by size. */
export function tally<T>(rows: T[], key: (r: T) => string, order: string[], label: Record<string, string>) {
  return order.map(k => ({ key: k, label: label[k] ?? k, n: rows.filter(r => key(r) === k).length }));
}

/**
 * The median of a list, or null for an empty one.
 *
 * ⚠ NULL RATHER THAN ZERO. A median over nothing is not zero hours, and returning zero would render a
 * response time of "0h" for a queue nobody has ever answered — the fastest support in the world.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}
