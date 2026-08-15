// CPR-PI-001 / CPR-PI-002 / CPR-PI-003 -- THE PRACTICE INTELLIGENCE SUITE, ITS SHAPE AND ITS COLOUR.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHY A CONSTANTS FILE AND NOT MORE OF intelligence.ts.
//
// Three things live here because three different consumers need them and none of them should be a
// server module: the TABS (a client component draws them), the COLOUR (a client component draws that
// too), and the RATE DETECTOR (a harness runs it, and it must be the same detector the engine is
// written against rather than a second regex that agrees with the first only by luck).
//
// NOTHING HERE READS A DATABASE OR IMPORTS A SERVER MODULE. That is deliberate: doctrine 10 says a
// server-only import reaching a client component is invisible to tsc and eslint and only shows up in
// `next build`. A leaf module with no imports at all cannot cause it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

// ── §6. INTERNAL INFORMATION ARCHITECTURE ────────────────────────────────────────────────────────────
//
// ⚠ THESE ARE TABS, NOT SIDEBAR ENTRIES, AND THAT IS A CONTRADICTION IN THE SOURCE MATERIAL WHICH THE
// SPEC RESOLVES AGAINST THE COMPS.
//
// All three comps draw these nine as an EXPANDED SUBMENU under "Practice Intelligence" in the global
// sidebar. CPR-PI-001 §4 forbids exactly that, in the same paragraph that lists the nine:
//
//     "Practice Intelligence may use internal tabs, but these must not create expandable global
//      sidebar submenus."
//
// §4's sentence wins because it is the normative requirement and the comps are illustrations; and it
// wins on merit too, because the nine-item flat sidebar §4 mandates stops meaning anything the moment
// one of its nine items unfolds into nine more. So the nine live INSIDE the workspace, selected by
// `?tab=`, and nothing here is registered in navigation.ts.
//
// THE ORDER IS §6's ORDER, VERBATIM. Overview is first and is the default landing view (§6).

export type IntelligenceTabKey =
  | "overview" | "brief" | "patients" | "cohorts" | "clinical"
  | "pathways" | "performance" | "reports" | "assistant" | "financial"
  | "followups" | "patterns";

export type IntelligenceTab = {
  key: IntelligenceTabKey;
  /** §6's own label. */
  label: string;
  /** What the area answers, in the practitioner's words. Shown under the tab heading, not as a tooltip. */
  blurb: string;
  /** The hue this area is drawn in. See PI_SWATCH for why colour is doing work here. */
  swatch: string;
};

export const INTELLIGENCE_TABS: IntelligenceTab[] = [
  { key: "overview", label: "Overview", swatch: "primary",
    blurb: "What needs attention now, and what the period adds up to." },
  { key: "brief", label: "Today's Brief", swatch: "indigo",
    blurb: "Today's sessions, obligations and outstanding reviews, derived from the record and labelled as derived." },
  { key: "patients", label: "Patient Intelligence", swatch: "rose",
    blurb: "Who makes up my practice, and how continuous is their relationship with it." },
  // v2 s3 destinations 4 and 5, new with the P0 rebuild.
  { key: "followups", label: "Follow-up & Outcomes", swatch: "amber",
    blurb: "What continuity was promised, what became of it, and the gaps the record can prove." },
  { key: "patterns", label: "Practice Patterns", swatch: "cyan",
    blurb: "How this practice operates across time, locations and consultation types." },
  { key: "cohorts", label: "Cohorts", swatch: "violet",
    blurb: "Groups of patients defined by an attribute the record actually holds." },
  { key: "clinical", label: "Clinical Intelligence", swatch: "emerald",
    blurb: "Diagnoses, procedures, outcomes and follow-up conclusions over the period." },
  { key: "pathways", label: "Pathways", swatch: "cyan",
    blurb: "Enrolment, stage progression and milestones that have passed their date." },
  { key: "performance", label: "Professional Portfolio", swatch: "violet",
    blurb: "Your own activity over the period, and the portfolio it feeds." },
  // CPR-PAY-001 s17 Phase 3 under CPR-PI-001 v2: descriptive money patterns, billing.view-gated in
  // the MODULE (financial permissions are not clinical ones), registry-defined, Payments-routed.
  { key: "financial", label: "Financial", swatch: "teal",
    blurb: "What was charged, collected and actually received, described from the billing records and routed to Payments." },
  { key: "reports", label: "Reports", swatch: "sky",
    blurb: "Reports this practice has defined, and the exports it has permission to take." },
  { key: "assistant", label: "Ask Practice", swatch: "assistant",
    blurb: "Questions about the records in front of you. It works from them and from nothing else." },
];

