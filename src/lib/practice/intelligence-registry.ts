// CPR-PI-001 v2 s14 -- THE METRIC REGISTRY. "No metric may ship without a registry definition."
//
// ⚠ THIS MODULE IMPORTS NOTHING (constants-file rule: client areas and harnesses both read it).
//
// ⚠ THIS FILE IS ALSO WHERE THE RATE DOCTRINE CHANGED, AND THE CHANGE HAS A DOCUMENT. The v1-era
// estate refused computed rates outright (ratesComputed: false, RATE_SHAPED_KEY). CPR-PI-001 v2
// (2026-08-15, the owner's source of truth) GOVERNS them instead: a rate may ship only with a
// registry entry naming its numerator and denominator (s14), the denominator must be exposed
// wherever the percentage renders (s19), and s16 draws the line the old rule was protecting --
// "Consultation volume increased 12%" is permitted description; "Your performance improved 12%"
// is forbidden judgement. Older modules keep their counts-only payloads until each is re-specified;
// every NEW metric lands here first.

export type MetricRegistryEntry = {
  metricId: string;
  version: number;
  displayName: string;
  /** Exact business meaning -- what a reader may take this number to claim. */
  definition: string;
  sourceDomains: string[];
  /** Where applicable. A rate WITHOUT both of these may not render as a percentage anywhere. */
  numerator?: string;
  denominator?: string;
  /** Which date decides period membership. */
  timeField: string;
  comparisonRule: "preceding_equal_period" | "none";
  nullHandling: string;
  drillthrough: string;
  releaseState: "required" | "conditional" | "future";
  owner: string;
};

export const METRIC_REGISTRY: MetricRegistryEntry[] = [
  {
    metricId: "fin.charged", version: 1, displayName: "Charged",
    definition: "Sum of charge amounts raised in the period, per currency. A charge is work billed for; it is never income received.",
    sourceDomains: ["charge"], timeField: "practice_charge.charged_on",
    comparisonRule: "preceding_equal_period",
    nullHandling: "A failed read renders as unavailable, never as zero.",
    drillthrough: "/practice/payments?tab=transactions", releaseState: "required", owner: "CPR-PAY-001 s17",
  },
  {
    metricId: "fin.collected", version: 1, displayName: "Collected",
    definition: "Sum of payment amounts recorded in the period, per currency, regardless of who collected them.",
    sourceDomains: ["payment"], timeField: "practice_payment.paid_at",
    comparisonRule: "preceding_equal_period",
    nullHandling: "A failed read renders as unavailable, never as zero.",
    drillthrough: "/practice/payments?tab=transactions", releaseState: "required", owner: "CPR-PAY-001 s17",
  },
  {
    metricId: "fin.received", version: 1, displayName: "Received by practitioner",
    definition: "Payments the practitioner collected directly plus settlement amounts actually transferred. Facility-collected money is excluded until its settlement row exists.",
    sourceDomains: ["payment", "settlement"], timeField: "practice_payment.paid_at / practice_settlement.received_on",
    comparisonRule: "preceding_equal_period",
    nullHandling: "A failed read renders as unavailable, never as zero.",
    drillthrough: "/practice/payments?tab=settlements", releaseState: "required", owner: "CPR-PAY-001 s9/s17",
  },
  {
    metricId: "fin.outstanding_invoiced", version: 1, displayName: "Outstanding on invoices",
    definition: "Issued invoice totals minus valid allocations, per currency, over ALL time -- a period filter on debt would hide the oldest first.",
    sourceDomains: ["invoice", "payment_allocation"], timeField: "none (always full)",
    comparisonRule: "none",
    nullHandling: "A failed read renders as unavailable, never as zero.",
    drillthrough: "/practice/payments?tab=outstanding", releaseState: "required", owner: "CPR-PAY-001 s11.3",
  },
  {
    metricId: "fin.settlement_receivable", version: 1, displayName: "Owed by facilities",
    definition: "The practitioner's configured share of facility-collected payments not yet reconciled into a settlement. Collections with no share rule are counted as needing a decision, never guessed into the sum.",
    sourceDomains: ["payment", "settlement_item", "facility_entitlement"], timeField: "none (always full)",
    comparisonRule: "none",
    nullHandling: "No rule = needs-decision count, excluded from the sum.",
    drillthrough: "/practice/payments?tab=settlements", releaseState: "required", owner: "CPR-PAY-001 s10",
  },
  {
    metricId: "fin.service_mix", version: 1, displayName: "Charges by service type",
    definition: "Charge counts and sums grouped by the catalogue service type of the fee each charge used; manual charges group as 'manual'. Descriptive mix, per currency -- proportions expose their denominator.",
    sourceDomains: ["charge", "service_fee"],
    numerator: "charges of the service type in period", denominator: "all charges in period, same currency",
    timeField: "practice_charge.charged_on", comparisonRule: "none",
    nullHandling: "Charges whose fee was deleted group by their snapshot label.",
    drillthrough: "/practice/payments?tab=transactions", releaseState: "required", owner: "CPR-PAY-001 s17",
  },
  {
    metricId: "fin.location_mix", version: 1, displayName: "Charges by location",
    definition: "Charge counts and sums grouped by recorded location, per currency. Charges without a location are shown as such, never dropped.",
    sourceDomains: ["charge", "location"],
    numerator: "charges at the location in period", denominator: "all charges in period, same currency",
    timeField: "practice_charge.charged_on", comparisonRule: "none",
    nullHandling: "Null location is its own visible group.",
    drillthrough: "/practice/payments?tab=transactions", releaseState: "required", owner: "CPR-PAY-001 s17",
  },
  {
    metricId: "fin.period_delta", version: 1, displayName: "Change vs previous period",
    definition: "Absolute and percentage change of charged/collected/received against the immediately preceding equal-length period. s16: describes volume, never performance. The percentage is suppressed under the low-denominator rule.",
    sourceDomains: ["charge", "payment", "settlement"],
    numerator: "this period's figure minus the previous period's", denominator: "the previous period's figure",
    timeField: "as the underlying metric", comparisonRule: "preceding_equal_period",
    nullHandling: "No previous-period data = no delta shown at all (never a fabricated +100%).",
    drillthrough: "/practice/payments", releaseState: "required", owner: "CPR-PI-001 v2 s5/s16",
  },
];

