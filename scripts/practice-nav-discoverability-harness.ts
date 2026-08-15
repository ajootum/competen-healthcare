/**
 * PRACTICE SIDEBAR — DISCOVERABILITY, not reachability.
 *
 * ⚠ WHY THIS EXISTS, AND IT IS THE WHOLE POINT: every harness in this repository was already checking
 * that each module is REACHABLE. `orphanedNav()` proves each has a parent. The access matrix proves each
 * is gated. The dead-link audit proves each resolves. All green — and the owner of the practice went
 * looking for Practice Guidance and could not find it, because the resting sidebar showed nine rows and
 * nothing on any of them said there was anything underneath.
 *
 * Seventeen of twenty-six built modules were in that position, including Close My Day, shipped two days
 * before. REACHABLE AND DISCOVERABLE ARE DIFFERENT PROPERTIES. This asserts the second.
 *
 *   npx --yes tsx scripts/practice-nav-discoverability-harness.ts
 */
import { readFileSync } from "node:fs";
import {
  PRACTICE_NAV, PRIMARY_ORDER, childrenOf, orphanedNav, primaryNav,
} from "../src/lib/practice/navigation";

let pass = 0; const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const SIDEBAR = "src/app/practice/(shell)/SidebarNav.tsx";
/** Every capability, so the filter never hides a module and makes an assertion vacuous. */
const ALL_CAPS = [...new Set(PRACTICE_NAV.map(i => i.capability).filter((c): c is string => !!c))];

