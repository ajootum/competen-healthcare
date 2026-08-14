// CPR-HFE-TRT-004 s11 -- THE RIGHT-RAIL HIERARCHY.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE DEFECT THIS FIXES: EIGHT CARDS OF EQUAL WEIGHT.
//
// Every panel in the encounter rail was the same object -- `rounded-xl border border-gray-200 bg-white
// p-4` with a `text-[13px] font-bold` heading. Patient safety, the encounter's start time, the audit
// trail of status transitions and a tray of shortcut buttons all shouted at exactly the same volume, so
// the rail carried no priority at all and a practitioner had to READ it to find anything. s11 assigns
// four tiers, and s14 requires the whole rail to be "visibly secondary to the active Treatment
// workspace".
//
//   HIGHEST   Patient safety                        strongest heading + status treatment
//   MEDIUM    Procedures in this encounter          compact context card, rows easy to scan
//   LOWER     Encounter context, Previous visits,   reduced padding and contrast
//             Encounter timeline
//   UTILITY   Quick actions                         compact tray, neutral buttons
//
// ⚠ THE TIERS ARE SEPARATED BY MORE THAN ONE PROPERTY. Border weight alone would vanish at high zoom;
// colour alone would fail s13 for a colour-blind reader. Each step down changes surface, border,
// padding AND heading size together, so the ordering survives greyscale, zoom and a narrow laptop.
//
// ⚠ AND NOTHING HERE OUT-SHOUTS THE WORK BAND. s3 gives band 4 "the strongest active boundary", and
// TreatmentCapture spends the only 2px border on the page there. The rail's top tier is therefore a
// DARKER 1px border and a larger heading, never a heavier one -- a rail that competed with the active
// task would invert the whole point of s14.
//
// ⚠ WHY THIS FILE IMPORTS NOTHING. page.tsx and ContextPanel are server components; EncounterConsole is
// `"use client"`. All three need these strings. A constants module that reached for anything else would
// drag a server chain into the browser bundle -- the trap that tsc and eslint both pass and only
// `next build` catches.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The rail's ground. s6: "Right rail cards: white on pale neutral rail."
 *
 * ⚠ THE RAIL BACKGROUND IS THE HALF THAT MAKES "SECONDARY" TRUE (s14). Without it, a white card on a
 * white page is the same visual object as a white card in the record band, and the rail reads as more
 * primary content sitting to the right. On a pale ground the cards become contents OF something, and
 * the eye treats the column as context.
 */
export const RAIL = "rounded-2xl bg-slate-100/60 p-3 ring-1 ring-slate-200/70";

/** HIGHEST -- Patient safety. s7: "one predictable visual anchor" for patient-level safety. */
export const RAIL_PRIMARY = "rounded-xl border border-slate-300 bg-white p-4 shadow-sm";
export const RAIL_PRIMARY_H = "text-[14px] font-bold tracking-tight text-gray-900";

/** MEDIUM -- Procedures in this encounter. */
export const RAIL_MEDIUM = "rounded-xl border border-gray-200 bg-white p-3.5";
export const RAIL_MEDIUM_H = "text-[13px] font-bold text-gray-900";

/** LOWER -- Encounter context, Previous visits, Encounter timeline. s11: reduced padding/contrast. */
export const RAIL_LOW = "rounded-xl border border-slate-200/80 bg-white/70 p-3";
export const RAIL_LOW_H = "text-[12px] font-semibold text-gray-600";

/** UTILITY -- Quick actions. s11: "compact grid/tray; neutral buttons except destructive/critical". */
export const RAIL_UTILITY = "rounded-xl border border-slate-200/80 bg-white/60 p-3";
export const RAIL_UTILITY_H = "text-[11px] font-bold uppercase tracking-[0.06em] text-gray-500";

/**
 * ⚠ THE SUPPORTING-TEXT FLOOR, AND IT IS AN ACCESSIBILITY FIX RATHER THAN A STYLE CHOICE.
 *
 * The rail was full of `text-[10px] text-gray-400`: procedure times, transition timestamps, the note
 * about the audit log. gray-400 on white measures about 2.8:1, which fails WCAG AA for body text at any
 * size, and 10px is below what s13 will accept -- "avoid very small helper text EVEN WHEN reducing
 * visual prominence". gray-500 at 11px measures about 4.6:1 and passes.
 *
 * Prominence is reduced by the TIER instead: a lower-contrast surface, a lighter border and a quieter
 * heading. That is the s11-legal way to make something secondary. Shrinking the text until it cannot be
 * read is not, and it fails the people who need the timestamps most.
 */
export const RAIL_META = "text-[11px] text-gray-500";
