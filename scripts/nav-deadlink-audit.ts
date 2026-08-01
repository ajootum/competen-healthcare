/**
 * Dead-link audit for every workspace sidebar.
 *
 * A nav entry pointing at a route with no page is invisible in review and invisible in the build: Next
 * renders whatever catch-all is nearest, so the user gets a "next phase" placeholder for a feature that
 * exists somewhere else. The UMW harness already checks this for one workspace; the same defect can hide in
 * any of the other sixteen, so this checks all of them at once.
 *
 * It reports and changes nothing.
 *
 *   npx --yes tsx scripts/nav-deadlink-audit.ts
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const APP = join(ROOT, "src/app");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

// Does this path resolve to a page? A real page.tsx, or a dynamic/catch-all segment that would match it.
function resolves(href: string): "page" | "dynamic" | "catchall" | "none" {
  const seg = href.split(/[?#]/)[0].replace(/^\//, "");
  if (!seg) return existsSync(join(APP, "page.tsx")) ? "page" : "none";
  if (existsSync(join(APP, seg, "page.tsx"))) return "page";
  // A nav entry can legitimately point at an API route — the CSV export links do. Those are served by
  // route.ts, not page.tsx, and checking only for pages reported all four as dead when none were.
  if (existsSync(join(APP, seg, "route.ts"))) return "page";

  const parts = seg.split("/");
  // A [param] sibling at the final level matches, e.g. /supervisor/patient-card/[id].
  const parent = join(APP, ...parts.slice(0, -1));
  if (existsSync(parent)) {
    for (const e of readdirSync(parent)) {
      if (e.startsWith("[") && existsSync(join(parent, e, "page.tsx"))) return "dynamic";
    }
  }
  // A [section] catch-all ABOVE it swallows the route — this is the one that hides a dead link behind a
  // placeholder rather than a 404, so it is reported separately.
  for (let i = parts.length - 1; i >= 1; i--) {
    const dir = join(APP, ...parts.slice(0, i));
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir)) {
      if (e.startsWith("[") && existsSync(join(dir, e, "page.tsx"))) return "catchall";
    }
  }
  return "none";
}

function main() {
  // Layouts AND the config engines under src/lib. Scanning only layouts reported a confident "every nav
  // entry resolves" while missing the supervisor workspace entirely — its 48 entries live in
  // src/lib/ssw/navigation.ts, so the one workspace with a known dead link was the one not audited.
  const sources = [
    ...walk(APP).filter(f => /[\\/]layout\.tsx$/.test(f)),
    ...walk(join(ROOT, "src/lib")).filter(f => /\.tsx?$/.test(f) && /href:\s*"\//.test(readFileSync(f, "utf8"))),
  ];
  const rows: { ws: string; href: string; verdict: string }[] = [];

  for (const f of sources) {
    const src = readFileSync(f, "utf8");
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    const ws = rel.startsWith("src/app/") ? rel.split("/")[2] : rel.replace("src/lib/", "lib:").replace(/\/[^/]*$/, "");
    // Nav entries only: an href in a nav-item object literal, not every <Link> on the page.
    const hrefs = [...src.matchAll(/href:\s*"(\/[^"]*)"/g)].map(m => m[1]);
    for (const href of [...new Set(hrefs)]) {
      const v = resolves(href);
      if (v !== "page" && v !== "dynamic") rows.push({ ws, href, verdict: v });
    }
  }

  const layoutsWithNav = sources.filter(f => /href:\s*"\//.test(readFileSync(f, "utf8")));
  console.log(`\nWorkspace nav dead-link audit\n`);
  console.log(`  ${layoutsWithNav.length} source(s) declare nav entries (layouts + src/lib nav engines)`);

  if (rows.length === 0) {
    console.log(`  every nav entry resolves to a real page\n`);
    return;
  }

  const swallowed = rows.filter(r => r.verdict === "catchall");
  const missing = rows.filter(r => r.verdict === "none");

  if (swallowed.length) {
    console.log(`\n  ${swallowed.length} entr(y/ies) SWALLOWED BY A CATCH-ALL — the user sees a placeholder,`);
    console.log(`  not a 404, so the feature looks unbuilt even when it exists elsewhere:`);
    for (const r of swallowed) console.log(`    ${r.ws.padEnd(18)} ${r.href}`);
  }
  if (missing.length) {
    console.log(`\n  ${missing.length} entr(y/ies) resolve to NOTHING AT ALL:`);
    for (const r of missing) console.log(`    ${r.ws.padEnd(18)} ${r.href}`);
  }
  console.log();
  process.exit(1);
}

main();
