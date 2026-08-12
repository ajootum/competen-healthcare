import type { CSSProperties } from "react";

// CPR-001_v4 -- the command centre's colour, extracted so it is one decision rather than fifty.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// COLOUR IS DOING SEMANTIC WORK IN THE COMP, AND THE FIRST BUILD LEFT IT ON THE TABLE.
//
// The mockup gives every statistic its own tinted icon, every panel a coloured badge, every follow-up
// tile a colour that means something, and every cohort a coloured circle. Built in greys, all fourteen
// widgets read at exactly the same weight -- so a screen designed to be scanned in ten seconds at the
// start of a clinic becomes something you have to read word by word. That is a legibility failure, not
// a decoration one.
//
// EVERY COLOUR HERE IS A CPR-040 TOKEN OR A TAILWIND STEP OF ONE. The tokens existed the whole time
// (--cp-primary indigo, --cp-accent cyan, --cp-success, --cp-warning, --cp-error, --cp-info); nothing
// new is being invented, it is being used.
//
// THE HUE IS NOT DECORATIVE WHERE IT CARRIES MEANING. A red follow-up tile is red because overdue is
// the one thing on this page whose cost falls on somebody outside the room; the amber of a waiting
// patient is the amber CPR-300 already uses for "warning". Where the hue carries NO meaning -- the six
// hero stats, the cohort circles -- it varies only to make the row scannable, and the harness asserts
// that no colour is load-bearing there: the same figure in a different colour must mean the same thing.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type Swatch = {
  /** Tinted circle or square behind an icon. */
  badge: string;
  /** The number itself, where the figure is the thing being read. */
  figure: string;
  /** A tinted panel background, used sparingly. */
  soft: string;
};

/**
 * The six hero statistics, in the comp's order and its hues.
 *
 * DISTINCT SO THE ROW CAN BE SCANNED, not because the colours rank anything. "Overdue Reviews" is the
 * one exception and it earns its red: it is the only figure in the row where somebody outside the room
 * is waiting.
 */
