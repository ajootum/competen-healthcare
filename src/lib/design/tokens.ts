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

// ── Product themes (COMPETEN-DESIGN-SYSTEM-01) ─────────────────────────────────────────────────────────
//
// ONE COMPETEN BRAND, FOUR COORDINATED THEMES, not four brands. The master brand (logo, typography, spacing,
// components, the semantic and clinical colours above) is shared; a theme only re-points the ACCENT family.
// Owner-approved values (26 Oct 2026; Scholar refined by HFE-COLOR-02, 27 Oct): Platform emerald, Individual indigo,
// Scholar teal, Professional indigo.
// Scholar and Professional remain experiences inside Individual: a theme never changes identity, entitlement
// or routing. Every accent is text-safe on white (>= 4.5:1, asserted by design-system-themes-harness):
//   platform #064E3B 9.72:1 · individual/professional #4338CA 7.90:1 · scholar #0B7089 5.69:1
// `strong` is the hover/pressed shade, `soft` the tinted background, `border` the tinted outline, `ink` the
// accent used as text on its own soft tint.
export type ProductThemeKey = "platform" | "individual" | "scholar" | "professional";
export const productTheme: Record<ProductThemeKey, { accent: string; strong: string; soft: string; border: string; ink: string; onAccent: string }> = {
  platform:     { accent: "#064E3B", strong: "#043D2E", soft: "#ECF6F2", border: "#A7D7C5", ink: "#064E3B", onAccent: "#FFFFFF" },
  individual:   { accent: "#4338CA", strong: "#3730A3", soft: "#EEF0FD", border: "#C3C7F4", ink: "#3730A3", onAccent: "#FFFFFF" },
  scholar:      { accent: "#0B7089", strong: "#07566B", soft: "#E8F6F9", border: "#A6D6E2", ink: "#07566B", onAccent: "#FFFFFF" },
  professional: { accent: "#4338CA", strong: "#3730A3", soft: "#EEF0FD", border: "#C3C7F4", ink: "#3730A3", onAccent: "#FFFFFF" },
};
export const PRODUCT_THEME_KEYS = Object.keys(productTheme) as ProductThemeKey[];

// ── Shared app surfaces and accent roles (COMPETEN-HFE-COLOR-02, owner-approved 27 Oct 2026) ───────────────
//
// ONE NEUTRAL CANVAS for Platform, Individual, Scholar and Professional: a very light grey page, white headers,
// sidebars and cards, subtle borders. Colour is purposeful (about 85% neutral, 15% accent): the product accent for
// action and navigation, and three ROLE accents used selectively -- revision (amber), progress (green), and indigo.
// ⚠ AMBER IS NOT A TEXT COLOUR. #D97706 is 3.19:1 on white and 2.92:1 on its own tint: decoration, large text and
// borders only. Words on the amber tint use `ink` (#92400E, 6.49:1); an amber fill behind white uses `strong`
// (#B45309, 5.02:1). Both are derived shades, recorded in docs/COMPETEN-SCHOLAR-HFE-COLOR-01.md.
export const appSurface = {
  bg: "#F7F8FA", surface: "#FFFFFF", border: "#E2E8F0", text: "#142638", textSecondary: "#475569",
  // #E2E8F0 is 1.23:1 on white: right for card edges and dividers, too faint to identify a form field (WCAG 1.4.11
  // asks 3:1). A field's edge uses controlBorder, a derived slate (3.51:1 on white, 3.30:1 on the page).
  controlBorder: "#7A8B99",
} as const;
export const accentRole = {
  revision: { accent: "#D97706", strong: "#B45309", ink: "#92400E", soft: "#FFF4DC" },
  progress: { accent: "#15803D", strong: "#166534", ink: "#166534", soft: "#ECFDF5" },
  indigo:   { accent: "#4338CA", strong: "#3730A3", ink: "#3730A3", soft: "#EEF0FD" },
} as const;
export type AccentRole = keyof typeof accentRole;
// Scholar's learning spaces, each an icon tint on a soft chip (an icon, never the only label). Teal is the product
// accent (core study and action); amber marks revision, green progress, indigo reasoning and evaluation.
export const activityRole = { plan: "scholar", library: "scholar", learn: "scholar", revise: "revision", apply: "indigo", evaluate: "indigo", progress: "progress" } as const;
export type ActivityKey = keyof typeof activityRole;

