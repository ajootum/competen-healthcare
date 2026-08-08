/**
 * Generates the permission matrix from the access gates the application actually enforces
 * (UMW-TLS-002) into src/lib/access/matrix.generated.json.
 *
 * Run after changing any workspace layout or API role check:
 *   npx --yes tsx scripts/gen-access-matrix.ts
 *
 * The committed JSON is checked for staleness by scripts/umw-permissions-harness.ts, so a gate that
 * changes without the matrix being regenerated fails a test rather than silently showing a manager an
 * out-of-date picture of who can reach what.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { type MatrixEntry, type RoleGroups, type CapabilityConsts } from "../src/lib/access/scan";
// The HQ layer delegates to classifyGate whenever the HQ idiom is absent, so this is a drop-in that adds
// a plane rather than replacing a classifier. Without it a page whose only gate is requireHqContext falls
// through to `none` -- open to the world -- which is what happened to 98 practice routes before scan.ts
// learned their idiom.
import { classifyHqGate as classifyGate } from "../src/lib/access/hq-scan";

const ROOT = process.cwd();
const APP = join(ROOT, "src/app");

// The role groups are read from api-auth.ts rather than restated here, so adding a role to ADMIN_ROLES
// changes the matrix on the next run and the two can never quietly disagree.
function readRoleGroups(): RoleGroups {
  const src = readFileSync(join(ROOT, "src/lib/api-auth.ts"), "utf8");
  const groups: RoleGroups = {};
  for (const m of src.matchAll(/export\s+const\s+([A-Z_]+ROLES)\s*=\s*\[([^\]]*)\]/g)) {
    groups[m[1]] = [...m[2].matchAll(/"([a-z_]+)"/g)].map(x => x[1]);
  }
  return groups;
}

// The tenant plane's capability constants (CHECKLIST_CAPABILITIES.manage and friends), read from the
// files that declare them for the same reason the role groups are: a restatement here would drift.
//
// ⚠ SCANNED ACROSS ALL OF src/lib/practice RATHER THAN A NAMED LIST OF FILES. A new *-constants.ts is
// added most weeks in this product, and a hand-kept list would go quietly out of date -- at which point
// the routes using it classify as `unknown`. That is the safe direction to fail, but it is still a route
// dropping out of the picture, so the cheaper fix is to not keep a list.
function readCapabilityConsts(): CapabilityConsts {
  const out: CapabilityConsts = {};
  const dir = join(ROOT, "src/lib/practice");
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(join(dir, file), "utf8");
    for (const m of src.matchAll(/export\s+const\s+([A-Z][A-Z0-9_]*CAPABILITIES)\s*=\s*\{([^}]*)\}/g)) {
      const members: Record<string, string> = {};
      for (const kv of m[2].matchAll(/([A-Za-z0-9_]+)\s*:\s*"([a-z0-9._]+)"/g)) members[kv[1]] = kv[2];
      if (Object.keys(members).length) out[m[1]] = { ...(out[m[1]] ?? {}), ...members };
    }
  }
  return out;
}

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

// ⚠ THE ANCHORS MATTER. `src/app/page.tsx` relativises to `page.tsx` with no leading slash, so a pattern
// anchored on `/page.tsx` misses it and the site root reported itself as the literal path "/page.tsx".
// Harmless-looking, and it would have meant the one page every visitor lands on had no row anybody could
// find. The alternation strips the filename whether or not a directory precedes it.
const routeOf = (file: string) => {
  const rel = relative(APP, file).replace(/\\/g, "/").replace(/\/?(layout|route|page)\.tsx?$/, "");
  return "/" + rel.replace(/^\.$/, "");
};

function main() {
  const groups = readRoleGroups();
  const caps = readCapabilityConsts();
  const files = walk(APP);

  // Workspace roots: a top-level segment's layout.tsx is what gates the whole workspace.
  const workspaceLayouts = files.filter(f => /[\\/]layout\.tsx$/.test(f) &&
    relative(APP, f).replace(/\\/g, "/").split("/").length === 2);

  const apiRoutes = files.filter(f => /[\\/]route\.ts$/.test(f) && relative(APP, f).replace(/\\/g, "/").startsWith("api/"));

  const entries: MatrixEntry[] = [];

  for (const f of workspaceLayouts) {
    entries.push({ path: routeOf(f) || "/", kind: "workspace", gate: classifyGate(readFileSync(f, "utf8"), groups, caps) });
  }
  for (const f of apiRoutes) {
    entries.push({ path: routeOf(f), kind: "api", gate: classifyGate(readFileSync(f, "utf8"), groups, caps) });
  }

  // ── PAGE GRANULARITY ─────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ WITHOUT THIS, ONE ENTRY STOOD FOR A WHOLE WORKSPACE. `/super-admin` was a single `single-role`
  // row covering 204 page patterns, so a question like "which positions reach the executive pages" had
  // no row to ask it of, and a module added under a guarded layout was invisible.
  //
  // ⚠ AND WITHOUT THE INHERITANCE WALK BELOW IT WOULD BE WORSE THAN NOTHING. There are 920 pages and 23
  // layouts, so the overwhelming majority carry no check of their own -- they are protected by an
  // ancestor. Classifying each page in isolation would report hundreds of correctly protected pages as
  // `none`, "reachable without signing in", which roleReaches answers `true` for. That is the same
  // failure that hid 98 practice routes, arriving from the opposite direction: not silence, but a flood
  // of false alarms that buries the real ones.
  const layoutGates = new Map<string, { path: string; gate: ReturnType<typeof classifyGate> }>();
  for (const f of files.filter(x => /[\\/]layout\.tsx$/.test(x))) {
    const dir = f.replace(/[\\/]layout\.tsx$/, "");
    layoutGates.set(dir, { path: routeOf(f) || "/", gate: classifyGate(readFileSync(f, "utf8"), groups, caps) });
  }

  for (const f of files.filter(x => /[\\/]page\.tsx$/.test(x))) {
    const own = classifyGate(readFileSync(f, "utf8"), groups, caps);
    // ⚠ A REQUEST MUST PASS THE LAYOUT *AND* THE PAGE, SO THE NARROWER GATE IS THE TRUE ANSWER.
    // `none` and `auth-only` are the two weak kinds: neither restricts by role, capability or position.
    // A page that merely checks somebody is signed in, sitting under a layout that demands
    // hospital_admin, is reachable by hospital_admin -- reporting the page's own `auth-only` would say
    // "any signed-in nurse", which is a false alarm and exactly what /unit-manager did on the first run
    // of this code. Anything narrower than auth-only is the page speaking for itself and is kept.
    if (own.kind !== "none" && own.kind !== "auth-only") {
      entries.push({ path: routeOf(f), kind: "page", gate: own, guard: "own", inheritedFrom: null });
      continue;
    }
    // Walk up for the nearest ancestor layout that actually gates. `none` and `unknown` do not count as
    // protection -- inheriting an unparsed gate would launder the scanner's own blind spot into an answer.
    let dir = f.replace(/[\\/]page\.tsx$/, "");
    let inherited: { path: string; gate: ReturnType<typeof classifyGate> } | null = null;
    while (dir.length >= APP.length) {
      const at = layoutGates.get(dir);
      if (at && at.gate.kind !== "none" && at.gate.kind !== "unknown") { inherited = at; break; }
      const up = dir.replace(/[\\/][^\\/]+$/, "");
      if (up === dir) break;
      dir = up;
    }
    entries.push(inherited
      ? { path: routeOf(f), kind: "page", gate: inherited.gate, guard: "inherited", inheritedFrom: inherited.path }
      // No ancestor gates it either. If the page at least checked for a session, say so -- `auth-only`
      // and `none` are a materially different finding and collapsing them would hide which is which.
      : { path: routeOf(f), kind: "page", gate: own, guard: "own", inheritedFrom: null });
  }

  entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));

  // No generatedAt timestamp on purpose: the file would then differ on every run and the staleness check
  // could not compare a fresh scan against the committed copy.
  const out = join(ROOT, "src/lib/access/matrix.generated.json");
  const json = JSON.stringify({ entries }, null, 2) + "\n";
  const changed = !existsSync(out) || readFileSync(out, "utf8") !== json;
  writeFileSync(out, json);

  const unknown = entries.filter(e => e.gate.kind === "unknown");
  const pages = entries.filter(e => e.kind === "page");
  console.log(`${changed ? "updated" : "unchanged"}  ${entries.length} entries (${workspaceLayouts.length} workspaces, ${apiRoutes.length} api routes, ${pages.length} pages)`);
  // ⚠ Reported every run rather than buried in the JSON: a page relying on an ancestor is protected in
  // the browser and NOT protected against a Server Action, which is the gap the HQ guard work closed for
  // 38 pages and has not closed for the rest.
  console.log(`  pages: ${pages.filter(e => e.guard === "own").length} check for themselves, ${pages.filter(e => e.guard === "inherited").length} rely on an ancestor layout, ${pages.filter(e => e.gate.kind === "none").length} have no gate anywhere`);
  console.log(`  auth-only: ${entries.filter(e => e.gate.kind === "auth-only").length}   role-gated: ${entries.filter(e => e.gate.kind === "role-list" || e.gate.kind === "single-role").length}   unknown: ${unknown.length}`);
  if (unknown.length) {
    console.log("\n  Gates this scanner could not classify (reported as unknown, never as open):");
    for (const e of unknown.slice(0, 25)) console.log(`    ${e.path}${e.gate.evidence ? `  [${e.gate.evidence.replace(/\s+/g, " ").slice(0, 70)}]` : "  [no gate found]"}`);
    if (unknown.length > 25) console.log(`    ... and ${unknown.length - 25} more`);
  }
}

main();
