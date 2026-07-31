// Harness for the Platform Design System (PUI-001) + the accessibility floor (PUI-005).
//
// A token system's whole value is that there is ONE copy of each value. This proves it:
//   - globals.css is not stale relative to tokens.ts (regeneration is a no-op)
//   - every declared token reaches the stylesheet
//   - the spec's stated values are actually the ones shipped (hex, type scale, 8pt grid, radius, elevation)
//   - contrast: primary and every semantic colour meet WCAG 2.1 AA against their intended background
//   - PUI-005 floor is present in CSS: focus-visible ring, reduced-motion, skip link, touch target, sr-only
//   - clinical status colours are distinct from each other (status must be distinguishable, and is never
//     carried by colour alone — the pairing rule is enforced in components, the distinctness here)
//   npx --yes tsx scripts/pui-tokens-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

// WCAG relative luminance + contrast ratio.
const srgb = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

async function main() {
  const t = await import("../src/lib/design/tokens");
  const { renderBlock } = await import("./gen-design-tokens");
  const cssPath = path.join(process.cwd(), "src", "app", "globals.css");
  const css = fs.readFileSync(cssPath, "utf8");

  // ── 1. Source of truth: the stylesheet is generated, current, and complete ──
  const block = renderBlock(t.cssVariables(), t.font.family);
  check(css.includes(block), "globals.css matches tokens.ts exactly (regeneration is a no-op)",
    css.includes(block) ? "" : "run: npx tsx scripts/gen-design-tokens.ts");

  const vars = t.cssVariables();
  const missing = Object.keys(vars).filter(k => !css.includes(`${k}:`));
  check(missing.length === 0, "every declared token reaches the stylesheet",
    missing.length ? missing.slice(0, 5).join(", ") : `${Object.keys(vars).length} properties`);

  const badHex = Object.entries(vars).filter(([k, v]) => /color|clinical|neutral/.test(k) && !/^#[0-9A-Fa-f]{6}$/.test(v));
  check(badHex.length === 0, "every colour token is a valid 6-digit hex", badHex.map(([k]) => k).join(", "));

  // ── 2. The values the spec states are the values shipped ──
  check(t.color.primary.base === "#0A7C59", "primary brand colour is Competen Green #0A7C59", t.color.primary.base);
  check(t.color.semantic.critical === "#DC2626" && t.color.semantic.warning === "#F59E0B",
    "semantic critical/warning match the spec");
  check(t.font.family.startsWith("Inter"), "Inter is the primary font family");
  check(t.font.scale.h1.size === 32 && t.font.scale.h1.lineHeight === 40 && t.font.scale.h1.weight === 700,
    "H1 is 32/40/700 as specified");
  check(t.font.scale.body.size === 14 && t.font.scale.bodyLarge.size === 16,
    "body 14px, body-large 16px");
  check(t.a11y.baseFontSize === 16, "base font size is 16px (PUI-005)");

  // 8-point grid: every step past the 4px half-step is a multiple of 8.
  const offGrid = t.space.filter(n => n % 4 !== 0 || (n >= 16 && n % 8 !== 0));
  check(offGrid.length === 0, "spacing is an 8-point grid above 16px, with 4/12 as the fine steps",
    offGrid.length ? `off-grid: ${offGrid.join(", ")}` : t.space.join(" "));
  check(t.space[0] === 4 && t.space[t.space.length - 1] === 96, "spacing runs 4 -> 96");
  check(t.radius.sm === 4 && t.radius.md === 8 && t.radius.lg === 12 && t.radius.xl === 16 && t.radius.pill === 24,
    "radius scale is 4/8/12/16/24");
  check(t.elevation[0] === "none" && /rgba\(0,0,0,0\.16\)/.test(t.elevation[4]),
    "elevation runs from none to level 4");
  check(t.grid.columns === 12 && t.grid.maxWidth === 1440 && t.grid.gutter === 24,
    "12-column grid, 1440 max, 24px gutter");

  // Breakpoints must tile without gap or overlap.
  check(t.breakpoint.mobile.max + 1 === t.breakpoint.tablet.min && t.breakpoint.tablet.max + 1 === t.breakpoint.desktop.min,
    "breakpoints tile with no gap or overlap",
    `mobile<=${t.breakpoint.mobile.max} tablet ${t.breakpoint.tablet.min}-${t.breakpoint.tablet.max} desktop>=${t.breakpoint.desktop.min}`);

  // ── 3. Contrast (PUI-001 s3 "WCAG-compliant", PUI-005 4.5:1 / 3:1) ──
  const white = "#FFFFFF";
  const cPrimary = contrast(t.color.primary.base, white);
  check(cPrimary >= 4.5, "primary on white meets AA for normal text (4.5:1)", `${cPrimary}:1`);
  const cPrimaryDark = contrast(t.color.primary.dark, white);
  check(cPrimaryDark >= 4.5, "primary-dark on white meets AA", `${cPrimaryDark}:1`);
  const onPrimary = contrast(white, t.color.primary.base);
  check(onPrimary >= 4.5, "white text on the primary button meets AA", `${onPrimary}:1`);

  // WCAG 1.4.11: a graphical object that carries meaning needs 3:1. Two of the specified fills do not clear
  // it on white, so they are NOT icon-safe and components must render those meanings with the text tone
  // instead. That constraint is asserted here by name: if the palette changes, this tells whoever changed it
  // which meanings became (or stopped being) safe as a standalone mark.
  const ICON_UNSAFE = ["information", "warning"];
  for (const [name, hex] of Object.entries(t.color.semantic)) {
    const c = contrast(hex, white);
    const safe = c >= 3;
    if (ICON_UNSAFE.includes(name)) {
      check(!safe, `semantic ${name} fill is KNOWN not icon-safe on white — components must use the text tone`, `${c}:1 (<3:1)`);
    } else {
      check(safe, `semantic ${name} fill is icon-safe on white (3:1)`, `${c}:1`);
    }
  }
  // Whatever the fill can't do, the text tone can — so every meaning has at least one icon-safe rendering.
  const noSafeRendering = Object.keys(t.color.semantic).filter(name => {
    const fill = contrast((t.color.semantic as any)[name], white);
    const text = contrast((t.color.semanticText as any)[name], white);
    return fill < 3 && text < 3;
  });
  check(noSafeRendering.length === 0, "every semantic meaning has at least one icon-safe rendering on white",
    noSafeRendering.length ? noSafeRendering.join(", ") : "all six");
  // FILL vs TEXT is the resolution of the spec's internal conflict (see tokens.ts semanticText).
  // Fills are asserted to still equal the SPECIFIED values — the palette was not quietly altered.
  const specFills: Record<string, string> = { success: "#16A34A", information: "#0EA5E9", warning: "#F59E0B", error: "#EF4444", critical: "#DC2626", neutral: "#64748B" };
  const drifted = Object.entries(specFills).filter(([k, v]) => (t.color.semantic as any)[k] !== v);
  check(drifted.length === 0, "semantic FILLS still equal the values PUI-001 specifies (palette not silently altered)",
    drifted.length ? drifted.map(([k]) => k).join(", ") : "all six unchanged");
  // ...and every TEXT tone clears the 4.5:1 body-text floor.
  for (const [name, hex] of Object.entries(t.color.semanticText)) {
    const c = contrast(hex as string, white);
    check(c >= 4.5, `text tone ${name} clears 4.5:1 for body text on white`, `${c}:1`);
  }
  const sameKeys = Object.keys(t.color.semantic).join() === Object.keys(t.color.semanticText).join();
  check(sameKeys, "every semantic meaning has a text-safe counterpart");

  // ── 4. Clinical status colours must be tellable apart ──
  const clinical = Object.entries(t.color.clinical);
  const tooClose: string[] = [];
  for (let i = 0; i < clinical.length; i++) {
    for (let j = i + 1; j < clinical.length; j++) {
      const [an, ah] = clinical[i], [bn, bh] = clinical[j];
      if (ah === bh) tooClose.push(`${an}==${bn}`);
    }
  }
  check(tooClose.length === 0, "no two clinical statuses share a colour", tooClose.join(", "));
  check(t.clinicalColor("critical") === "#DC2626", "clinicalColor() resolves a known status");
  check(t.clinicalColor("nonsense") === t.color.clinical.discharged,
    "clinicalColor() falls back to a neutral rather than throwing");

  // ── 5. PUI-006 priority table ──
  const prios = Object.entries(t.priority);
  check(prios.length === 4, "four priority levels", prios.map(([k]) => k).join(" > "));
  check(t.priority.critical.requiresAck && t.priority.high.requiresAck,
    "critical and high REQUIRE acknowledgement");
  check(!t.priority.medium.requiresAck && !t.priority.low.requiresAck,
    "medium and low do not");
  check(/persistent/i.test(t.priority.critical.behaviour),
    "critical is persistent until acknowledged", t.priority.critical.behaviour);
  check(prios.every(([, v]) => !!v.icon), "every priority carries an ICON, so it is never colour-alone");
  const order = prios.map(([, v]) => v.order);
  check(order.join() === [...order].sort((a, b) => a - b).join(), "priority order is monotonic");

  // ── 6. PUI-005 floor is actually present in the stylesheet ──
  check(/:focus-visible\s*\{[^}]*outline:\s*var\(--cmp-focus-width\)/.test(css.replace(/\n/g, " ")),
    "a visible focus ring is defined for interactive elements");
  check(css.includes("prefers-reduced-motion"), "prefers-reduced-motion is respected");
  check(css.includes(".cmp-skip-link"), "a skip-to-content link class exists");
  check(css.includes("[data-touch-target]") && css.includes("--cmp-touch-min"),
    "a 44px touch-target utility exists");
  check(css.includes(".cmp-sr-only"), "a screen-reader-only utility exists");
  check(t.a11y.minTouchTarget === 44 && t.a11y.focusRingWidth === 2,
    "touch target 44px, focus ring 2px");

  // ── 7. The published JSON contract ──
  const json = t.tokensJson();
  for (const key of ["color", "font", "space", "radius", "elevation", "grid", "breakpoint", "a11y", "priority"]) {
    check(key in json, `tokens JSON exposes ${key}`);
  }
  check(JSON.parse(JSON.stringify(json)).color.primary.base === "#0A7C59",
    "tokens JSON round-trips through serialisation");

  console.log(`\n${pass}/${pass + fail} checks passed.`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
