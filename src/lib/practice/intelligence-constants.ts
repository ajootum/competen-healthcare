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
  | "pathways" | "performance" | "reports" | "assistant";

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
  { key: "patients", label: "Patients", swatch: "rose",
    blurb: "Patients the dates say need attention -- overdue, inactive, lost to follow-up." },
  { key: "cohorts", label: "Cohorts", swatch: "violet",
    blurb: "Groups of patients defined by an attribute the record actually holds." },
  { key: "clinical", label: "Clinical Insights", swatch: "emerald",
    blurb: "Diagnoses, procedures, outcomes and follow-up conclusions over the period." },
  { key: "pathways", label: "Pathways", swatch: "cyan",
    blurb: "Enrolment, stage progression and milestones that have passed their date." },
  { key: "performance", label: "Performance & Portfolio", swatch: "amber",
    blurb: "Your own activity over the period, and the portfolio it feeds." },
  { key: "reports", label: "Reports", swatch: "sky",
    blurb: "Reports this practice has defined, and the exports it has permission to take." },
  { key: "assistant", label: "Assistant", swatch: "assistant",
    blurb: "Questions about the records in front of you. It works from them and from nothing else." },
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
// This is a legibility decision. The priority strip is read in the first seconds of a clinic to answer
// "what needs me first". Five identical grey rectangles containing five numbers have to be READ, one at
// a time; five coloured ones are FOUND.
//
// ⚠ THESE LIVE HERE RATHER THAN IN palette.ts BECAUSE palette.ts IS CONTENDED BY ANOTHER AGENT RIGHT
// NOW. Every hue below is one palette.ts already uses for the same meaning -- rose for a failure whose
// cost falls outside the room, amber for waiting, sky for arrived-and-unreviewed, emerald for the only
// good news, slate for context that must never pull the eye. THEY SHOULD BE MOVED INTO palette.ts as
// PRIORITY_SWATCH / PI_PANEL when that file is free; this file is not a second palette and must not
// become one.

export type IntelSwatch = {
  /** Tinted card background and border. */
  box: string;
  /** Tinted square behind the glyph. */
  badge: string;
  /** THE FIGURE, in the card's own hue. The line that keeps being dropped. */
  figure: string;
  /** A 2px rule down the card's leading edge. */
  accent: string;
  /** The caption under the figure, at the card's hue and reduced. */
  caption: string;
  icon: string;
};

/**
 * §7.2's PRIORITY STRIP -- five tiles, and the colour is semantic in four of them.
 *
 *   overdue_followups  rose  -- the only item whose cost falls on somebody outside the room.
 *   awaiting_review    sky   -- arrived and unreviewed. The missed-result harm. Not late, but silent.
 *   open_encounters    amber -- unfinished work with your name on it. Waiting, not failing.
 *   patients_attention violet-- people the dates have flagged. Unplanned work.
 *   pathway_milestones cyan  -- a date on a plan. Due, and not yet a failure.
 */
export const PRIORITY_SWATCH: Record<string, IntelSwatch> = {
  overdue_followups: {
    box: "border-rose-300 bg-rose-50", badge: "bg-rose-100 text-rose-700", figure: "text-rose-700",
    accent: "bg-rose-500", caption: "text-rose-800/70", icon: "↺",
  },
  awaiting_review: {
    box: "border-sky-200/80 bg-sky-50/70", badge: "bg-sky-100 text-sky-700", figure: "text-sky-700",
    accent: "bg-sky-400", caption: "text-sky-800/70", icon: "▤",
  },
  open_encounters: {
    box: "border-amber-200/80 bg-amber-50/70", badge: "bg-amber-100 text-amber-700", figure: "text-amber-700",
    accent: "bg-amber-400", caption: "text-amber-800/70", icon: "✎",
  },
  patients_attention: {
    box: "border-violet-200/80 bg-violet-50/70", badge: "bg-violet-100 text-violet-700", figure: "text-violet-700",
    accent: "bg-violet-400", caption: "text-violet-800/70", icon: "⚇",
  },
  pathway_milestones: {
    box: "border-cyan-200/80 bg-cyan-50/70", badge: "bg-cyan-100 text-cyan-700", figure: "text-cyan-700",
    accent: "bg-cyan-400", caption: "text-cyan-800/70", icon: "◷",
  },
};

/**
 * A tile whose figure the engine could not supply.
 *
 * IT KEEPS ITS PLACE AND LOSES ITS COLOUR -- the same rule the patients dashboard already applies. A
 * tinted card with an em dash reads as a number you cannot quite make out; a grey dashed one reads as a
 * question nobody could answer, which is what it is. Removing the tile entirely would make the strip
 * look complete when it is not.
 */
export const PRIORITY_UNSUPPLIED: IntelSwatch = {
  box: "border-dashed border-slate-300 bg-white", badge: "bg-slate-100 text-slate-400",
  figure: "text-slate-300", accent: "bg-slate-200", caption: "text-slate-400", icon: "?",
};

