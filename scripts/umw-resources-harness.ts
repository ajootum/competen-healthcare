/**
 * UMW-RES-001 harness — Resource Operations (migration 165).
 *
 * The rule this module lives or dies on: A SHORTAGE IS ONLY EVER MEASURED AGAINST A THRESHOLD SOMEONE SET.
 * An item with no minimum recorded must read as "no threshold set", never as healthy — a unit that never
 * configured a floor is not a well-stocked unit, and reporting it as OK is the exact failure the module
 * exists to prevent. That is tested first, as a pure function, then live.
 *
 * Also pinned: per-unit thresholds override the item default (a ward may hold a deeper buffer), a catalogued
 * item with no stock row anywhere is unrecorded rather than zero, and a failed readiness check still counts
 * as a check having happened.
 *
 *   npx --yes tsx scripts/umw-resources-harness.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { loadResourceOperations, stockState } from "../src/lib/operations/resource-operations";
loadEnvConfig(process.cwd());

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
};
const eq = (name: string, got: any, want: any) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const DAY = 86400000;

async function main() {
  console.log("\nUMW-RES-001 Resource Operations\n");

  console.log("Threshold rules (pure)");
  eq("no thresholds at all -> unset, NOT ok", stockState(0, null, null), "unset");
  eq("plenty on hand with no threshold is still unset", stockState(999, null, null), "unset");
  eq("above the minimum is ok", stockState(10, 5, 2), "ok");
  eq("exactly at the minimum counts as low", stockState(5, 5, 2), "low");
  eq("below the minimum is low", stockState(4, 5, 2), "low");
  eq("exactly at the critical level counts as critical", stockState(2, 5, 2), "critical");
  eq("below critical is critical", stockState(0, 5, 2), "critical");
  eq("critical takes precedence over low", stockState(1, 5, 2), "critical");
  eq("a minimum alone still detects a shortage", stockState(3, 5, null), "low");
  eq("a critical level alone still detects a shortage", stockState(1, null, 2), "critical");
  eq("a critical level alone, above it, is ok not unset", stockState(9, null, 2), "ok");

  // ── Live round-trip ──
  console.log("\nLive round-trip (real rows)");
  const { data: hosp } = await admin.from("hospitals").select("id, name").limit(1).single();
  if (!hosp) { console.log("  no hospital rows — cannot run"); process.exit(1); }
  const { data: dept } = await admin.from("departments").select("id, name").eq("hospital_id", hosp.id).limit(1).maybeSingle();
  console.log(`  ${hosp.name}${dept ? ` · ${dept.name}` : " · no departments"}\n`);

  const now = Date.now();
  const made: { table: string; ids: string[] }[] = [];
  const track = (t: string, rows: any[]) => made.push({ table: t, ids: rows.map(r => r.id) });

  try {
    const base: any = await loadResourceOperations(admin, hosp.id, false, { now });
    eq("migration 165 detected", base.provisioned, true);

    const { data: cat, error: cErr } = await admin.from("res_categories").insert([
      { hospital_id: hosp.id, code: "HX-BLOOD", label: "HX Blood products", kind: "consumable", critical: true, sort_order: 1 },
    ]).select("id");
    if (cErr) throw new Error(`res_categories: ${cErr.message}`);
    track("res_categories", cat!);

    // Four items covering every threshold case, including the one with no floor at all.
    // EVERY COLUMN IS SPELLED OUT ON EVERY ROW. PostgREST unifies the column list across a batch, so a column
    // present on one row becomes an explicit NULL on the others and the DEFAULT never applies — which here
    // would send NULL into a not-null `critical`.
    const { data: items, error: iErr } = await admin.from("res_items").insert([
      { hospital_id: hosp.id, category_id: cat![0].id, name: "HX O-negative", unit_of_measure: "unit", min_level: 6, critical_level: 2, critical: true },
      { hospital_id: hosp.id, category_id: cat![0].id, name: "HX Saline 500ml", unit_of_measure: "bag", min_level: 20, critical_level: 5, critical: false },
      { hospital_id: hosp.id, category_id: cat![0].id, name: "HX Unmeasured item", unit_of_measure: "box", min_level: null, critical_level: null, critical: false },
      { hospital_id: hosp.id, category_id: cat![0].id, name: "HX Never counted", unit_of_measure: "box", min_level: 3, critical_level: null, critical: false },
    ]).select("id, name");
    if (iErr) throw new Error(`res_items: ${iErr.message}`);
    track("res_items", items!);
    const byName = (n: string) => items!.find(i => i.name === n)!.id;

    const { data: stocks, error: sErr } = await admin.from("res_stock").insert([
      // At the critical level exactly.
      { hospital_id: hosp.id, item_id: byName("HX O-negative"), department_id: dept?.id ?? null, location: "HX Fridge", on_hand: 2, counted_at: new Date(now - 2 * DAY).toISOString() },
      // Comfortably above its own floor, but the UNIT override below makes it low — the per-unit rule.
      { hospital_id: hosp.id, item_id: byName("HX Saline 500ml"), department_id: dept?.id ?? null, location: "HX Store", on_hand: 25, min_level: 30, critical_level: 10, counted_at: new Date(now - 1 * DAY).toISOString() },
      // Plenty on hand, but nobody ever set a floor.
      { hospital_id: hosp.id, item_id: byName("HX Unmeasured item"), department_id: dept?.id ?? null, location: "HX Cupboard", on_hand: 500, counted_at: new Date(now - 40 * DAY).toISOString() },
    ]).select("id");
    if (sErr) throw new Error(`res_stock: ${sErr.message}`);
    track("res_stock", stocks!);

    const d: any = await loadResourceOperations(admin, hosp.id, false, { now });
    const row = (n: string) => d.stock.rows.find((r: any) => r.name === n);

    console.log("Stock");
    eq("item at its critical level reads critical", row("HX O-negative")?.state, "critical");
    eq("per-unit override beats the item default", row("HX Saline 500ml")?.state, "low");
    ok("...and the override value is what is shown", row("HX Saline 500ml")?.minLevel === 30, `got ${row("HX Saline 500ml")?.minLevel}`);
    eq("500 on hand with no threshold is unset, NOT ok", row("HX Unmeasured item")?.state, "unset");
    ok("critical rows sort to the top", d.stock.rows[0]?.state === "critical");
    eq("stale count reports its age", row("HX Unmeasured item")?.countedDaysAgo, 40);
    eq("critical item is flagged as a critical item", row("HX O-negative")?.critical, true);
    eq("category label resolves", row("HX O-negative")?.category, "HX Blood products");

    // The item deliberately given no stock row anywhere.
    ok("a catalogued item with no stock row is reported as unrecorded",
      d.stock.itemsWithoutStock.some((i: any) => i.name === "HX Never counted"),
      "an item with no stock record must not silently read as zero on hand");
    ok("...and does not appear as a stock row at all", !d.stock.rows.some((r: any) => r.name === "HX Never counted"));

    console.log("\nKPIs and signals");
    eq("critical count (delta)", d.kpis.critical - base.kpis.critical, 1);
    eq("low count (delta)", d.kpis.low - base.kpis.low, 1);
    eq("unset count (delta)", d.kpis.unset - base.kpis.unset, 1);
    const text = d.signals.map((s: any) => s.text).join(" | ");
    ok("critical shortage raises a HIGH signal", d.signals.some((s: any) => s.severity === "high" && /critical level/.test(s.text)), text);
    ok("...and names the item", /HX O-negative/.test(text), text);
    ok("missing thresholds raise their own signal", /no minimum level set/.test(text), text);

    console.log("\nRequests");
    const { data: reqs, error: rErr } = await admin.from("res_requests").insert([
      { hospital_id: hosp.id, item_id: byName("HX O-negative"), department_id: dept?.id ?? null, quantity: 4, urgency: "emergency", status: "requested", requested_by_name: "HX Manager", created_at: new Date(now - 5 * DAY).toISOString() },
      { hospital_id: hosp.id, item_id: byName("HX Saline 500ml"), quantity: 40, urgency: "routine", status: "approved", requested_by_name: "HX Manager", decided_by_name: "HX Lead", decided_at: new Date(now - 1 * DAY).toISOString(), created_at: new Date(now - 2 * DAY).toISOString() },
      { hospital_id: hosp.id, description: "HX uncatalogued trolley", quantity: 1, urgency: "routine", status: "fulfilled", created_at: new Date(now - 3 * DAY).toISOString() },
    ]).select("id");
    if (rErr) throw new Error(`res_requests: ${rErr.message}`);
    track("res_requests", reqs!);

    const withReq: any = await loadResourceOperations(admin, hosp.id, false, { now });
    const req = (n: string) => withReq.requests.rows.find((r: any) => r.itemName === n);
    eq("open requests count both requested and approved", withReq.requests.open - base.requests.open, 2);
    eq("only the undecided one is awaiting a decision", req("HX O-negative")?.awaitingDecision, true);
    eq("an approved request is NOT awaiting a decision", req("HX Saline 500ml")?.awaitingDecision, false);
    eq("a request with no catalogue item shows its description", req("HX uncatalogued trolley")?.itemName, "HX uncatalogued trolley");
    eq("request age is reported in days", req("HX O-negative")?.ageDays, 5);
    const reqText = withReq.signals.map((s: any) => s.text).join(" | ");
    ok("an open emergency request raises a HIGH signal", withReq.signals.some((s: any) => s.severity === "high" && /emergency resource request/.test(s.text)), reqText);
    ok("a request undecided for 3+ days is flagged", /awaiting a decision for three days/.test(reqText), reqText);

    console.log("\nReadiness checks");
    const { data: checks, error: chErr } = await admin.from("res_checks").insert([
      { hospital_id: hosp.id, department_id: dept?.id ?? null, check_type: "crash_cart", label: "HX Crash cart A", passed: true, checked_at: new Date(now - 10 * DAY).toISOString(), checked_by_name: "HX Nurse", next_due_at: new Date(now - 3 * DAY).toISOString() },
      { hospital_id: hosp.id, department_id: dept?.id ?? null, check_type: "crash_cart", label: "HX Crash cart A", passed: false, issues: "HX seal broken", checked_at: new Date(now - 1 * DAY).toISOString(), checked_by_name: "HX Nurse", next_due_at: new Date(now + 6 * DAY).toISOString() },
      { hospital_id: hosp.id, department_id: dept?.id ?? null, check_type: "defibrillator", label: "HX Defib 2", passed: true, checked_at: new Date(now - 2 * DAY).toISOString(), next_due_at: new Date(now - 1 * DAY).toISOString() },
    ]).select("id");
    if (chErr) throw new Error(`res_checks: ${chErr.message}`);
    track("res_checks", checks!);

    const withChecks: any = await loadResourceOperations(admin, hosp.id, false, { now });
    const cart = withChecks.readiness.latest.find((c: any) => c.label === "HX Crash cart A");
    const defib = withChecks.readiness.latest.find((c: any) => c.label === "HX Defib 2");
    eq("only the LATEST check per item is shown", withChecks.readiness.latest.filter((c: any) => c.label === "HX Crash cart A").length, 1);
    eq("...and it is the most recent one", cart?.passed, false);
    ok("a failed check carries its issue text", /seal broken/.test(String(cart?.issues)));
    eq("a past due date marks the check overdue", defib?.overdue, true);
    eq("a future due date does not", cart?.overdue, false);
    ok("a failed check still counts as a check that happened", withChecks.readiness.recorded >= 3,
      "a unit that stopped checking must not look like one that checks and passes");
    ok("failing checks raise a HIGH signal", withChecks.signals.some((s: any) => s.severity === "high" && /readiness check/.test(s.text)));

    console.log("\nCategories and isolation");
    const c = withChecks.categories.byCategory.find((x: any) => x.code === "HX-BLOOD");
    eq("category counts its items", c?.items, 4);
    eq("category counts only the tracked ones", c?.tracked, 3);
    eq("category counts its shortages", c?.shortages, 2);
    eq("category critical flag survives", c?.critical, true);

    const NONE = "00000000-0000-0000-0000-000000000000";
    const foreign: any = await loadResourceOperations(admin, NONE, false, { now });
    eq("another tenant sees no stock", foreign.stock.recorded, 0);
    eq("another tenant sees no requests", foreign.requests.recorded, 0);
    eq("another tenant sees no checks", foreign.readiness.recorded, 0);
    eq("another tenant sees no categories", foreign.categories.recorded, 0);

    console.log("\nHonest empties");
    const narrow: any = await loadResourceOperations(admin, hosp.id, false, { now, windowDays: 0 });
    eq("a zero-day window records no requests", narrow.requests.recorded, 0);
    eq("...and no checks", narrow.readiness.recorded, 0);
    ok("stock is not windowed — it is a current position, not an event",
      narrow.stock.recorded === withChecks.stock.recorded,
      "stock on hand has no time window; only requests and checks do");
  } finally {
    for (const m of [...made].reverse()) if (m.ids.length) await admin.from(m.table).delete().in("id", m.ids);
    const { data: leftI } = await admin.from("res_items").select("id").like("name", "HX %").limit(1);
    const { data: leftC } = await admin.from("res_checks").select("id").like("label", "HX %").limit(1);
    ok("harness rows removed", !leftI?.length && !leftC?.length);
  }

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"}  ${pass}/${pass + fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
