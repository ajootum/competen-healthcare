// The four kinds of mark on the study calendar. Kept apart from study-calendar.ts so the calendar component can use them
// without bundling the planner (SCHOLAR-MONTHLY-REVIEW-01).

export type CalendarKind = "planned" | "due_revision" | "completed" | "monthly_review";
/** The words and glyphs of the four kinds. The glyph is decoration (aria-hidden) beside the word, which always shows. */
export const CALENDAR_KIND: Record<CalendarKind, { word: string; glyph: string }> = {
  planned: { word: "Planned", glyph: "▤" },
  due_revision: { word: "Cards due", glyph: "↻" },
  completed: { word: "Done", glyph: "✓" },
  monthly_review: { word: "Monthly review", glyph: "★" },
};
/** How far ahead the plan is laid on the calendar, and the furthest a move may go either way. */
export const CALENDAR_REACH_DAYS = 60;
