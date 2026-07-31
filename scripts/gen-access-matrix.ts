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
import { classifyGate, type MatrixEntry, type RoleGroups } from "../src/lib/access/scan";

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

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const routeOf = (file: string) =>
  "/" + relative(APP, file).replace(/\\/g, "/").replace(/\/(layout|route)\.tsx?$/, "")
    .replace(/\/page\.tsx$/, "").replace(/^\.$/, "");

function main() {
  const groups = readRoleGroups();
  const files = walk(APP);

  // Workspace roots: a top-level segment's layout.tsx is what gates the whole workspace.
  const workspaceLayouts = files.filter(f => /[\\/]layout\.tsx$/.test(f) &&
    relative(APP, f).replace(/\\/g, "/").split("/").length === 2);

  const apiRoutes = files.filter(f => /[\\/]route\.ts$/.test(f) && relative(APP, f).replace(/\\/g, "/").startsWith("api/"));

  const entries: MatrixEntry[] = [];

  for (const f of workspaceLayouts) {
    entries.push({ path: routeOf(f) || "/", kind: "workspace", gate: classifyGate(readFileSync(f, "utf8"), groups) });
  }
  for (const f of apiRoutes) {
    entries.push({ path: routeOf(f), kind: "api", gate: classifyGate(readFileSync(f, "utf8"), groups) });
  }

  entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));

  // No generatedAt timestamp on purpose: the file would then differ on every run and the staleness check
  // could not compare a fresh scan against the committed copy.
  const out = join(ROOT, "src/lib/access/matrix.generated.json");
  const json = JSON.stringify({ entries }, null, 2) + "\n";
  const changed = !existsSync(out) || readFileSync(out, "utf8") !== json;
  writeFileSync(out, json);

  const unknown = entries.filter(e => e.gate.kind === "unknown");
  console.log(`${changed ? "updated" : "unchanged"}  ${entries.length} entries (${workspaceLayouts.length} workspaces, ${apiRoutes.length} api routes)`);
  console.log(`  auth-only: ${entries.filter(e => e.gate.kind === "auth-only").length}   role-gated: ${entries.filter(e => e.gate.kind === "role-list" || e.gate.kind === "single-role").length}   unknown: ${unknown.length}`);
  if (unknown.length) {
    console.log("\n  Gates this scanner could not classify (reported as unknown, never as open):");
    for (const e of unknown.slice(0, 25)) console.log(`    ${e.path}${e.gate.evidence ? `  [${e.gate.evidence.replace(/\s+/g, " ").slice(0, 70)}]` : "  [no gate found]"}`);
    if (unknown.length > 25) console.log(`    ... and ${unknown.length - 25} more`);
  }
}

main();
