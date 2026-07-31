// Platform Design System (PUI-001) — THE single source of truth for the Competen visual language.
//
// Every value here is mirrored as a CSS custom property in globals.css (`--cmp-*`) by the same names, so a
// token can be consumed from TypeScript (`tokens.color.primary.base`) or from CSS/Tailwind
// (`var(--cmp-color-primary)`), and the two can never drift — scripts/pui-tokens-harness.ts fails if they do.
//
// WHAT THIS DOES NOT DO, stated plainly: defining tokens does not restyle the ~400 pages already written
// against hard-coded Tailwind classes. This is the foundation new and migrated surfaces build on, and the
// reference the rest of the PUI specs (components, dashboards, notifications) are implemented against.
// Migration of existing pages is deliberate and incremental, not a silent big-bang.

// ── 3. Colour system ────────────────────────────────────────────────────────────────────────────────────
export const color = {
  primary: { base: "#0A7C59", dark: "#065E46", light: "#E6F6EF" },
  secondary: { base: "#2563EB", light: "#EAF2FF" },

  // Semantic / functional — meaning, not decoration. These are the values PUI-001 s3 specifies, and they are
  // FILL colours: icon fills, chart series, badge backgrounds, borders, left-edge severity rails.
  semantic: {
    success: "#16A34A",
    information: "#0EA5E9",
    warning: "#F59E0B",
    error: "#EF4444",
    critical: "#DC2626",
    neutral: "#64748B",
  },

  // TEXT-SAFE variants of the same meanings.
  //
  // WHY THIS EXISTS: PUI-001 s3 requires "WCAG-compliant colour contrast" and PUI-005 sets the floor at
  // 4.5:1 for normal text — but three of the specified fills do not clear it on white:
  //     warning     #F59E0B  2.15:1
  //     information #0EA5E9  2.77:1
  //     error       #EF4444  3.76:1
  // The spec's palette and the spec's accessibility requirement genuinely conflict for TEXT. Rather than
  // quietly darken the brand colours (that would change the client's visual language) or quietly lower the
  // bar (that would fake compliance), the fills stay exactly as specified and these AA-passing tones are
  // used wherever the colour carries words. scripts/pui-tokens-harness.ts asserts both halves: the fills
  // still equal the spec, and every text tone clears 4.5:1.
  semanticText: {
    success: "#15803D",
    information: "#0369A1",
    warning: "#B45309",
    error: "#B91C1C",
    critical: "#B91C1C",
    neutral: "#475569",
  },

  // TINTED SURFACES for the same meanings — the wash behind an alert, a status chip, a highlighted row.
  //
  // ADDED BECAUSE THE APP ALREADY HAD THEM, in Tailwind classes, ~4,800 times. The library shipped fills and
  // text tones but no surface, so every page invented its own and the same meaning appears as both
  // emerald-50 and green-50 depending on who wrote it. (It also meant `var(--cmp-surface-success)` written
  // against this library resolved to nothing at all — an undefined custom property is simply dropped, so the
  // element rendered with no background. That was a real defect, not a hypothetical one.)
  //
  // The values are NOT invented: each is the Tailwind tint the app already renders most often for that
  // meaning, so adopting the token preserves what the majority of pages look like today and only converges
  // the minority that chose a neighbouring hue for the same thing.
  surface: {
    success: "#ECFDF5",      // emerald-50
    information: "#EFF6FF",  // blue-50
    warning: "#FFFBEB",      // amber-50
    error: "#FFF1F2",        // rose-50
    critical: "#FEF2F2",     // red-50 — kept distinct from error so a critical wash can diverge later
    neutral: "#F8FAFC",      // slate-50
  },

  // Clinical status. Deliberately SEPARATE from `semantic` even where the hex repeats: a patient being
  // "stable" is not the same fact as an operation "succeeding", and the two scales must be free to diverge.
  // PUI-005 requires status never be conveyed by colour alone — every consumer pairs these with text or icon.
  clinical: {
    stable: "#16A34A",
    moderate: "#F59E0B",
    high: "#EF4444",
    critical: "#DC2626",
    discharged: "#64748B",
    deceased: "#424242",
  },

  // Neutral ramp for surfaces, borders and text.
  neutral: {
    0: "#FFFFFF", 50: "#F8FAFC", 100: "#F1F5F9", 200: "#E2E8F0", 300: "#CBD5E1",
    400: "#94A3B8", 500: "#64748B", 600: "#475569", 700: "#334155", 800: "#1E293B", 900: "#0F172A",
  },
} as const;

// ── 4. Typography ───────────────────────────────────────────────────────────────────────────────────────
// PUI-005: base body size is 16px and the whole scale must survive a 200% browser zoom, so sizes are
// declared in px here for fidelity to the spec and consumed through rem-based Tailwind utilities.
export const font = {
  family: `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`,
  scale: {
    h1:        { size: 32, lineHeight: 40, weight: 700, use: "Page / screen titles" },
    h2:        { size: 24, lineHeight: 32, weight: 600, use: "Section titles" },
    h3:        { size: 20, lineHeight: 28, weight: 600, use: "Card / panel titles" },
    h4:        { size: 16, lineHeight: 24, weight: 600, use: "Subsection titles" },
    bodyLarge: { size: 16, lineHeight: 24, weight: 400, use: "Primary content" },
    body:      { size: 14, lineHeight: 20, weight: 400, use: "Secondary content" },
    caption:   { size: 12, lineHeight: 16, weight: 400, use: "Supporting text" },
    label:     { size: 12, lineHeight: 16, weight: 600, use: "Form labels, tags" },
  },
} as const;

