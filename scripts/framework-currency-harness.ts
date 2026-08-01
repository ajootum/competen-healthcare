/**
 * Framework currency harness (XWI P2-10b).
 *
 * THE GAP. A decision is made against a framework AS IT WAS. The framework then publishes a new version or
 * is withdrawn, and nothing downstream notices: the passport and the public /verify page present a decision
 * from v1.0.0 exactly as one from the current v2.0.0. On /verify that matters most, because the reader is a
 * third party with no other source.
 *
 * MEASURED FIRST, so the claim is sized honestly: all 15 frameworks are currently published and active, so
 * this is a LATENT hole, not live exposure. What IS live is that 77 of 77 decisions carry no
 * framework_version at all -- they predate the stamp.
 *
 * WHICH MAKES `unstamped` THE ASSERTION THAT MATTERS. Treating a missing stamp as current would make every
 * one of those 77 look verified against today's standard, and would make the passport look cleanest exactly
 * where the platform knows least. "We did not record which version this was assessed against" and "this is
 * current" are different facts, and only one of them is true.
 *
 * Deliberately UNIT-style over the real engine, with one live-data assertion at the end. The states being
 * checked (retired framework, superseded version) cannot be produced without unpublishing a real framework
 * or bumping a real version, and a harness that mutates governed content to test itself is a worse idea than
 * one that constructs the map it judges.
 *
 *   npx --yes tsx scripts/framework-currency-harness.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assessCurrency, summariseCurrency, loadFrameworkCurrency, semver, type FrameworkCurrency } from "../src/lib/competency/framework-currency";
loadEnvConfig(process.cwd());

const admin: any = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const fw = (over: Partial<FrameworkCurrency> = {}): FrameworkCurrency => ({
  id: "FW", name: "Test framework", version: "1.0.0", pubStatus: "published", isActive: true, ...over,
});
const map = (f: FrameworkCurrency) => new Map([[f.id, f]]);

async function main() {
  // 1 -- the happy case must actually be reachable, or every other assertion is trivially satisfied.
  const current = assessCurrency({ framework_id: "FW", framework_version: "1.0.0" }, map(fw()));
  ok("1. a decision stamped at the current version reports current",
    current.state === "current" && current.caveat === false, JSON.stringify(current.state));

  // 2 -- THE ONE THAT MATTERS. All 77 live decisions are in this state.
  const unstamped = assessCurrency({ framework_id: "FW", framework_version: null }, map(fw()));
  ok("2. an UNSTAMPED decision does not report as current",
    unstamped.state === "unstamped" && unstamped.caveat === true, JSON.stringify(unstamped.state));

  // 3 -- version drift.
  const superseded = assessCurrency({ framework_id: "FW", framework_version: "1.0.0" }, map(fw({ version: "2.1.0" })));
  ok("3. a decision against an earlier version reports superseded",
    superseded.state === "superseded" && superseded.caveat === true
    && superseded.assessedVersion === "1.0.0" && superseded.currentVersion === "2.1.0",
    JSON.stringify(superseded));

  // 4 -- withdrawal outranks drift: which version stops being the interesting question.
  const retiredDraft = assessCurrency({ framework_id: "FW", framework_version: "1.0.0" }, map(fw({ pubStatus: "draft" })));
  const retiredInactive = assessCurrency({ framework_id: "FW", framework_version: "1.0.0" }, map(fw({ isActive: false })));
  ok("4. an unpublished OR inactive framework reports retired",
    retiredDraft.state === "retired" && retiredInactive.state === "retired",
    `${retiredDraft.state} / ${retiredInactive.state}`);
  const retiredAndOld = assessCurrency({ framework_id: "FW", framework_version: "1.0.0" }, map(fw({ pubStatus: "draft", version: "9.0.0" })));
  ok("4b. withdrawal outranks version drift", retiredAndOld.state === "retired", retiredAndOld.state);

  // 5 -- a FAILED lookup must not manufacture reassurance. loadFrameworkCurrency returns an empty map on
  // error so pages still render; if `assessCurrency` then defaulted to current, a broken query would turn
  // every entry green. That is the exact fail-soft shape this codebase keeps being bitten by.
  const missing = assessCurrency({ framework_id: "FW", framework_version: "1.0.0" }, new Map());
  ok("5. a framework missing from the map reports unknown, NOT current",
    missing.state === "unknown_framework" && missing.caveat === true, missing.state);

  // 6 -- the summary must count caveats, since the banner is driven off it.
  const s = summariseCurrency([current, unstamped, superseded, retiredDraft, missing]);
  ok("6. the summary counts every caveated state",
    s.total === 5 && s.current === 1 && s.caveated === 4
    && s.unstamped === 1 && s.superseded === 1 && s.retired === 1 && s.unknown === 1,
    JSON.stringify(s));

  // 7 -- semver assembly must match the PRODUCER in src/lib/engines/decisions.ts. Two different assemblies
  // of the same version compare unequal, and every decision would report superseded forever.
  ok("7. semver assembly treats absent parts as 0",
    semver({ version_major: 1 }) === "1.0.0" && semver({}) === "0.0.0"
    && semver({ version_major: 2, version_minor: 3, version_revision: 4 }) === "2.3.4");

  // 8 -- against the LIVE database: the loader resolves real frameworks, and a real decision is judged.
  const { data: decs } = await admin.from("competency_decisions").select("framework_id, framework_version").not("framework_id", "is", null).limit(50);
  const live = await loadFrameworkCurrency(admin, (decs ?? []).map((d: any) => d.framework_id));
  ok("8. the loader resolves real frameworks from the live database", live.size > 0, `resolved=${live.size}`);
  if (decs?.length) {
    const verdict = assessCurrency(decs[0], live);
    ok("8b. a real decision is judged, and an unstamped one is not called current",
      verdict.state !== "current" || !!decs[0].framework_version,
      `state=${verdict.state} stamped=${decs[0].framework_version ?? "null"}`);
  }

  console.log(`\n${fails.length ? "FAILED" : "PASSED"}  ${pass} assertion(s)${fails.length ? `, ${fails.length} failure(s):\n  - ${fails.join("\n  - ")}` : ""}\n`);
  process.exitCode = fails.length ? 1 : 0;
}

main().catch(e => { console.error("\nHARNESS ERROR:", e instanceof Error ? e.message : e); process.exitCode = 1; });
