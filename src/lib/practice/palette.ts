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
export const PERFORMANCE_SWATCH: Record<string, string> = {
  patients_seen: "text-[var(--cp-primary-deep)]",
  avg_consult: "text-emerald-700",
  avg_wait: "text-cyan-700",
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
