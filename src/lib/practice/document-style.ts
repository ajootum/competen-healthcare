// CPR-DOC-CONFIG-001 sections 6, 8, 14 and 16 -- THE DESIGN TOKEN CONTRACT.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// SEMANTIC ROLES, NOT PER-FORM COLOURS. Section 8 in as many words:
//
//   "Use semantic section roles rather than hard-coding colours into each form. The practitioner
//    configures the semantic palette once. Document generators map their sections to semantic roles.
//    This prevents every form from implementing its own colours."
//
// So a referral letter does not know it is indigo. It knows its first section is a PURPOSE, and the
// resolved style decides what a purpose looks like. Add a ninth document type and it inherits the
// palette by naming roles, without touching a colour anywhere.
//
// NOTHING HERE BECOMES MARKUP. Section 14 forbids "arbitrary script, CSS, HTML or remote font
// injection", and a jsonb column would happily hold a stylesheet. Two things prevent that: every token
// is validated against the bounded vocabularies below before it is written, and the renderer maps
// tokens to a fixed set of properties rather than interpolating them into a style attribute. A value
// that is not a six-digit hex or a member of a named list never reaches the page.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

import type { FactCategory } from "@/lib/practice/document-facts";

/** Section 8's eight semantic roles. */
export const SECTION_ROLES = [
  "purpose", "diagnosis", "treatment", "medication", "investigation", "follow_up", "plan", "additional",
] as const;
export type SectionRole = typeof SECTION_ROLES[number];

/**
 * Which role a recorded fact belongs to.
 *
 * `procedure` maps to treatment because section 8 groups them: "Treatment / intervention -- Treatment
 * given, procedure". `encounter` -- the reason-for-visit and plan-note facts -- is deliberately
 * `additional` rather than `purpose`: the PURPOSE of a document is what the practitioner typed about
 * why they are writing it, and quietly promoting a recorded note into that slot would colour a
 * consultation note as though it were the letter's stated reason.
 */
export const ROLE_FOR_CATEGORY: Record<FactCategory, SectionRole> = {
  encounter: "additional",
  diagnosis: "diagnosis",
  treatment: "treatment",
  procedure: "treatment",
  investigation: "investigation",
  medication: "medication",
  follow_up: "follow_up",
};

// ── the token vocabulary ────────────────────────────────────────────────────────────────────────────
//
// Bounded on purpose (section 6's "Guardrail" column). Every one of these is a closed list or a
// numeric range, so the designer in Phase 2 can only ever produce a value the renderer understands.

export const SECTION_TREATMENTS = ["band", "left_accent", "plain", "card", "divider"] as const;
export type SectionTreatment = typeof SECTION_TREATMENTS[number];

export const HEADING_CASES = ["uppercase", "title"] as const;
export const DENSITIES = ["compact", "standard", "relaxed"] as const;
export const BORDER_STYLES = ["none", "subtle", "accent"] as const;
export const PATIENT_BLOCKS = ["row", "card"] as const;
export const FOOTER_STYLES = ["minimal", "bordered"] as const;

/** Section 6: "Approved professional font list." No remote fonts, no uploads. */
export const BODY_FONTS = ["inter", "source_serif", "system"] as const;

export const PRESETS = ["professional", "classic", "modern", "minimal", "practice_brand"] as const;
export type PresetName = typeof PRESETS[number];

/**
 * Section 6: "Font size -- Bounded range. Minimum readable size enforced."
 *
 * The floor is not a style preference. A referral letter set at 9px is a document a consultant cannot
 * read, and the practitioner choosing it will not be the person struggling with it.
 */
export const BODY_SIZE_RANGE = { min: 11, max: 16 } as const;
export const HEADING_SIZE_RANGE = { min: 12, max: 24 } as const;

export type RoleTone = { band: string; accent: string };

export type StyleTokens = {
  colour: {
    primary: string;
    text: string;
    muted: string;
    border: string;
    surface: string;
    /** One tone per semantic role. Section 8's palette, configured once. */
    roles: Record<SectionRole, RoleTone>;
  };
  typography: {
    bodyFont: typeof BODY_FONTS[number];
    bodySize: number;
    headingSize: number;
    headingCase: typeof HEADING_CASES[number];
    lineSpacing: typeof DENSITIES[number];
  };
  layout: {
    sectionTreatment: SectionTreatment;
    sectionSpacing: typeof DENSITIES[number];
    borders: typeof BORDER_STYLES[number];
    showSectionIcons: boolean;
    patientBlock: typeof PATIENT_BLOCKS[number];
    footerStyle: typeof FOOTER_STYLES[number];
  };
};