// ── CPR-PI-001 v2 P0: the intelligence screens' own entries ─────────────────────────────────────────
METRIC_REGISTRY.push(
  {
    metricId: "pi.followup_completion", version: 1, displayName: "Follow-up completion",
    definition: "Of the follow-ups RAISED in the period, how many are completed -- the cohort whose fate is attributable to the period, with the not-yet-due share disclosed beside it rather than hidden in the denominator.",
    sourceDomains: ["follow_up"],
    numerator: "follow-ups raised in period, now COMPLETED", denominator: "follow-ups raised in period",
    timeField: "practice_follow_up.created_at", comparisonRule: "none",
    nullHandling: "An unreadable cohort is unavailable, never 0 of 0.",
    drillthrough: "/practice/follow-ups", releaseState: "required", owner: "CPR-PI-001 v2 s9",
  },
  {
    metricId: "pi.median_days_followup", version: 1, displayName: "Median days to follow-up",
    definition: "Median elapsed days between due date and completion over valid completed pairs; an early completion is a negative value and is kept, never clamped.",
    sourceDomains: ["follow_up"], timeField: "practice_follow_up.closed_at", comparisonRule: "none",
    nullHandling: "No valid pairs = no median, never 0.",
    drillthrough: "/practice/follow-ups", releaseState: "required", owner: "CPR-PI-001 v2 s15",
  },
  {
    metricId: "pi.recency_last_visit", version: 1, displayName: "Recency of last visit",
    definition: "Active (non-merged) patients bucketed by days since their last recorded encounter, as at today; never-seen patients are their own visible group.",
    sourceDomains: ["patient", "encounter"],
    numerator: "patients in each bucket", denominator: "all active patients (shown)",
    timeField: "practice_encounter.started_at (latest per patient)", comparisonRule: "none",
    nullHandling: "Truncated reads are flagged; a capped list is said to be capped.",
    drillthrough: "/practice/patients", releaseState: "required", owner: "CPR-PI-001 v2 s7",
  },
  {
    metricId: "pi.avg_visits_per_patient", version: 1, displayName: "Average visits per patient",
    definition: "Qualifying encounters in the period divided by distinct patients seen in it; both halves shown wherever the ratio renders.",
    sourceDomains: ["encounter"],
    numerator: "qualifying encounters in period", denominator: "distinct patients seen in period",
    timeField: "practice_encounter.started_at", comparisonRule: "none",
    nullHandling: "No patients seen = no ratio, never a divide-by-zero zero.",
    drillthrough: "/practice/encounters", releaseState: "required", owner: "CPR-PI-001 v2 s7",
  },
  {
    metricId: "pi.top_conditions_by_patients", version: 1, displayName: "Top conditions by patients",
    definition: "Distinct patients with a qualifying recorded diagnosis in the period, per condition AS TYPED -- tidying labels would invent a coding.",
    sourceDomains: ["diagnosis"],
    numerator: "distinct patients with the condition", denominator: "patients seen in the period (the eligible set)",
    timeField: "practice_diagnosis recorded date", comparisonRule: "none",
    nullHandling: "Unreadable diagnoses render as unavailable.",
    drillthrough: "/practice/intelligence?tab=clinical", releaseState: "required", owner: "CPR-PI-001 v2 s8/s15",
  },
  {
    metricId: "pi.top_conditions_by_encounters", version: 1, displayName: "Top conditions by records",
    definition: "Qualifying diagnosis RECORDS per condition -- occurrence, not prevalence, and the two are never presented as the same number (v2 s15).",
    sourceDomains: ["diagnosis"],
    numerator: "diagnosis records naming the condition", denominator: "all diagnosis records in period",
    timeField: "practice_diagnosis recorded date", comparisonRule: "none",
    nullHandling: "Unreadable diagnoses render as unavailable.",
    drillthrough: "/practice/intelligence?tab=clinical", releaseState: "required", owner: "CPR-PI-001 v2 s8/s15",
  },
  {
    metricId: "pi.consultations_trend", version: 1, displayName: "Consultations over time",
    definition: "Daily encounter counts in the practice's calendar, from the ONE shared trend (encounterTrend) -- never a second bucketing that can disagree with it.",
    sourceDomains: ["encounter"], timeField: "practice_encounter.started_at (practice timezone)",
    comparisonRule: "preceding_equal_period",
    nullHandling: "An unreadable trend renders as unavailable.",
    drillthrough: "/practice/encounters", releaseState: "required", owner: "CPR-PI-001 v2 s6/s10",
  },
  {
    metricId: "pi.overdue_now", version: 1, displayName: "Follow-ups overdue now",
    definition: "Follow-ups still OPEN or SCHEDULED whose due date is before the practice's today. A backlog as at the clock, across ALL periods -- an overdue promise does not expire with the period that made it. Same derivation followUpIntelligence states: OVERDUE is not a stored status.",
    sourceDomains: ["follow_up"], timeField: "practice_follow_up.due_on vs the practice's today",
    comparisonRule: "none",
    nullHandling: "A failed count is unavailable and says so -- never rendered as zero overdue.",
    drillthrough: "/practice/follow-ups?filter=overdue", releaseState: "required", owner: "CPR-PI-001 v2 s9/s13",
  },
  {
    metricId: "ask.investigations_ordered", version: 1, displayName: "Investigations most requested",
    definition: "Requests recorded in the period grouped by label as typed. Requested is a practitioner's note of asking, never an order that left this product, and never a result (migration 238 refuses a result column on purpose).",
    sourceDomains: ["investigation"],
    numerator: "requests carrying the label", denominator: "all investigation requests in period",
    timeField: "practice_encounter_investigation.requested_at", comparisonRule: "none",
    nullHandling: "A failed read is unavailable, never 'no investigations'.",
    drillthrough: "/practice/encounters", releaseState: "required", owner: "CPR-PI-001 v2 s13",
  },
  {
    metricId: "pi.day_of_week", version: 1, displayName: "Consultations by weekday",
    definition: "Encounter counts per weekday in the practice's own calendar, derived from the one encounter trend every screen shares.",
    sourceDomains: ["encounter"],
    numerator: "encounters on the weekday", denominator: "all encounters in period",
    timeField: "practice_encounter.started_at (practice timezone)", comparisonRule: "none",
    nullHandling: "An unreadable trend renders as unavailable.",
    drillthrough: "/practice/intelligence?tab=patterns", releaseState: "required", owner: "CPR-PI-001 v2 s10",
  },
);

export const metricById = (id: string): MetricRegistryEntry | null =>
  METRIC_REGISTRY.find(m => m.metricId === id) ?? null;

/**
 * s22's low-denominator rule, as a number the harness can pin: below this many prior-period records,
 * a percentage delta is withheld and only the counts speak.
 */
export const LOW_DENOMINATOR_FLOOR = 10;