export const HERO_SWATCH: Record<string, Swatch> = {
  patients_today: { badge: "bg-violet-100 text-violet-700", figure: "text-violet-700", soft: "bg-violet-50" },
  new_patients: { badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", figure: "text-[var(--cp-primary-deep)]", soft: "bg-[var(--cp-primary)]/5" },
  followups: { badge: "bg-rose-100 text-rose-700", figure: "text-rose-700", soft: "bg-rose-50" },
  results: { badge: "bg-emerald-100 text-emerald-700", figure: "text-emerald-700", soft: "bg-emerald-50" },
  overdue_reviews: { badge: "bg-amber-100 text-amber-700", figure: "text-amber-700", soft: "bg-amber-50" },
  walk_ins: { badge: "bg-cyan-100 text-cyan-700", figure: "text-cyan-700", soft: "bg-cyan-50" },
};

/** The comp's small line-icons. Text glyphs, so nothing here needs an icon package or a network fetch. */
export const HERO_ICON: Record<string, string> = {
  patients_today: "☰", new_patients: "＋", followups: "↻",
  results: "▤", overdue_reviews: "!", walk_ins: "⏱",
};

/** Panel header badges. One hue per panel, matching the comp's own assignment. */
export const PANEL: Record<string, { icon: string; badge: string }> = {
  timeline: { icon: "↑", badge: "bg-violet-100 text-violet-700" },
  queue: { icon: "☰", badge: "bg-emerald-100 text-emerald-700" },
  followups: { icon: "↻", badge: "bg-rose-100 text-rose-700" },
  locations: { icon: "◎", badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]" },
  alerts: { icon: "⚑", badge: "bg-amber-100 text-amber-700" },
  tasks: { icon: "☑", badge: "bg-cyan-100 text-cyan-700" },
  messages: { icon: "✉", badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]" },
  recent_patients: { icon: "☺", badge: "bg-violet-100 text-violet-700" },
  insights: { icon: "◐", badge: "bg-emerald-100 text-emerald-700" },
  documents: { icon: "▦", badge: "bg-amber-100 text-amber-700" },
  performance: { icon: "◫", badge: "bg-cyan-100 text-cyan-700" },
  quick: { icon: "⚡", badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]" },
  brief: { icon: "✧", badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]" },
};

/**
 * The five follow-up tiles.
 *
 * HERE THE COLOUR IS LOAD-BEARING, and deliberately so: overdue is the only figure on this page whose
 * cost falls on a patient rather than on the practitioner, so it is the only one that goes red -- and
 * it goes red ONLY when it is non-zero, because a red nought trains people to ignore red.
 */
export const FOLLOWUP_SWATCH: Record<string, { figure: string; box: string }> = {
  booked_today: { figure: "text-emerald-700", box: "border-emerald-200 bg-emerald-50/60" },
  need_booking: { figure: "text-[var(--cp-primary-deep)]", box: "border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/5" },
  overdue: { figure: "text-rose-700", box: "border-rose-300 bg-rose-50" },
  completed: { figure: "text-cyan-700", box: "border-cyan-200 bg-cyan-50/60" },
  due_week: { figure: "text-violet-700", box: "border-violet-200 bg-violet-50/60" },
};

/** Cohort circles. Rotated by position, never by condition -- the product has no condition taxonomy. */
export const COHORT_RING = [
  "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
  "bg-cyan-100 text-cyan-700",
];

/**
 * CPR-V5-001 s3's eight "Today at a glance" tiles, and s6's five follow-up lenses.
 *
 * ⚠ COLOUR HERE IS SEMANTIC, NOT ROTATION. Unlike QUICK_SWATCH below -- which cycles hues purely so a row
 * of eight tiles does not read as one grey block -- every colour in these two maps means the thing it is
 * attached to. Cancelled and Emergency are red because they are the two tiles you must not scan past;
 * Completed is green because it is the only one that is good news; No Show is slate because a nought
 * there is unremarkable and colouring it would compete with the two that matter.
 *
 * The first build of this dashboard drew all eight in plain grey with a number in them. Every tile read
 * at identical weight, which is the failure the v4 comp was already redesigned to fix once -- a screen
 * meant to be scanned in ten seconds at the start of a clinic became something you read word by word.
 * The tone was even being COMPUTED in session.ts and thrown away by the page.
 */
export const GLANCE_SWATCH: Record<string, { badge: string; figure: string; box: string; icon: string }> = {
  booked: { badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", figure: "text-[var(--cp-primary-deep)]", box: "border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/5", icon: "▤" },
  waiting: { badge: "bg-amber-100 text-amber-700", figure: "text-amber-700", box: "border-amber-200 bg-amber-50/60", icon: "⏱" },
  completed: { badge: "bg-emerald-100 text-emerald-700", figure: "text-emerald-700", box: "border-emerald-200 bg-emerald-50/60", icon: "✓" },
  // `walk_in`, matching metrics.ts's MetricKey. The swatch is looked up BY that key, so a mismatch here
  // silently falls back to the booked swatch and the tile quietly wears the wrong colour.
  walk_in: { badge: "bg-violet-100 text-violet-700", figure: "text-violet-700", box: "border-violet-200 bg-violet-50/60", icon: "⚇" },
  cancelled: { badge: "bg-rose-100 text-rose-700", figure: "text-rose-700", box: "border-rose-200 bg-rose-50/60", icon: "✕" },
  emergency: { badge: "bg-red-100 text-red-700", figure: "text-red-700", box: "border-red-200 bg-red-50/60", icon: "✚" },
  follow_ups_due: { badge: "bg-sky-100 text-sky-700", figure: "text-sky-700", box: "border-sky-200 bg-sky-50/60", icon: "↻" },
  // Slate on purpose. A no-show count is usually nought, and a nought that shouts is a nought people
  // learn to ignore -- taking the two red tiles beside it down with it.
  no_show: { badge: "bg-slate-100 text-slate-500", figure: "text-slate-600", box: "border-slate-200 bg-slate-50/60", icon: "○" },
};

/**
 * CPR-V5-006's six worklist tiles.
 *
 * ⚠ THE THIRD TIME THIS EXACT NOTE HAS BEEN WRITTEN IN THIS FILE, and the third screen it has been
 * written about. The Patients page shipped with SIX GREY TILES and not one of its components imported
 * this module. The user's words, again: "The colors are flat."
 *
 * It is worth being precise about why this keeps happening and why it matters. Grey feels like the
 * conservative choice -- it commits to nothing and cannot clash. But these six tiles are read in the
 * first seconds of a clinic, at a glance, to answer "what needs me first". Six identical grey
 * rectangles containing six numbers have to be READ, one at a time, left to right; six coloured ones
 * are FOUND. THIS IS A LEGIBILITY DECISION, NOT A DECORATIVE ONE, and monochrome is not the safe
 * default -- it is the option that quietly costs the practitioner the thing the screen was for.
 *
 * The hues carry meaning where meaning exists and are only scannability where it does not:
 *   waiting          amber -- people in the building, now. The one with a clock on it.
 *   dueFollowUps     rose  -- the only FAILURE state here. Somebody is owed something and it is late.
 *   pendingResults   sky   -- arrived and unreviewed. Not late yet, but it is the missed-result harm.
 *   walkIns          violet-- unplanned work, which is what makes a day overrun.
 *   recentPatients   slate -- context, not a demand. Deliberately quiet: it is the tile that should
 *                            NEVER pull the eye away from the five above it.
 *   newRegistrations emerald -- growth, and the only unambiguously good number on the row.
 */
export const WORKLIST_SWATCH: Record<string, { badge: string; figure: string; box: string; icon: string }> = {
  waiting: { badge: "bg-amber-100 text-amber-700", figure: "text-amber-700", box: "border-amber-200 bg-amber-50/60", icon: "⏱" },
  dueFollowUps: { badge: "bg-rose-100 text-rose-700", figure: "text-rose-700", box: "border-rose-300 bg-rose-50", icon: "↻" },
  pendingResults: { badge: "bg-sky-100 text-sky-700", figure: "text-sky-700", box: "border-sky-200 bg-sky-50/60", icon: "⚗" },
  walkIns: { badge: "bg-violet-100 text-violet-700", figure: "text-violet-700", box: "border-violet-200 bg-violet-50/60", icon: "⚇" },
  recentPatients: { badge: "bg-slate-100 text-slate-500", figure: "text-slate-600", box: "border-slate-200 bg-slate-50/60", icon: "◔" },
  // CPR-PAT-002's three additions. Indigo for in-consultation matches QUEUE_SWATCH.IN_CONSULTATION so
  // one state is one colour wherever it is drawn. Cyan for today's follow-ups sits deliberately between
  // the amber of waiting and the rose of overdue: due today is neither.
  inConsultation: { badge: "bg-indigo-100 text-indigo-700", figure: "text-indigo-700", box: "border-indigo-200 bg-indigo-50/60", icon: "◉" },
  followUpsToday: { badge: "bg-cyan-100 text-cyan-700", figure: "text-cyan-700", box: "border-cyan-200 bg-cyan-50/60", icon: "◷" },
  urgentReviews: { badge: "bg-rose-100 text-rose-700", figure: "text-rose-700", box: "border-rose-300 bg-rose-50", icon: "!" },
  newRegistrations: { badge: "bg-emerald-100 text-emerald-700", figure: "text-emerald-700", box: "border-emerald-200 bg-emerald-50/60", icon: "＋" },
  // Teal for what is COMING: distinct from amber (in the building), cyan (due today) and rose (late).
  // A tile with no entry here renders grey among nine coloured ones, which harness 42b exists to catch.
  booked: { badge: "bg-teal-100 text-teal-700", figure: "text-teal-700", box: "border-teal-200 bg-teal-50/60", icon: "▤" },
};

/**
 * CPR-PAT-002 s3's NINE dashboard cards -- five under "Today's Care", four under "Continuing Care".
 *
 * ⚠ THE FOURTH TIME THIS NOTE HAS BEEN WRITTEN IN THIS FILE. The Patients dashboard was rebuilt again and
 * came back grey again. The rule, one more time, because it is the specific thing that keeps being lost:
 * THE FIGURE TAKES THE CARD'S COLOUR. A tinted badge beside a black number leaves the colour on the
 * decoration; the number is what is being read. A card gets three things -- a tinted box, a tinted icon
 * badge, AND a figure in the same hue.
 *
 * THE SPEC'S NINE CARDS ARE NOT WORKLIST_SWATCH'S SIX, which is why this map exists rather than being
 * bent out of that one. Four of the nine have no engine worklist behind them at all; they still need a
 * hue, because a card whose figure could not be computed still has to sit in the row without looking
 * broken. Cards fall back to WORKLIST_SWATCH by their engine key where one exists, so the two maps
 * cannot disagree about what a worklist's colour is.
 *
 * THE HUES, AND WHY EACH ONE:
 *   waiting          amber   -- people in the building now. This product's waiting hue everywhere else.
 *   walkIns          violet  -- unplanned work, which is what makes a day overrun. GLANCE_SWATCH agrees.
 *   inConsultation   indigo  -- the practice's primary. QUEUE_SWATCH already draws IN_CONSULTATION in it,
 *                               so the card and the chip on the row below it are the same colour.
 *   followUpsToday   cyan    -- due today and not yet late. Deliberately NOT sky (that is the results
 *                               hue) and NOT rose (that is the failure hue) -- today's follow-up is
 *                               neither of those things yet.
 *   urgentReviews    rose    -- priority set by a clinician, on an open obligation. A failure state.
 *   overdueFollowUps rose    -- the other failure state, and the only one whose cost falls on somebody
 *                               outside the room. Drawn heavier than the rest: a solid tint, not a wash.
 *   resultsToReview  sky     -- arrived and unreviewed. Not late, but it is the missed-result harm.
 *   recentlySeen     slate   -- context, not a demand. The one card that must never pull the eye.
 *   newRegistrations emerald -- growth, and the only unambiguously good figure on either row.
 *
 * ROSE TWICE IS DELIBERATE and the two are in different rows: today's urgent reviews and the standing
 * overdue backlog are the same KIND of fact at two timescales, and giving the second one its own hue
 * would say they were different kinds.
 */
/**
 * What a summary card needs to be drawn: a tinted box with a left accent bar, a tinted icon badge, THE
 * FIGURE IN THE CARD'S HUE, and a caption under it. Named because three screens now draw this same card.
 */
export type CardSwatch = {
  badge: string; figure: string; box: string; accent: string; icon: string; caption: string;
};

export const CARE_CARD_SWATCH: Record<string, CardSwatch> = {
  waiting: {
    badge: "bg-amber-100 text-amber-700", figure: "text-amber-700",
    box: "border-amber-200/80 bg-amber-50/70", accent: "bg-amber-400",
    icon: "⏱", caption: "text-amber-800/60",
  },
  walkIns: {
    badge: "bg-violet-100 text-violet-700", figure: "text-violet-700",
    box: "border-violet-200/80 bg-violet-50/70", accent: "bg-violet-400",
    icon: "⚇", caption: "text-violet-800/60",
  },
  inConsultation: {
    badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", figure: "text-[var(--cp-primary-deep)]",
    box: "border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.06]", accent: "bg-[var(--cp-primary)]",
    icon: "◉", caption: "text-[var(--cp-primary-deep)]/60",
  },
  followUpsToday: {
    badge: "bg-cyan-100 text-cyan-700", figure: "text-cyan-700",
    box: "border-cyan-200/80 bg-cyan-50/70", accent: "bg-cyan-400",
    icon: "↻", caption: "text-cyan-800/60",
  },
  urgentReviews: {
    badge: "bg-rose-100 text-rose-700", figure: "text-rose-700",
    box: "border-rose-200/90 bg-rose-50/80", accent: "bg-rose-400",
    icon: "⚠", caption: "text-rose-800/60",
  },
  overdueFollowUps: {
    badge: "bg-rose-100 text-rose-700", figure: "text-rose-700",
    box: "border-rose-300 bg-rose-50", accent: "bg-rose-500",
    icon: "↺", caption: "text-rose-800/60",
  },
  resultsToReview: {
    badge: "bg-sky-100 text-sky-700", figure: "text-sky-700",
    box: "border-sky-200/80 bg-sky-50/70", accent: "bg-sky-400",
    icon: "▤", caption: "text-sky-800/60",
  },
  recentlySeen: {
    badge: "bg-slate-100 text-slate-500", figure: "text-slate-600",
    box: "border-slate-200 bg-slate-50/80", accent: "bg-slate-300",
    icon: "◔", caption: "text-slate-500",
  },
  newRegistrations: {
    badge: "bg-emerald-100 text-emerald-700", figure: "text-emerald-700",
    box: "border-emerald-200/80 bg-emerald-50/70", accent: "bg-emerald-400",
    icon: "＋", caption: "text-emerald-800/60",
  },
};

/**
 * A card whose figure the engine cannot supply.
 *
 * IT KEEPS ITS PLACE AND LOSES ITS COLOUR, which is the same rule WorklistTiles already applied to an
 * unreadable tile: a tinted card with an em dash in it looks like a number you cannot quite read, rather
 * than a question nobody could answer. The card still occupies its slot -- removing it would make the row
 * look complete when it is not.
 */
export const CARE_CARD_UNSUPPLIED = {
  badge: "bg-slate-100 text-slate-400", figure: "text-slate-300",
  box: "border-dashed border-slate-300 bg-white", accent: "bg-slate-200",
  caption: "text-slate-400",
} as const;

/**
 * A card whose KEY is not in its map -- which is a different failure from a card whose FIGURE could not
 * be read, and must not be drawn as one.
 *
 * It cannot happen: both card maps below are asserted key-for-key against the engine that emits them.
 * It exists so that if it ever does, the card goes grey instead of the page going blank on `s.box` of
 * undefined -- a bug you can see beats a bug that white-screens, and beats a card silently wearing some
 * other card's colour most of all.
 */
export const CARD_SWATCH_UNKEYED: CardSwatch = {
  badge: "bg-slate-100 text-slate-500", figure: "text-slate-600",
  box: "border-slate-200 bg-slate-50/80", accent: "bg-slate-300",
  icon: "•", caption: "text-slate-500",
};

/**
 * CPR-FUP-001 s4's FIVE FOLLOW-UP CARDS.
 *
 * ⚠ KEYED ON THE ENGINE'S OWN CARD KEYS -- the `card: true` entries of FOLLOW_UP_VIEWS, which is what
 * followUpWorkspace() emits. Nothing else. The harness asserts the two key sets are IDENTICAL in both
 * directions, because this file's header records the same mismatch shipping twice (PERFORMANCE_SWATCH
 * keyed `avg_consult` against `average_consult_time`, GLANCE_SWATCH `walk_ins` against `walk_in`) and
 * both times the symptom was a real figure quietly rendered in dead grey, invisible in a diff.
 *
 * THESE FIVE LIVED IN THE PAGE, INDIRECTING INTO CARE_CARD_SWATCH BY A BORROWED KEY -- "Completed" read
 * `newRegistrations` because that entry happens to be emerald. It rendered correctly and it was still
 * the wrong shape: colour was being decided in a component by a key that names something else, so the
 * only thing keeping the two in step was a comment. They are decided here now.
 *
 * THE HUES, AND WHY EACH ONE:
 *   overdue    rose    -- the only FAILURE state on the row, and the only one whose cost falls on
 *                         somebody outside the room. Drawn heaviest for that reason and no other: a
 *                         solid tint and a 500 accent where the rest take a wash and a 400.
 *   due_today  cyan    -- due, and not yet late. Deliberately NOT rose (that is failure) and NOT amber
 *                         (that is waiting) -- today's review is neither of those things yet.
 *   due_week   amber   -- the horizon. This product's "coming, not here yet" hue everywhere else.
 *   awaiting   violet  -- unarranged work, which is what makes a week overrun. The walk-in hue, for the
 *                         same reason it is the walk-in hue: nobody has planned this yet.
 *   completed  emerald -- the only unambiguously good figure on the row.
 */
export const FOLLOWUP_CARD_SWATCH: Record<string, CardSwatch> = {
  overdue: {
    badge: "bg-rose-100 text-rose-700", figure: "text-rose-700",
    box: "border-rose-300 bg-rose-50", accent: "bg-rose-500",
    icon: "!", caption: "text-rose-800/60",
  },
  due_today: {
    badge: "bg-cyan-100 text-cyan-700", figure: "text-cyan-700",
    box: "border-cyan-200/80 bg-cyan-50/70", accent: "bg-cyan-400",
    icon: "◷", caption: "text-cyan-800/60",
  },
  due_week: {
    badge: "bg-amber-100 text-amber-700", figure: "text-amber-700",
    box: "border-amber-200/80 bg-amber-50/70", accent: "bg-amber-400",
    icon: "▦", caption: "text-amber-800/60",
  },
  awaiting: {
    badge: "bg-violet-100 text-violet-700", figure: "text-violet-700",
    box: "border-violet-200/80 bg-violet-50/70", accent: "bg-violet-400",
    icon: "⌕", caption: "text-violet-800/60",
  },
  completed: {
    badge: "bg-emerald-100 text-emerald-700", figure: "text-emerald-700",
    box: "border-emerald-200/80 bg-emerald-50/70", accent: "bg-emerald-400",
    icon: "✓", caption: "text-emerald-800/60",
  },
};

/**
 * CPR-FUP-003 s12's FIVE PATHWAY CARDS.
 *
 * ⚠ KEYED ON PATHWAY_CARD_SHAPE'S OWN KEYS, and asserted equal to them by the pathways harness for the
 * same reason as above. Like the follow-up five, these were a borrowed-key indirection in the page:
 * "Completed" read `resultsToReview` because that entry happens to be sky.
 *
 * THE HUES:
 *   active     indigo  -- the practice's primary. The plans that are running, which is what this screen
 *                         is for. QUEUE_SWATCH.IN_CONSULTATION and CARE_CARD_SWATCH.inConsultation are
 *                         the same token, so the practice's live-work hue is one colour everywhere.
 *   patients   violet  -- people. This product's violet, on every screen that counts them.
 *   on_track   emerald -- the only unambiguously good figure on the row.
 *   overdue    rose    -- the only FAILURE state, and the only one whose cost falls outside the room.
 *   completed  sky     -- finished, and neither good news nor bad. DELIBERATELY NOT EMERALD: on_track
 *                         owns green on this row, and two greens would rank nothing while looking like
 *                         they ranked something.
 */
export const PATHWAY_CARD_SWATCH: Record<string, CardSwatch> = {
  active: {
    badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", figure: "text-[var(--cp-primary-deep)]",
    box: "border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.06]", accent: "bg-[var(--cp-primary)]",
    icon: "⁂", caption: "text-[var(--cp-primary-deep)]/60",
  },
  patients: {
    badge: "bg-violet-100 text-violet-700", figure: "text-violet-700",
    box: "border-violet-200/80 bg-violet-50/70", accent: "bg-violet-400",
    icon: "☺", caption: "text-violet-800/60",
  },
  on_track: {
    badge: "bg-emerald-100 text-emerald-700", figure: "text-emerald-700",
    box: "border-emerald-200/80 bg-emerald-50/70", accent: "bg-emerald-400",
    icon: "✓", caption: "text-emerald-800/60",
  },
  overdue: {
    badge: "bg-rose-100 text-rose-700", figure: "text-rose-700",
    box: "border-rose-300 bg-rose-50", accent: "bg-rose-500",
    icon: "!", caption: "text-rose-800/60",
  },
  completed: {
    badge: "bg-sky-100 text-sky-700", figure: "text-sky-700",
    box: "border-sky-200/80 bg-sky-50/70", accent: "bg-sky-400",
    icon: "▦", caption: "text-sky-800/60",
  },
};

/** The register's Journey Snapshot glyphs -- encounters and procedures, the two figures that are real. */
export const JOURNEY_ICON = { encounters: "▤", procedures: "✚" } as const;

/**
 * The eight quick actions of CPR-PAT-002 s7.
 *
 * Cycled hues rather than semantic ones: none of the eight ranks above another, and eight identical grey
 * buttons is the failure this file exists to stop. The disabled treatment is separate and is grey on
 * purpose -- an action you cannot take must not look like one you can.
 */
export const ACTION_SWATCH: Record<string, { badge: string; icon: string }> = {
  new_patient: { badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", icon: "☺" },
  walk_in: { badge: "bg-violet-100 text-violet-700", icon: "⚇" },
  open_encounter: { badge: "bg-emerald-100 text-emerald-700", icon: "✎" },
  upload_document: { badge: "bg-sky-100 text-sky-700", icon: "▤" },
  schedule_follow_up: { badge: "bg-cyan-100 text-cyan-700", icon: "↻" },
  print_summary: { badge: "bg-amber-100 text-amber-700", icon: "⎙" },
  merge_duplicate: { badge: "bg-rose-100 text-rose-700", icon: "⇄" },
  import_patients: { badge: "bg-slate-100 text-slate-500", icon: "⇪" },
};

export const ACTION_DISABLED = "bg-slate-100 text-slate-400";

/**
 * The status chip in the My Patients table, and in the summary panel's header.
 *
 * ⚠ RED IS SPENT ONLY ON `overdue`. The comp colours five states and it is tempting to make each one
 * loud; the discipline recorded on the command centre applies here too -- a red that appears on an
 * ordinary row teaches people to stop seeing red, and takes the one row that matters down with it.
 * "Active" and "New patient" are ordinary facts about a person and are drawn as such.
 */
// ⚠ KEYED ON COHORT_STATUS_LABELS' OWN CODES, NOT ON THE COMP'S LABELS. My first version of this used
// the words the design shows -- "Follow-up Due", "Active", "New Patient" -- and NONE of them is a status
// this engine emits. Every chip would have fallen through to the grey default while compiling perfectly:
// the exact key-mismatch that has already shipped twice here (PERFORMANCE_SWATCH keyed avg_consult
// against average_consult_time, GLANCE_SWATCH walk_ins against walk_in), both times rendering real
// figures in dead grey with nothing to show anything was wrong. The harness now asserts the two maps
// have identical keys.
export const PATIENT_STATUS_SWATCH: Record<string, string> = {
  // Somebody is in the room with a clinician right now. The loudest state, and the shortest-lived.
  in_consultation: "bg-violet-100 text-violet-700 ring-1 ring-violet-200",
  // In the building, not yet seen. Amber is this product's waiting hue everywhere else.
  waiting: "bg-amber-100 text-amber-700 ring-1 ring-amber-200",
  // A consultation record left open. Not an emergency, but it is unfinished work with a name on it.
  encounter_open: "bg-sky-100 text-sky-700 ring-1 ring-sky-200",
  seen: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200",
  registered_not_seen: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  // Archived and merged are not states to draw the eye; they explain why a record looks unusual.
  archived: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
  merged: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
};

/**
 * The summary panel's Key Information cards -- the comp's four tinted boxes.
 *
 * Each is a different KIND of fact, which is the whole reason they are coloured differently: when they
 * were four grey boxes the practitioner had to read all four to find the one that was a problem.
 */
export const KEY_INFO_SWATCH: Record<string, { box: string; label: string; figure: string }> = {
  last_seen: { box: "border-emerald-200 bg-emerald-50/60", label: "text-emerald-700/70", figure: "text-emerald-800" },
  next_follow_up: { box: "border-emerald-200 bg-emerald-50/60", label: "text-emerald-700/70", figure: "text-emerald-800" },
  pending_results: { box: "border-sky-200 bg-sky-50/60", label: "text-sky-700/70", figure: "text-sky-800" },
  active_problems: { box: "border-rose-200 bg-rose-50/60", label: "text-rose-700/70", figure: "text-rose-800" },
  // The fallback, and it must stay grey: an unknown card type wearing a borrowed hue would be a claim
  // about a fact nobody classified.
  neutral: { box: "border-slate-200 bg-slate-50/60", label: "text-slate-500", figure: "text-slate-700" },
};

/** s6's five lenses. Overdue is the only red one, because it is the only one that is a failure. */
export const LENS_SWATCH: Record<string, { figure: string; box: string }> = {
  due_today: { figure: "text-[var(--cp-primary-deep)]", box: "border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/5" },
  overdue: { figure: "text-rose-700", box: "border-rose-300 bg-rose-50" },
  waiting_results: { figure: "text-amber-700", box: "border-amber-200 bg-amber-50/60" },
  booked: { figure: "text-sky-700", box: "border-sky-200 bg-sky-50/60" },
  completed: { figure: "text-emerald-700", box: "border-emerald-200 bg-emerald-50/60" },
};

/** Queue states. Amber is CPR-300's "warning" hue, reused rather than re-chosen. */
export const QUEUE_SWATCH: Record<string, { dot: string; chip: string }> = {
  WAITING: { dot: "bg-amber-500", chip: "bg-amber-100 text-amber-800" },
  READY: { dot: "bg-emerald-500", chip: "bg-emerald-100 text-emerald-800" },
  IN_CONSULTATION: { dot: "bg-[var(--cp-primary)]", chip: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]" },
  PAUSED: { dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600" },
};

/** Quick access tiles, cycled so a row of eight does not read as one grey block. */
export const QUICK_SWATCH = [
  "bg-violet-50 text-violet-700 border-violet-200",
  "bg-amber-50 text-amber-700 border-amber-200",
  "bg-emerald-50 text-emerald-700 border-emerald-200",
  "bg-[var(--cp-primary)]/8 text-[var(--cp-primary-deep)] border-[var(--cp-primary)]/25",
  "bg-cyan-50 text-cyan-700 border-cyan-200",
  "bg-rose-50 text-rose-700 border-rose-200",
  "bg-sky-50 text-sky-700 border-sky-200",
  "bg-teal-50 text-teal-700 border-teal-200",
];

export const QUICK_ICON: Record<string, string> = {
  new_patient: "☺", walk_in: "⏱", start_encounter: "✎", book: "▤",
  calendar: "▦", letter: "✉", procedure: "✚", task: "☑",
};

/** Performance figures. Cyan for time, indigo for a count -- the comp's own split. */
// ⚠ KEYED BY metrics.ts's MetricKey, and it was not. These read `avg_consult` / `avg_wait` while the
// command centre stopped passing command-centre.ts's own keys and started passing the metric engine's
// (`average_consult_time` / `average_wait_time`) -- so two of the four figures silently fell back to
// plain grey. A missing swatch is invisible in a diff and obvious only to whoever is scanning the row.
//
// This is the SECOND time this exact mismatch has shipped: GLANCE_SWATCH had `walk_ins` against the
// metric key `walk_in`. There is now an assertion for both.
export const PERFORMANCE_SWATCH: Record<string, string> = {
  patients_seen: "text-[var(--cp-primary-deep)]",
  average_consult_time: "text-emerald-700",
  average_wait_time: "text-cyan-700",
  clinic_delay: "text-amber-700",
};

/** Severity, shared with CPR-300's attention list so one concept has one colour. */
export const SEVERITY: Record<string, { text: string; dot: string; border: string }> = {
  critical: { text: "text-rose-700", dot: "bg-rose-500", border: "border-rose-300" },
  warning: { text: "text-amber-700", dot: "bg-amber-500", border: "border-amber-300" },
  normal: { text: "text-slate-700", dot: "bg-emerald-500", border: "border-slate-200" },
};

// ────────────────────────────────────────────────────────────────────────────────────────────────────
// SHARED WITH THE CALENDAR AND PATIENT REGISTRATION (CPR-CAL-001 v4, CPR-REG-002 v4).
//
// Both comps use the SAME system as the command centre, so it is the same file rather than three
// near-identical ones that drift. The specification asks for exactly this ("Consistent visual language
// with Calendar and Patient Registration" -- CPR-001_v4 Design Goals).
//
// THE APPOINTMENT TYPE COLOURS ALREADY EXISTED and were barely used. APPOINTMENT_KINDS has carried a
// hue per type since CPR-CAL-001 -- indigo for a new patient, sky for a follow-up, amber for a hospital
// consult, cyan for telemedicine, green for a walk-in, red for an emergency -- and the calendar spent
// it on a 2px dot. The comp spends it on the whole card: a tinted background and a left accent bar, so
// a day can be read as a pattern of colour before any text is read. That is the difference between the
// two screens, and it is not a new palette.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A tinted card in a type's own colour.
 *
 * Built with color-mix off the SAME token the dot uses, so a type can never end up with a card in one
 * hue and a chip in another -- the failure mode of writing the tints out by hand.
 */
export function tintedCard(colour: string): CSSProperties {
  return {
    background: `color-mix(in srgb, ${colour} 7%, white)`,
    borderColor: `color-mix(in srgb, ${colour} 22%, white)`,
    borderLeftColor: colour,
  };
}

/** The chip that names the type, in the same hue as its card. */
export function tintedChip(colour: string): CSSProperties {
  return { background: `color-mix(in srgb, ${colour} 13%, white)`, color: colour };
}

/** A figure rendered in its own type's colour -- the comp's "18 Booked · 4 Follow-ups · 3 New" row. */
export function tintedFigure(colour: string): CSSProperties {
  return { color: colour };
}

/**
 * Registration's numbered steps.
 *
 * DONE AND CURRENT ARE DIFFERENT, and the comp draws them differently: a filled indigo circle for where
 * you are, a lighter filled one for what you have finished, an outline for what is still ahead. Three
 * states, because collapsing done into ahead loses the only progress signal the form has.
 */
export const STEP_STATE = {
  done: "bg-[var(--cp-primary)]/15 text-[var(--cp-primary-deep)] ring-1 ring-[var(--cp-primary)]/30",
  current: "bg-[var(--cp-primary)] text-white ring-2 ring-[var(--cp-primary)]/25",
  ahead: "bg-white text-slate-400 ring-1 ring-slate-200",
} as const;

/** Registration section headers: a small tinted icon, as the comp draws Identity / Contact / Photo. */
export const SECTION_BADGE: Record<string, { icon: string; badge: string }> = {
  identity: { icon: "☺", badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]" },
  contact: { icon: "✆", badge: "bg-cyan-100 text-cyan-700" },
  guardian: { icon: "⚇", badge: "bg-violet-100 text-violet-700" },
  visit: { icon: "▤", badge: "bg-amber-100 text-amber-700" },
  identifiers: { icon: "▦", badge: "bg-emerald-100 text-emerald-700" },
  photo: { icon: "◉", badge: "bg-rose-100 text-rose-700" },
  custom: { icon: "✦", badge: "bg-slate-100 text-slate-600" },
};

/** The registration stat strip: four tinted tiles, the comp's hues. */
export const REG_STAT_SWATCH: Record<string, { badge: string; figure: string }> = {
  walk_ins: { badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", figure: "text-[var(--cp-primary-deep)]" },
  registrations: { badge: "bg-violet-100 text-violet-700", figure: "text-violet-700" },
  followups: { badge: "bg-emerald-100 text-emerald-700", figure: "text-emerald-700" },
  total: { badge: "bg-cyan-100 text-cyan-700", figure: "text-cyan-700" },
  drafts: { badge: "bg-amber-100 text-amber-700", figure: "text-amber-700" },
};

/**
 * Buttons.
 *
 * TWO PRIMARY ACTIONS, TWO COLOURS, because the comp has two and they are not the same act: "Register &
 * Queue" puts somebody in today's clinic, "Register Only" files a record. Rendering both in one hue
 * makes the more consequential of the two a coin toss.
 */
export const BUTTON = {
  primary: "bg-[var(--cp-primary)] text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50",
  secondaryAction: "bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50",
  quiet: "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50",
  danger: "border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-50",
} as const;

/* ══ CPR-PI-001: the Practice Intelligence suite's swatches ══════════════════════════════════════
 *
 * ⚠ THESE LIVED IN intelligence-constants.ts BECAUSE THIS FILE WAS BEING WRITTEN BY SOMEBODY ELSE
 * AT THE TIME, not because a suite deserves its own colour system. Leaving them there is how two
 * screens come to disagree about what amber means -- the specific failure this file exists to
 * prevent, and the one a local TINT map in WorklistTiles.tsx had already caused once.
 *
 * Every hue below is one this file already uses for the same meaning: rose for the only item whose
 * cost falls on somebody outside the room, amber for waiting, sky for arrived-and-unread, violet
 * for unplanned work, emerald for settled.
 */
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


/* == CPR-V5-007 / V5-008: the Setup and Availability swatches ======================================
 *
 * WARNING: THESE LIVED IN THEIR FEATURE'S CONSTANTS FILE BECAUSE THIS ONE WAS BEING WRITTEN BY SOMEBODY
 * ELSE AT THE TIME -- three agents built against palette.ts in parallel and none could hold it. Each
 * left a note saying the swatches belonged here. They do, and this is that move.
 *
 * The reason is not tidiness. A local colour table is how two screens come to disagree about what amber
 * means, which has already happened once in this codebase: a private TINT map in WorklistTiles.tsx said
 * violet was "registered, not yet seen" while everywhere else violet was the walk-in. One definition or
 * the disagreement is only a matter of time.
 *
 * Every hue below is one this file already carries for the same meaning: rose for the figure that is
 * about a person, amber for waiting, emerald for settled, slate for context that must never pull the eye.
 */
/**
 * CPR-V5-008's three domains.
 *
 *   foundation      emerald -- who you are and where you work. Settled facts, and the only domain whose
 *                              completion is unambiguously good news. palette.ts's growth hue.
 *   operations      indigo  -- the practice's primary. How the practice RUNS day to day, which is the
 *                              live-work hue everywhere else in this product.
 *   administration  violet  -- people and systems around the clinical work. palette.ts's hue for the
 *                              unplanned and the organisational.
 */
export const SETUP_DOMAIN_SWATCH: Record<string, CardSwatch> = {
  foundation: {
    badge: "bg-emerald-100 text-emerald-700", figure: "text-emerald-700",
    box: "border-emerald-200/80 bg-emerald-50/70", accent: "bg-emerald-400",
    icon: "⌂", caption: "text-emerald-800/70",
  },
  operations: {
    badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", figure: "text-[var(--cp-primary-deep)]",
    box: "border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.06]", accent: "bg-[var(--cp-primary)]",
    icon: "▦", caption: "text-[var(--cp-primary-deep)]/70",
  },
  administration: {
    badge: "bg-violet-100 text-violet-700", figure: "text-violet-700",
    box: "border-violet-200/80 bg-violet-50/70", accent: "bg-violet-400",
    icon: "⚇", caption: "text-violet-800/70",
  },
};

/**
 * s7's four progress states, plus the two this build needs and s7 does not have.
 *
 * ⚠ `unreadable` IS NOT A DESIGN ADDITION, IT IS THE FIRST DOCTRINE. A domain whose configuration could
 * not be read is not a domain with nothing in it, and drawing it as NOT STARTED would tell somebody to
 * go and configure something that may already be configured. Slate, dashed, and it says so.
 * `unavailable` is the same distinction for a domain whose every module this caller may not open.
 */
export const DOMAIN_STATE_CHIP: Record<string, { label: string; chip: string; dot: string }> = {
  complete: { label: "Complete", chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  in_progress: { label: "In progress", chip: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", dot: "bg-[var(--cp-primary)]" },
  needs_attention: { label: "Needs attention", chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  not_started: { label: "Not started", chip: "bg-slate-100 text-slate-600", dot: "bg-slate-300" },
  unreadable: { label: "Could not be read", chip: "bg-slate-100 text-slate-500 ring-1 ring-dashed ring-slate-300", dot: "bg-slate-300" },
  unavailable: { label: "Not yours to change", chip: "bg-slate-100 text-slate-500", dot: "bg-slate-300" },
};

/** Module chips on the domain cards. The setup hub's four states plus the read failure. */
export const MODULE_STATE_CHIP: Record<string, { label: string; chip: string; dot: string; mark: string }> = {
  configured: { label: "Configured", chip: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", mark: "✓" },
  needs_attention: { label: "Needs attention", chip: "bg-amber-100 text-amber-700", dot: "bg-amber-500", mark: "!" },
  not_built: { label: "Not built", chip: "bg-slate-100 text-slate-500", dot: "bg-slate-300", mark: "–" },
  no_access: { label: "No access", chip: "bg-slate-100 text-slate-400", dot: "bg-slate-300", mark: "⚿" },
  unreadable: { label: "Could not be read", chip: "bg-slate-100 text-slate-500", dot: "bg-slate-300", mark: "?" },
};

/**
 * s7's four readiness indicators.
 *
 * Emerald when met and slate when not -- deliberately NOT amber. An unmet readiness indicator is a
 * statement of where the practice has got to, not a fault; amber would make "you have not published a
 * booking page" read as a problem for a practitioner who never intends to.
 */
export const READINESS_SWATCH = {
  met: { ring: "text-emerald-600", label: "text-emerald-900", mark: "✓" },
  unmet: { ring: "text-slate-300", label: "text-slate-600", mark: "○" },
  unreadable: { ring: "text-slate-300", label: "text-slate-500", mark: "?" },
} as const;

/** The three layer cards of CPR-V5-007 s3.2, numbered as the specification numbers them. */
export const LAYER_SWATCH: Record<string, CardSwatch> = {
  regular_practice: {
    badge: "bg-emerald-100 text-emerald-700", figure: "text-emerald-700",
    box: "border-emerald-200/80 bg-emerald-50/70", accent: "bg-emerald-400",
    icon: "▤", caption: "text-emerald-800/70",
  },
  changes: {
    badge: "bg-amber-100 text-amber-700", figure: "text-amber-700",
    box: "border-amber-200/80 bg-amber-50/70", accent: "bg-amber-400",
    icon: "⚑", caption: "text-amber-800/70",
  },
  patient_booking: {
    badge: "bg-violet-100 text-violet-700", figure: "text-violet-700",
    box: "border-violet-200/80 bg-violet-50/70", accent: "bg-violet-400",
    icon: "⚭", caption: "text-violet-800/70",
  },
};

/** Layer 1's four summary figures, in the comp's order and hues. */
export const LAYER1_STAT_SWATCH: Record<string, { badge: string; figure: string; icon: string }> = {
  locations: { badge: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", figure: "text-[var(--cp-primary-deep)]", icon: "◎" },
  sessions: { badge: "bg-cyan-100 text-cyan-700", figure: "text-cyan-700", icon: "▦" },
  appointment_types: { badge: "bg-violet-100 text-violet-700", figure: "text-violet-700", icon: "⚭" },
  capacity: { badge: "bg-amber-100 text-amber-700", figure: "text-amber-700", icon: "☰" },
};

/**
 * Session cards on the weekly board, coloured BY ACTIVITY TYPE rather than by column.
 *
 * The comp's legend reads "Outpatient Clinic · Inpatient · Virtual · Procedure · Day off" -- five
 * colours over what a session IS, which is the only thing on that board worth a colour. Colouring by
 * weekday would make Monday green because it is first.
 */
export const ACTIVITY_HUE: Record<string, string> = {
  outpatient_clinic: "var(--cp-success)",
  ward_round: "var(--cp-area-8)",
  theatre: "var(--cp-accent)",
  emergency_consult: "var(--cp-error)",
  virtual_clinic: "var(--cp-warning)",
  telephone_review: "var(--cp-info)",
  administration: "var(--cp-slate-500)",
  teaching: "var(--cp-info)",
  meeting: "var(--cp-slate-500)",
  research: "var(--cp-info)",
  leave: "var(--cp-warning)",
  travel: "var(--cp-slate-500)",
  custom: "var(--cp-primary)",
};

/** A session nobody has typed yet. Grey, and it must stay grey: it is an absence, not a kind of work. */
export const ACTIVITY_HUE_UNSET = "var(--cp-slate-400)";

/**
 * Layer 2's summary figures.
 *
 *   changes    amber   -- the layer's own hue in LAYER_SWATCH. A change is not a fault, it is a change.
 *   affected   rose    -- people who may be about to lose an appointment. The only figure on this screen
 *                         that is about a person rather than a date, and it is the one that must be
 *                         found rather than read.
 *   pending    violet  -- decided to park. palette.ts's hue for the unplanned and the organisational.
 *   unreviewed slate   -- ⚠ NEVER GREEN AND NEVER NOUGHT. An unreviewed change is an open question, and
 *                         a green tick here would be the screen answering it on the practitioner's
 *                         behalf. Slate and dashed, like every other "could not be read" in this product.
 */
export const LAYER2_STAT_SWATCH: Record<string, CardSwatch> = {
  changes: {
    badge: "bg-amber-100 text-amber-700", figure: "text-amber-700",
    box: "border-amber-200/80 bg-amber-50/70", accent: "bg-amber-400",
    icon: "⚑", caption: "text-amber-800/70",
  },
  affected: {
    badge: "bg-rose-100 text-rose-700", figure: "text-rose-700",
    box: "border-rose-200/80 bg-rose-50/70", accent: "bg-rose-400",
    icon: "☎", caption: "text-rose-800/70",
  },
  pending: {
    badge: "bg-violet-100 text-violet-700", figure: "text-violet-700",
    box: "border-violet-200/80 bg-violet-50/70", accent: "bg-violet-400",
    icon: "⧗", caption: "text-violet-800/70",
  },
  unreviewed: {
    badge: "bg-slate-100 text-slate-500", figure: "text-slate-600",
    box: "border-slate-300 bg-slate-50/80", accent: "bg-slate-300",
    icon: "?", caption: "text-slate-500",
  },
};

/** The chip on an exception row. Three states, and the third is not the second. */
export const IMPACT_STATE_CHIP: Record<string, { label: string; chip: string; dot: string }> = {
  clear: { label: "Nobody affected", chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  pending: { label: "Patients to decide", chip: "bg-rose-100 text-rose-800", dot: "bg-rose-500" },
  settled: { label: "All decided", chip: "bg-[var(--cp-primary)]/12 text-[var(--cp-primary-deep)]", dot: "bg-[var(--cp-primary)]" },
  // ⚠ NOT "nobody affected". Those are different answers and only one of them is safe.
  unreviewed: { label: "Impact not reviewed", chip: "bg-slate-100 text-slate-600 ring-1 ring-slate-300", dot: "bg-slate-400" },
  unreadable: { label: "Could not be read", chip: "bg-slate-100 text-slate-500 ring-1 ring-slate-300", dot: "bg-slate-300" },
};

/**
 * CP-BOOKED-SEEN-001 s9 -- the one appointment-status palette, shared by the planner and the
 * Booked & seen workspace.
 *
 * ⚠ COLOUR SUPPLEMENTS TEXT, IT NEVER REPLACES IT. The spec says "Text always visible" on every row of
 * its own table, and s17 repeats it: "Status meaning must not rely on colour alone." Every caller
 * renders the word beside the swatch.
 *
 * ⚠ CANCELLED IS GREY, NOT RED. s9 asks for grey for cancelled and a MUTED RED for no-show, and the
 * distinction is the point: a cancelled appointment is an ordinary administrative fact, a no-show is
 * the one worth noticing. They were the same rose here, which flattened that.
 */
export const APPOINTMENT_STATUS_SWATCH: Record<string, string> = {
  REQUESTED: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-indigo-100 text-indigo-700",
  ARRIVED: "bg-emerald-100 text-emerald-700",
  COMPLETED: "bg-slate-100 text-slate-600",
  CANCELLED: "bg-gray-100 text-gray-500",
  NO_SHOW: "bg-rose-50 text-rose-600",
};

/** Encounter states on the Seen tab. s7: an encounter is not a booking and is not styled as one. */
export const ENCOUNTER_STATUS_SWATCH: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-800",
  ACTIVE: "bg-indigo-100 text-indigo-700",
  PAUSED: "bg-amber-100 text-amber-800",
  SIGNED: "bg-emerald-100 text-emerald-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
};