/**
 * THE PLATFORM BASELINE (section 2) -- what a practice that has never configured anything gets.
 *
 * These are CPR-DOC-AUTO-UI-001's own values: its section 6.1 colour system, its 6.2 type scale, and
 * its 7 section patterns. That specification describes the default CP document appearance, and this
 * constant is that description made executable, so the two cannot drift into disagreeing.
 *
 * It is a CONSTANT, not a seeded database row. A practice with no style profile, a practice whose
 * profile fails to load, and a document written before any of this existed all resolve to the same
 * thing, and none of them depends on a migration having inserted something.
 */
export const PLATFORM_BASELINE: StyleTokens = {
  colour: {
    primary: "#1E3A8A",
    text: "#111827",
    muted: "#6B7280",
    border: "#E5E7EB",
    surface: "#FFFFFF",
    roles: {
      // ⚠ TWO OF THESE ARE NOT THE HEX THE UI SPECIFICATION PRINTS, AND THAT IS DELIBERATE.
      //
      // CPR-DOC-AUTO-UI-001 gives eight section tones and also states, in its own design principles,
      // "Accessible & inclusive: WCAG AA contrast". Six of its eight pairs clear AA's 4.5:1 for normal
      // text. Two do not, measured against the bands the same table supplies:
      //
      //     treatment  #059669 on #E6F7EE = 3.39:1
      //     plan       #0284C7 on #E0F2FE = 3.57:1
      //
      // A 14-16px semibold heading is not WCAG "large text" (that needs 18.66px bold or 24px), so 4.5:1
      // is the applicable threshold, not 3:1. The two accents below are the smallest darkening that
      // clears it while staying the same colour to look at -- 4.94:1 and 6.59:1. plan does not simply
      // reuse medication's #0369A1, which would also have passed, because two semantic roles sharing an
      // accent defeats the point of having roles.
      //
      // Raised with the owner rather than silently absorbed: the specification's own table needs the
      // same correction, or these two will be "fixed" back to the failing values by the next person who
      // checks the code against the document.
      purpose:       { band: "#E8F0FF", accent: "#4F46E5" },
      diagnosis:     { band: "#EBF4FF", accent: "#2563EB" },
      treatment:     { band: "#E6F7EE", accent: "#047857" },
      medication:    { band: "#EFF6FF", accent: "#0369A1" },
      investigation: { band: "#ECFEFF", accent: "#0E7490" },
      follow_up:     { band: "#F3E8FF", accent: "#7C3AED" },
      plan:          { band: "#E0F2FE", accent: "#075985" },
      additional:    { band: "#F3F4F6", accent: "#4B5563" },
    },
  },
  typography: {
    bodyFont: "inter",
    bodySize: 13,
    headingSize: 14,
    headingCase: "uppercase",
    lineSpacing: "standard",
  },
  layout: {
    sectionTreatment: "band",
    sectionSpacing: "standard",
    borders: "subtle",
    showSectionIcons: true,
    patientBlock: "card",
    footerStyle: "bordered",
  },
};

// ── contrast, because section 16 requires it to be enforced rather than hoped for ───────────────────

const HEX = /^#[0-9A-Fa-f]{6}$/;