// ── CPR-PI-001 v2 s3: THE STRIP IS v2's ORDER; THE KEYS ARE A SUPERSET ──────────────────────────────
//
// The strip renders v2's eight destinations in v2's order (Financial slots after Patterns -- it is
// PAY-001 s17's addition, and v2 s12 conditions financial surfaces on the governed module existing).
// brief, cohorts and pathways LEAVE THE STRIP -- v2 s3: "Cohorts are filters, not a primary
// destination. Pathways are not part of the initial redesigned navigation." -- but their KEYS stay
// valid so every old bookmark still lands on its area. Removed from the strip is not deleted.
export const INTELLIGENCE_TAB_STRIP: IntelligenceTabKey[] = [
  "overview", "patients", "clinical", "followups", "patterns", "financial",
  "performance", "reports", "assistant",
];

export const DEFAULT_TAB: IntelligenceTabKey = "overview";

export const isIntelligenceTab = (x: unknown): x is IntelligenceTabKey =>
  typeof x === "string" && INTELLIGENCE_TABS.some(t => t.key === x);

// ── §7.1. THE DATE-RANGE SELECTOR ────────────────────────────────────────────────────────────────────
//
// "7 days, 30 days, 90 days, year and custom range". The four presets are days; custom is two dates in
// the query string, which is also what makes a view bookmarkable and hand-offable.

export const RANGE_PRESETS: { label: string; days: number }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "A year", days: 365 },
];

export const DEFAULT_RANGE_DAYS = 30;

/** Where the last selected range is remembered (§6: "shall remember the practitioner's last selected date range"). */
export const RANGE_MEMORY_KEY = "cp.intelligence.range";

// ── COLOUR ───────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠ THE FIFTH TIME THIS NOTE HAS BEEN WRITTEN IN THIS CODEBASE, and the reason it is being written a
// fifth time is that the last screen shipped grey and came back with "the colors are flat."
//
// THE RULE, WHICH IS THE PART THAT KEEPS GETTING LOST: a card gets THREE tinted things -- the box, the
// icon badge, AND THE FIGURE ITSELF. A tinted badge beside a black number leaves the colour on the
// decoration; the number is the thing being read, so the number takes the card's hue.
//
// ── The suite's swatches now live in palette.ts ─────────────────────────────────────────────────
//
// They were defined here while palette.ts was being written by another session, with a note saying
// they should move. They have. RE-EXPORTED rather than re-declared, so this file's consumers keep
// their import and there is exactly ONE definition of what rose means in this product -- two would
// agree on the day they were written and drift on some later one, which is the whole reason a design
// system is a file rather than a convention.
export type { IntelSwatch } from "@/lib/practice/palette";
export {
  PRIORITY_SWATCH, PRIORITY_UNSUPPLIED, PI_PANEL, TAB_SWATCH, PROVENANCE_BADGE,
} from "@/lib/practice/palette";

