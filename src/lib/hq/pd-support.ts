import { mayRender, absenceSentence } from "@/lib/hq/pd-metric-registry";
import {
  loadOpenIncidents, incidentImpact, incidentHistory, severityTally,
  SEVERITY_LABEL, STATUS_LABEL, INCIDENT_STATUSES,
  type OpenIncident, type IncidentStatus,
} from "@/lib/hq/mos-incident";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-009 — SUPPORT & INCIDENTS, the loader.
//
// ⚠ THIS MODULE IS HALF-GROUNDED, AND THE HALVES DO NOT BLUR. Incidents are real — phase 4 built a
// Practice-native model scoped by foreign key to the canonical subjects and the eight journeys, and
// phase 3 gave it evidence to point at. Everything else §1 names has no store: support cases, problems,
// postmortems, corrective actions and escalations are models to build, not queries to write.
//
// ⚠ AND §1's LAST LINE GOVERNS EVERY READ HERE: "Do not treat individual clinical concerns or patient
// records as product support data." Nothing in this file reads a patient table, and §6's Affected
// Practices surface is deliberately about practices and journeys rather than people.
//
// ⚠ RESPONSE IS THIS MODULE'S JOB, DETECTION IS PRODUCT HEALTH'S. The prescriptive decision at the head
// of the specification is explicit: "Product Health detects and explains degradation; Support &
// Incidents owns response." So this loader shows what a responder must act on and links to Health for
// the evidence, rather than recomputing a health verdict of its own that could disagree with it.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

export type Figure =
  | { state: "value"; value: number }
  | { state: "unknown"; why: string }
  | { state: "absent"; why: string };

function figure(metricId: string, compute: () => number | null, unreadable: string): Figure {
  if (!mayRender(metricId)) return { state: "absent", why: absenceSentence(metricId) };
  const v = compute();
  return v === null ? { state: "unknown", why: unreadable } : { state: "value", value: v };
}

export const supportRefusal = (metricId: string, label: string) =>
  ({ label, why: absenceSentence(metricId) });

/** §2's eleven submodules, so the overview and the sidebar cannot disagree about what exists. */
export const SUPPORT_SUBMODULES = [
  { key: "cases", label: "Support Cases", href: "/super-admin/pd/support/cases", spec: "PD-009 §4", state: "absent" },
  { key: "incidents", label: "Incident Management", href: "/super-admin/pd/support/incidents", spec: "PD-009 §5", state: "real" },
  { key: "incident-360", label: "Incident 360", href: "/super-admin/pd/support/incident-360", spec: "PD-009 §7", state: "partial" },
  { key: "escalations", label: "Escalations", href: "/super-admin/pd/support/escalations", spec: "PD-009 §2", state: "absent" },
  { key: "affected", label: "Affected Practices", href: "/super-admin/pd/support/affected", spec: "PD-009 §2", state: "partial" },
  { key: "communications", label: "Communications", href: "/super-admin/pd/support/communications", spec: "PD-009 §2", state: "absent" },
  { key: "problems", label: "Problem Management", href: "/super-admin/pd/support/problems", spec: "PD-009 §2", state: "absent" },
  { key: "postmortems", label: "Root Cause & Postmortems", href: "/super-admin/pd/support/postmortems", spec: "PD-009 §2", state: "absent" },
  { key: "corrective-actions", label: "Corrective Actions", href: "/super-admin/pd/support/corrective-actions", spec: "PD-009 §2", state: "absent" },
  { key: "intelligence", label: "Support Intelligence", href: "/super-admin/pd/support/intelligence", spec: "PD-009 §2", state: "absent" },
] as const;

/**
 * The record types §1 defines that have no store at all.
 *
 * ⚠ NAMED AS MODELS TO BUILD, NOT AS FEATURES TO ENABLE. Each of these is a table with a lifecycle, not
 * a screen waiting for a query — and saying so is the difference between a reader knowing what the next
 * piece of work is and assuming somebody forgot to wire something up.
 */
export const MISSING_RECORD_TYPES = [
  { key: "case", name: "Support Case", metric: "sup.cases_open", spec: "PD-009 §4" },
  { key: "escalation", name: "Escalation", metric: "sup.escalations", spec: "PD-009 §2" },
  { key: "problem", name: "Problem", metric: "sup.problems", spec: "PD-009 §2" },
  { key: "postmortem", name: "Postmortem", metric: "sup.postmortems", spec: "PD-009 §2" },
  { key: "corrective_action", name: "Corrective Action", metric: "sup.corrective_actions", spec: "PD-009 §2" },
] as const;

/** §5's lifecycle, in order, for a screen that shows where the estate sits. */
export const LIFECYCLE_ORDER: IncidentStatus[] = [...INCIDENT_STATUSES];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const HOURS = (from: string, to = new Date()) =>
  Math.max(0, Math.round((to.getTime() - new Date(from).getTime()) / 3_600_000));

