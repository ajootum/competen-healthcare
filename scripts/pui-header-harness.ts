// Harness for the Platform Global Header (PUI-002) + HWW-UI-002.
//
// These two specs have unusually testable acceptance criteria, so they are tested rather than asserted:
//   "Sign Out is no longer displayed in the sidebar."
//   "User profile functions are available from the top-right menu."
//   "Sidebar contains only workflow-related navigation."
//   "Header behaviour is identical across all Competen workspaces."
//
// The last one is the reason this is a source-level harness: "identical" is a property of the SET of
// layouts, not of any one of them, and the only way it stays true as workspaces are added is if something
// fails when a new layout hand-rolls its own header instead of rendering the shared one.
//   npx --yes tsx scripts/pui-header-harness.ts

import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

const APP = path.join(process.cwd(), "src", "app");

// Every workspace layout: a layout.tsx that renders a sidebar. The root layout and route-group layouts
// that render no chrome are not workspaces and are not held to the standard.
function workspaceLayouts(): { name: string; file: string; src: string }[] {
  return fs.readdirSync(APP, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("("))
    .map(d => ({ name: d.name, file: path.join(APP, d.name, "layout.tsx") }))
    .filter(x => fs.existsSync(x.file))
    .map(x => ({ ...x, src: fs.readFileSync(x.file, "utf8") }))
    .filter(x => x.src.includes("data-sidebar"));
}