// ── THE RATE DETECTOR ────────────────────────────────────────────────────────────────────────────────
//
// ⚠ THE SINGLE MOST-REPEATED RULE IN THIS CODEBASE, AND THE COMPS ARE FULL OF BREACHES OF IT: "82%
// Follow-up Compliance", "78% of VP shunt patients had no complications", donut segments labelled
// "6 (33%)" and "22 (25%)", and "▲12% vs last week" on every tile in the strip.
//
// Counts and denominators as SEPARATE VALUES. "6 of 18", never "33%". A percentage is where a small
// number hides: "follow-up completion 75%" is the same sentence whether it is 3 of 4 or 750 of 1000, and
// only one of those is worth changing a clinic over.
//
// THIS DETECTOR IS EXPORTED SO THE HARNESS AND THE ENGINE SHARE ONE DEFINITION of what a rate looks
// like. A harness with its own private regex proves that the harness's idea of a rate is absent, which
// is not the same claim.
//
// TWO KINDS OF BREACH, AND THEY NEED DIFFERENT TESTS:
//
//   A RATE-SHAPED FIELD NAME -- `rate`, `percent`, `compliance`, `score`. Caught on the KEY. A field
//   called `followUpRate` is a rate whatever number is in it.
//
//   A PERCENTAGE LITERAL IN A STRING -- "up 12%", "82% on track". Caught on the VALUE, and only when a
//   DIGIT precedes the sign. That distinction is load-bearing: the engine's own refusal texts say
//   "never as a percentage" and "a percentage of a small base moves violently", and those sentences are
//   the doctrine being stated, not breached. A detector that fired on the word would force the engine
//   to stop explaining itself.

/**
 * Field names that ARE a rate, whatever they hold.
 *
 * ⚠ MATCHED AGAINST THE KEY AFTER camelCase HAS BEEN SPLIT. This is not a detail: the first version of
 * this regex used `\b` and therefore did not match `complianceRate` at all, because there is no word
 * boundary between `e` and `R`. It matched `compliance_rate` and `rate` and nothing a TypeScript
 * codebase would ever actually be called -- a detector that only catches the spelling nobody uses.
 */
export const RATE_SHAPED_KEY =
  /(^|_)(rate|rates|percent|percentage|pct|ratio|share|proportion|compliance|adherence|score|index|quotient|coverage|utilisation|utilization)($|_)/;

/** `complianceRate` -> `compliance_rate`, `followUpPct` -> `follow_up_pct`. */
export const normaliseFieldName = (key: string) =>
  key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toLowerCase();

/**
 * The one exemption, and it is value-checked.
 *
 * ⚠ `ratesComputed: false` IS THE DOCTRINE'S OWN NEGATION FLAG. It exists so a client cannot render any
 * of this as a percentage and claim it is the same data, and a detector that flagged it would force the
 * engine to stop declaring the very rule the detector enforces.
 *
 * THE EXEMPTION IS ON THE PAIR, NOT THE NAME. `{ ratesComputed: 0.82 }` still fires -- the escape hatch
 * is a boolean `false` and nothing else, so nobody can smuggle a figure through it.
 */
export const RATE_KEY_EXEMPT: Record<string, unknown> = { ratesComputed: false };

/** A percentage LITERAL: a digit, then optional decimals and space, then the sign. */
export const PERCENT_LITERAL = /\d+(\.\d+)?\s?%/;

export type RateViolation = { path: string; why: string; sample: string };

/**
 * Walk a serialisable payload and return every rate-shaped field and percentage literal in it.
 *
 * RETURNS THE PATHS, NOT A BOOLEAN, because a harness that can only say "something failed" over a
 * 400-key payload is a harness nobody can act on.
 */
