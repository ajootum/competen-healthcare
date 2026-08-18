import { mayRender, absenceSentence } from "@/lib/hq/pd-metric-registry";
import { loadActions, loadEscalations, loadCases, loadPostmortems, loadProblems } from "@/lib/hq/mos-support";
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

/**
 * §2's submodules, so the overview and the sidebar cannot disagree about what exists.
 *
 * ⚠ THE CHIP IS THE STATE OF THE RECORD TYPE, NOT OF THE PAGE, and migration 318 moved five of them.
 * "Built" here means a reader can trust what the screen counts — not that the workflow is complete;
 * none of these five has an intake yet, which the pages say for themselves.
 */
export const SUPPORT_SUBMODULES = [
  { key: "cases", label: "Support Cases", href: "/super-admin/pd/support/cases", spec: "PD-009 §4", state: "real" },
  { key: "incidents", label: "Incident Management", href: "/super-admin/pd/support/incidents", spec: "PD-009 §5", state: "real" },
  { key: "incident-360", label: "Incident 360", href: "/super-admin/pd/support/incident-360", spec: "PD-009 §7", state: "partial" },
  { key: "escalations", label: "Escalations", href: "/super-admin/pd/support/escalations", spec: "PD-009 §9", state: "real" },
  { key: "affected", label: "Affected Practices", href: "/super-admin/pd/support/affected", spec: "PD-009 §10", state: "partial" },
  { key: "communications", label: "Communications", href: "/super-admin/pd/support/communications", spec: "PD-009 §8", state: "absent" },
  { key: "problems", label: "Problem Management", href: "/super-admin/pd/support/problems", spec: "PD-009 §12", state: "real" },
  { key: "postmortems", label: "Root Cause & Postmortems", href: "/super-admin/pd/support/postmortems", spec: "PD-009 §13", state: "real" },
  { key: "corrective-actions", label: "Corrective Actions", href: "/super-admin/pd/support/corrective-actions", spec: "PD-009 §14", state: "real" },
  { key: "intelligence", label: "Support Intelligence", href: "/super-admin/pd/support/intelligence", spec: "PD-009 §11", state: "partial" },
] as const;

/**
 * What §1 and §7 still define that has no store at all.
 *
 * ⚠ THIS LIST USED TO HOLD THE FIVE RECORD TYPES AND NOW HOLDS NONE OF THEM. Migration 318 built them,
 * so keeping them here would be the same defect in the other direction: a screen claiming a gap that
 * has been closed teaches a reader to distrust the ones that are real.
 *
 * ⚠ NAMED AS MODELS TO BUILD, NOT AS FEATURES TO ENABLE. Each is a table with a lifecycle, not a screen
 * waiting for a query — and saying so is the difference between a reader knowing what the next piece of
 * work is and assuming somebody forgot to wire something up.
 */
export const MISSING_RECORD_TYPES = [
  { key: "communication", name: "Incident Update / Communication", metric: "sup.communications", spec: "PD-009 §8" },
  { key: "decision", name: "Incident Decision", metric: "sup.decisions", spec: "PD-009 §7" },
  { key: "response_target", name: "Response Target", metric: "sup.response_target", spec: "PD-009 §3" },
  { key: "postmortem_rule", name: "Postmortem Qualification Rule", metric: "sup.postmortems_outstanding", spec: "PD-009 §5" },
] as const;

/** §5's lifecycle, in order, for a screen that shows where the estate sits. */
export const LIFECYCLE_ORDER: IncidentStatus[] = [...INCIDENT_STATUSES];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const HOURS = (from: string, to = new Date()) =>
  Math.max(0, Math.round((to.getTime() - new Date(from).getTime()) / 3_600_000));

export type SupportPosture = Awaited<ReturnType<typeof loadPdSupport>>;

