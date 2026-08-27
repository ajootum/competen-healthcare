/**
 * Which project does a SPAWNED harness actually resolve? — the control for privileged-harnesses --staging.
 *
 * ⚠ THIS EXISTS BECAUSE THE FAILURE IT GUARDS IS SILENT AND CATASTROPHIC. `--staging` remaps three
 * variables at spawn time and does not edit any harness. Every harness then calls
 * `loadEnvConfig(process.cwd())`, which re-reads .env.local — and .env.local names PRODUCTION. If
 * loadEnvConfig overwrote an already-set variable, all 161 writing harnesses would insert, update and
 * delete against the live project while the runner printed the staging ref and reported ALL GREEN.
 *
 * That fact was tested before any of this was built and the injection survives. But "I tested it once"
 * is not a control, and a dependency upgrade could change it without a word. So this file is spawned
 * with exactly the environment the harnesses get, resolves the target exactly as they do, and prints
 * what it found. The runner refuses to execute anything if the answer is not staging.
 *
 * ⚠ IT MUST NOT SHORT-CIRCUIT. Reading the injected value straight out of process.env would prove
 * nothing — the whole question is what survives loadEnvConfig, so loadEnvConfig has to run first, in a
 * real child process, the way a harness runs it.
 *
 * Prints one line: `RESOLVED <ref>`. Nothing else, and never a key.
 */
import { createRequire } from "node:module";
const require2 = createRequire(process.cwd() + "/");
require2("@next/env").loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";
import { refOf } from "./production-guard";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ref = refOf(url);

/**
 * ⚠ THE KEY IS CHECKED BY USING IT, NOT BY READING IT.
 *
 * The first version decoded the service-role key's JWT payload for its `ref`. That works for production,
 * whose key is a legacy JWT — and returns nothing for staging, whose key is one of Supabase's newer
 * `sb_secret_…` keys: 41 characters, no dots, no payload to read. The check reported "belongs to project
 * unreadable" and refused, which was the guard being right for the wrong reason.
 *
 * Executing it is the better test anyway, and it is the rule this repository already writes down: a pin
 * over a validating artifact must EXERCISE it rather than assert its shape. Keys are project-scoped, so a
 * key belonging to another project cannot authenticate here — which is exactly the thing worth knowing,
 * and it holds for both key formats.
 *
 * ⚠ IT READS, IT DOES NOT WRITE. A probe that proved write access by writing would be the first thing to
 * leave a row behind on whatever project it turned out to be pointed at.
 */
async function main() {
  let auth = "fail:no-key";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (key && url) {
    const c = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await c.from("hq_capability").select("code", { count: "exact", head: true });
    auth = error ? `fail:${(error.code || error.message).slice(0, 24).replace(/\s+/g, "_")}` : "ok";
  }
  console.log(`RESOLVED ${ref ?? "none"} AUTH ${auth}`);
}
main();
