/**
 * A LOCAL VERIFICATION BUILD, ISOLATED FROM THE RUNNING DEV SERVER.
 *
 *   npm run build:verify
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ WHY THIS EXISTS, AND WHY THE ENV VAR ALONE WAS NOT ENOUGH.
 *
 * next.config.ts already carries the mechanism -- `distDir: process.env.NEXT_BUILD_DIR || ".next"` --
 * and a comment explaining the failure it prevents: a day of verifying commits with `npx next build`,
 * a dozen production builds written into the directory the running dev server was reading, left `.next`
 * at 1.5GB of mixed output, and localhost served an OLDER Treatment tab than the deployed site TWICE,
 * with correct source on disk and a clean `git status` both times.
 *
 * The mechanism was correct and it was optional. `npm run build` is bare `next build`, so isolation
 * depended on a person remembering to type `NEXT_BUILD_DIR=.next-verify` in front of it -- and on
 * 2026-08-24 nobody did: two `npm run build` runs went straight into `.next`, leaving 242MB of
 * production server output and a BUILD_ID sitting beside the dev server's own directory. The comment
 * describing the hazard was three hundred lines away in another file, which is exactly as much
 * protection as no comment at all.
 *
 * A rule that depends on remembering dies with the second person who does not know it exists. This
 * script is the rule made reachable: one npm command, no variable to recall, no shell-specific syntax
 * (`VAR=x cmd` is not valid in PowerShell or cmd.exe, which is what this repository is developed on).
 *
 * ⚠ `npm run build` IS DELIBERATELY LEFT ALONE. Vercel runs it and MUST write to `.next` -- the
 * platform looks for the default directory and a deployment that wrote elsewhere would produce nothing
 * to serve. This adds a second door; it does not move the first one.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */

import { spawn } from "node:child_process";
import { join } from "node:path";

/** Must match tsconfig.json's include globs and .vercelignore's exclusion. */
const VERIFY_DIR = ".next-verify";

if (process.env.NEXT_BUILD_DIR && process.env.NEXT_BUILD_DIR !== VERIFY_DIR) {
  console.error(`\n⛔ NEXT_BUILD_DIR is already set to "${process.env.NEXT_BUILD_DIR}".`);
  console.error(`   This script builds into ${VERIFY_DIR} and will not silently override you.\n`);
  process.exit(1);
}

console.log(`\nVerification build -> ${VERIFY_DIR}`);
console.log(`The dev server's .next is not touched.\n`);

/**
 * ⚠ SPAWN THE JS ENTRY POINT, NOT `npx` -- the same constraint dev-staging.mjs records. Node 20+
 * refuses to spawn a .cmd/.bat without a shell and throws EINVAL, so `npx.cmd` fails outright on
 * Windows, and `shell: true` would re-introduce shell quoting rules. Running the local binary's own JS
 * file under this Node has neither problem and pins the version to node_modules.
 */
const nextBin = join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_BUILD_DIR: VERIFY_DIR },
});
child.on("exit", code => process.exit(code ?? 0));