export async function loadPdSupport(admin: Admin) {
  const [incidents, cases, probs, escs, pms, acts] = await Promise.all([
    loadOpenIncidents(admin), loadCases(admin), loadProblems(admin),
    loadEscalations(admin), loadPostmortems(admin), loadActions(admin),
  ]);
  const readable = incidents !== null;
  const open = incidents ?? [];
  const problems: string[] = [];
  if (!readable) problems.push("mos_incident: the incident store could not be read. That is not zero incidents.");
  // ⚠ EACH NAMED SEPARATELY. "Some support reads failed" tells a reader nothing they can act on, and
  // hides which of the five counts below they may still trust.
  for (const [name, r] of [
    ["mos_support_case", cases], ["mos_problem", probs], ["mos_escalation", escs],
    ["mos_postmortem", pms], ["mos_corrective_action", acts],
  ] as const) {
    if (r === null) problems.push(`${name}: could not be read. Its count below is unavailable, not zero.`);
  }

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

    /**
     * §1's other five objects, now that they are records rather than gaps.
     *
     * ⚠ EVERY ONE OF THESE IS A MEASURED ZERO TODAY AND WILL STAY ONE UNTIL AN INTAKE EXISTS. The
     * registry carries that caveat per metric and the screens render it beside the number — a count
     * that cannot rise is a worse lie than a blank, because it looks like good news.
     */
    records: {
      cases: figure("sup.cases_open", () => (cases ? cases.rows.filter(c => c.isOpen).length : null),
        "The support case store could not be read — that is not zero cases."),
      problems: figure("sup.problems", () => (probs ? probs.rows.filter(p => p.isOpen).length : null),
        "The problem store could not be read — that is not zero problems."),
      escalations: figure("sup.escalations", () => (escs ? escs.rows.filter(e => e.isOpen).length : null),
        "The escalation store could not be read — that is not zero escalations."),
      postmortems: figure("sup.postmortems", () => (pms ? pms.rows.length : null),
        "The postmortem store could not be read — that is not zero postmortems."),
      overdueActions: figure("sup.corrective_actions", () => (acts ? acts.rows.filter(a => a.overdue).length : null),
        "The corrective action store could not be read — that is not zero overdue actions."),
    },

    truncated: [
      cases?.truncated ? "support cases" : null,
      probs?.truncated ? "problems" : null,
      escs?.truncated ? "escalations" : null,
      pms?.truncated ? "postmortems" : null,
      acts?.truncated ? "corrective actions" : null,
    ].filter((x): x is string => x !== null),

    /**
     * §3's Needs Attention triggers, restricted to the ones that have a producer.
     *
     * ⚠ FOUR OF SIX FIRE NOW, NOT ONE. Three of these could not exist before the record types did, and
     * adding the records without adding the triggers would have left the panel showing one signal
     * while the page claimed four were possible — a screen disagreeing with its own footnote.
     */
    attention: [
      ...noCommander.map(i => ({
        key: `inc-${i.incidentId}`,
        href: `/super-admin/pd/support/incident-360?id=${i.incidentId}`,
        title: i.title,
        why: "No commander. §7 makes the commander a required field of the command header, and §3 lists this first among the triggers.",
        severityLabel: SEVERITY_LABEL[i.severity],
        startedAt: i.startedAt,
      })),
      // §3: an unresolved high-impact case. Priority, never severity — §4 keeps the scales apart.
      ...(cases?.rows ?? [])
        .filter(c => c.isOpen && (c.priority === "p1" || c.priority === "p2"))
        .map(c => ({
          key: `case-${c.caseId}`,
          href: "/super-admin/pd/support/cases",
          title: c.title,
          why: `An unresolved ${c.priority.toUpperCase()} case, open ${c.ageHours}h${c.ownerName ? "" : " and unowned"}.`,
          severityLabel: c.priority === "p1" ? "SEV-1 Critical" : "SEV-2 High",
          startedAt: c.createdAt,
        })),
      // §3: a recurring problem. Recorded by judgement, never inferred from the incidents it explains.
      ...(probs?.rows ?? [])
        .filter(p => p.isOpen && (p.priority === "p1" || p.priority === "p2"))
        .map(p => ({
          key: `prob-${p.problemId}`,
          href: "/super-admin/pd/support/problems",
          title: p.title,
          why: p.confirmedCause
            ? "An open problem with a confirmed cause and no closure."
            : "An open problem whose cause is still suspected rather than confirmed.",
          severityLabel: p.priority === "p1" ? "SEV-1 Critical" : "SEV-2 High",
          startedAt: p.createdAt,
        })),
      // §3: a corrective action past its due date. Only actions carrying one can appear.
      ...(acts?.rows ?? [])
        .filter(a => a.overdue)
        .map(a => ({
          key: `act-${a.actionId}`,
          href: "/super-admin/pd/support/corrective-actions",
          title: a.action,
          why: `${a.daysLate} day${a.daysLate === 1 ? "" : "s"} past its due date, held by ${a.ownerName}.`,
          severityLabel: a.priority === "p1" ? "SEV-1 Critical" : "SEV-2 High",
          startedAt: a.createdAt,
        })),
    ],

    byStatus,
    severity: severityTally(open),

    /**
     * Every §3 trigger that cannot fire, so a quiet panel is not read as a quiet estate.
     *
     * ⚠ THIS LIST WENT FROM FIVE TO TWO WHEN MIGRATION 318 LANDED. The three that left — unresolved
     * high-impact case, recurring problem, corrective action overdue — now have record types and fire
     * from the panels above. The two that remain are the two whose FACT is still unrecorded, and the
     * second of them is a decision rather than a build: nobody has stated what P1 promises.
     */
    triggersWithoutProducers: [
      { trigger: "Update overdue", why: "No incident update record exists, so there is no last-update time to be overdue against, and no cadence to be overdue by." },
      { trigger: "Breached response target", why: "First-response times ARE recorded now — but no response target is configured anywhere, so a duration cannot be judged late without inventing the promise it broke." },
    ],

    missing: MISSING_RECORD_TYPES.map(m => supportRefusal(m.metric, m.name)),
  };
}