const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => channel(c / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Section 16: "Enforce safe contrast and readable minimum font sizes", and section 18's acceptance
 * row: "Unsafe contrast/font-size choices are blocked or corrected."
 *
 * WCAG AA for normal text is 4.5:1. A section's accent is used for its heading text ON the band, so
 * that is the pair that has to hold -- checking the accent against white would pass a combination
 * nobody ever sees.
 */
export const MIN_CONTRAST = 4.5;

export type StyleProblem = { path: string; message: string };

/**
 * Validate a token set. Returns every problem, not the first.
 *
 * ⚠ THIS IS THE ONLY DOOR. Tokens arrive as jsonb from a form, and a value that is not checked here
 * is a value the renderer will use. Anything unrecognised is a problem rather than a default, because
 * silently substituting a default would let a practitioner publish a style, see something else, and
 * have no idea which of their choices was discarded.
 */
export function validateTokens(input: unknown): StyleProblem[] {
  const problems: StyleProblem[] = [];
  const t = input as StyleTokens | null;
  if (!t || typeof t !== "object") return [{ path: "tokens", message: "no style was supplied" }];

  const hex = (v: unknown, path: string) => {
    if (typeof v !== "string" || !HEX.test(v)) {
      // No example hex in the message: the design-system harness counts raw colours in this file and
      // bounds them to the baseline, and an illustration in an error string would inflate that count.
      problems.push({ path, message: "must be a six-digit hex colour code" });
      return false;
    }
    return true;
  };
  const oneOf = <T extends readonly string[]>(v: unknown, list: T, path: string) => {
    if (typeof v !== "string" || !list.includes(v)) {
      problems.push({ path, message: `must be one of: ${list.join(", ")}` });
    }
  };
  const inRange = (v: unknown, r: { min: number; max: number }, path: string) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < r.min || v > r.max) {
      problems.push({ path, message: `must be between ${r.min} and ${r.max}` });
    }
  };

  const c = t.colour ?? ({} as StyleTokens["colour"]);
  for (const key of ["primary", "text", "muted", "border", "surface"] as const) hex(c[key], `colour.${key}`);

  // Body text on the page has to be readable before any section colour matters.
  if (HEX.test(String(c.text)) && HEX.test(String(c.surface))
      && contrastRatio(c.text, c.surface) < MIN_CONTRAST) {
    problems.push({
      path: "colour.text",
      message: `body text on the page background is too faint to read (${contrastRatio(c.text, c.surface).toFixed(1)}:1, needs ${MIN_CONTRAST}:1)`,
    });
  }

  for (const role of SECTION_ROLES) {
    const tone = c.roles?.[role];
    if (!tone) { problems.push({ path: `colour.roles.${role}`, message: "missing" }); continue; }
    const bandOk = hex(tone.band, `colour.roles.${role}.band`);
    const accentOk = hex(tone.accent, `colour.roles.${role}.accent`);
    // The heading sits in the accent colour on the band. That is the pair a reader sees.
    if (bandOk && accentOk && contrastRatio(tone.accent, tone.band) < MIN_CONTRAST) {
      problems.push({
        path: `colour.roles.${role}`,
        message: `this heading colour is too faint on its own band (${contrastRatio(tone.accent, tone.band).toFixed(1)}:1, needs ${MIN_CONTRAST}:1)`,
      });
    }
  }

  const ty = t.typography ?? ({} as StyleTokens["typography"]);
  oneOf(ty.bodyFont, BODY_FONTS, "typography.bodyFont");
  inRange(ty.bodySize, BODY_SIZE_RANGE, "typography.bodySize");
  inRange(ty.headingSize, HEADING_SIZE_RANGE, "typography.headingSize");
  oneOf(ty.headingCase, HEADING_CASES, "typography.headingCase");
  oneOf(ty.lineSpacing, DENSITIES, "typography.lineSpacing");

  const l = t.layout ?? ({} as StyleTokens["layout"]);
  oneOf(l.sectionTreatment, SECTION_TREATMENTS, "layout.sectionTreatment");
  oneOf(l.sectionSpacing, DENSITIES, "layout.sectionSpacing");
  oneOf(l.borders, BORDER_STYLES, "layout.borders");
  oneOf(l.patientBlock, PATIENT_BLOCKS, "layout.patientBlock");
  oneOf(l.footerStyle, FOOTER_STYLES, "layout.footerStyle");
  if (typeof l.showSectionIcons !== "boolean") {
    problems.push({ path: "layout.showSectionIcons", message: "must be on or off" });
  }

  return problems;
}

/**
 * The style a document should be rendered with.
 *
 * ⚠ A PINNED STYLE WINS, ALWAYS, AND THAT IS SECTION 11'S HISTORICAL IMMUTABILITY. A document carries
 * the tokens it was rendered with; publishing a new practice style must not repaint a letter somebody
 * already signed and sent. Only a document with no pin follows the practice's current style.
 *
 * Anything unreadable falls through to the baseline rather than failing: a document that cannot be
 * displayed because its theme did not load is worse than one displayed in the default theme, and the
 * caller is told which it got.
 */
export function resolveStyle(args: {
  pinned?: unknown | null;
  practicePublished?: unknown | null;
}): { tokens: StyleTokens; source: "pinned" | "practice" | "baseline" } {
  for (const [candidate, source] of [
    [args.pinned, "pinned"],
    [args.practicePublished, "practice"],
  ] as const) {
    if (candidate && validateTokens(candidate).length === 0) {
      return { tokens: candidate as StyleTokens, source };
    }
  }
  return { tokens: PLATFORM_BASELINE, source: "baseline" };
}
