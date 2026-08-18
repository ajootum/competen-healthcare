// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-CORE-MOS-001 §8 — THE PRACTICE-NATIVE INCIDENT MODEL, read side.
//
// ⚠ THE IMPACT COUNT IS DERIVED HERE, NOT STORED THERE. §8 asks for quantified affected sessions or
// practices "where possible". The incident row deliberately holds only a sentence, because a number
// frozen at creation is wrong within the hour and looks authoritative while it is wrong. What the row
// carries is a correlation id; this module counts the events on that thread whenever it is asked, so
// the answer is always as of now rather than as of whenever somebody typed it.
//
// ⚠ AND A DERIVED SIGNAL IS NOT AN INCIDENT. Product Health can surface "eleven AI requests errored"
// from a log, and that is a measurement with no lifecycle, no owner and no acknowledgement. An incident
// is a stateful record somebody opened and will close. Both belong on Needs Attention, and the panel
// must never let a reader mistake one for the other.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * CPR-PD-009 §6's severity model, as machine codes.
 *
 * ⚠ THE LABEL IS NOT THE IDENTIFIER. "SEV-1 Critical" is what a reader sees; sev1 is what the row
 * holds. Storing the label would put a display decision in the database and make it untranslatable.
 */
export type IncidentSeverity = "sev1" | "sev2" | "sev3" | "sev4" | "informational";

/**
 * CPR-PD-009 §5's eight-state lifecycle.
 *
 * ⚠ MIGRATION 315 IMPLEMENTED A FIVE-STATE LIST FROM MOS-001 §8, WHICH WAS A SKETCH OF A FIELD RATHER
 * THAN THE OPERATING MODEL. §5 is the model, and MOS-001 §19 says the Product Director specifications
 * govern. The distinction that was being lost matters most: INVESTIGATING is "we are looking" and
 * MITIGATING is "we are doing something", which is the question a commander is asked repeatedly.
 */
export type IncidentStatus =
  | "detected" | "declared" | "investigating" | "mitigating"
  | "monitoring" | "resolved" | "post_incident" | "closed";

export const INCIDENT_SEVERITIES: IncidentSeverity[] = ["sev1", "sev2", "sev3", "sev4", "informational"];
export const INCIDENT_STATUSES: IncidentStatus[] = [
  "detected", "declared", "investigating", "mitigating", "monitoring", "resolved", "post_incident", "closed",
];

/** §6's display names, kept out of the database so they stay a view concern. */
export const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  sev1: "SEV-1 Critical",
  sev2: "SEV-2 High",
  sev3: "SEV-3 Moderate",
  sev4: "SEV-4 Low",
  informational: "Informational",
};

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  detected: "Detected", declared: "Declared", investigating: "Investigating",
  mitigating: "Mitigating", monitoring: "Monitoring", resolved: "Resolved",
  post_incident: "Post-incident", closed: "Closed",
};

/** ⚠ AN INCIDENT PAST RESOLVED IS NOT OPEN. §5 continues into post-incident and closed, and neither is
 *  something a commander is still working. The view already excludes only 'resolved', so these two are
 *  filtered here as well rather than appearing on Needs Attention forever. */
export const TERMINAL_STATUSES: IncidentStatus[] = ["resolved", "post_incident", "closed"];

/** Severity order for ranking Needs Attention. §9 asks for ranked signals, and this is the ranking. */
const SEVERITY_RANK: Record<string, number> = { sev1: 0, sev2: 1, sev3: 2, sev4: 3, informational: 4 };