export type SupportPosture = Awaited<ReturnType<typeof loadPdSupport>>;

export async function loadPdSupport(admin: Admin) {
  const incidents = await loadOpenIncidents(admin);
  const readable = incidents !== null;
  const open = incidents ?? [];
  const problems: string[] = [];
  if (!readable) problems.push("mos_incident: the incident store could not be read. That is not zero incidents.");

  const UNREADABLE = "The incident store could not be read — that is not zero incidents.";

  const major = open.filter(i => i.severity === "sev1" || i.severity === "sev2");
  const unowned = open.filter(i => !i.ownerName);
  // §3's first Needs Attention trigger: a major incident with nobody holding it, once it is past
  // detection. A DETECTED incident has not been declared yet, so it has no commander by design.
  const noCommander = major.filter(i => !i.ownerName && i.status !== "detected");
  const oldest = open.length ? open.reduce((a, b) => (a.startedAt < b.startedAt ? a : b)) : null;

  const byStatus = LIFECYCLE_ORDER.map(s => ({
    status: s,
    label: STATUS_LABEL[s],
    n: open.filter(i => i.status === s).length,
  }));

  return {
    readAt: new Date().toISOString(),
    readable,
    problems,
    incidents: open,

    posture: {
      openIncidents: figure("sup.incidents_open", () => (readable ? open.length : null), UNREADABLE),
      major: figure("sup.incidents_sev1", () => (readable ? major.length : null), UNREADABLE),
      unowned: figure("sup.incidents_unowned", () => (readable ? unowned.length : null), UNREADABLE),
      noCommander: figure("sup.incidents_no_commander", () => (readable ? noCommander.length : null), UNREADABLE),
      oldestHours: figure("sup.incident_age", () => (readable && oldest ? HOURS(oldest.startedAt) : readable ? 0 : null), UNREADABLE),
    },

    /** §3's Needs Attention triggers, restricted to the ones that have a producer. */
    attention: noCommander.map(i => ({
      incidentId: i.incidentId,
      title: i.title,
      why: "No commander. §7 makes the commander a required field of the command header, and §3 lists this first among the triggers.",
      severityLabel: SEVERITY_LABEL[i.severity],
      startedAt: i.startedAt,
    })),

    byStatus,
    severity: severityTally(open),

    /** Every §3 trigger that cannot fire, so a quiet panel is not read as a quiet estate. */
    triggersWithoutProducers: [
      { trigger: "Update overdue", why: "No incident update record exists, so there is no last-update time to be overdue against." },
      { trigger: "Breached response target", why: "No response target is configured anywhere, and no case record carries a first-response time." },
      { trigger: "Unresolved high-impact case", why: "No support case record exists in this schema." },
      { trigger: "Recurring problem", why: "No problem record exists, and a problem cannot be inferred from the incidents it would explain." },
      { trigger: "Corrective action overdue", why: "No corrective action record exists, so nothing carries an owner and a due date." },
    ],

    missing: MISSING_RECORD_TYPES.map(m => supportRefusal(m.metric, m.name)),
  };
}

/** One incident with everything §7's command surface can currently fill. */
export async function loadIncidentCommand(admin: Admin, incidentId: string) {
  const all = await loadOpenIncidents(admin);
  const incident = (all ?? []).find(i => i.incidentId === incidentId) ?? null;
  if (!incident) return null;
  const [impact, history] = await Promise.all([
    incidentImpact(admin, incident),
    incidentHistory(admin, incidentId),
  ]);
  return {
    incident,
    severityLabel: SEVERITY_LABEL[incident.severity],
    statusLabel: STATUS_LABEL[incident.status],
    durationHours: HOURS(incident.startedAt),
    impact,
    history: history ?? [],
    /**
     * §7 names eight panels. These are the ones with nothing behind them, named per panel rather than
     * as one sentence, because a commander needs to know WHICH part of the surface is dark.
     */
    darkPanels: [
      { panel: "Current Situation", why: "No hypothesis, confidence or verified-evidence field exists on an incident." },
      { panel: "Actions Underway", why: "No action record exists — §7 wants owner, state, due time, blocker and result on each." },
      { panel: "Communications", why: "No update or audience record exists, so there is no latest update and no next scheduled one." },
      { panel: "Decisions", why: "No decision record exists, so no decision maker, rationale or timestamp can be shown." },
      { panel: "Next update due", why: "Requires a communications cadence, which has nowhere to be configured." },
    ],
  };
}

export type IncidentCommand = NonNullable<Awaited<ReturnType<typeof loadIncidentCommand>>>;
export type { OpenIncident };
