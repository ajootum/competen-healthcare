// ── COMPETEN-SCHOLAR-HFE-COLOR-01: WHICH SCHOLAR THEME A VIEWER SEES ──────────────────────────────────────
//
// The Calm Teal + Warm Learning Accents variant (tokens.ts scholarVariant.calm) is a REVIEWABLE candidate. It must not
// replace the approved Scholar theme for everyone until the owner approves it after comparison, so:
//   policy "current" (default)  -> everyone sees the approved theme; a stored choice is ignored; nothing is offered.
//   policy "preview"            -> the approved theme by default; a learner may choose Calm Teal in Settings.
//   policy "calm"               -> Calm Teal by default; a learner may still choose the approved theme.
// The learner's choice is a browser cookie: a presentation preference, never a record, permission or entitlement.
// The result is only ever a data attribute ([data-cmp-scholar]) on the Individual app wrapper.

import type { ScholarThemePolicy } from "@/lib/individual/policy";

export const SCHOLAR_THEME_COOKIE = "cmp_scholar_theme";
export type ScholarThemeChoice = "current" | "calm";

const isChoice = (v: unknown): v is ScholarThemeChoice => v === "current" || v === "calm";

/** Pure: the theme a viewer sees, from the published policy and their own stored choice (if any). */
export function resolveScholarTheme(policy: ScholarThemePolicy, stored: string | null | undefined): ScholarThemeChoice {
  if (policy !== "preview" && policy !== "calm") return "current";
  if (isChoice(stored)) return stored;
  return policy === "calm" ? "calm" : "current";
}

/** Pure: whether a learner is offered the choice in Settings. */
export const scholarThemeOffered = (policy: ScholarThemePolicy) => policy === "preview" || policy === "calm";
