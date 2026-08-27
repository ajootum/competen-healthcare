/**
 * PLAT-GOV-001 s5 / PLAT-GOV-MC-001 s8 - one identity, many appointments, ONE active governance context.
 *
 * Run:  npx --yes tsx scripts/governance-context-harness.ts
 *
 * ⚠ THIS FILE TESTS AN AUTHORIZATION PATH, so its fixtures grant real access for the seconds they exist.
 * Every one is created with a recorded id and deleted BY THAT ID in a finally block - never by clearing a
 * table. An earlier harness in this codebase asserted over an empty appointments table, and the obvious fix
 * for it would have deleted real governance appointments.
 *
 * ⚠ THE PROPERTY THAT MATTERS MOST IS NEGATIVE: the context cookie must never be able to WIDEN what an
 * identity may do. Everything in section B is that one property approached from four directions.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { listGovernanceContexts, resolveActiveGovernance, recordContextSwitch } from "../src/lib/hq/governance-context";
import { resolveHqPositions } from "../src/lib/hq/context";
import { isHqOfficeType } from "../src/lib/hq/spaces";

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
  console.log("\nGOVERNANCE CONTEXT SWITCHING\n");

  // ── Structural, no credentials needed ───────────────────────────────────────────────────────────
  console.log("  -- structural --");
  const ctxSrc = strip(readFileSync("src/lib/hq/context.ts", "utf8"));
  const layoutSrc = strip(readFileSync("src/app/super-admin/layout.tsx", "utf8"));
  const switchSrc = strip(readFileSync("src/app/api/governance/context/switch/route.ts", "utf8"));

  ok("S1", /resolveActiveGovernance\(admin, user\.id, selected\)/.test(ctxSrc),
    "resolveHqContext resolves the ACTIVE governance context");

  // ⚠ S1 ALONE WAS NOT ENOUGH, AND A DELIBERATE BREAK PROVED IT. Reverting the two lines BELOW the call to
  // the old union left S1 green, because the call itself was untouched -- the resolver ran and its answer
  // was then thrown away. Calling a narrowing function is not narrowing. These pin the expressions that
  // actually decide, and they are exact rather than prefixes for the same reason.
  ok("S1b", /const positions = governance\.active \? \[governance\.active\.positionCode\] : \[\];/.test(ctxSrc)
        && /const capabilities = governance\.active \? governance\.active\.capabilities : \[\];/.test(ctxSrc),
    "...and authorization is built from that ONE context, not from the union of every position held");

  // ⚠ THE DOOR MUST STAY THE UNION. If the layout narrowed too, an identity whose active context is narrow
  // could be refused the building it needs to enter in order to change context.
  //
  // ⚠ ANCHORED TO THE END OF THE STATEMENT. A prefix match passed a break that appended `.slice(0, 0)` --
  // the call was still there and returned nothing, which is precisely the lockout this guards against.
  /**
   * ⚠ THIS PINNED ONE EXACT SPELLING AND A LEGITIMATE REFACTOR BROKE IT -- 2026-08-27.
   *
   * It required, character for character:
   *   const hqCapabilities = isOwner ? [] : (await resolveHqPositions(admin, user.id)).capabilities;
   *
   * The layout now resolves into a named binding first, because it needs `positions` and `positionNames`
   * from the SAME call -- the resolver returns them as extra columns on a query it already makes, and
   * this layout runs on all 205 HQ pages, so a second resolution is a real cost. The door still asks for
   * the FULL set. Only the spelling moved, and the assertion went red against strictly better code.
   *
   * !! THE EXACTNESS WAS NOT A MISTAKE, WHICH IS WHY THIS IS NOT SIMPLY LOOSENED. The note it replaces
   * records a real break that a PREFIX match let through: appending `.slice(0, 0)` to the call left the
   * call present and returned nothing -- precisely the lockout this guards. So the property is asserted
   * as a conjunction over the whole resolve-and-derive region: the call is made with the real arguments,
   * the capabilities come from it, NOTHING narrows them, and the owner branch yields an empty list rather
   * than a narrowed one. A rename or a re-spelling passes; `.slice(0, 0)` anywhere in the region does not.
   */
  const region = (() => {
    const from = layoutSrc.indexOf("const hqPositions");
    if (from < 0) return "";
    const decl = layoutSrc.indexOf("const hqCapabilities", from);
    if (decl < 0) return "";
    const end = layoutSrc.indexOf(";", decl);
    return end < 0 ? "" : layoutSrc.slice(from, end + 1);
  })();
  const doorIsFull = (src: string) =>
    src.length > 0
    && /await resolveHqPositions\(\s*admin\s*,\s*user\.id\s*\)/.test(src)   // the real call, real arguments
    && /\.capabilities\b/.test(src)                                          // capabilities come from it
    && !/\.(slice|filter|splice|shift|pop)\s*\(/.test(src)                   // and nothing narrows them
    && /isOwner/.test(src) && /capabilities:\s*\[\]|\?\s*\[\]/.test(src);    // owner short-circuits to empty

  ok("S2", doorIsFull(region),
    "the /super-admin door still asks resolveHqPositions for the FULL set -- getting IN is 'any live appointment', not the active one");

  // ⚠ THE DETECTOR'S OWN CONTROL, feeding it the exact break the note above describes. A predicate that
  // cannot refuse is indistinguishable from a door that is open, and this one is now four clauses long --
  // far easier to get subtly wrong than the single literal it replaced.
  ok("S2-control", !doorIsFull(region.replace(/\.capabilities\b/, ".capabilities.slice(0, 0)")),
    "...and the check still REFUSES a door narrowed with .slice(0, 0) -- the break a prefix match once passed");

  ok("S3", /before\.available\.find\(c => c\.appointmentId === appointmentId\)/.test(switchSrc),
    "the switch route validates the submitted id against the CALLER'S OWN resolved contexts");
  ok("S4", /status: 403/.test(switchSrc) && /not one of your governance contexts/.test(switchSrc),
    "...and refuses anything else with 403, naming no appointment");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    skip("A*-L*", "no Supabase service credentials");
    console.log(`\n${failures.length ? "RED" : "ALL GREEN"}  ${pass} passed, ${failures.length} failed, ${skips.length} skipped`);
    process.exit(failures.length ? 1 : 0);
  }
  const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

  let fixtureApptId: string | null = null;
  try {
    // ── A. Listing ────────────────────────────────────────────────────────────────────────────────
    console.log("\n  -- A. listing contexts --");
    const { data: profiles } = await admin.from("profiles").select("id, full_name, role, roles").limit(500);
    const nonOwners = (profiles ?? []).filter((p: any) =>
      !((p.roles?.length ? p.roles : [p.role]).filter(Boolean) as string[]).includes("super_admin"));

    const withContexts: any[] = [];
    for (const p of nonOwners) {
      const cs = await listGovernanceContexts(admin, p.id);
      if (cs.length) withContexts.push({ p, cs });
    }
    ok("A0-control", withContexts.length > 0,
      `count control: ${withContexts.length} non-owner identity(ies) hold at least one governance context`);

    const subject = withContexts[0];
    ok("A1", subject.cs.length >= 1 && subject.cs[0].capabilities.length > 0,
      `${subject.p.full_name} holds ${subject.cs.length} context(s), the first carrying ${subject.cs[0].capabilities.length} capabilities`);

    const noneHolder = nonOwners.find((p: any) => !withContexts.some(w => w.p.id === p.id));
    if (!noneHolder) skip("A2", "every non-owner holds a context");
    else ok("A2", (await listGovernanceContexts(admin, noneHolder.id)).length === 0,
      "an identity holding no appointment lists no contexts -- A1 is not a function that always returns rows");

    // ── B. The cookie cannot widen ────────────────────────────────────────────────────────────────
    console.log("\n  -- B. the cookie is a hint, never a grant --");
    const baseline = await resolveActiveGovernance(admin, subject.p.id, null);
    const baseCaps = baseline.active?.capabilities ?? [];
    ok("B0-control", baseCaps.length > 0, `count control: baseline context grants ${baseCaps.length} capabilities`);

    // ⚠ ANY appointment belonging to somebody else will do, and looking only at other NON-OWNERS made this
    // skip when a perfectly good foreign id existed -- the platform owner's own appointment. A skipped
    // negative test is a test nobody ran.
    const { data: foreignRows } = await admin.from("ogs_office_appointments")
      .select("id, person_id").neq("person_id", subject.p.id).limit(5);
    const foreignId = ((foreignRows ?? []) as any[])[0]?.id ?? null;
    if (!foreignId) skip("B1", "no appointment belonging to another identity exists to try");
    else {
      const foreign = await resolveActiveGovernance(admin, subject.p.id, foreignId);
      ok("B1", foreign.active?.appointmentId === baseline.active?.appointmentId
            && (foreign.active?.capabilities.length ?? 0) === baseCaps.length,
        "a cookie naming SOMEBODY ELSE'S real appointment selects nothing and falls back to their own default");
    }

    const garbage = await resolveActiveGovernance(admin, subject.p.id, "not-an-id-at-all");
    ok("B2", garbage.active?.appointmentId === baseline.active?.appointmentId
          && garbage.active?.capabilities.length === baseCaps.length,
      "a garbage cookie falls back to their own default with the same capabilities");

    // ── C. Narrowing, proved with a real second appointment ───────────────────────────────────────
    console.log("\n  -- C. one active context, not the union --");
    const { data: offices } = await admin.from("ogs_offices").select("id, office_type, is_active, status").limit(500);
    const hqOffice = ((offices ?? []) as any[]).find(o =>
      isHqOfficeType(o.office_type) && o.is_active !== false && o.status !== "dissolved" && o.status !== "archived");
    const held = new Set(subject.cs.map((c: any) => c.positionCode));
    const { data: allPos } = await admin.from("hq_position").select("code, is_active").limit(50);
    const spare = ((allPos ?? []) as any[]).find(p => p.is_active !== false && !held.has(p.code));

    if (!hqOffice || !spare) skip("C1-C3", "no spare HQ office/position to build a second appointment from");
    else {
      const { data: made, error: mkErr } = await admin.from("ogs_office_appointments").insert({
        office_id: hqOffice.id, person_id: subject.p.id, person_name: subject.p.full_name,
        role: spare.code, status: "active",
      }).select("id").single();
      if (mkErr || !made) skip("C1-C3", `fixture appointment could not be created: ${mkErr?.message}`);
      else {
        fixtureApptId = made.id;
        const both = await listGovernanceContexts(admin, subject.p.id);
        ok("C0-control", both.length === subject.cs.length + 1,
          `count control: the subject now holds ${both.length} contexts (was ${subject.cs.length})`);

        const union = (await resolveHqPositions(admin, subject.p.id)).capabilities;
        const nowActive = await resolveActiveGovernance(admin, subject.p.id, null);
        const activeCaps = nowActive.active?.capabilities ?? [];

        // ⚠ THE DEVIATION, MEASURED. The union is what the product used to hand out.
        ok("C1", activeCaps.length < union.length,
          `the ACTIVE context grants ${activeCaps.length} capabilities where the union grants ${union.length} -- acceptance 4, a director cannot act in another product from the same shell`);

        ok("C2", nowActive.defaulted === true,
          "holding two contexts with none chosen is reported as DEFAULTED, so the screen can say so rather than imply a decision");

        const second = both.find(c => c.appointmentId !== nowActive.active?.appointmentId)!;
        const switched = await resolveActiveGovernance(admin, subject.p.id, second.appointmentId);
        ok("C3", switched.active?.appointmentId === second.appointmentId
              && switched.active?.capabilities.join(",") !== activeCaps.join(","),
          "choosing their OWN other appointment DOES switch, and to a different capability set -- B1/B2 are the validation, not a resolver that ignores the cookie");

        // ── D. Audit ────────────────────────────────────────────────────────────────────────────
        console.log("\n  -- D. the audit event (GOV-001 s17) --");
        const stamp = `harness-${made.id}`;
        await recordContextSwitch(admin, {
          userId: subject.p.id, userName: subject.p.full_name,
          from: nowActive.active, to: second, traceId: stamp,
        });
        const { data: rows } = await admin.from("audit_log")
          .select("action, entity_id, old_value, new_value")
          .eq("trace_id", stamp).limit(5);
        const row = (rows ?? [])[0];
        ok("D1", !!row && row.action === "governance_context_switched",
          `the switch is recorded as governance_context_switched (${(rows ?? []).length} row(s))`);
        ok("D2", !!row?.old_value?.appointment_id && row?.new_value?.appointment_id === second.appointmentId,
          "...naming BOTH the context left and the context entered");
        if (row) await admin.from("audit_log").delete().eq("trace_id", stamp);
      }
    }

    // ── E. Owners ─────────────────────────────────────────────────────────────────────────────────
    console.log("\n  -- E. ownership is not an appointment --");
    ok("E1", /if \(isOwner\) \{[\s\S]{0,400}?activeContext: null, availableContexts: \[\], contextDefaulted: false,/.test(ctxSrc),
      "the owner branch returns no context and reads nothing -- no context resolution can lock a platform owner out");
    // ⚠ ANCHOR ON THE CALL, NOT THE NAME. The first `resolveActiveGovernance` in that file is the IMPORT,
    // which precedes everything -- so a bare-name search made this permanently red while saying nothing
    // about ordering. Exactly the bug W3 hit in api-membership-harness.
    ok("E2", ctxSrc.indexOf("if (isOwner)") < ctxSrc.indexOf("resolveActiveGovernance(admin,"),
      "...and it is tested BEFORE the context is resolved, not after");

  } finally {
    if (fixtureApptId) {
      await admin.from("ogs_office_appointments").delete().eq("id", fixtureApptId);
      const { data: gone } = await admin.from("ogs_office_appointments").select("id").eq("id", fixtureApptId).limit(1);
      const { count } = await admin.from("ogs_office_appointments").select("id", { count: "exact" }).limit(1);
      ok("Z1", (gone ?? []).length === 0,
        `the fixture appointment is deleted BY ID (${count} real appointment(s) remain, untouched)`);
    }
  }

  console.log(`\n${failures.length ? "RED" : "ALL GREEN"}  ${pass} passed, ${failures.length} failed, ${skips.length} skipped`);
  if (failures.length) { console.log("\nFAILURES:"); failures.forEach(f => console.log("  " + f)); }
  process.exit(failures.length ? 1 : 0);
})();
