/**
 * PLAT-GOV-001 product lines + PLAT-GOV-MC-001 mission control composition.
 *
 * Run:  npx --yes tsx scripts/mission-profile-harness.ts
 *
 * ⚠ WHAT THIS PROVES AND WHAT IT DOES NOT. It proves the composition RESOLVES correctly and that each
 * widget source enforces its own capability. It does not prove the page is safe: /super-admin still passes
 * requireHqCapability, and section 10 is explicit that hiding a widget is not a security control. If this
 * file is ever cited as the reason a dashboard is safe, it is being misread.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { PRODUCT_LINES, SAAS_PRODUCT_LINES, NOT_PRODUCT_LINES } from "../src/lib/governance/product-lines";
import { resolveMissionProfile, MINIMAL_PROFILE } from "../src/lib/hq/mission-profile";
import { runWidget, REGISTERED_SOURCES } from "../src/lib/hq/mission-widgets";
import { resolveHqPositions } from "../src/lib/hq/context";

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

(async () => {
  console.log("\nGOVERNANCE PRODUCT LINES + MISSION CONTROL COMPOSITION\n");

  // ── 1. The taxonomy ─────────────────────────────────────────────────────────────────────────────
  console.log("  -- 1. the frozen product taxonomy --");
  ok("T0-control", PRODUCT_LINES.length >= 5 && SAAS_PRODUCT_LINES.length === 4,
    `count control: ${PRODUCT_LINES.length} lines, ${SAAS_PRODUCT_LINES.length} of them SaaS products`);

  ok("T1", SAAS_PRODUCT_LINES.map(p => p.code).sort().join(",") === "enterprise,individual,practice,recruitment",
    "the four SaaS lines are exactly Enterprise, Individual, Practice, Recruitment (GOV-MC-001 acceptance 2)");

  // ⚠ GOV-001 section 2 and section 18 step 1: the Platform is the FOUNDATION and must not be counted as a
  // product. Getting this wrong is what section 18 step 2 exists to migrate away from.
  ok("T2", PRODUCT_LINES.find(p => p.code === "platform")?.classification === "foundation"
        && !SAAS_PRODUCT_LINES.some(p => p.code === "platform"),
    "Competen Platform is classified as the FOUNDATION and is not one of the products");

  ok("T3", !PRODUCT_LINES.some(p => NOT_PRODUCT_LINES.includes(p.code)),
    "no role or workspace (Healthcare Worker, Educator, Assessor...) appears as a product line");

  // ── 2. Code and database agree, in both directions ──────────────────────────────────────────────
  console.log("\n  -- 2. code <-> database --");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { skip("D*", "no Supabase service credentials"); }
  else {
    const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

    const { data: lines, error: lineErr } = await admin.from("plat_product_line").select("code, classification");
    if (lineErr) skip("D1-D3", `plat_product_line unreadable (${lineErr.message}) - migration 281 may not be applied`);
    else {
      const dbCodes = new Set((lines ?? []).map((l: any) => l.code));
      const missing = PRODUCT_LINES.filter(p => !dbCodes.has(p.code)).map(p => p.code);
      const extra = (lines ?? []).filter((l: any) => !PRODUCT_LINES.some(p => p.code === l.code)).map((l: any) => l.code);
      ok("D1", missing.length === 0 && extra.length === 0,
        `catalogue and migration 281 agree in BOTH directions (missing=${missing.join(",") || "none"} extra=${extra.join(",") || "none"})`);
      ok("D2", (lines ?? []).find((l: any) => l.code === "platform")?.classification === "foundation",
        "the database also records Competen Platform as the foundation");
    }

    // ⚠ THE AXIS SEPARATION, ASSERTED. plat_products is the ENGINE catalogue with eleven readers. If a
    // future change starts writing product LINES into it the two meanings merge silently and licensing,
    // feature flags and the control plane inherit rows they were never written for.
    const { data: engines } = await admin.from("plat_products").select("code");
    const engineCodes = new Set((engines ?? []).map((e: any) => e.code));
    const leaked = SAAS_PRODUCT_LINES.filter(p => p.code !== "practice" && engineCodes.has(p.code)).map(p => p.code);
    ok("D3", (engines ?? []).length >= 8 && leaked.length === 0,
      `plat_products is untouched and separate: ${(engines ?? []).length} engine rows, no product line leaked in (${leaked.join(",") || "none"})`);

    // ── 3. Resolution ────────────────────────────────────────────────────────────────────────────
    console.log("\n  -- 3. profile resolution --");

    const owner = await resolveMissionProfile(admin, { isOwner: true, positions: [], capabilities: [] });
    ok("R1", owner.profile.governanceLevel === "hq" && owner.state === "resolved",
      `an owner resolves to an HQ profile (${owner.profile.code}, state=${owner.state}) -- and an owner's capability list is EMPTY by construction, so this must not depend on it`);

    const director = await resolveMissionProfile(admin, {
      isOwner: false, positions: ["practice_product_director"], capabilities: ["hq.practice.operations.view"],
    });
    ok("R2", director.profile.governanceLevel === "product" && director.profile.productLineCode === "practice",
      `a Practice Product Director resolves to the PRACTICE product profile (${director.profile.code})`);
    ok("R3", director.widgets.length > 0 && director.widgets.every(w => w.requiredCapability === "hq.practice.operations.view"),
      `...carrying ${director.widgets.length} widget(s), each one they hold the capability for`);

    // ⚠ SELECTED BY CONTEXT, NOT BY NAME (section 10). A position holding NO product line must not fall into
    // a product dashboard just because it is an HQ appointment.
    const nonProduct = await resolveMissionProfile(admin, {
      isOwner: false, positions: ["quality_council_member"], capabilities: ["hq.quality.assurance.view"],
    });
    ok("R4", nonProduct.profile.governanceLevel === "hq",
      `a position governing no product line resolves to HQ, not to a product (${nonProduct.profile.code})`);

    // ⚠ THE CONTROL FOR R2. If resolution matched on anything other than the product line, an unknown
    // position would still land somewhere product-shaped.
    const unknown = await resolveMissionProfile(admin, {
      isOwner: false, positions: ["a_position_that_does_not_exist"], capabilities: [],
    });
    ok("R5-control", unknown.profile.governanceLevel !== "product",
      `control: an unknown position does NOT resolve to a product profile (${unknown.profile.code}) -- R2 is the product binding, not a resolver that always finds something`);

    // ── 4. Fail closed ───────────────────────────────────────────────────────────────────────────
    console.log("\n  -- 4. fail closed (section 10) --");
    const throwing = { from: () => { throw new Error("registry down"); } };
    const failed = await resolveMissionProfile(throwing, { isOwner: false, positions: ["practice_product_director"], capabilities: [] });
    ok("F1", failed.profile.code === MINIMAL_PROFILE.code && failed.widgets.length === 0,
      "an unreadable registry falls back to the minimum safe view with no widgets");
    ok("F2", failed.state === "unreadable",
      `...and REPORTS that it is a fallback (state=${failed.state}) -- a minimal dashboard that looks deliberate is the worse failure`);

    // ⚠ A RETURNED ERROR IS A DIFFERENT PATH FROM A THROWN ONE, AND ONLY THE THROWN ONE WAS TESTED. F1 uses
    // a client whose from() throws, which lands in the catch. PostgREST does not throw -- it RETURNS
    // { data: null, error } -- so the branch that actually fires in production had no assertion, and a
    // deliberate break that made it return a real profile with state "resolved" left this section green.
    const chain = (result: any) => ({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => result }) }) }) }) });
    const errored = await resolveMissionProfile(chain({ data: null, error: { message: "permission denied" } }),
      { isOwner: false, positions: ["practice_product_director"], capabilities: [] });
    ok("F1b", errored.profile.code === MINIMAL_PROFILE.code && errored.state === "unreadable",
      `a RETURNED PostgREST error also falls back and reports it (profile=${errored.profile.code}, state=${errored.state}) -- the path that actually fires in production`);

    const empty = chain({ data: [], error: null });
    const none = await resolveMissionProfile(empty, { isOwner: true, positions: [], capabilities: [] });
    ok("F3-control", none.profile.code === MINIMAL_PROFILE.code,
      "control: an EMPTY registry also lands on the minimum -- F1 is the fallback, not one error path");

    // ⚠ THE OWNER MUST NEVER SEE THE FALLBACK ON THE PAGE. resolveMissionProfile can return the minimum for
    // reasons that have nothing to do with the viewer, and an owner whose console blanked on a failed read
    // would have to fix the registry from the dashboard the registry just blanked.
    const pageSrc = strip(readFileSync("src/app/super-admin/page.tsx", "utf8"));
    ok("F4", /if \(!ctx\.isOwner && \(composition\.profile\.governanceLevel === "product" \|\| composition\.state !== "resolved"\)\)/.test(pageSrc),
      "the page tests !isOwner FIRST, so no registry failure can take an owner's Mission Control away");

    // ── 5. Widgets enforce their own capability ──────────────────────────────────────────────────
    console.log("\n  -- 5. widgets enforce authorization independently (section 10) --");
    const src = readFileSync("src/lib/hq/mission-widgets.ts", "utf8");
    ok("W0-control", REGISTERED_SOURCES.length >= 3 && /holds\(ctx,/.test(src),
      `count control: ${REGISTERED_SOURCES.length} source(s) registered and the capability test is present`);

    for (const source of REGISTERED_SOURCES) {
      const denied = await runWidget(source, { admin, isOwner: false, capabilities: [] });
      if (denied.state !== "forbidden") {
        ok(`W1.${source}`, false, `${source} did NOT refuse a viewer holding no capability (got ${denied.state})`);
      }
    }
    ok("W1", (await Promise.all(REGISTERED_SOURCES.map(s => runWidget(s, { admin, isOwner: false, capabilities: [] }))))
        .every(r => r.state === "forbidden"),
      `every registered source REFUSES a viewer holding nothing -- the composition filter is not the control`);

    ok("W2-control", (await runWidget(REGISTERED_SOURCES[0], { admin, isOwner: true, capabilities: [] })).state !== "forbidden",
      "control: an owner is not refused by the same source -- W1 is the capability test, not a source that refuses everybody");

    ok("W3", (await runWidget("no.such.source", { admin, isOwner: true, capabilities: [] })).state === "unavailable",
      "an unregistered data source is UNAVAILABLE, never a silent empty");

    // ⚠ NO WIDGET MAY DECLARE A SOURCE NOBODY HAS WRITTEN. That is how a dashboard ships a promise.
    const { data: widgets } = await admin.from("hq_mission_widget").select("code, data_source, required_capability");
    const orphan = (widgets ?? []).filter((w: any) => !REGISTERED_SOURCES.includes(w.data_source));
    ok("W4", (widgets ?? []).length > 0 && orphan.length === 0,
      `every seeded widget has an implemented data source (${(widgets ?? []).length} seeded, ${orphan.length} orphan${orphan.length ? `: ${orphan.map((o: any) => o.data_source).join(", ")}` : ""})`);

    // ── 6. Live ──────────────────────────────────────────────────────────────────────────────────
    console.log("\n  -- 6. live --");
    const { data: people } = await admin.from("profiles").select("id, full_name, role, roles").limit(500);
    const appointees: any[] = [];
    for (const p of (people ?? [])) {
      const roles = ((p.roles?.length ? p.roles : [p.role]) as any[]).filter(Boolean) as string[];
      if (roles.includes("super_admin")) continue;
      const r = await resolveHqPositions(admin, p.id);
      if (r.capabilities.length) appointees.push({ p, ...r });
    }
    if (!appointees.length) skip("L1-L2", "no non-owner holds an HQ position");
    else {
      const s = appointees[0];
      const c = await resolveMissionProfile(admin, { isOwner: false, positions: s.positions, capabilities: s.capabilities });
      ok("L1", c.state === "resolved",
        `${s.p.full_name} resolves to ${c.profile.code} (${c.widgets.length} widget(s))`);
      const results = await Promise.all(c.widgets.map(w => runWidget(w.dataSource, { admin, isOwner: false, capabilities: s.capabilities })));
      ok("L2", results.length > 0 && results.every(r => r.state !== "forbidden"),
        `every widget they are shown actually answers for them (${results.map(r => r.state).join(", ")})`);
    }
  }

  console.log(`\n${failures.length ? "RED" : "ALL GREEN"}  ${pass} passed, ${failures.length} failed, ${skips.length} skipped`);
  if (failures.length) { console.log("\nFAILURES:"); failures.forEach(f => console.log("  " + f)); }
  process.exit(failures.length ? 1 : 0);
})();