async function main() {
  const layouts = workspaceLayouts();
  check(layouts.length >= 15, "found the workspace layouts", `${layouts.length}: ${layouts.map(l => l.name).join(", ")}`);

  // ── HWW-UI-002: "Sign Out is no longer displayed in the sidebar." ──
  const withLogout = layouts.filter(l => l.src.includes("auth/logout"));
  check(withLogout.length === 0, "no workspace layout renders sign out in its sidebar",
    withLogout.length ? withLogout.map(l => l.name).join(", ") : `${layouts.length} layouts clean`);

  // ── "Sidebar contains only workflow-related navigation." ──
  // Scoped to the <aside> itself: a mobile top bar may legitimately carry a workspace switcher, since it is
  // the mobile stand-in for the global header, not sidebar navigation.
  //
  // /dashboard is EXEMPT and stated as such: it IS the Personal Workspace, so Profile and Preferences are
  // its own workflow rather than account management bolted onto a clinical sidebar. Exempting it by name
  // beats contorting the rule until it passes.
  const PERSONAL_WORKSPACE = "dashboard";
  const asideOf = (src: string) => {
    const i = src.indexOf("data-sidebar");
    return i < 0 ? "" : src.slice(i, src.indexOf("</aside>", i));
  };
  const ACCOUNT_MARKERS = ["RoleSwitcher", "WorkspaceSwitcher", "/dashboard/preferences", "/dashboard/profile", "auth/logout"];
  const withAccountNav = layouts
    .filter(l => l.name !== PERSONAL_WORKSPACE)
    .filter(l => ACCOUNT_MARKERS.some(m => asideOf(l.src).includes(m)));
  check(withAccountNav.length === 0, "no workspace sidebar carries account or profile management",
    withAccountNav.length ? withAccountNav.map(l => l.name).join(", ") : `workflow navigation only (${PERSONAL_WORKSPACE} exempt — it is the Personal Workspace)`);

  // ── "Header behaviour is identical across all workspaces." ──
  const withHeader = layouts.filter(l => l.src.includes("<GlobalHeader"));
  const missing = layouts.filter(l => !l.src.includes("<GlobalHeader"));
  check(missing.length === 0, "every workspace renders the SHARED GlobalHeader",
    missing.length ? `missing in: ${missing.map(l => l.name).join(", ")}` : `${withHeader.length} layouts`);

  const withResolver = layouts.filter(l => l.src.includes("loadHeaderContext("));
  check(withResolver.length === layouts.length, "every workspace builds its header from the SHARED resolver",
    withResolver.length === layouts.length ? "no layout assembles its own props" :
      layouts.filter(l => !l.src.includes("loadHeaderContext(")).map(l => l.name).join(", "));

  // A layout that hand-rolled a second DESKTOP header would defeat the point. A <header> carrying
  // `md:hidden` is the mobile bar, which is a separate and legitimate surface.
  const desktopHeaders = (src: string) =>
    [...src.matchAll(/<header[^>]*>/g)].map(m => m[0]).filter(tag => !tag.includes("md:hidden"));
  const ownHeader = layouts.filter(l => desktopHeaders(l.src).length > 0);
  check(ownHeader.length === 0, "no workspace hand-rolls its own desktop header",
    ownHeader.length ? ownHeader.map(l => l.name).join(", ") : "one header component, platform-wide");

  // Every header gets the same prop set — a layout passing fewer would render a quietly different header.
  const REQUIRED_PROPS = ["user={header.user}", "workspaces={header.workspaces}", "units={header.units}",
    "activeUnitId={header.activeUnitId}", "notifications={header.notifications}", "messages={header.messages}"];
  const incomplete = layouts.filter(l => REQUIRED_PROPS.some(p => !l.src.includes(p)));
  check(incomplete.length === 0, "every header receives the identical prop set",
    incomplete.length ? incomplete.map(l => l.name).join(", ") : `${REQUIRED_PROPS.length} props everywhere`);

  // ── PUI-005: skip link + main landmark, everywhere ──
  const noSkip = layouts.filter(l => !l.src.includes("cmp-skip-link"));
  check(noSkip.length === 0, "every workspace offers a skip-to-content link",
    noSkip.length ? noSkip.map(l => l.name).join(", ") : "all layouts");
  const noLandmark = layouts.filter(l => !l.src.includes('id="main-content"'));
  check(noLandmark.length === 0, "every workspace has the matching main landmark",
    noLandmark.length ? noLandmark.map(l => l.name).join(", ") : "all layouts");

  // ── The header component itself ──
  const header = fs.readFileSync(path.join(process.cwd(), "src/components/platform/GlobalHeader.tsx"), "utf8");
  check(header.includes('action="/api/auth/logout"'), "sign out lives in the header user menu — the one place platform-wide");
  for (const [label, href] of [["Personal Workspace", "/dashboard"], ["Competency Passport", "/dashboard/passport"],
    ["Learning", "/dashboard/learning"], ["Profile", "/dashboard/profile"],
    ["Preferences", "/dashboard/preferences"], ["Help & Support", "/dashboard/help"]] as const) {
    check(header.includes(`label: "${label}"`) && header.includes(`href: "${href}"`),
      `user menu offers ${label}`);
  }

  // Every user-menu destination must be a real page — a menu of dead links is the failure mode this
  // whole body of work has been removing.
  const menuHrefs = [...header.matchAll(/href: "(\/[^"]+)"/g)].map(m => m[1]);
  const dead = menuHrefs.filter(h => !fs.existsSync(path.join(APP, h.replace(/^\//, ""), "page.tsx")));
  check(dead.length === 0, "every user-menu destination is a built page", dead.length ? dead.join(", ") : `${menuHrefs.length} links`);

  // ── Accessibility of the menus themselves (PUI-005) ──
  check((header.match(/aria-haspopup="menu"/g) ?? []).length >= 3, "each popover declares aria-haspopup");
  check((header.match(/aria-expanded=/g) ?? []).length >= 3, "each popover declares aria-expanded");
  check(header.includes('role="menu"'), "popovers use role=menu");
  check(header.includes('e.key === "Escape"'), "Escape closes an open menu");
  check(header.includes("triggerRef.current?.focus()"), "focus returns to the trigger on close");
  check(header.includes("mousedown"), "an outside click closes an open menu");
  check((header.match(/data-touch-target/g) ?? []).length >= 4, "header controls meet the 44px touch target");
  check(header.includes("cmp-sr-only"), "badges carry screen-reader text, not just a number");

  // ── The unit selector is tenant-safe (PUI-002: unit selector configurable per tenant) ──
  const unitRoute = fs.readFileSync(path.join(APP, "api/context/unit/route.ts"), "utf8");
  // THIS CHECK USED TO PASS WHILE THE FEATURE WAS ENTIRELY BROKEN. It matched the literal string
  // `unit.hospital_id !== profile?.hospital_id` — which was present in the source, but `units` has no
  // hospital_id column, so the query errored, the route 404'd on every unit, and the selector never worked.
  // A source grep proves a string exists, not that it does anything. It now checks the CORRECT model
  // (a unit's hospital is reached through its department) and the schema-drift audit checks the columns
  // are real, which is the part a grep can never do.
  check(/departments!department_id\(hospital_id\)/.test(unitRoute),
    "the unit selector resolves a unit's hospital THROUGH its department (units has no hospital_id)");
  check(/unitHospital !== profile\?\.hospital_id/.test(unitRoute),
    "and refuses a unit outside the caller's hospital");
  check(unitRoute.includes("httpOnly: true"), "the unit cookie is httpOnly, so client script cannot forge it");
  check(unitRoute.includes('cookieStore.delete("active_unit")'), "selecting All units clears the cookie");

  // ── Shortcuts: documentation and bindings come from ONE table ──
  const { SHORTCUTS } = await import("../src/lib/platform/shortcuts");
  const helpPage = fs.readFileSync(path.join(APP, "dashboard/help/page.tsx"), "utf8");
  check(helpPage.includes("SHORTCUTS"), "the Help page renders the shared shortcut table, not a hand-written copy");
  const badTargets = SHORTCUTS.filter(s => s.href && !fs.existsSync(path.join(APP, s.href.replace(/^\//, ""), "page.tsx")));
  check(badTargets.length === 0, "every documented shortcut points at a real page",
    badTargets.length ? badTargets.map(s => s.href).join(", ") : `${SHORTCUTS.length} shortcuts`);
  const dupes = SHORTCUTS.map(s => s.combo).filter((c, i, a) => a.indexOf(c) !== i);
  check(dupes.length === 0, "no two shortcuts bind the same key", dupes.join(", "));

  console.log(`\n${pass}/${pass + fail} checks passed.`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
