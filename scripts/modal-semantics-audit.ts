/**
 * Modal semantics audit.
 *
 * WHY. Fixing the focus traps on the five surfaces that DECLARE `aria-modal="true"` raised the obvious next
 * question: how many overlays block the page without declaring anything at all? A full-screen panel that is
 * not marked as a dialog is not lying to assistive technology the way a mislabelled one is -- it is simply
 * invisible to it. A screen-reader user hears the page behind, unchanged, while the visual user sees a
 * modal. Tab wanders behind the overlay with no indication anything has opened.
 *
 * IT COUNTED TWO DIFFERENT THINGS AS ONE, and the first version of this file reported all 39 as modals
 * needing dialog semantics. They are not. `fixed inset-0` is written here for two unrelated jobs:
 *
 *   DIALOG  a blocking panel WITH CONTENT -- wants role="dialog", aria-modal, a name and a focus trap.
 *   SCRIM   an EMPTY div whose only job is catching the click outside an absolutely-positioned dropdown.
 *           Giving this role="dialog" would announce an empty dialog to a screen reader, which is worse
 *           than saying nothing. It has a real but DIFFERENT defect: the menu beside it usually has no
 *           Escape key and no aria-expanded, so a keyboard user can open it and not get out.
 *
 * Classifying by content rather than by filename is what separates them: a self-closing or empty overlay
 * element is a scrim, anything with children is a dialog. Several files contain both, so this counts
 * OCCURRENCES, not files -- the per-file version hid a dialog in any file that also had a dropdown.
 *
 * This is an AUDIT, not a gate. It exits 0 and prints a ranked list, because the finding is pre-existing
 * debt across authenticated workspaces rather than a regression: turning it into a failing test would put
 * the suite permanently red, which is how a suite stops being read. scripts/pui-a11y-harness.ts holds the
 * line that already-declared modals must trap focus; this measures the rest.
 *
 *   npx --yes tsx scripts/modal-semantics-audit.ts
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const walk = (dir: string): string[] =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith(".") ? [] : walk(rel);
    return [rel];
  });

/**
 * Find the end of the JSX opening tag that starts at `open`, respecting strings and {braces} so a `>` inside
 * className={cond ? "a>b" : ""} or an arrow function does not end the tag early.
 * Returns the index just past the closing `>`, and whether the tag was self-closing.
 */
function endOfOpenTag(src: string, open: number): { end: number; selfClosing: boolean } {
  let i = open + 1, depth = 0, quote = "";
  while (i < src.length) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== "\\") quote = ""; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; i++; continue; }
    if (c === "{") { depth++; i++; continue; }
    if (c === "}") { depth--; i++; continue; }
    if (c === ">" && depth === 0) {
      return { end: i + 1, selfClosing: src[i - 1] === "/" };
    }
    i++;
  }
  return { end: src.length, selfClosing: false };
}

/**
 * The overlay's whole subtree, from the end of its opening tag to its matching close.
 *
 * NEEDED BECAUSE THE CORRECT PATTERN PUTS THE ROLE ON THE PANEL, NOT THE BACKDROP. The reference
 * implementation in interactive.tsx is `<div className="fixed inset-0 ...">` wrapping
 * `<div role="dialog" aria-modal="true">` -- which is right, since the scrim is decoration and the panel is
 * the dialog. Reading only the overlay's own opening tag reported that file as undeclared, i.e. the audit
 * called its own reference implementation broken. Suspect the measurement first.
 */
function subtree(src: string, from: number): string {
  let i = from, depth = 1, quote = "";
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (quote) { if (c === quote && src[i - 1] !== "\\") quote = ""; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; i++; continue; }
    if (c === "<") {
      if (src[i + 1] === "/") { depth--; i = src.indexOf(">", i) + 1 || src.length; continue; }
      if (/[A-Za-z]/.test(src[i + 1] ?? "")) {
        const t = endOfOpenTag(src, i);
        if (!t.selfClosing) depth++;
        i = t.end; continue;
      }
    }
    i++;
  }
  return src.slice(from, i);
}

