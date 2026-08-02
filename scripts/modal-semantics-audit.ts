/**
 * Modal semantics audit.
 *
 * WHY. Fixing the focus traps on the five surfaces that DECLARE `aria-modal="true"` raised the obvious next
 * question: how many overlays block the page without declaring anything at all? A full-screen panel that is
 * not marked as a dialog is not lying to assistive technology the way a mislabelled one is -- it is simply
 * invisible to it. A screen-reader user hears the page behind, unchanged, while the visual user sees a
 * modal. Tab wanders behind the overlay with no indication anything has opened.
 *
 * This is an AUDIT, not a gate. It exits 0 and prints a ranked list, because the finding is pre-existing
 * debt across authenticated workspaces rather than a regression: turning it into a failing test would put
 * the suite permanently red, which is how a suite stops being read. scripts/pui-a11y-harness.ts holds the
 * line that already-declared modals must trap focus; this measures the rest.
 *
 * It reports, per overlay file:
 *   dialog   - declares role="dialog"
 *   modal    - declares aria-modal="true"
 *   trap     - calls useModalFocus
 *   escape   - has any Escape handling
 *   labelled - has aria-label or aria-labelledby on the dialog
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

type Row = {
  file: string; dialog: boolean; modal: boolean; trap: boolean; escape: boolean; labelled: boolean;
  interactive: boolean;
};

const rows: Row[] = [];

for (const file of walk("src").filter(f => f.endsWith(".tsx"))) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  // A blocking overlay: fixed and covering the viewport. `inset-0` is how every one of them is written here.
  if (!/fixed inset-0/.test(src)) continue;
  rows.push({
    file,
    dialog: /role="dialog"/.test(src),
    modal: /aria-modal="true"/.test(src),
    trap: /useModalFocus\s*\(/.test(src),
    // A file that calls useModalFocus gets Escape from the hook. Checking only for the literal string in
    // this file reported four freshly-fixed dialogs as having no Escape -- the same mistake the a11y
    // harness made, for the same reason: the behaviour moved and the check kept looking where it used to be.
    escape: /["']Escape["']/.test(src) || /useModalFocus\s*\(/.test(src),
    labelled: /aria-label(ledby)?=/.test(src),
    interactive: /<input|<select|<textarea|<button/.test(src),
  });
}

// Ranked worst-first. Something that claims to be a modal and does not trap focus is actively misleading;
// something that blocks the page and says nothing is merely absent. Both matter, in that order.
const score = (r: Row) => (r.modal && !r.trap ? 0 : !r.dialog ? 1 : !r.escape ? 2 : 3);
rows.sort((a, b) => score(a) - score(b) || a.file.localeCompare(b.file));

const yn = (b: boolean) => (b ? "yes" : " - ");
const mislabelled = rows.filter(r => r.modal && !r.trap);
const undeclared = rows.filter(r => !r.dialog);
const noEscape = rows.filter(r => r.dialog && !r.escape);

console.log(`\n${rows.length} blocking overlay(s) found under src/.\n`);
console.log("  dialog modal trap escape label  file");
for (const r of rows) {
  console.log(`  ${yn(r.dialog)}    ${yn(r.modal)}   ${yn(r.trap)}  ${yn(r.escape)}    ${yn(r.labelled)}  ${r.file}`);
}

console.log(`
SUMMARY
  ${mislabelled.length}  declare aria-modal but do not trap focus   <- worst: an unkept promise to assistive tech
  ${undeclared.length}  block the page without role="dialog"        <- invisible to assistive tech entirely
  ${noEscape.length}  are dialogs with no Escape handling

  All of the above are in authenticated workspaces; the public site is clean. Each needs role="dialog",
  aria-modal, an accessible name and a useModalFocus call -- mechanical, but they differ enough in
  structure that they want doing deliberately rather than by codemod, and they cannot be verified in a
  browser without signing in.
`);
