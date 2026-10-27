// ── COMPETEN-DESIGN-SYSTEM-01: HOW EACH PRODUCT PRESENTS ITSELF ────────────────────────────────────────────
//
// One place for the words, icon and theme of each Competen destination, so the login chooser, shells and
// switchers cannot drift. PRESENTATION ONLY: nothing here grants, implies or routes access. Which destinations
// a person may enter is decided by the server (src/lib/identity/product-resolution.ts, COMP-ID-ROUTE-001);
// this file only says how an already-authorised destination looks.
//
// The colour values live in tokens.ts (productTheme); a product here names its theme key and reads them.

import { productTheme, type ProductThemeKey } from "./tokens";

export type ProductIcon = "building" | "person" | "stethoscope" | "book" | "briefcase";
export type ProductPresentation = {
  /** Approved display name. */
  name: string;
  /** What kind of environment this is, shown above the name. */
  role: string;
  /** One sentence: who it is for and what it does. */
  description: string;
  /** The destination action label. */
  action: string;
  icon: ProductIcon;
  theme: ProductThemeKey;
};

// Keyed by the resolver's destination codes, plus the two Individual experiences.
export const PRODUCT_PRESENTATION = {
  platform: {
    name: "Competen Platform", role: "Organisational environment",
    description: "For your organisation's work: teams, competencies, assessments and services across the places you work.",
    action: "Open Competen Platform", icon: "building", theme: "platform",
  },
  practice: {
    name: "Competen Practice", role: "Organisational environment",
    description: "Run your clinic or practice: planner, sessions, patients and payments.",
    action: "Open Competen Practice", icon: "stethoscope", theme: "platform",
  },
  individual: {
    name: "Competen Individual", role: "Personal learning and professional development",
    description: "Your own account for study, development, evidence and your lifelong Competen Passport.",
    action: "Open Competen Individual", icon: "person", theme: "individual",
  },
  scholar: {
    name: "Competen Scholar", role: "Personal learning",
    description: "Study from your own notes, revise and practise clinical reasoning.",
    action: "Open Competen Scholar", icon: "book", theme: "scholar",
  },
  professional: {
    name: "Competen Professional", role: "Professional development",
    description: "Plan your development, keep your CPD and evidence, and share your Passport.",
    action: "Open Competen Professional", icon: "briefcase", theme: "professional",
  },
} as const satisfies Record<string, ProductPresentation>;

export type PresentedProduct = keyof typeof PRODUCT_PRESENTATION;

/** The presentation for a destination code, or a neutral Platform-themed fallback for a code not listed. */
export function presentationFor(code: string): ProductPresentation {
  return (PRODUCT_PRESENTATION as Record<string, ProductPresentation>)[code] ?? PRODUCT_PRESENTATION.platform;
}

/** The hex palette of a theme, for the few consumers that need real colour values (SVG attributes, documents). */
export function themePalette(key: ProductThemeKey) {
  return productTheme[key];
}
