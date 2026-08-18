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
  // ⚠ THE FOCUS BEHAVIOUR MOVED, AND THIS HARNESS DID NOT FOLLOW IT (corrected 2026-08-19). Three checks
  // below used to grep interactive.tsx for `restore.current?.focus()`, `first.focus()` and
  // `focusables()[0]?.focus()`. Those lines are real, but they live in use-modal-focus.ts now: the
  // implementation was lifted out of ConfirmDialog so Modal and Drawer could stop hand-rolling it. The
  // components were CORRECT and this harness was RED -- pinned to where the code used to be rather than
  // to what it does. Read both files, assert the behaviour where it lives, and separately assert that
  // each modal surface still consumes it, which is the part that actually stops regressing.
  const modalFocus = fs.readFileSync(path.join(process.cwd(), "src", "components", "ui", "use-modal-focus.ts"), "utf8");
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
  check(/restore(\.current)?(\?)?\.focus\(\)/.test(modalFocus), "the modal focus hook restores focus on close");
  // The trap is written as a guard clause (`if (e.key !== "Tab") return`), so match on the wrap-around
  // behaviour that actually constitutes trapping rather than on one spelling of the key test.
  check(/e\.key !== "Tab"|e\.key === "Tab"/.test(modalFocus) && modalFocus.includes("last.focus()") && modalFocus.includes("first.focus()"),
    "the modal focus hook traps Tab (wraps at both ends)");
  // ⚠ AND THE PART THAT ACTUALLY REGRESSES. A correct hook nobody calls protects nothing -- which is
  // exactly what pui-a11y caught on three surfaces the same day. Every modal surface in this file must
  // consume it, so deleting a call is what goes red rather than only editing the hook.
  check((interactive.match(/useModalFocus\s*\(/g) ?? []).length >= 3,
    "Modal, ConfirmDialog and Drawer each consume the shared focus hook",
    `${(interactive.match(/useModalFocus\s*\(/g) ?? []).length} call(s)`);
  // ⚠ COUNTED WITH COMMENTS STRIPPED, AND THE FIRST DRAFT OF THIS LINE DID NOT DO THAT. It compared raw
  // occurrences and went red at 5 vs 3 -- because `aria-modal` is discussed twice in this file's own
  // header prose. A count that includes the commentary about a thing is not a count of the thing, which
  // is the same failure that made five routes look capability-gated on the estate plane. Strip first.
  const code = interactive.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const modalSurfaces = (code.match(/aria-modal="true"/g) ?? []).length;
  const hookCalls = (code.match(/useModalFocus\s*\(/g) ?? []).length;
  check(modalSurfaces === hookCalls,
    "every aria-modal surface here has exactly one focus-hook call -- no surface makes the promise without keeping it",
    `${modalSurfaces} aria-modal surface(s), ${hookCalls} hook call(s)`);
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
  // ⚠ REWRITTEN FROM A COMMENT MATCH TO THE MECHANISM (2026-08-19). This asserted the literal string
  // "Focus the CANCEL control first" -- a needle that matched its own explanatory comment, so deleting
  // the safety behaviour while keeping the sentence would have stayed green. What actually makes a stray
  // Enter safe is two facts together: the hook focuses the FIRST focusable, and ConfirmDialog renders
  // Cancel BEFORE Confirm. Assert both, and assert the ordering by position rather than by prose.
  const confirmBody = interactive.slice(interactive.indexOf("export function ConfirmDialog"));
  const cancelAt = confirmBody.indexOf("onClick={onCancel}");
  const confirmAt = confirmBody.indexOf("onClick={onConfirm}");
  check(/focusables\(\)\[initialIndex\]\s*\?\?\s*focusables\(\)\[0\]/.test(modalFocus) || /focusables\(\)\[0\]/.test(modalFocus),
    "the hook lands on the first focusable by default");
  check(cancelAt > -1 && confirmAt > -1 && cancelAt < confirmAt,
    "a destructive dialog focuses CANCEL first, so a stray Enter is safe",
    cancelAt > -1 && confirmAt > -1 ? `cancel at ${cancelAt}, confirm at ${confirmAt}` : "one of the two controls was not found");

  console.log(`\n${pass}/${pass + fail} checks passed.`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
