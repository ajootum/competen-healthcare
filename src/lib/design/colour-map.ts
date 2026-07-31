// Tailwind semantic colour -> design token mapping (PUI colour migration).
//
// MAPPED BY ROLE, NOT BY HUE. The library deliberately keeps three scales for the same six meanings:
// `semantic` fills, `semanticText` tones that clear 4.5:1, and `surface` tints. So `text-amber-600` and
// `bg-amber-50` do NOT map to the same token — one carries words and one is a wash behind them. A naive
// hue-to-hue table would put a 3.35:1 fill on body text and call it a migration.
//
// WHY THIS IS WORTH DOING TO THOUSANDS OF SITES: most of the text classes in use today FAIL the contrast
// floor PUI-005 sets. amber-600 is 3.35:1, emerald-600 is 3.55:1, sky-600 is 3.61:1 — all below 4.5:1 for
// normal text. The token tones pass. The migration is therefore an accessibility fix that happens to also
// unify the palette, rather than a tidy-up that happens to change colours.
//
// Everything here is data. scripts/pui-colour-harness.ts computes the real contrast of every source class
// and every target token and refuses any mapping that would make text harder to read.

export type Role = "text" | "bg" | "border";

// Tailwind v3 palette values for the shades this app actually uses.
export const TAILWIND: Record<string, string> = {
  "red-50": "#FEF2F2", "red-100": "#FEE2E2", "red-200": "#FECACA", "red-400": "#F87171",
  "red-500": "#EF4444", "red-600": "#DC2626", "red-700": "#B91C1C", "red-800": "#991B1B", "red-900": "#7F1D1D",
  "rose-50": "#FFF1F2", "rose-100": "#FFE4E6", "rose-200": "#FECDD3", "rose-400": "#FB7185",
  "rose-500": "#F43F5E", "rose-600": "#E11D48", "rose-700": "#BE123C", "rose-800": "#9F1239", "rose-900": "#881337",
  "amber-50": "#FFFBEB", "amber-100": "#FEF3C7", "amber-200": "#FDE68A", "amber-400": "#FBBF24",
  "amber-500": "#F59E0B", "amber-600": "#D97706", "amber-700": "#B45309", "amber-800": "#92400E", "amber-900": "#78350F",
  "yellow-50": "#FEFCE8", "yellow-100": "#FEF9C3", "yellow-200": "#FEF08A", "yellow-400": "#FACC15",
  "yellow-500": "#EAB308", "yellow-600": "#CA8A04", "yellow-700": "#A16207", "yellow-800": "#854D0E", "yellow-900": "#713F12",
  "emerald-50": "#ECFDF5", "emerald-100": "#D1FAE5", "emerald-200": "#A7F3D0", "emerald-400": "#34D399",
  "emerald-500": "#10B981", "emerald-600": "#059669", "emerald-700": "#047857", "emerald-800": "#065F46", "emerald-900": "#064E3B",
  "green-50": "#F0FDF4", "green-100": "#DCFCE7", "green-200": "#BBF7D0", "green-400": "#4ADE80",
  "green-500": "#22C55E", "green-600": "#16A34A", "green-700": "#15803D", "green-800": "#166534", "green-900": "#14532D",
  "sky-50": "#F0F9FF", "sky-100": "#E0F2FE", "sky-200": "#BAE6FD", "sky-400": "#38BDF8",
  "sky-500": "#0EA5E9", "sky-600": "#0284C7", "sky-700": "#0369A1", "sky-800": "#075985", "sky-900": "#0C4A6E",
  "blue-50": "#EFF6FF", "blue-100": "#DBEAFE", "blue-200": "#BFDBFE", "blue-400": "#60A5FA",
  "blue-500": "#3B82F6", "blue-600": "#2563EB", "blue-700": "#1D4ED8", "blue-800": "#1E40AF", "blue-900": "#1E3A8A",
  "orange-50": "#FFF7ED", "orange-100": "#FFEDD5", "orange-200": "#FED7AA", "orange-400": "#FB923C",
  "orange-500": "#F97316", "orange-600": "#EA580C", "orange-700": "#C2410C", "orange-800": "#9A3412", "orange-900": "#7C2D12",
};

// The text tones, restated here so the mapping can measure against them without importing the whole token
// module into a file the codemod also loads. pui-colour-harness.ts asserts these equal tokens.semanticText,
// so the two cannot drift apart.
export const SEMANTIC_TEXT: Record<string, string> = {
  success: "#15803D", information: "#0369A1", warning: "#B45309",
  error: "#B91C1C", critical: "#B91C1C", neutral: "#475569",
};

// Which meaning each hue carries in this app.
export const HUE_MEANING: Record<string, string> = {
  red: "critical", rose: "error", amber: "warning", yellow: "warning", orange: "warning",
  emerald: "success", green: "success", sky: "information", blue: "information",
};

// A class only migrates when the role and shade band agree on a token:
//   text-*  at 600..700   -> the AA-passing text tone
//
// THE TEXT BAND STOPS AT 700 BECAUSE THE HARNESS CAUGHT IT. My first version ran to 900, and the contrast
// check refused it: amber-900 is 9.07:1 on white and the warning tone is 5.02:1, so "migrating" those 484
// sites would have made deliberately dark text measurably HARDER to read while reporting a tidier palette.
// A shade at 800 or 900 is someone choosing emphasis, not reaching for a semantic tone.
//   bg-*    at 50..100    -> the tinted surface
//   bg-*    at 400..600   -> the fill (a solid status chip, not a wash)
//   border-*at 100..300   -> the fill, which is what a border is
// Anything outside those bands is LEFT ALONE. A bg-amber-800 is a deliberate dark panel, not a warning
// wash, and guessing at it would be the kind of silent restyle this migration is trying to avoid.
export function tokenFor(role: Role, hue: string, shade: number): string | null {
  const meaning = HUE_MEANING[hue];
  if (!meaning) return null;
  if (role === "text") {
    if (shade < 600 || shade > 700) return null;
    // THE BAND IS NOT ENOUGH, so the rule is MEASURED rather than guessed. Even inside 600..700 some
    // classes are already darker than the token — emerald-700 is 5.48:1 against the success tone's 5.02:1.
    // Migrating those would trade real readability for a tidier palette, so the mapping is defined by the
    // measurement: a text class converts only when the token is at least as readable as what is there now.
    const from = TAILWIND[`${hue}-${shade}`];
    const to = SEMANTIC_TEXT[meaning];
    if (!from || !to) return null;
    return contrast(to, "#FFFFFF") >= contrast(from, "#FFFFFF") ? `--cmp-text-${meaning}` : null;
  }
  if (role === "border") return shade >= 100 && shade <= 300 ? `--cmp-color-${meaning}` : null;
  if (shade <= 100) return `--cmp-surface-${meaning}`;
  if (shade >= 400 && shade <= 600) return `--cmp-color-${meaning}`;
  return null;
}

// ── Contrast, for the harness ────────────────────────────────────────────────
const srgb = (h: string) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
};
export const luminance = (hex: string) => { const [r, g, b] = srgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export function contrast(a: string, b: string): number {
  const l1 = luminance(a), l2 = luminance(b);
  return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
}