/** §7.3's seven dashboard panels, one hue each, matching the tab that opens the same material. */
export const PI_PANEL: Record<string, { icon: string; badge: string; rule: string }> = {
  todays_brief: { icon: "✧", badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", rule: "bg-[var(--cp-primary)]/25" },
  practice_activity: { icon: "▥", badge: "bg-violet-100 text-violet-700", rule: "bg-violet-200" },
  clinical_trends: { icon: "◈", badge: "bg-emerald-100 text-emerald-700", rule: "bg-emerald-200" },
  patient_attention: { icon: "⚇", badge: "bg-rose-100 text-rose-700", rule: "bg-rose-200" },
  pathway_status: { icon: "◷", badge: "bg-cyan-100 text-cyan-700", rule: "bg-cyan-200" },
  ai_insight: { icon: "✦", badge: "bg-sky-100 text-sky-700", rule: "bg-sky-200" },
  recent_reports: { icon: "▦", badge: "bg-amber-100 text-amber-700", rule: "bg-amber-200" },
  cohorts: { icon: "◎", badge: "bg-violet-100 text-violet-700", rule: "bg-violet-200" },
  performance: { icon: "❑", badge: "bg-amber-100 text-amber-700", rule: "bg-amber-200" },
  refused: { icon: "⊘", badge: "bg-slate-100 text-slate-500", rule: "bg-slate-200" },
};

/** Tab chips. `primary` is the workspace's own indigo; `assistant` is deliberately the AI hue, sky. */
export const TAB_SWATCH: Record<string, { on: string; off: string }> = {
  primary: { on: "bg-[var(--cp-primary)] text-white", off: "text-[var(--cp-primary-deep)] hover:bg-[var(--cp-primary)]/8" },
  indigo: { on: "bg-indigo-600 text-white", off: "text-indigo-700 hover:bg-indigo-50" },
  rose: { on: "bg-rose-600 text-white", off: "text-rose-700 hover:bg-rose-50" },
  violet: { on: "bg-violet-600 text-white", off: "text-violet-700 hover:bg-violet-50" },
  emerald: { on: "bg-emerald-600 text-white", off: "text-emerald-700 hover:bg-emerald-50" },
  cyan: { on: "bg-cyan-600 text-white", off: "text-cyan-700 hover:bg-cyan-50" },
  amber: { on: "bg-amber-600 text-white", off: "text-amber-700 hover:bg-amber-50" },
  sky: { on: "bg-sky-600 text-white", off: "text-sky-700 hover:bg-sky-50" },
  assistant: { on: "bg-sky-600 text-white", off: "text-sky-700 hover:bg-sky-50" },
};

/**
 * Where a line came from, said in a badge rather than implied.
 *
 * ⚠ COMPUTED IS NOT AI, AND THE DISTINCTION IS THE WHOLE POINT OF THE BADGE. §11 requires AI-generated
 * content to be "clearly labelled". The failure mode that requirement invites is labelling ARITHMETIC as
 * AI because it sits in a panel headed "AI Insight" -- which trains a practitioner to discount a count
 * they could have done themselves, and, worse, to extend the same trust to a sentence a model wrote.
 * command-centre.ts already set this precedent with `aiGenerated: false`.
 */
export const PROVENANCE_BADGE = {
  computed: { label: "COMPUTED", chip: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
    title: "Arithmetic over this practice's own rows. No model was involved." },
  derived: { label: "DERIVED", chip: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    title: "Rules over rows that exist right now, with the source records named." },
  ai: { label: "AI", chip: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
    title: "Written by a model from the records listed beneath it. Read it as a draft, not as a finding." },
  refused: { label: "NOT COMPUTED", chip: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
    title: "The design asks for this figure and nothing in this practice's records could ground it." },
} as const;

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
  {
    key: "improving",
    label: "Improving",
    why: "Nothing in this product records a clinical trajectory. There is no observation series, no severity scale and no staging, and no clinician has ever been asked in this software whether a patient is getting better. The available proxies are worse than nothing: fewer visits lately is what a patient who deteriorated and went elsewhere looks like, and a follow-up closed as 'improved' describes one obligation on one day rather than a person over time.",
    wouldRequire: "A recorded trajectory -- either a clinician-stated impression per encounter, or a repeated structured measurement with a direction agreed in advance. Neither exists and neither is specified in CPR-PI-001 or CPR-PI-002.",
  },
  {
    key: "deteriorating",
    label: "Deteriorating",
    why: "The same absence as Improving, and it is the more dangerous of the two to guess at. A false Deteriorating flag sends a clinician after the wrong patient; a false absence of one is a patient nobody looked at because a dashboard said they were fine. Both require the product to have written down something it never asked for.",
    wouldRequire: "The same recorded trajectory, plus a stated threshold for what counts as a decline, agreed by a clinician rather than chosen by whoever wrote the query.",
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