// ── Scholar learning design system (owner directive 4 Nov 2026, docs/design/SCHOLAR-LEARNING-DESIGN-SYSTEM.md) ──────
//
// ONE SEMANTIC COLOUR IDENTITY PER LEARNING ACTIVITY, shared by every Scholar learning stage (Learn first; Revise, Apply,
// Evaluate and My Plan adopt the same tones). Named by what the content IS, never by page. Each tone has four roles:
//   surface  the soft background of its section     border  the quiet edge
//   accent   icons and the SELECTED edge (>= 3:1 on its surface, on a white card and on the page: WCAG 1.4.11)
//   ink      headings, labels and filled controls (>= 4.5:1 on its surface and on white: WCAG 1.4.3)
// Colour is identity, never meaning: every use also has a heading in words and an icon. None is a correctness or a
// clinical-review colour -- no tone may be used to imply that AI content was clinically checked. The answer callouts
// (caution, key, summary, memory, example, record) share the set; caution keeps the strongest safety styling, memory
// (the Memory aid) has its own rose identity apart from ai-beyond sky and quick-check lilac.
// Dark values are staged: they apply under [data-cmp-scheme="dark"] (re-pointed by the generator), which no shell sets yet.
// Every pair is asserted by src/lib/design/scholar-learning-tokens.test.ts.
export type LearningToneRoles = { surface: string; border: string; accent: string; ink: string };
export const learningTone = {
  teach:      { light: { surface: "#F2F8EF", border: "#C9DFBF", accent: "#3E7B37", ink: "#24521F" }, dark: { surface: "#16241A", border: "#3F6B3A", accent: "#8FCB84", ink: "#C4E8BC" } },
  check:      { light: { surface: "#F6F3FD", border: "#D9CFF4", accent: "#6A4FC4", ink: "#45309A" }, dark: { surface: "#1E1A33", border: "#5B4A9A", accent: "#B7A6F2", ink: "#DCD3FB" } },
  aiBeyond:   { light: { surface: "#EEF6FC", border: "#C3DDF1", accent: "#1F6FA8", ink: "#154E78" }, dark: { surface: "#12222F", border: "#2F5E82", accent: "#8CC4EC", ink: "#CBE5F7" } },
  explain:    { light: { surface: "#EFF8F1", border: "#BCE0C4", accent: "#2E7D45", ink: "#1D5A30" }, dark: { surface: "#14261A", border: "#3A7049", accent: "#86D09C", ink: "#C3EBCD" } },
  guide:      { light: { surface: "#EFF4FD", border: "#C3D6F4", accent: "#2F63C4", ink: "#1E4691" }, dark: { surface: "#151F33", border: "#3B5B97", accent: "#9DBBF2", ink: "#D2E0FA" } },
  challenge:  { light: { surface: "#F5F1FD", border: "#D6CAF5", accent: "#6D46C7", ink: "#4A2C96" }, dark: { surface: "#201833", border: "#5E4699", accent: "#BFA8F3", ink: "#E0D5FB" } },
  practice:   { light: { surface: "#EDF7F6", border: "#BCDFDB", accent: "#1B7A73", ink: "#11564F" }, dark: { surface: "#12262A", border: "#2F6E69", accent: "#7FD0C7", ink: "#C2EDE8" } },
  quickCheck: { light: { surface: "#F9F2FB", border: "#E3CDEE", accent: "#8A43A8", ink: "#632C7B" }, dark: { surface: "#26182C", border: "#74488A", accent: "#DDA9F0", ink: "#F0D8F8" } },
  notes:      { light: { surface: "#FCF9F0", border: "#E7DCBF", accent: "#8A6A1F", ink: "#5E4712" }, dark: { surface: "#262013", border: "#6E5A2A", accent: "#E0C27A", ink: "#F2E3BC" } },
  sources:    { light: { surface: "#F6F6FA", border: "#D9D9E6", accent: "#5A5B7A", ink: "#3D3E58" }, dark: { surface: "#1C1D2A", border: "#4E5070", accent: "#B4B6D6", ink: "#DADBF0" } },
  next:       { light: { surface: "#EBF8FB", border: "#A9DDE8", accent: "#0E7490", ink: "#155E75" }, dark: { surface: "#0F252B", border: "#2F7A8F", accent: "#8FD3E4", ink: "#CDEEF6" } },
  memory:     { light: { surface: "#FDF0F4", border: "#F0C3D2", accent: "#B5345E", ink: "#86203F" }, dark: { surface: "#2B1520", border: "#8A3B58", accent: "#F4A3BE", ink: "#FBD5E2" } },
  caution:    { light: { surface: "#FFF5E1", border: "#E9B872", accent: "#B45309", ink: "#7C2D12" }, dark: { surface: "#2E1F0B", border: "#A86412", accent: "#F5B860", ink: "#FCE0B4" } },
  key:        { light: { surface: "#E8F6F9", border: "#A6D6E2", accent: "#0B7089", ink: "#07566B" }, dark: { surface: "#0E2A33", border: "#2F7A8F", accent: "#8FD3E4", ink: "#CDEEF6" } },
  example:    { light: { surface: "#ECFAF3", border: "#A9E0C5", accent: "#047857", ink: "#065F46" }, dark: { surface: "#0F2A20", border: "#2E7A5C", accent: "#7FDCB4", ink: "#C6F2DE" } },
  record:     { light: { surface: "#EEF0FD", border: "#C3C7F4", accent: "#4338CA", ink: "#3730A3" }, dark: { surface: "#1B1C3A", border: "#4B4FA8", accent: "#AAB0F5", ink: "#D9DCFC" } },
  summary:    { light: { surface: "#F3F5F8", border: "#C6CFD8", accent: "#526273", ink: "#1F2D3A" }, dark: { surface: "#1A222C", border: "#4C5A68", accent: "#B4C0CC", ink: "#E1E7ED" } },
} as const satisfies Record<string, { light: LearningToneRoles; dark: LearningToneRoles }>;
export type LearningTone = keyof typeof learningTone;
export const LEARNING_TONES = Object.keys(learningTone) as LearningTone[];
/** The text and page colours a learning tone sits with (light: appSurface; dark: the staged Scholar dark canvas). */
export const learningCanvas = {
  light: { page: appSurface.bg, card: appSurface.surface, text: appSurface.text, textSecondary: appSurface.textSecondary },
  dark: { page: "#0F1722", card: "#172033", text: "#E8EEF4", textSecondary: "#BFCBDA" },
} as const;

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
  // Product theme palettes, by product, then the ACTIVE theme (`--cmp-theme-*`), which defaults to Platform and
  // is re-pointed by `[data-cmp-theme="<key>"]` (themeCss below). Components read only `--cmp-theme-*`.
  for (const [p, v] of Object.entries(productTheme)) for (const [k, c] of Object.entries(v)) out[cssVar(`product.${p}.${k}`)] = c;
  for (const k of Object.keys(productTheme.platform)) out[cssVar(`theme.${k}`)] = `var(${cssVar(`product.platform.${k}`)})`;
  // HFE-COLOR-02: the shared canvas (--cmp-app-*), the role accents (--cmp-role-<role>-*) and Scholar's activity cues.
  for (const [k, c] of Object.entries(appSurface)) out[cssVar(`app.${k}`)] = c;
  for (const [r, v] of Object.entries(accentRole)) for (const [k, c] of Object.entries(v)) out[cssVar(`role.${r}.${k}`)] = c;
  for (const [a, r] of Object.entries(activityRole)) {
    const p = r === "scholar" ? productTheme.scholar : accentRole[r];
    out[cssVar(`activity.${a}.icon`)] = r === "revision" ? accentRole.revision.strong : p.accent;
    out[cssVar(`activity.${a}.chip`)] = p.soft;
  }
  // Scholar learning tones: the light palette (--cmp-learn-<tone>-<role>) and the staged dark palette
  // (--cmp-learn-dark-<tone>-<role>). The generator derives `.cmp-learn-<tone>` (the --learn-* roles a component reads)
  // and the [data-cmp-scheme="dark"] re-pointing from these, the way it derives the product theme rules.
  for (const [t, v] of Object.entries(learningTone)) {
    for (const [k, c] of Object.entries(v.light)) out[cssVar(`learn.${t}.${k}`)] = c;
    for (const [k, c] of Object.entries(v.dark)) out[cssVar(`learn.dark.${t}.${k}`)] = c;
  }
  return out;
}

/** The `[data-cmp-theme]` selectors, for consumers outside globals.css (the generator derives the same rules from cssVariables). */
export function themeCss(): string {
  return PRODUCT_THEME_KEYS.map(p => `[data-cmp-theme="${p}"] {\n${Object.keys(productTheme[p]).map(k => `  ${cssVar(`theme.${k}`)}: var(${cssVar(`product.${p}.${k}`)});`).join("\n")}\n}`).join("\n");
}

// PUI-001 s10: "Design tokens ... available as JSON for system use" — served by /api/design/tokens so
// tenant theming and any external consumer read the same values the app renders with.
export function tokensJson() {
  return { color, font, space, radius, elevation, grid, breakpoint, a11y, priority, productTheme, appSurface, accentRole, learningTone };
}

const tokens = { color, font, space, radius, elevation, grid, breakpoint, a11y, priority, productTheme, appSurface, accentRole, learningTone, clinicalColor, cssVar, cssVariables, themeCss, tokensJson };
export default tokens;