// ── 5. Spacing & layout ─────────────────────────────────────────────────────────────────────────────────
// 8-point grid. 4 is the half-step, kept for dense clinical tables where 8 is too airy.
export const space = [4, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96] as const;

export const radius = { sm: 4, md: 8, lg: 12, xl: 16, pill: 24 } as const;

// Elevation 0-4. Shadows carry hierarchy, never decoration.
export const elevation = {
  0: "none",
  1: "0 1px 2px rgba(0,0,0,0.05)",
  2: "0 4px 12px rgba(0,0,0,0.08)",
  3: "0 8px 24px rgba(0,0,0,0.12)",
  4: "0 16px 48px rgba(0,0,0,0.16)",
} as const;

// ── PUI-003 grid + breakpoints ──────────────────────────────────────────────────────────────────────────
export const grid = { columns: 12, maxWidth: 1440, gutter: 24, container: { desktop: 1140, tablet: 720 } } as const;

// A breakpoint is a RANGE, so tablet styling never leaks onto desktop.
export const breakpoint = {
  mobile:  { min: 0,    max: 767 },
  tablet:  { min: 768,  max: 1199 },
  desktop: { min: 1200, max: null },
} as const;

// ── PUI-005 accessibility constants ─────────────────────────────────────────────────────────────────────
export const a11y = {
  minTouchTarget: 44,        // px, both axes
  focusRingWidth: 2,         // px solid outline, always visible
  contrast: { normalText: 4.5, largeText: 3 },
  baseFontSize: 16,          // px, must scale to 200% without loss of content
  lineHeight: { body: 1.5, heading: 1.2 },
  motion: { enterMs: 200, exitMs: 300 },   // disabled entirely under prefers-reduced-motion
} as const;

// ── PUI-006 notification priority ───────────────────────────────────────────────────────────────────────
// Priority decides colour, delivery, persistence AND whether acknowledgement is required — one table, so a
// notification can never be styled critical while behaving like an FYI.
export const priority = {
  critical: { label: "Critical", color: color.semantic.critical,    icon: "▲", behaviour: "Persistent until acknowledged", requiresAck: true,  order: 0 },
  high:     { label: "High",     color: color.semantic.warning,     icon: "↑", behaviour: "Highlight and notify",          requiresAck: true,  order: 1 },
  medium:   { label: "Medium",   color: "#D97706",                  icon: "⊖", behaviour: "Standard notify",               requiresAck: false, order: 2 },
  low:      { label: "Low",      color: color.semantic.information, icon: "ⓘ", behaviour: "Silent / optional",             requiresAck: false, order: 3 },
} as const;

export type PriorityKey = keyof typeof priority;
export type ClinicalStatus = keyof typeof color.clinical;

// ── Consumption helpers ─────────────────────────────────────────────────────────────────────────────────
export const clinicalColor = (status: string): string =>
  (color.clinical as Record<string, string>)[status] ?? color.clinical.discharged;

// The CSS custom-property name for a token path — the contract the stylesheet mirrors.
export const cssVar = (path: string) => `--cmp-${path.replace(/\./g, "-").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;

// Flat {cssVarName: value} map. globals.css is generated FROM this shape, and the harness compares the two.
export function cssVariables(): Record<string, string> {
  const out: Record<string, string> = {};
  out[cssVar("color.primary")] = color.primary.base;
  out[cssVar("color.primary.dark")] = color.primary.dark;
  out[cssVar("color.primary.light")] = color.primary.light;
  out[cssVar("color.secondary")] = color.secondary.base;
  out[cssVar("color.secondary.light")] = color.secondary.light;
  for (const [k, v] of Object.entries(color.semantic)) out[cssVar(`color.${k}`)] = v;
  for (const [k, v] of Object.entries(color.semanticText)) out[cssVar(`text.${k}`)] = v;
  for (const [k, v] of Object.entries(color.surface)) out[cssVar(`surface.${k}`)] = v;
  for (const [k, v] of Object.entries(color.clinical)) out[cssVar(`clinical.${k}`)] = v;
  for (const [k, v] of Object.entries(color.neutral)) out[cssVar(`neutral.${k}`)] = v;
  for (const [k, v] of Object.entries(font.scale)) {
    out[cssVar(`font.${k}.size`)] = `${v.size}px`;
    out[cssVar(`font.${k}.line`)] = `${v.lineHeight}px`;
    out[cssVar(`font.${k}.weight`)] = String(v.weight);
  }
  space.forEach(n => { out[cssVar(`space.${n}`)] = `${n}px`; });
  for (const [k, v] of Object.entries(radius)) out[cssVar(`radius.${k}`)] = `${v}px`;
  for (const [k, v] of Object.entries(elevation)) out[cssVar(`elevation.${k}`)] = v;
  out[cssVar("focus.width")] = `${a11y.focusRingWidth}px`;
  out[cssVar("touch.min")] = `${a11y.minTouchTarget}px`;
  out[cssVar("grid.max")] = `${grid.maxWidth}px`;
  out[cssVar("grid.gutter")] = `${grid.gutter}px`;
  return out;
}

// PUI-001 s10: "Design tokens ... available as JSON for system use" — served by /api/design/tokens so
// tenant theming and any external consumer read the same values the app renders with.
export function tokensJson() {
  return { color, font, space, radius, elevation, grid, breakpoint, a11y, priority };
}

const tokens = { color, font, space, radius, elevation, grid, breakpoint, a11y, priority, clinicalColor, cssVar, cssVariables, tokensJson };
export default tokens;