export function findRates(value: unknown, path = "$"): RateViolation[] {
  const out: RateViolation[] = [];

  const walk = (v: unknown, p: string) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string") {
      if (PERCENT_LITERAL.test(v))
        out.push({ path: p, why: "a percentage literal in a value", sample: v.slice(0, 120) });
      return;
    }
    if (typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`)); return; }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const child = `${p}.${k}`;
      // ⚠ THE KEY IS CHECKED EVEN WHEN THE VALUE IS NULL. `{ complianceRate: null }` is still a
      // commitment to render a rate the moment the query starts working.
      const exempt = Object.prototype.hasOwnProperty.call(RATE_KEY_EXEMPT, k) && RATE_KEY_EXEMPT[k] === x;
      if (!exempt && RATE_SHAPED_KEY.test(normaliseFieldName(k)))
        out.push({ path: child, why: "a rate-shaped field name", sample: k });
      walk(x, child);
    }
  };

  walk(value, path);
  return out;
}

// ── §5's PATIENT INTELLIGENCE: WHAT IS A DATE RULE AND WHAT IS A CLINICAL JUDGEMENT ───────────────────
//
// ⚠ THE MOST IMPORTANT REFUSAL IN THIS SUITE, AND THE ONE THAT LOOKS LEAST LIKE A REFUSAL.
//
// §5 asks Patient Intelligence for: "Patients overdue, improving, deteriorating, inactive, lost to
// follow-up, high complexity or requiring attention."
//
// Three of those are ARITHMETIC ON DATES and are built: overdue (a due date has passed), inactive (no
// encounter within a stated window), lost to follow-up (an obligation went past its date and the person
// has not been back since). Each is checkable by anybody with a calendar, and each is the length of a
// list you can open.
//
// THREE OF THEM ARE CLINICAL JUDGEMENTS WITH NO STORE BEHIND THEM. Nothing in this product records a
// trajectory. There is no severity scale, no observation series, no staging, no acuity score, no
// problem-count weighting -- and no clinician has ever been asked, in this software, whether a patient
// is getting better. A Stable / Improving / Monitor chip was refused outright on the Patients register
// for exactly this reason, and it must be refused here for the same one.
//
// AND THE FAILURE MODE IS SPECIFIC AND SEVERE. A plausible proxy is available -- fewer visits lately, or
// a follow-up closed with outcome_code `improved` -- and it would render as a green "Improving" chip
// beside real counts, inheriting their credibility. A patient who stopped attending because they got
// worse and went elsewhere is the exact case that proxy calls Improving.
//
// SO THEY ARE REFUSED IN THE POSITION THEY WOULD OCCUPY, each naming what would make it real. An
// omitted card teaches nothing; a card that says "this cannot be computed, and here is what it would
// take" is the difference between a gap and a lie.

export type RefusedState = {
  key: string;
  /** §5's own word for it, so the refusal is findable from the spec. */
  label: string;
  why: string;
  /** What would have to exist in this product before the state could be derived at all. */
  wouldRequire: string;
};

export const REFUSED_PATIENT_STATES: RefusedState[] = [
  // ⚠ REWRITTEN, NOT DELETED, ON 2026-08-07 WHEN CPR-LCP-001 SHIPPED.
  //
  // The original refusal named its own precondition: "a repeated structured measurement with a direction
  // agreed in advance." LCP-001 s7.2 is exactly that, so the precondition is now SOMETIMES met -- and
  // only sometimes, which is why the refusal stays here rather than being removed.
  //
  // WHERE IT IS LIFTED: one parameter, for one patient, who has (a) at least two active measurements of
  // it and (b) a monitoring plan whose change_rule carries an `improving_direction` a practitioner
  // stated IN ADVANCE. trendLine in parameters-constants.ts computes it and returns
  // `no_direction_agreed` or `too_few_measurements` for everything else.
  //
  // WHERE IT IS STILL REFUSED, AND THIS IS MOST PATIENTS: as a WHOLE-PATIENT state on this dashboard.
  // There is no way to roll up "improving on weight, deteriorating on blood pressure, nothing agreed for
  // anything else" into one chip beside a patient's name without inventing a weighting nobody agreed.
  //
  // AND THE ORIGINAL FAILURE MODE SURVIVES THE UNLOCK UNCHANGED, which is why its sentence is kept
  // verbatim below: the trajectory must be computed from MEASUREMENTS and never from attendance.
  {
    key: "improving",
    label: "Improving",
    why: "As a state of a whole patient, this still cannot be computed. CPR-LCP-001 gives the product its first recorded trajectory -- a measurement series with a direction a practitioner agreed in advance -- but that is per parameter, for the patients who have a monitoring plan, and this chip would sit beside a name. Rolling 'improving on weight, deteriorating on blood pressure, nothing agreed for the rest' into one word needs a weighting nobody has agreed. The old proxies remain worse than nothing and remain refused: fewer visits lately is what a patient who deteriorated and went elsewhere looks like, and a follow-up closed as 'improved' describes one obligation on one day rather than a person over time.",
    wouldRequire: "Either a clinician-stated overall impression per encounter, or a recorded decision about which monitored parameter speaks for this patient and how conflicting directions are resolved. The per-parameter direction now exists (see parameterSeries and trendLine); the roll-up rule does not, and no specification supplies one.",
  },
  {
    key: "deteriorating",
    label: "Deteriorating",
    why: "The same position as Improving after CPR-LCP-001, and it is the more dangerous of the two to guess at. A false Deteriorating flag sends a clinician after the wrong patient; a false absence of one is a patient nobody looked at because a dashboard said they were fine. Per parameter, with a direction agreed in advance and at least two measurements, the monitoring plan now says so in the patient's own workspace and cites the two values it read. Rolling that into a single word beside a name still requires the product to have written down something it never asked for.",
    wouldRequire: "The roll-up rule above, plus a stated threshold for what counts as a decline, agreed by a clinician rather than chosen by whoever wrote the query. The threshold now has a home -- practice_patient_monitoring_plan.target_low/target_high and change_rule -- and it is per patient and per parameter, not per dashboard.",
  },
  {
    key: "high_complexity",
    label: "High complexity",
    why: "Complexity is a weighting, and this product has no weights. Counting a patient's problems would call somebody with four minor entries more complex than somebody with one serious one, and the record holds no severity to correct that with. The number would be real arithmetic over the wrong thing, which is the hardest kind of wrong figure to notice.",
    wouldRequire: "A severity or acuity attribute on the problem list, or an adopted complexity instrument with a published weighting -- and a decision, recorded, about which one this practice uses.",
  },
];

/**
 * Windows that define the three states that ARE computable.
 *
 * ⚠ THESE ARE EDITORIAL CHOICES, NOT FACTS, AND THEY ARE NAMED ON THE PAGE. "Inactive" is not a
 * property of a patient; it is a property of a threshold somebody picked. A screen that shows the count
 * without the threshold is asking to be read as clinical.
 */
export const INACTIVE_AFTER_DAYS = 180;
export const LOST_TO_FOLLOW_UP_AFTER_DAYS = 90;

// ── CPR-PIE-001 §7. THE ALERT FRAMEWORK, AND THE FIFTH BUCKET THAT IS NOT A LEVEL ────────────────────
//
// ⚠ THE TAXONOMY IS SETTLED AND THIS IS NOT THE PLACE THAT SETTLED IT. Migration 246 did, in writing:
//
//     "CPR-MED-001 s5 said 'Informational / Advisory / Significant / Critical' and CPR-PIE-001 s7 said
//      'Informational / Advisory / Action required / Critical'. The user settled it on 2026-08-07 in
//      favour of PIE s7 -- 'action_required' says what to do rather than how bad it is, and PIE s7 is
//      the platform-wide alert framework where MED s5 governs only medication. One taxonomy everywhere."
//
// THESE FOUR STRINGS ARE THE CHECK CONSTRAINT ON practice_parameter_alert.severity, COPIED OUT OF IT.
// A fifth level invented here would not fail typecheck and would not fail the constraint either -- it
// would simply never match a row, and the level would render as an eternally empty bar.
//
// ⚠ AND THE FIFTH ENTRY BELOW IS NOT A LEVEL. The column is NULLABLE on purpose: migration 246 says an
// alert raised by a rule that carries no severity "is 'not classified', and must render as those words
// -- never as low, and never as a blank cell." So NULL gets a NAMED bucket rather than being folded into
// `informational` (which would be a clinical claim nobody made) or into a distribution's `unrecorded`
// (which reads as a data-quality defect rather than as a rule that never declared one).
//
// ⚠ AND IT IS NOT THE OPERATIONAL SCALE. PriorityTile.severity is critical/warning/normal and answers
// "does this need you today". This answers "how dangerous is this reading". Migration 246 warns in its
// own words against merging them, and NOTHING here touches PriorityTile.

export type AlertSeverityKey =
  | "informational" | "advisory" | "action_required" | "critical" | "not_classified";

export type AlertSeverity = {
  key: AlertSeverityKey;
  label: string;
  /** What the level asserts, so a screen is not left to infer it from the colour. */
  meaning: string;
  /** False for `not_classified`, which is the absence of a level rather than one. */
  isLevel: boolean;
};

export const ALERT_SEVERITIES: AlertSeverity[] = [
  { key: "informational", label: "Informational", isLevel: true,
    meaning: "Recorded so it is on the timeline. It asks for nothing." },
  { key: "advisory", label: "Advisory", isLevel: true,
    meaning: "Worth a practitioner's eye at the next contact. It does not name an action." },
  { key: "action_required", label: "Action required", isLevel: true,
    meaning: "PIE §7's third level, chosen over MED §5's \"Significant\" because it says what to do rather than how bad it is. Something is expected of somebody." },
  { key: "critical", label: "Critical", isLevel: true,
    meaning: "The most serious level this product has. It does not mean the patient is critical; it means the rule that fired is." },
  { key: "not_classified", label: "Not classified", isLevel: false,
    meaning: "The rule that raised this alert declared no severity. That is an absence, not a low reading, and it is drawn as these two words rather than as a blank cell or a quiet level -- migration 246 requires exactly that." },
];

/** The four the CHECK constraint accepts. `not_classified` is deliberately absent: it is what NULL renders as. */
export const ALERT_SEVERITY_LEVELS = ALERT_SEVERITIES.filter(s => s.isLevel).map(s => s.key);

/** The value a NULL severity is displayed under. Never written to the column. */
export const SEVERITY_NOT_CLASSIFIED: AlertSeverityKey = "not_classified";

// ── CPR-PIE-001 §3 AND §5: THE MODULES THAT CANNOT BE BUILT, NAMED WHERE THEY WOULD HAVE GONE ─────────
//
// ⚠ THE SAME DEVICE AS REFUSED_PATIENT_STATES, FOR THE SAME REASON, AT A DIFFERENT SCALE. PIE §3 lists
// eight intelligence modules and §5 lists seven practice items. Some of them have no store in this
// product AT ALL -- not a thin one, not a proxy: nothing.
//
// An omitted module reads as a feature nobody got round to. A module that says which specification it
// came from, what is missing, and what would make it real is a finding somebody can act on. Every entry
// below was checked against supabase/migrations before it was written, and each names the search that
// was run so the next person does not repeat it.

export type UnbuildableModule = {
  key: string;
  /** The specification's own words for it. */
  label: string;
  /** Which section of CPR-PIE-001 asks for it. */
  from: string;
  why: string;
  wouldRequire: string;
};

export const PIE_NOT_BUILDABLE: UnbuildableModule[] = [
  {
    key: "medication_review",
    label: "Medication review",
    from: "PIE §3 (intelligence modules) and §2 (data sources)",
    why: "There is no medication engine in this product. CPR-MED-001 is unbuilt: no practice_medication, practice_medication_event, practice_medication_warning, practice_dose_calculation, practice_medication_monitoring or practice_adverse_reaction table exists in any migration; there is no medication module in src/lib/practice and no /practice/medications route. The nearest store is practice_treatment (migration 194), whose treatment_type may be 'medication' -- but that row is a decision recorded inside one consultation, it carries no drug, no dose, no route and no stop date, and its status is never written after insert. Counting those rows and heading the panel \"Medication review\" would answer a different question from the one on the heading, which is the failure this whole engine exists to avoid.",
    wouldRequire: "The CPR-MED-001 medication record: a prescribing store with a drug, a dose, a route, a start and a stop, and a status something writes. That is a migration and an engine, and it is not scope a read-only intelligence layer can invent.",
  },
  {
    key: "medication_utilisation",
    label: "Medication utilisation",
    from: "PIE §5 (practice intelligence)",
    why: "The same absent store as medication review, and one further reason of its own: utilisation is a question about what a practice dispenses or prescribes over time, and this product records neither. Nothing here has ever known that a prescription was issued.",
    wouldRequire: "The medication record above, plus a dispensing or prescribing event with a date -- and a decision about whether utilisation counts prescriptions written or medicines given, because those are different numbers.",
  },
  {
    key: "medication_monitoring_due",
    label: "Medication monitoring due",
    from: "PIE §4 (patient intelligence)",
    why: "This asks which patients are due bloods or a level because of a drug they are on. Both halves are needed and only one exists: migration 246 gives the product monitoring plans and due-parameter reminders, but nothing anywhere records that a patient is on a drug, so no plan can be attached to one.",
    wouldRequire: "The medication record, and a link from a drug to the parameter its monitoring plan watches. The plan side is built (practice_patient_monitoring_plan); the drug side does not exist.",
  },
  {
    key: "growth_percentiles",
    label: "Growth and anthropometric trends",
    from: "PIE §3 (intelligence modules)",
    why: "Half of this is now built and the half that matters is refused on purpose. Migration 246 gives the product anthropometric parameters and a longitudinal measurement series, so weight and height over time are recorded and charted per patient. What a growth chart actually IS -- a reading against a reference population -- is not, and migration 246 states why in its own words: \"A percentile computed against an unnamed population is not an approximation. It is a fabricated clinical claim.\" There is no reference-standard table, so no z-score and no centile can be computed from anything.\n\n⚠ AND THE NAME COLLIDES. The module already called Practice Growth in this engine is BUSINESS growth -- new patients and workload -- not a child's growth chart. They are unrelated and must not be merged by whoever next sees two things called growth.",
    wouldRequire: "A named, versioned reference population (WHO or CDC, stated on the row) and the derived-value machinery of migration 246 section 9, so a centile arrives with its source and its formula attached rather than as a bare number.",
  },
  {
    key: "predictive_reminders",
    label: "Predictive reminders",
    from: "PIE §3 (intelligence modules)",
    why: "Everything else in this workspace is arithmetic a practitioner could check with a calendar. A prediction is not: it is a model, it needs an outcome to have been labelled, and this product has never labelled one. The available proxy -- \"patients like this usually come back in six weeks\" -- would be computed over a handful of records and expressed as a likelihood, and a likelihood is a rate wearing a different word. The date-derived reminders that ARE honest already exist beside this entry: overdue follow-ups, lost to follow-up, milestones past their date, and measurements a monitoring plan says are due.",
    wouldRequire: "A recorded outcome to predict, a stated population to predict it over, and a published method -- plus a decision about how a probability is shown to a clinician in a product that computes no rates.",
  },
  {
    key: "preventive_care_reminders",
    label: "Preventive care reminders",
    from: "PIE §4 (patient intelligence)",
    why: "A preventive reminder needs a schedule -- what is due, to whom, at what age or interval -- and no such schedule exists. practice_follow_up.kind accepts 'immunisation', so a practitioner can record that THIS patient is owed one; nothing in this product knows what any patient is owed without somebody having written it down first. Deriving a schedule from the follow-ups already raised would flag exactly the patients somebody had already remembered, and miss every patient the reminder exists for.",
    wouldRequire: "An immunisation or screening schedule as data -- an eligibility rule per item, with an age or interval -- which is a store and a governance surface, not a query.",
  },
];

// ── §12. EMPTY, LOADING AND FAILURE STATES ───────────────────────────────────────────────────────────
//
// "Zero activity is presented as a valid result, not as a data-quality failure." Three states, and only
// one of them is a problem -- the same three the engine's IntelStatus already carries.

export const STATE_COPY = {
  empty: {
    title: "Nothing in this period",
    body: "A real answer, not a failure. Intelligence here is a count of what has been recorded, so it appears as the practice records it.",
  },
  not_permitted: {
    title: "You may not see this",
    body: "Your role does not include the records this is computed from. That is a permissions answer, not an empty practice.",
  },
  unreadable: {
    title: "This could not be read",
    body: "A query failed. The figure is deliberately blank rather than nought -- a failed read is not a quiet week.",
  },
  ai_unavailable: {
    title: "The assistant is not available",
    body: "Everything else on this page is arithmetic over your own records and is unaffected. §12: unavailable AI must not block dashboards.",
  },
} as const;

// ── CPR-GROWTH-001 s2: "first insight actioned" ──────────────────────────────────────────────────────
//
// ⚠ THIS EXISTS BECAUSE THE MILESTONE HAD NOTHING TO HANG ON. Every interactive element on the
// intelligence surface was a link to somewhere else, a range picker or the Ask field -- so the only things
// that COULD have been wired were a page view, a date change or a click on "All patients". Emitting on any
// of those would have said a practitioner acted on intelligence when they had only looked at it, and
// intelligence.first_action is stage 7 of the adoption ladder: every practice that ever opened the page
// would have shown as having reached the top rung.
//
// So the action had to become real first. "Act on this" raises a TASK -- tracked work, assigned to
// somebody, that outlives the page. That is a state change attributable to the insight, which is what the
// milestone claims.
//
// ⚠ FOUR OF THE FIVE PRIORITY TILES, NOT FIVE. `patients_attention` links back into another intelligence
// tab, so its only "next step" is to look at more detail -- and a button offering to act, which merely
// navigates, is the thing this whole exercise exists to avoid. It is absent on purpose, and the harness
// asserts that the omission is deliberate rather than a gap.
//
// ⚠ AND NO COUNT APPEARS IN A TITLE. "Clear 7 overdue follow-ups" is wrong the moment one is cleared, and
// a task carrying a stale figure is worse than one carrying none.
export const INSIGHT_ACTIONS: Record<string, {
  title: string; detail: string; href: string; category: string;
}> = {
  overdue_followups: {
    title: "Work through overdue follow-ups",
    detail: "Raised from Practice Intelligence. These are obligations this practice recorded whose date has passed.",
    href: "/practice/follow-ups",
    category: "follow_up",
  },
  awaiting_review: {
    title: "Review results and letters that have arrived",
    detail: "Raised from Practice Intelligence. Incoming documents nobody has reviewed, plus clinical documents not yet issued.",
    href: "/practice/inbox",
    category: "documents",
  },
  open_encounters: {
    title: "Finish and sign open consultations",
    detail: "Raised from Practice Intelligence. Consultations still open or recorded but not signed are not yet a record. Close My Day works through them one at a time.",
    href: "/practice/close-my-day",
    category: "clinical",
  },
  pathway_milestones: {
    title: "Review pathway milestones that are due",
    detail: "Raised from Practice Intelligence. Stages of an active plan that are due soon or have gone past their date.",
    href: "/practice/pathways",
    category: "clinical",
  },
};

export const ACTIONABLE_INSIGHT_KEYS = Object.keys(INSIGHT_ACTIONS);

/** Named so the absence is a decision on the record rather than an oversight somebody has to infer. */
export const INSIGHTS_WITHOUT_AN_ACTION = [
  { key: "patients_attention", why: "its next step is another intelligence tab, so acting would only mean looking" },
];

/**
 * Weekday grouping over the ONE shared encounter trend's daily buckets (pi.day_of_week's derivation).
 * Lives here so the Patterns screen and the report engine read the SAME arithmetic -- a second copy of
 * this loop is how two surfaces come to disagree about what a Tuesday is.
 */
export function weekdayPattern(buckets: { day: string; total: number }[]): { label: string; count: number }[] {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const counts = new Array(7).fill(0);
  for (const b of buckets ?? []) {
    const dow = (new Date(b.day + "T00:00:00Z").getUTCDay() + 6) % 7;
    counts[dow] += b.total;
  }
  return names.map((label, i) => ({ label, count: counts[i] }));
}

/**
 * CPR-PI-001 v2 s10's GOVERNED TIME BANDS -- the workload distribution's vocabulary, named here so
 * a band boundary is a decision on the record rather than an if-chain someone retunes quietly.
 * Hours are in the PRACTICE's timezone, inclusive of `from`, inclusive of `to`.
 */
export const TIME_BANDS: { key: string; label: string; from: number; to: number }[] = [
  { key: "morning", label: "Morning (05:00 to 11:59)", from: 5, to: 11 },
  { key: "afternoon", label: "Afternoon (12:00 to 16:59)", from: 12, to: 16 },
  { key: "evening", label: "Evening (17:00 to 20:59)", from: 17, to: 20 },
  { key: "night", label: "Night (21:00 to 04:59)", from: 21, to: 4 },
];

/** Which band an hour falls in. The night band wraps midnight, hence the explicit membership test. */
export function timeBandOf(hour: number): string {
  for (const b of TIME_BANDS) {
    if (b.from <= b.to ? hour >= b.from && hour <= b.to : hour >= b.from || hour <= b.to) return b.key;
  }
  return "night";
}