/** One incident with everything §7's command surface can currently fill. */
export async function loadIncidentCommand(admin: Admin, incidentId: string) {
  const all = await loadOpenIncidents(admin);
  const incident = (all ?? []).find(i => i.incidentId === incidentId) ?? null;
  if (!incident) return null;
  const [impact, history, actions, escalations, cases, postmortems] = await Promise.all([
    incidentImpact(admin, incident),
    incidentHistory(admin, incidentId),
    loadActions(admin),
    loadEscalations(admin),
    loadCases(admin),
    loadPostmortems(admin),
  ]);

  // ⚠ FILTERED HERE RATHER THAN QUERIED PER PANEL. Four narrow queries would be four more chances for
  // one of them to fail silently and render an empty panel; these four reads each return null on
  // failure, and null is carried through to the screen as "could not be read" rather than as none.
  const mine = <T extends { incidentId: string | null }>(r: { rows: T[] } | null) =>
    r === null ? null : r.rows.filter(x => x.incidentId === incidentId);

  return {
    incident,
    severityLabel: SEVERITY_LABEL[incident.severity],
    statusLabel: STATUS_LABEL[incident.status],
    durationHours: HOURS(incident.startedAt),
    impact,
    history: history ?? [],

    /**
     * §7's Actions Underway, which was dark until migration 318. §7 asks for owner, state, due time,
     * blocker and result on each, and §14's record carries all five.
     */
    actions: mine(actions),
    escalations: mine(escalations),
    cases: mine(cases),
    /** ⚠ One postmortem per incident — the schema's unique constraint, so this is at most one row. */
    postmortem: postmortems === null ? null : (postmortems.rows.find(p => p.incidentId === incidentId) ?? null),
    postmortemsReadable: postmortems !== null,
    /**
     * §7 names eight panels. These are the ones with nothing behind them, named per panel rather than
     * as one sentence, because a commander needs to know WHICH part of the surface is dark.
     */
    darkPanels: [
      { panel: "Current Situation", why: "No hypothesis, confidence or verified-evidence field exists on an incident. ⚠ A problem record now carries a suspected and a confirmed cause separately, but that is the standing cause behind many incidents rather than the working hypothesis of this one." },
      { panel: "Communications", why: "No update or audience record exists, so there is no latest update and no next scheduled one." },
      { panel: "Decisions", why: "No decision record exists, so no decision maker, rationale or timestamp can be shown." },
      { panel: "Next update due", why: "Requires a communications cadence, which has nowhere to be configured." },
    ],
  };
}

export type IncidentCommand = NonNullable<Awaited<ReturnType<typeof loadIncidentCommand>>>;
export type { OpenIncident };
