// Harness for Accessibility & Interaction Standards (PUI-005).
//
// PUI-005 is not a feature — it is a floor that every other piece has to stand on. This is therefore a
// CONSOLIDATED pass over what the previous PUI work produced, asserting the commitments the platform now
// makes in writing on /dashboard/help are actually true of the code.
//
// It deliberately re-checks things the other harnesses touch, from the accessibility angle rather than the
// feature angle: contrast is a token property, focus is a stylesheet property, keyboard operation is a
// component property, and a user reading the Help page cares that all three hold at once.
//   npx --yes tsx scripts/pui-a11y-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/** Every file under a directory, recursively. Used to find modal surfaces wherever they were added. */
const walk = (dir: string): string[] =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith(".") ? [] : walk(rel);
    return [rel];
  });

const srgb = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = (hex: string) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
};

async function main() {
  const css = read("src/app/globals.css");
  const tokens = await import("../src/lib/design/tokens");
  const { SHORTCUTS } = await import("../src/lib/platform/shortcuts");

  // ── 1.4.3 / 1.4.11 Contrast ──
  check(tokens.a11y.contrast.normalText === 4.5 && tokens.a11y.contrast.largeText === 3,
    "the AA contrast floor is declared (4.5:1 normal, 3:1 large)");
  for (const [name, hex] of Object.entries(tokens.color.semanticText)) {
    const c = contrast(hex as string, "#FFFFFF");
    check(c >= 4.5, `text tone ${name} passes AA on white`, `${c}:1`);
  }
  check(contrast(tokens.color.neutral[600], "#FFFFFF") >= 4.5, "the body-text neutral passes AA",
    `${contrast(tokens.color.neutral[600], "#FFFFFF")}:1`);
  check(contrast("#FFFFFF", tokens.color.primary.base) >= 4.5, "white on the primary button passes AA");

  // ── 1.4.4 Resize text ──
  check(tokens.a11y.baseFontSize === 16, "base font size is 16px");
  check(tokens.font.scale.caption.size >= 12, "the smallest type is 12px, not smaller", `${tokens.font.scale.caption.size}px`);
  const lineRatios = Object.values(tokens.font.scale).map(s => s.lineHeight / s.size);
  check(lineRatios.every(r => r >= 1.2), "every type step has a line height of at least 1.2",
    `min ${Math.min(...lineRatios).toFixed(2)}`);
  check(tokens.font.scale.body.lineHeight / tokens.font.scale.body.size >= 1.4,
    "body text has generous line height for clinical reading",
    `${(tokens.font.scale.body.lineHeight / tokens.font.scale.body.size).toFixed(2)}`);

  // ── 2.4.7 Focus visible ──
  const flat = css.replace(/\s+/g, " ");
  check(/:focus-visible \{ outline: var\(--cmp-focus-width\) solid/.test(flat),
    "a visible focus ring is defined platform-wide");
  check(/:where\(a, button, input, select, textarea, summary, \[tabindex\]\)/.test(flat),
    "the focus ring covers every interactive element type");
  check(flat.includes("outline-offset: 2px"), "the focus ring is offset so it is not swallowed by the control");
  check(tokens.a11y.focusRingWidth >= 2, "the focus ring is at least 2px");

  // ── 2.4.1 Skip link + landmark, on every workspace ──
  const layouts = fs.readdirSync(path.join(root, "src/app"), { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("("))
    .map(d => ({ name: d.name, file: path.join(root, "src/app", d.name, "layout.tsx") }))
    .filter(x => fs.existsSync(x.file))
    .map(x => ({ ...x, src: fs.readFileSync(x.file, "utf8") }))
    .filter(x => x.src.includes("data-sidebar"));
  check(css.includes(".cmp-skip-link"), "the skip-link class exists");
  check(/\.cmp-skip-link:focus \{ top:/.test(flat), "the skip link becomes visible on focus");
  const noSkip = layouts.filter(l => !l.src.includes("cmp-skip-link"));
  check(noSkip.length === 0, "every workspace offers a skip link", noSkip.map(l => l.name).join(", ") || `${layouts.length} workspaces`);
  const noTarget = layouts.filter(l => !l.src.includes('id="main-content"'));
  check(noTarget.length === 0, "and every skip link has its landmark to land on", noTarget.map(l => l.name).join(", ") || "all");

  // ── 2.3.3 / prefers-reduced-motion ──
  check(css.includes("@media (prefers-reduced-motion: reduce)"), "reduced motion is honoured");
  check(/animation-duration: \.01ms !important/.test(css) && /transition-duration: \.01ms !important/.test(css),
    "both animation and transition are suppressed, not just one");
  check(/scroll-behavior: auto !important/.test(css), "smooth scrolling is disabled too");

  // ── 2.5.5 Target size ──
  check(tokens.a11y.minTouchTarget === 44, "the touch-target floor is 44px");
  check(css.includes("[data-touch-target]") && /min-width: var\(--cmp-touch-min\)/.test(flat),
    "a touch-target utility enforces it");
  const header = read("src/components/platform/GlobalHeader.tsx");
  const interactive = read("src/components/ui/interactive.tsx");
  check((header.match(/data-touch-target/g) ?? []).length >= 4, "header controls opt in");
  check((interactive.match(/data-touch-target/g) ?? []).length >= 4, "interactive components opt in");

  // ── 1.4.1 Use of colour ──
  check(css.includes(".cmp-sr-only"), "a screen-reader-only utility exists for the text half of a status");
  const comps = read("src/components/ui/primitives.tsx") + read("src/components/ui/clinical.tsx");
  check(!/showLabel|hideLabel|iconOnly/.test(comps), "no status component can be rendered without its label");
  const priorities = Object.values(tokens.priority);
  check(priorities.every((p: any) => p.icon && p.label), "every priority level carries an icon AND a word");

  // ── 2.1.1 Keyboard operable ──
  check(interactive.includes('role="tablist"') && /ArrowRight/.test(interactive), "tabs are arrow-key operable");
  // Escape moved out of interactive.tsx and into useModalFocus, so this now checks where the behaviour
  // actually lives. It is re-asserted in the modal-focus block below alongside the other two guarantees.
  check(read("src/components/ui/use-modal-focus.ts").includes('e.key === "Escape"'), "dialogs close on Escape");
  check(header.includes('e.key === "Escape"'), "header menus close on Escape");
  check(header.includes("triggerRef.current?.focus()"), "and return focus to their trigger");

  // ── 2.1.2 No keyboard trap, and shortcuts that do not steal keystrokes ──
  const binder = read("src/components/platform/ShortcutBinder.tsx");
  check(binder.includes("isTypingTarget(e.target)"), "shortcuts never fire while the user is typing");
  check(/e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey/.test(binder), "modifier combinations are left to the browser and OS");
  check(binder.includes("SEQUENCE_WINDOW_MS"), "a two-key sequence prefix expires rather than lying in wait");

  // THE POINT OF THIS SECTION: the Help page promises these shortcuts work. Assert that each documented
  // shortcut is actually reachable and bound, and that nothing is documented without a target.
  check(SHORTCUTS.length > 0, "shortcuts are declared", `${SHORTCUTS.length}`);
  const undocumentedTargets = SHORTCUTS.filter(s => !s.href && !s.behaviour);
  check(undocumentedTargets.length === 0, "every documented shortcut has a target",
    undocumentedTargets.map(s => s.combo).join(", "));
  const deadTargets = SHORTCUTS.filter(s => s.href && !fs.existsSync(path.join(root, "src/app", s.href.replace(/^\//, ""), "page.tsx")));
  check(deadTargets.length === 0, "every shortcut target is a built page", deadTargets.map(s => s.href).join(", "));
  const unbound = SHORTCUTS.filter(s => s.behaviour && !binder.includes(s.behaviour));
  check(unbound.length === 0, "no shortcut is documented with a behaviour the binder does not implement",
    unbound.map(s => s.combo).join(", "));
  check(read("src/components/platform/GlobalHeader.tsx").includes("<ShortcutBinder />"),
    "the binder is mounted in the shared header, so every workspace gets the shortcuts");

  // ── The Help page's promises are true ──
  const help = read("src/app/dashboard/help/page.tsx");
  check(help.includes("SHORTCUTS"), "the Help page renders the shared table rather than a hand-written copy");
  check(help.includes("tokens.a11y.focusRingWidth") && help.includes("tokens.a11y.minTouchTarget"),
    "the Help page quotes the REAL token values, so its promises cannot drift from the code");
  check(help.includes("Skip to main content"), "the Help page tells users the skip link exists");
  check(help.includes("never carried by colour alone"), "and states the colour-alone commitment");
  check(help.includes("reduce motion"), "and the reduced-motion commitment");

  // ── Charts: the content, not a summary ──
  const charts = read("src/components/ui/charts.tsx");
  check(charts.includes("DataTableAlt"), "charts emit a hidden data table, not just an aria-label");
  check(charts.includes('role="img"'), "charts are role=img");

  // ── Modal focus management ───────────────────────────────────────────────────────────────────────
  //
  // aria-modal="true" is a PROMISE to assistive technology that everything outside the dialog is inert.
  // Three of four modal surfaces were making it without keeping it: the two public mobile navigation
  // drawers and the design system's own Drawer moved no focus and trapped no Tab, so a screen-reader user
  // was told the page was unavailable while a keyboard user Tabbed straight into it behind an opaque
  // overlay. Measured on /practice at 375px, thirty-one elements were still reachable.
  //
  // Asserted as a SOURCE invariant because the behaviour is only observable in a real browser, and a
  // harness that cannot see the bug is how this survived in the first place. Every file that declares
  // aria-modal must go through the one hook that implements all three parts.
  const modalFiles = walk("src")
    .filter(f => /\.tsx$/.test(f))
    .filter(f => read(f).includes('aria-modal="true"'));
  check(modalFiles.length > 0, "there are modal surfaces to check", `${modalFiles.length} file(s)`);

  // Matches the CALL, not the string. The first version of this checked `includes("useModalFocus")`, which
  // a leftover import satisfies on its own -- so deleting the call and keeping the import passed cleanly.
  // Verified by doing exactly that: it must fail, or it is measuring nothing.
  const untrapped = modalFiles.filter(f => !/useModalFocus\s*\(/.test(read(f)));
  check(untrapped.length === 0,
    "every aria-modal surface CALLS useModalFocus (focus in, Tab trapped, focus restored)",
    untrapped.join(", "));

  // The hook is worthless if it stops doing any one of the three. Each is asserted by its mechanism
  // rather than by name, so renaming a variable does not silently pass.
  const hook = read("src/components/ui/use-modal-focus.ts");
  check(/\.focus\(\)/.test(hook) && /initial/.test(hook), "the hook moves focus into the dialog on open");
  check(/e\.key !== "Tab"/.test(hook) && /shiftKey/.test(hook), "the hook wraps Tab and Shift+Tab");
  check(/isConnected/.test(hook) && /restore/.test(hook), "the hook restores focus to the trigger on close");
  check(/Escape/.test(hook), "the hook dismisses on Escape");

  console.log(`\n${pass}/${pass + fail} checks passed.`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
