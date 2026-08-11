/**
 * CP-SPLIT-002 — platform membership at the API boundary.
 *
 * Run:  npx --yes tsx scripts/api-membership-harness.ts
 *
 * ⚠ WHAT THIS IS ABOUT. The eleven estate layouts call admitToEstate; until now no API route did. Gate 1
 * was enforced where pages are RENDERED and nowhere where data is WRITTEN, so an identity the estate had
 * stopped admitting could still drive all 430 route handlers directly.
 *
 * ⚠ AND WHAT IT IS NOT ABOUT. Membership is not a permission. Passing this gate proves somebody is on the
 * Competen Platform at all; the role predicates (isSuper / isAdmin / isStaff) still decide what they may
 * do. A green run here says nothing about whether any individual route is correctly scoped.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { admitToEstate, readPlatformMembership, holdsEstateBreakGlass } from "../src/lib/platform-membership";

loadEnvConfig(process.cwd());

let pass = 0;
const failures: string[] = [];
const skips: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};
const skip = (id: string, msg: string) => { skips.push(id); console.log(`  SKIP  ${id}  ${msg}`); };

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

const walk = (d: string, o: string[] = []): string[] => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, o);
    else if (e === "route.ts") o.push(p);
  }
  return o;
};

(async () => {
  console.log("\nAPI MEMBERSHIP BOUNDARY\n");

  // ── 1. The wiring ───────────────────────────────────────────────────────────────────────────────
  console.log("  -- 1. getCaller asks the question --");
  const src = strip(readFileSync("src/lib/api-auth.ts", "utf8"));

  ok("W1", /admitToEstate\(\s*admin\s*,\s*user\.id\s*,\s*roles/.test(src),
    "getCaller calls admitToEstate with the authenticated user and their roles");
  // ⚠⚠ THIS PINNED THE SPELLING OF THE CONDITION AND HAS BEEN RED SINCE THE PLANE FIX LANDED.
  //
  // It required `if (` to be immediately followed by `!(await admitToEstate`. When the estate gate gained
  // its `opts.plane !== "practice"` guard -- the fix for the regression that 403'd 115 of 125 practice
  // routes -- the condition grew a first term and this assertion went red against the CORRECTION for the
  // very bug it exists to guard. It then sat red, which is how an assertion stops being read.
  //
  // The property was never the spelling. It is: THE ESTATE GATE'S ONLY OUTCOME ON REFUSAL IS `forbidden`
  // -- it does not warn and continue, and it does not fall through to the role predicates. So the
  // statement is sliced from the call to its terminator and that is what is asserted.
  const gateStart = src.indexOf("admitToEstate(admin");
  const gateEnd = src.indexOf(";", gateStart);
  const gate = gateStart > 0 ? src.slice(src.lastIndexOf("if", gateStart), gateEnd + 1) : "";
  ok("W2", /^if\s*\(/.test(gate) && gate.includes(".admitted") && gate.includes("return forbidden"),
    "a refused membership returns forbidden -- it does not fall through to the role predicates");
  ok("W2b", gateStart > 0 && gateEnd > gateStart && gate.length < 400,
    "the sliced statement is the estate gate alone, not half the file");
  // ⚠ AND THE PLANE TERM IS PART OF THE PROPERTY NOW, not an inconvenience the regex has to tolerate.
  // Without it this gate stands in front of gate 2 again, which is the whole regression.
  ok("W2c", gate.includes('plane !== "practice"'),
    "the estate gate does not apply to practice routes -- COMP-ARCH-PSA-001 keeps the gates separate");

  // ⚠ ORDER. The membership read must happen AFTER the profile read (it needs `roles` for break-glass) and
  // BEFORE the Caller is returned, or a refused identity is handed to a route anyway.
  // ⚠ ANCHOR ON THE CALL, NOT THE NAME. The first `admitToEstate` in this file is the IMPORT on line 4,
  // which precedes everything -- so searching for the bare name made this assertion permanently red and
  // said nothing about ordering.
  const posProfile = src.indexOf("from(\"profiles\")");
  const posAdmit = src.indexOf("await admitToEstate(");
  const posReturn = src.indexOf("return { admin, userId");
  ok("W3", posProfile > -1 && posAdmit > posProfile && posReturn > posAdmit,
    "the gate sits between the profile read and the Caller it would otherwise return");

  // ── 2. The posture, asserted on the real helper ──────────────────────────────────────────────────
  console.log("\n  -- 2. the three states --");
  ok("P1", holdsEstateBreakGlass(["super_admin"] as any) && !holdsEstateBreakGlass(["hospital_admin"] as any),
    "super_admin is break-glass and hospital_admin is not");

  // ⚠ A CLIENT THAT THROWS IS THE UNREADABLE CASE, AND IT MUST ADMIT. A transient database fault must not
  // turn every API in the product into a 403 for everybody at once.
  const throwing = { from: () => { throw Object.assign(new Error("down"), { code: "ECONNRESET" }); } };
  const unreadable = await readPlatformMembership(throwing, "anyone");
  ok("P2", unreadable.state === "unreadable",
    `a throwing client reads as unreadable, not as not_member (got ${unreadable.state})`);
  const admittedAnyway = await admitToEstate(throwing, "anyone", ["hospital_admin"] as any);
  ok("P3", admittedAnyway.admitted && admittedAnyway.reason === "store_unreadable",
    "an unreadable store ADMITS and says so -- the role gate remains the operative check");

  // The control: the same helper must actually be capable of refusing, or P3 proves nothing.
  const emptyStore = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
  const refused = await admitToEstate(emptyStore, "anyone", ["hospital_admin"] as any);
  ok("P4-control", !refused.admitted && refused.reason === "no_platform_membership",
    "control: a store that answers 'no such row' REFUSES -- P3 is the unreadable branch, not a helper that admits everybody");

  const owner = await admitToEstate(emptyStore, "anyone", ["super_admin"] as any);
  ok("P5", owner.admitted && owner.reason === "owner_break_glass",
    "an owner is admitted by the SAME empty store that refused the non-owner -- no read can lock them out");

  // ── 3. Coverage: how much of the API surface this actually reaches ───────────────────────────────
  console.log("\n  -- 3. coverage --");
  const routes = walk("src/app/api");
  const viaGetCaller = routes.filter(f => /getCaller\s*\(/.test(strip(readFileSync(f, "utf8"))));
  const viaPractice = routes.filter(f => /requirePracticeContext/.test(strip(readFileSync(f, "utf8"))));
  ok("C1", routes.length > 300 && viaGetCaller.length > 100,
    `count control: ${routes.length} route files, ${viaGetCaller.length} route through getCaller (both non-trivial)`);
  console.log(`        ⚠ ${routes.length - viaGetCaller.length - viaPractice.length} route file(s) reach neither getCaller nor requirePracticeContext -- this gate does not cover them.`);

  // ── 4. Live ─────────────────────────────────────────────────────────────────────────────────────
  console.log("\n  -- 4. live --");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { skip("L*", "no Supabase service credentials"); }
  else {
    const admin = createClient(url, key, { auth: { persistSession: false } }) as any;
    const { data: profiles, error: pErr } = await admin.from("profiles").select("id, full_name, role, roles").limit(1000);
    if (pErr) skip("L*", `profiles unreadable: ${pErr.message}`);
    else {
      const rolesOf = (p: any) => ((p.roles?.length ? p.roles : [p.role]) as any[]).filter(Boolean) as string[];
      const estate = (profiles ?? []).filter((p: any) => rolesOf(p).length > 0);
      const practiceOnly = (profiles ?? []).filter((p: any) => rolesOf(p).length === 0);

      const admissions = await Promise.all(estate.map(async (p: any) =>
        ({ p, adm: await admitToEstate(admin, p.id, rolesOf(p) as any) })));
      const refusedEstate = admissions.filter(a => !a.adm.admitted);

      ok("L1", estate.length > 0, `count control: ${estate.length} estate-role holder(s) evaluated`);
      ok("L2", refusedEstate.length === 0,
        `NOBODY who can use the product today is refused by this gate${refusedEstate.length ? ` -- ${refusedEstate.slice(0, 5).map(a => a.p.full_name).join(", ")}` : ""}`);

      // ⚠ THE HALF THAT PROVES THE GATE IS A GATE. If every identity passed, L2 would be green for a
      // predicate that never refuses. A practice-only account is exactly who gate 1 exists to stop.
      if (!practiceOnly.length) skip("L3", "no practice-only account exists to test the refusal against");
      else {
        const po = await Promise.all(practiceOnly.map(async (p: any) =>
          ({ p, adm: await admitToEstate(admin, p.id, [] as any) })));
        const stopped = po.filter(a => !a.adm.admitted);
        ok("L3", stopped.length === po.length,
          `all ${po.length} practice-only account(s) are REFUSED the estate API (${stopped.map(a => a.p.full_name).join(", ")}) -- L2 is not a predicate that admits everybody`);
      }
    }
  }

  console.log(`\n${failures.length ? "RED" : "ALL GREEN"}  ${pass} passed, ${failures.length} failed, ${skips.length} skipped`);
  if (failures.length) { console.log("\nFAILURES:"); failures.forEach(f => console.log("  " + f)); }
  process.exit(failures.length ? 1 : 0);
})();