type Kind = "dialog" | "scrim";
type Row = {
  file: string; line: number; kind: Kind;
  role: boolean; modal: boolean; trap: boolean; escape: boolean; labelled: boolean;
};

const rows: Row[] = [];

for (const file of walk("src").filter(f => f.endsWith(".tsx"))) {
  const src = fs.readFileSync(path.join(root, file), "utf8");

  // File-level facts. A focus trap and an Escape handler are wired once per component, not per element, so
  // they are properties of the file that owns the overlay rather than of the overlay tag itself.
  const trap = /useModalFocus\s*\(/.test(src);
  // A file that calls useModalFocus gets Escape from the hook. Checking only for the literal string in
  // this file reported four freshly-fixed dialogs as having no Escape -- the same mistake the a11y
  // harness made, for the same reason: the behaviour moved and the check kept looking where it used to be.
  const escape = /["']Escape["']/.test(src) || trap;

  for (const m of src.matchAll(/fixed inset-0/g)) {
    // Walk back to the `<` that opens this element.
    const open = src.lastIndexOf("<", m.index);
    if (open < 0) continue;
    const { end, selfClosing } = endOfOpenTag(src, open);
    const tag = src.slice(open, end);

    // Empty means scrim: self-closing, or an opening tag immediately followed by its own close.
    const after = src.slice(end, end + 200).trimStart();
    const kind: Kind = selfClosing || /^<\/\w/.test(after) ? "scrim" : "dialog";

    // Overlay tag PLUS everything inside it, so the role is found whether it sits on the backdrop or, as in
    // the correct pattern, on the panel within.
    const scope = kind === "scrim" ? tag : tag + subtree(src, end);

    rows.push({
      file, line: src.slice(0, open).split("\n").length, kind,
      role: /role="dialog"/.test(scope), modal: /aria-modal="true"/.test(scope),
      trap, escape, labelled: /aria-label(ledby)?=/.test(scope),
    });
  }
}

// Ranked worst-first. Something that claims to be a modal and does not trap focus is actively misleading;
// something that blocks the page and says nothing is merely absent. Both matter, in that order.
const score = (r: Row) =>
  r.kind === "scrim" ? 4 : r.modal && !r.trap ? 0 : !r.role ? 1 : !r.escape ? 2 : 3;
rows.sort((a, b) => score(a) - score(b) || a.file.localeCompare(b.file) || a.line - b.line);

const yn = (b: boolean) => (b ? "yes" : " - ");
const dialogs = rows.filter(r => r.kind === "dialog");
const scrims = rows.filter(r => r.kind === "scrim");
const mislabelled = dialogs.filter(r => r.modal && !r.trap);
const undeclared = dialogs.filter(r => !r.role);
const noEscape = dialogs.filter(r => r.role && !r.escape);
// A scrim closes on outside click. Without Escape the same dismissal is unavailable from the keyboard.
const scrimNoEscape = scrims.filter(r => !r.escape);

console.log(`\n${rows.length} full-viewport overlay(s) under src/ -- ${dialogs.length} with content, ${scrims.length} empty scrims.\n`);
console.log("  kind    role modal trap escape label  file:line");
for (const r of rows) {
  console.log(`  ${r.kind.padEnd(7)} ${yn(r.role)}  ${yn(r.modal)}  ${yn(r.trap)} ${yn(r.escape)}   ${yn(r.labelled)}  ${r.file}:${r.line}`);
}

console.log(`
SUMMARY
  DIALOGS (overlays with content -- these want full dialog semantics)
    ${mislabelled.length}  declare aria-modal but do not trap focus   <- worst: an unkept promise to assistive tech
    ${undeclared.length}  block the page without role="dialog"        <- invisible to assistive tech entirely
    ${noEscape.length}  are dialogs with no Escape handling

  SCRIMS (empty click-catchers behind a dropdown -- role="dialog" here would be WRONG)
    ${scrimNoEscape.length}  cannot be dismissed from the keyboard    <- opened by keyboard, no way out

  The public site is clean; everything above is in an authenticated workspace and so cannot be verified in
  a browser without signing in. Verification is this audit plus tsc, eslint and the build.
`);
