/**
 * BUILD ISOLATION -- a verification build must never write into the dev server's directory.
 *
 * WHAT IT PROVES:
 *   - next.config.ts keeps the `distDir` override, so a build CAN be redirected at all;
 *   - the default is still `.next`, because Vercel looks there and a deployment that wrote elsewhere
 *     would produce nothing to serve;
 *   - `npm run build:verify` exists, so the isolation is one command rather than a remembered
 *     environment variable -- ⚠ THE FAILURE THIS FILE EXISTS FOR: the mechanism was correct and
 *     OPTIONAL, and on 2026-08-24 two `npm run build` runs went straight into `.next`, leaving 242MB
 *     of production server output beside the running dev server's own directory;
 *   - tsconfig.json still lists the verification directory's type globs, so the isolated build
 *     type-checks the same surface the default one does;
 *   - both directories are excluded from the Vercel upload, and by ANCHORED patterns -- a bare
 *     `.next` would not match `.next-verify` anyway, and a bare `coverage` once deleted six real
 *     routes from a deploy.
 *
 * WHAT IT DOES NOT PROVE: that a build actually honours distDir. That is Next's behaviour, verified by
 * running it (2026-08-24: `.next-verify` created in 2s, `.next/BUILD_ID` and `.next/server` byte-for-
 * byte unchanged). A static harness can only keep the configuration that makes it possible.
 *
 * Run: npx --yes tsx scripts/build-isolation-harness.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
const failures: string[] = [];
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const ROOT = join(__dirname, "..");
const read = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");

const nextConfig = read("next.config.ts");
const tsconfig = read("tsconfig.json");
const vercelIgnore = read(".vercelignore");
const pkg = JSON.parse(read("package.json") || "{}");
const VERIFY_DIR = ".next-verify";

console.log("\nBuild isolation -- .next vs .next-verify\n");

// ── 1. The mechanism ─────────────────────────────────────────────────────────────────────────────
ok("1a. next.config.ts reads NEXT_BUILD_DIR for distDir",
  /distDir:\s*process\.env\.NEXT_BUILD_DIR/.test(nextConfig));
ok("1b. ⚠ the DEFAULT is still .next -- Vercel looks there and nothing else would be served",
  /distDir:\s*process\.env\.NEXT_BUILD_DIR\s*\|\|\s*"\.next"/.test(nextConfig));
ok("1c. next.config.ts still records WHY the override exists, next to the code",
  nextConfig.includes(VERIFY_DIR) && /dev server/i.test(nextConfig));

// ── 2. ⚠ THE MECHANISM IS REACHABLE, not merely present ──────────────────────────────────────────
ok("2a. ⚠ npm run build:verify exists, so isolation is a command and not a memory",
  typeof pkg.scripts?.["build:verify"] === "string", String(pkg.scripts?.["build:verify"]));
ok("2b. it runs the wrapper rather than inlining `VAR=x next build`, which no Windows shell parses",
  (pkg.scripts?.["build:verify"] ?? "").includes("scripts/build-verify.mjs"));
ok("2c. the wrapper exists and targets the verification directory",
  read("scripts/build-verify.mjs").includes(`VERIFY_DIR = "${VERIFY_DIR}"`));
ok("2d. ⚠ `npm run build` is UNCHANGED -- adding a second door must not move the first",
  pkg.scripts?.build === "next build", String(pkg.scripts?.build));

// ── 3. The isolated build type-checks the same surface ───────────────────────────────────────────
ok("3a. tsconfig includes the default build's types",
  tsconfig.includes(".next/types/**/*.ts"));
ok("3b. tsconfig includes the verification build's types",
  tsconfig.includes(`${VERIFY_DIR}/types/**/*.ts`));

// ── 4. Neither directory reaches Vercel, and the patterns are anchored ───────────────────────────
const ignoreLines = vercelIgnore.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
ok("4a. .next is excluded from the upload",
  ignoreLines.includes("/.next"), ignoreLines.filter(l => l.includes("next")).join(" "));
ok("4b. ⚠ .next-verify is excluded SEPARATELY -- `/.next` does not match it, and 2.3GB proved it",
  ignoreLines.includes(`/${VERIFY_DIR}`));
ok("4c. ⚠ every directory pattern is anchored, so none can match at depth like `coverage` did",
  ignoreLines
    .filter(l => !l.startsWith("*") && !l.startsWith("/") && !l.startsWith("!"))
    .every(l => ["node_modules", ".git", ".env", ".env.*"].includes(l)),
  ignoreLines.filter(l => !l.startsWith("*") && !l.startsWith("/") && !l.startsWith("!")).join(" "));
ok("4d. the six route directories named `coverage` are NOT excluded by an unanchored pattern",
  !ignoreLines.includes("coverage"));

console.log(`\n${pass} passed, ${failures.length} failed\n`);
if (failures.length) { failures.forEach(f => console.log(`  FAILED: ${f}`)); process.exit(1); }
