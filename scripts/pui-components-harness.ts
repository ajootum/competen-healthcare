// Harness for the Platform Component Library (PUI-004) + the interaction rules it must enforce.
//
// A component library earns its keep by making the right thing automatic. These checks assert the two rules
// that would otherwise depend on every future author remembering them:
//
//   1. STATUS IS NEVER COLOUR ALONE (PUI-001 s8 / PUI-005). Every status component must render a word or an
//      icon, and must not offer a prop to suppress it.
//   2. FILL vs TEXT (PUI-001). Colour that carries words must use the AA-passing text tone. A component
//      styling text with a raw semantic FILL would put 2.15:1 amber on white.
//
// Plus: no hard-coded hex (tokens exist so there is one copy), server/client split is deliberate, and the
// clinical components derive bands from the SHIPPED instrument engine instead of a private copy.
//   npx --yes tsx scripts/pui-components-harness.ts

import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

const UI = path.join(process.cwd(), "src", "components", "ui");
const read = (f: string) => fs.readFileSync(path.join(UI, f), "utf8");

async function main() {
  const primitives = read("primitives.tsx");
  const clinical = read("clinical.tsx");
  const interactive = read("interactive.tsx");
  const all = `${primitives}\n${clinical}\n${interactive}`;

  // ── 1. Server/client split is deliberate ──
  check(!primitives.startsWith('"use client"'), "primitives are SERVER-component safe (pages stay server components)");
  check(!clinical.startsWith('"use client"'), "clinical components are server-component safe");
  check(interactive.startsWith('"use client"'), "only genuinely interactive components are client components");

  // ── 2. No hard-coded colour: tokens are the single copy ──
  // Tailwind palette utilities (bg-green-50) are allowed as tints; raw hex in component source is not,
  // because that is a second copy of a value tokens.ts already owns.
  const hexes = [...all.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map(m => m[0]);
  check(hexes.length === 0, "no hard-coded hex in any component", hexes.length ? [...new Set(hexes)].join(", ") : "tokens only");
  check((all.match(/var\(--cmp-/g) ?? []).length >= 20, "components read design tokens through CSS custom properties",
    `${(all.match(/var\(--cmp-/g) ?? []).length} token references`);

  // ── 3. Colour that carries WORDS uses the text tone, never the fill ──
  // Any `color:` styling must reference --cmp-text-* (or a neutral), not --cmp-color-* semantic fills.
  const colourStyles = [...all.matchAll(/color:\s*`?var\(--cmp-([a-z-]+)/g)].map(m => m[1]);
  const fillsAsText = colourStyles.filter(v => /^color-(success|information|warning|error|critical)/.test(v));
  check(fillsAsText.length === 0, "no component styles TEXT with a semantic fill tone",
    fillsAsText.length ? fillsAsText.join(", ") : `${colourStyles.length} colour declarations, all text-safe`);

  // The badge/alert tone tables must map every tone to a text-safe class.
  const toneText = [...primitives.matchAll(/text-\[color:var\(--cmp-([a-z-]+)\)\]/g)].map(m => m[1]);
  const badToneText = toneText.filter(v => !v.startsWith("text-") && !v.startsWith("color-primary"));
  check(badToneText.length === 0, "badge tones use text-safe tones for their labels",
    badToneText.length ? badToneText.join(", ") : `${toneText.length} tone mappings`);

  // ── 4. Status components cannot render colour alone ──
  // Each must render children/label text, and none may accept a prop that hides it.
  for (const [name, src] of [["Badge", primitives], ["Chip", primitives], ["AcuityIndicator", clinical],
    ["PewsBadge", clinical], ["LevelBadge", clinical], ["PriorityPill", primitives]] as const) {
    check(src.includes(`export function ${name}`), `${name} exists`);
  }
  check(!/showLabel|hideLabel|labelless|iconOnly/.test(all),
    "no component offers a prop that would hide its status label");
  check(clinical.includes("band.label"), "PEWS/level badges render the band's WORD alongside its colour");
  check(primitives.includes("{p.icon}</span>{p.label}") || /\{p\.icon\}<\/span>\s*\{p\.label\}/.test(primitives),
    "priority pill renders icon AND label");

  // ── 5. Clinical components derive bands from the SHIPPED engine ──
  check(clinical.includes('from "@/lib/hww/instruments"'), "clinical components import the real instrument engine");
  check(clinical.includes("classifyPews("), "PEWS banding uses classifyPews — the same function the write-path uses");
  check(clinical.includes("levelFromBands("), "dependency levels use levelFromBands, not a private threshold table");
  // A private copy would show up as literal band thresholds in the component file.
  const privateThresholds = /score\s*>=\s*\d+\s*\?\s*["'](red|orange|yellow|critical|high)/.test(clinical);
  check(!privateThresholds, "no component re-declares instrument thresholds locally");

  // ── 6. "Not measured" is distinct from zero, everywhere it matters ──
  check(clinical.includes("Not assessed") && clinical.includes("PEWS not assessed"),
    "clinical badges say NOT ASSESSED rather than showing a zero score");
  check(primitives.includes("not measured"), "Progress renders 'not measured' for a null value");
  check(/value != null &&/.test(primitives), "Progress draws NO bar when the value is null — an empty track, not 0%");
  check(clinical.includes("Unassessed is an unknown, not a low score"),
    "the PEWS widget states plainly that unassessed is not a low score");
  check(primitives.includes("export function NotProvisioned"), "a NotProvisioned state exists for absent stores");
  check(primitives.includes("No figures are estimated in its place"), "NotProvisioned promises no estimated figures");

  // ── 7. Accessibility (PUI-005) ──
  check(primitives.includes('role="progressbar"') && primitives.includes("aria-valuetext"),
    "Progress is a labelled progressbar with a text alternative");
  check(primitives.includes('role={a.role}') && /role: "alert"/.test(primitives),
    "error and critical alerts use role=alert; calmer tones use role=status");
  check(interactive.includes('aria-modal="true"'), "dialog and drawer are modal dialogs");
  check(interactive.includes('aria-labelledby="cmp-dialog-title"'), "the dialog is labelled by its own heading");
  check(interactive.includes("restore.current?.focus()"), "dialog and drawer restore focus on close");
  // The trap is written as a guard clause (`if (e.key !== "Tab") return`), so match on the wrap-around
  // behaviour that actually constitutes trapping rather than on one spelling of the key test.
  check(/e\.key !== "Tab"|e\.key === "Tab"/.test(interactive) && interactive.includes("last.focus()") && interactive.includes("first.focus()"),
    "the dialog traps Tab focus (wraps at both ends)");
  check(interactive.includes('role="tablist"') && interactive.includes('role="tabpanel"'), "Tabs implement the ARIA tabs pattern");
  check(/ArrowRight/.test(interactive) && /ArrowLeft/.test(interactive), "Tabs support arrow-key roving focus");
  check(/tabIndex={on \? 0 : -1}/.test(interactive), "only the active tab is in the tab order");
  check((interactive.match(/data-touch-target/g) ?? []).length >= 4, "interactive controls meet the 44px touch target");
  check(primitives.includes("cmp-sr-only"), "screen-reader text accompanies icon-only meaning");

  // ── 8. PUI-006 behaviour baked into the toast ──
  const { priority } = await import("../src/lib/design/tokens");
  check(interactive.includes('t.level !== "critical"'), "critical toasts do NOT auto-dismiss");
  check(interactive.includes("Requires acknowledgement"), "a critical toast says it requires acknowledgement");
  check(priority.critical.requiresAck === true, "the token table agrees critical requires acknowledgement");
  check(interactive.includes('aria-live="assertive"') && interactive.includes('aria-live="polite"'),
    "critical announces assertively; everything else politely");
  check(interactive.includes('aria-label={level === "critical" ? "Acknowledge notification"'),
    "the critical toast's dismiss control is labelled Acknowledge, not Dismiss");

  // ── 9. Destructive confirmation defaults to the safe option ──
  check(interactive.includes("focusables()[0]?.focus()") && interactive.includes("Focus the CANCEL control first"),
    "a destructive dialog focuses CANCEL first, so a stray Enter is safe");

  console.log(`\n${pass}/${pass + fail} checks passed.`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