function main() {
  console.log("\n=== PRACTICE SIDEBAR: DISCOVERABILITY ===\n");

  const source = readFileSync(SIDEBAR, "utf8");
  // ⚠ Comments stripped: this file's own header explains the chevron at length, and a needle that
  // matches its own documentation can only ever pass. Fourth time this has bitten in three days.
  const code = source.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join("\n");
  ok("0-control. stripping comments left the component behind", code.includes("export default function SidebarNav"));

  // ── 1. THE SHAPE OF THE PROBLEM, MEASURED ────────────────────────────────────────────────────────
  const built = PRACTICE_NAV.filter(i => i.built);
  const kids = built.filter(i => i.parent);
  ok("1a-control. there ARE modules filed under a section -- otherwise everything below is vacuous",
    kids.length > 0, `${kids.length} children`);
  ok("1b. every built module is reachable: none is an orphan",
    orphanedNav().length === 0, orphanedNav().map(i => i.href).join(", "));
  ok("1c-control. the resting sidebar is still the comp's nine",
    primaryNav(ALL_CAPS).length === PRIMARY_ORDER.length && PRIMARY_ORDER.length === 9,
    `${primaryNav(ALL_CAPS).length} primary`);

  const parentsWithChildren = PRIMARY_ORDER.filter(h => childrenOf(h, ALL_CAPS).length > 0);
  ok("1d. more than half the built product sits under a section",
    kids.length > built.length / 2, `${kids.length} of ${built.length}`);

  // ── 2. ⚠ THE ASSERTION THAT WOULD HAVE CAUGHT IT ─────────────────────────────────────────────────
  // A section that owns modules must ADVERTISE them from the resting state. In the component that means
  // a disclosure control rendered on the condition that children exist -- not on the condition that the
  // section is active, which is what it used to be.
  ok("2a. ⚠ a disclosure control is rendered whenever a section has children",
    /children\.length > 0 && \(\s*<button/.test(code),
    "a section with modules under it gives no sign they exist");
  ok("2b. ⚠ and it is gated on HAVING children, not on being the active section",
    !/inSection && children\.length > 0 && \(\s*<button/.test(code));
  ok("2c. the panel itself still opens on expansion",
    /expanded && children\.length > 0 && \(/.test(code));

  // ── 3. IT MUST EXPAND WITHOUT NAVIGATING ─────────────────────────────────────────────────────────
  ok("3a. the control is a button, not a link",
    /<button\s+[\s\S]{0,400}?aria-expanded=\{expanded\}/.test(code));
  // ⚠ ORDER, NOT CONTAINMENT, because a containment regex cannot be written safely here. The first
  // attempt was /<Link[\s\S]*?<button[\s\S]*?<\/Link>/ and it went red against correct code: the file
  // holds SEVERAL Link elements, so it matched from the parent's <Link, past the sibling <button, to the
  // CHILD link's </Link> — three unrelated tags. A regex that can span elements is not a nesting test.
  // What is actually required is that the parent row's Link CLOSES before any button OPENS.
  const firstLinkClose = code.indexOf("</Link>");
  const firstButton = code.indexOf("<button");
  ok("3b. ⚠ the parent link closes before any button opens -- the chevron is a SIBLING, not a child",
    firstLinkClose > 0 && firstButton > 0 && firstLinkClose < firstButton,
    `</Link> at ${firstLinkClose}, <button> at ${firstButton} -- a button inside an anchor navigates when the person meant to expand`);
  ok("3c. toggling changes state rather than routing",
    /onClick=\{\(\) => setToggled/.test(code) && !/onClick=\{\(\) => router/.test(code));

  // ── 4. THE EXISTING BEHAVIOUR IS KEPT ────────────────────────────────────────────────────────────
  ok("4a. a section you are standing in still opens by itself",
    /const expanded = toggled\[item\.href\] \?\? inSection/.test(code));
  ok("4b. ⚠ and an explicit toggle overrides that, so a collapsed section stays collapsed",
    /toggled\[item\.href\] \?\?/.test(code));
  ok("4c. longest-prefix matching is untouched",
    code.includes("pathname.startsWith(`${i.href}/`)"));

  // ── 5. ⚠ NO COUNT BESIDE THE CHEVRON ─────────────────────────────────────────────────────────────
  // badge() renders counts of WORK WAITING in the same region of the same row. A number meaning "six
  // modules" would be read as "six things need you".
  const chevron = code.slice(code.indexOf("children.length > 0 && ("), code.indexOf("</button>"));
  ok("5a. ⚠ the disclosure control prints no number",
    !/\{children\.length\}/.test(chevron), "a nav count would be read as work waiting");
  ok("5b-control. badge() still exists, so 5a is guarding a real collision",
    code.includes("const badge = ("));

  // ── 6. ACCESSIBILITY ─────────────────────────────────────────────────────────────────────────────
  ok("6a. the control reports its state", /aria-expanded=\{expanded\}/.test(code));
  ok("6b. and points at the panel it opens", /aria-controls=\{panelId\}/.test(code) && /id=\{panelId\}/.test(code));
  ok("6c. ⚠ its accessible name says WHAT is inside, not merely 'expand'",
    /aria-label=\{`\$\{expanded \? "Hide" : "Show"\} what is filed under \$\{item\.label\}/.test(code)
    && /children\.map\(c => c\.label\)/.test(code));

  // ── 7. EVERY SECTION THAT HIDES SOMETHING NOW ADVERTISES IT ──────────────────────────────────────
  console.log("");
  for (const href of PRIMARY_ORDER) {
    const list = childrenOf(href, ALL_CAPS);
    if (list.length) console.log(`     ${href.padEnd(24)} advertises ${list.length}: ${list.map(c => c.label).join(", ")}`);
  }
  ok("7a. ⚠ Practice Guidance is filed under Documents and is now advertised from it",
    childrenOf("/practice/documents", ALL_CAPS).some(c => c.href === "/practice/knowledge-studio"));
  // Repointed 2026-08-15: CPR-HFE-001 s3 removed Encounters from primary navigation, so Close My Day
  // moved under Today -- the day-close ritual under the day, which is where CPR-ADOPT-001 s3 wanted a
  // door anyway. The assertion pins the NEW home; the discoverability rule it protects is unchanged.
  ok("7b. ⚠ Close My Day is filed under Today and advertised from it",
    childrenOf("/practice/home", ALL_CAPS).some(c => c.href === "/practice/close-my-day"));
  ok("7c. every parent that owns modules is in PRIMARY_ORDER, so the chevron is always visible",
    parentsWithChildren.every(h => PRIMARY_ORDER.includes(h)));
  ok("7d-control. and there are several such parents, not one",
    parentsWithChildren.length >= 5, `${parentsWithChildren.length}`);

  report();
}

function report() {
  console.log(`\n${failures.length ? "FAILED" : "PASSED"}  ${pass} passed, ${failures.length} failed`);
  failures.forEach(f => console.log(`  - ${f}`));
  if (failures.length) process.exitCode = 1;
}

main();