export type OpenIncident = {
  incidentId: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  startedAt: string;
  subjectType: string;
  subjectId: string | null;
  /** Resolved through the phase 1 registry, so a renamed Practice is renamed here with nothing to refresh. */
  subjectLabel: string | null;
  journeyKey: string | null;
  journeyName: string | null;
  component: string | null;
  affectedScope: string | null;
  impactNote: string | null;
  ownerName: string | null;
  evidenceCorrelationId: string | null;
  changeRef: string | null;
  detection: "manual" | "health_rule";
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

type Row = {
  incident_id: string; title: string; severity: string; status: string; started_at: string;
  subject_type: string; subject_id: string | null; subject_label: string | null;
  journey_key: string | null; journey_name: string | null; component: string | null;
  affected_scope: string | null; impact_note: string | null; owner_name: string | null;
  evidence_correlation_id: string | null; change_ref: string | null; detection: string;
};

const toIncident = (r: Row): OpenIncident => ({
  incidentId: r.incident_id,
  title: r.title,
  severity: r.severity as IncidentSeverity,
  status: r.status as IncidentStatus,
  startedAt: r.started_at,
  subjectType: r.subject_type,
  subjectId: r.subject_id,
  subjectLabel: r.subject_label,
  journeyKey: r.journey_key,
  journeyName: r.journey_name,
  component: r.component,
  affectedScope: r.affected_scope,
  impactNote: r.impact_note,
  ownerName: r.owner_name,
  evidenceCorrelationId: r.evidence_correlation_id,
  changeRef: r.change_ref,
  detection: r.detection === "health_rule" ? "health_rule" : "manual",
});

/**
 * Unresolved incidents, most severe first then oldest first.
 *
 * ⚠ RETURNS null ON A FAILED READ RATHER THAN AN EMPTY ARRAY. "No incidents are open" and "the incident
 * store could not be read" are opposite reassurances, and an empty array collapses them into the
 * comfortable one.
 */
export async function loadOpenIncidents(admin: Admin): Promise<OpenIncident[] | null> {
  const res = await admin.from("mos_incident_open")
    .select("incident_id, title, severity, status, started_at, subject_type, subject_id, subject_label, journey_key, journey_name, component, affected_scope, impact_note, owner_name, evidence_correlation_id, change_ref, detection");
  if (res.error || !Array.isArray(res.data)) return null;
  return (res.data as Row[]).map(toIncident)
    .filter(i => !TERMINAL_STATUSES.includes(i.status))
    .sort((a, b) =>
    (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    || (new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()));
}

/**
 * §8's quantified impact, computed from the event store at read time.
 *
 * ⚠ IT ANSWERS null WHEN THE INCIDENT CARRIES NO CORRELATION ID, not 0. An incident nobody threaded to
 * telemetry has an unknown impact, and a zero would say the opposite.
 */
export async function incidentImpact(admin: Admin, incident: OpenIncident): Promise<{
  events: number; practices: number; failures: number;
} | null> {
  if (!incident.evidenceCorrelationId) return null;
  const res = await admin.from("mos_event")
    .select("practice_id, outcome")
    .eq("correlation_id", incident.evidenceCorrelationId);
  if (res.error || !Array.isArray(res.data)) return null;
  const rows = res.data as { practice_id: string | null; outcome: string }[];
  return {
    events: rows.length,
    practices: new Set(rows.map(r => r.practice_id).filter(Boolean)).size,
    failures: rows.filter(r => r.outcome === "failure" || r.outcome === "timeout").length,
  };
}

/** The lifecycle trail for one incident, oldest first. Append-only at the database. */
export async function incidentHistory(admin: Admin, incidentId: string): Promise<
  { at: string; actorName: string | null; fromStatus: string | null; toStatus: string | null; note: string | null }[] | null
> {
  const res = await admin.from("mos_incident_event")
    .select("at, actor_name, from_status, to_status, note")
    .eq("incident_id", incidentId).order("at", { ascending: true });
  if (res.error || !Array.isArray(res.data)) return null;
  return (res.data as { at: string; actor_name: string | null; from_status: string | null; to_status: string | null; note: string | null }[])
    .map(r => ({ at: r.at, actorName: r.actor_name, fromStatus: r.from_status, toStatus: r.to_status, note: r.note }));
}

/** How many incidents are open at each severity — the Needs Attention headline. */
export function severityTally(incidents: OpenIncident[]) {
  const t: Record<IncidentSeverity, number> = { sev1: 0, sev2: 0, sev3: 0, sev4: 0, informational: 0 };
  for (const i of incidents) t[i.severity]++;
  return t;
}
