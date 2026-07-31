// Resource Operations (UMW-RES-001) — migration 165, over existing equipment/asset stores.
//
// THREE SOURCES, ONE VIEW, NO FOURTH EQUIPMENT TABLE:
//   op_equipment  service status of clinical equipment
//   adm_assets    the asset register (tags, custodians, maintenance and calibration dates)
//   op_resources  bookable capacity (theatres, rooms, transport)
// plus migration 165's consumable side, which genuinely did not exist: items, stock, requests, checks.
//
// SHORTAGE IS COMPUTED FROM A THRESHOLD SOMEONE SET, never from a guess. An item with no floor recorded is
// reported as "no threshold set" rather than as healthy — a unit that never configured a minimum is not a
// unit that is well stocked, and the difference is the whole point of the module.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const DAY = 86400000;

export type StockRow = {
  itemId: string; name: string; category: string | null; critical: boolean;
  unit: string; onHand: number; minLevel: number | null; criticalLevel: number | null;
  state: "critical" | "low" | "ok" | "unset";
  location: string | null; departmentId: string | null;
  countedAt: string | null; countedDaysAgo: number | null; expiresAt: string | null; expiringSoon: boolean;
};

// Thresholds resolve stock-level override -> item default. A ward may hold a deeper buffer than the
// hospital norm, and the spec asks for exactly that.
export function stockState(onHand: number, min: number | null, crit: number | null): StockRow["state"] {
  if (crit != null && onHand <= crit) return "critical";
  if (min != null && onHand <= min) return "low";
  if (min == null && crit == null) return "unset";
  return "ok";
}

export async function loadResourceOperations(
  admin: any, hid: string | null, isSuper: boolean, opts: { now?: number; windowDays?: number } = {},
) {
  const now = opts.now ?? Date.now();
  const windowDays = opts.windowDays ?? 30;
  const since = new Date(now - windowDays * DAY).toISOString();
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const soft = (p: any) => p.then((r: any) => r, () => ({ data: null, error: true }));

  const [catRes, itemRes, stockRes, reqRes, checkRes, equipRes, assetRes, capRes, deptRes] = await Promise.all([
    soft(scope(admin.from("res_categories").select("id, code, label, kind, critical, sort_order").order("sort_order"))),
    soft(scope(admin.from("res_items").select("id, category_id, name, code, unit_of_measure, min_level, critical_level, critical, active"))),
    soft(scope(admin.from("res_stock").select("id, item_id, department_id, location, on_hand, min_level, critical_level, counted_at, expires_at"))),
    soft(scope(admin.from("res_requests")
      .select("id, item_id, description, department_id, quantity, urgency, status, reason, requested_by_name, decided_by_name, decided_at, decision_note, fulfilled_at, created_at")
      .gte("created_at", since).order("created_at", { ascending: false }).limit(200))),
    soft(scope(admin.from("res_checks")
      .select("id, asset_id, department_id, check_type, label, passed, issues, checked_at, checked_by_name, next_due_at")
      .gte("checked_at", since).order("checked_at", { ascending: false }).limit(200))),
    soft(scope(admin.from("op_equipment").select("id, name, category, status"))),
    soft(scope(admin.from("adm_assets").select("id, name, asset_tag, category, status, location, maintenance_due, calibration_due, utilisation_pct"))),
    soft(scope(admin.from("op_resources").select("id, name, category, total, available, demand"))),
    soft(scope(admin.from("departments").select("id, name"))),
  ]);

  // provisioned=false means migration 165 has not been applied. The equipment half still renders from the
  // stores that always existed, so the page degrades to less rather than to nothing.
  const provisioned = !itemRes.error && !stockRes.error;

  const cats = (catRes.data ?? []) as any[];
  const items = (itemRes.data ?? []) as any[];
  const stocks = (stockRes.data ?? []) as any[];
  const requests = (reqRes.data ?? []) as any[];
  const checks = (checkRes.data ?? []) as any[];
  const equipment = (equipRes.data ?? []) as any[];
  const assets = (assetRes.data ?? []) as any[];
  const capacity = (capRes.data ?? []) as any[];
  const depts = (deptRes.data ?? []) as any[];

  const catById = new Map(cats.map(c => [c.id, c]));
  const itemById = new Map(items.map(i => [i.id, i]));
  const deptName = (id: string | null) => depts.find(d => d.id === id)?.name ?? null;

  // ── Stock ──
  const stock: StockRow[] = stocks.map(s => {
    const item = itemById.get(s.item_id) ?? {};
    const min = s.min_level ?? item.min_level ?? null;
    const crit = s.critical_level ?? item.critical_level ?? null;
    const onHand = Number(s.on_hand ?? 0);
    const countedAt = s.counted_at ?? null;
    return {
      itemId: s.item_id, name: item.name ?? "Unknown item",
      category: item.category_id ? (catById.get(item.category_id)?.label ?? null) : null,
      critical: !!item.critical, unit: item.unit_of_measure ?? "unit",
      onHand, minLevel: min, criticalLevel: crit, state: stockState(onHand, min, crit),
      location: s.location ?? deptName(s.department_id), departmentId: s.department_id ?? null,
      countedAt, countedDaysAgo: countedAt ? Math.floor((now - new Date(countedAt).getTime()) / DAY) : null,
      expiresAt: s.expires_at ?? null,
      expiringSoon: !!s.expires_at && new Date(s.expires_at).getTime() - now < 30 * DAY,
    };
  }).sort((a, b) => {
    const rank = { critical: 0, low: 1, unset: 2, ok: 3 } as const;
    return rank[a.state] - rank[b.state] || a.name.localeCompare(b.name);
  });

  const byState = (s: StockRow["state"]) => stock.filter(x => x.state === s);
  // An item with no stock row anywhere is not "zero on hand" — it is unrecorded, and saying so is the
  // difference between a stock system and a guess.
  const itemsWithoutStock = items.filter(i => i.active !== false && !stocks.some(s => s.item_id === i.id));

  const byCategory = cats.map(c => {
    const catItems = items.filter(i => i.category_id === c.id).map(i => i.id);
    const rows = stock.filter(s => catItems.includes(s.itemId));
    return {
      code: c.code, label: c.label, kind: c.kind, critical: c.critical,
      items: catItems.length, tracked: rows.length,
      shortages: rows.filter(r => r.state === "critical" || r.state === "low").length,
    };
  }).filter(c => c.items > 0);

  // ── Requests ──
  const OPEN_REQ = ["requested", "approved", "ordered"];
  const openRequests = requests.filter(r => OPEN_REQ.includes(r.status));
  const reqRows = requests.map(r => ({
    ...r,
    itemName: r.item_id ? (itemById.get(r.item_id)?.name ?? "Unknown item") : (r.description ?? "Unspecified"),
    unitName: deptName(r.department_id),
    ageDays: Math.floor((now - new Date(r.created_at).getTime()) / DAY),
    // "Awaiting a decision" is a different state from "approved but not yet delivered", and a dashboard that
    // merges them hides which one is actually blocked on a person.
    awaitingDecision: r.status === "requested",
  }));

  // ── Readiness checks ──
  const checkRows = checks.map(c => ({
    ...c, unitName: deptName(c.department_id),
    daysAgo: Math.floor((now - new Date(c.checked_at).getTime()) / DAY),
    overdue: !!c.next_due_at && new Date(c.next_due_at).getTime() < now,
  }));
  const latestByLabel = new Map<string, any>();
  for (const c of checkRows) if (!latestByLabel.has(c.label)) latestByLabel.set(c.label, c);
  const readiness = [...latestByLabel.values()];

  // ── Equipment (existing stores, unified for display only) ──
  const equipmentOut = equipment.filter(e => e.status === "out_of_service").length;
  const equipmentMaint = equipment.filter(e => e.status === "under_maintenance").length;
  const calibrationDue = equipment.filter(e => e.status === "calibration_due").length;
  const assetsDue = assets.filter(a => a.maintenance_due && new Date(a.maintenance_due).getTime() < now + 30 * DAY);
  const assetsCalDue = assets.filter(a => a.calibration_due && new Date(a.calibration_due).getTime() < now + 30 * DAY);

  // ── Signals ──
  const signals: { severity: "high" | "medium"; text: string }[] = [];
  const criticalShort = byState("critical");
  if (criticalShort.length) signals.push({ severity: "high", text: `${criticalShort.length} item(s) at or below their critical level: ${criticalShort.slice(0, 3).map(s => s.name).join(", ")}${criticalShort.length > 3 ? "…" : ""}.` });
  const lowShort = byState("low");
  if (lowShort.length) signals.push({ severity: "medium", text: `${lowShort.length} item(s) at or below their minimum level.` });
  const emergencyReq = openRequests.filter(r => r.urgency === "emergency");
  if (emergencyReq.length) signals.push({ severity: "high", text: `${emergencyReq.length} emergency resource request(s) are still open.` });
  const stale = reqRows.filter(r => r.awaitingDecision && r.ageDays >= 3);
  if (stale.length) signals.push({ severity: "medium", text: `${stale.length} request(s) have been awaiting a decision for three days or more.` });
  const failed = readiness.filter(c => !c.passed);
  if (failed.length) signals.push({ severity: "high", text: `${failed.length} readiness check(s) last failed: ${failed.slice(0, 3).map(c => c.label).join(", ")}.` });
  const overdueChecks = readiness.filter(c => c.overdue);
  if (overdueChecks.length) signals.push({ severity: "medium", text: `${overdueChecks.length} readiness check(s) are past their due date.` });
  if (equipmentOut) signals.push({ severity: "medium", text: `${equipmentOut} equipment item(s) are out of service.` });
  const unsetThresholds = byState("unset");
  if (unsetThresholds.length) signals.push({ severity: "medium", text: `${unsetThresholds.length} tracked item(s) have no minimum level set, so no shortage can be detected for them.` });

  return {
    provisioned,
    window: { days: windowDays, from: since.slice(0, 10) },
    kpis: {
      itemsTracked: items.filter(i => i.active !== false).length,
      stockRows: stock.length,
      critical: criticalShort.length,
      low: lowShort.length,
      unset: unsetThresholds.length,
      openRequests: openRequests.length,
      awaitingDecision: reqRows.filter(r => r.awaitingDecision).length,
      checksRecorded: checks.length,
      checksFailing: failed.length,
      equipmentOut, equipmentMaint, calibrationDue,
    },
    categories: { recorded: cats.length, byCategory },
    stock: { recorded: stock.length, rows: stock, itemsWithoutStock: itemsWithoutStock.map(i => ({ id: i.id, name: i.name })) },
    requests: { recorded: requests.length, rows: reqRows, open: openRequests.length },
    readiness: { recorded: checks.length, latest: readiness, failing: failed },
    equipment: {
      recorded: equipment.length, rows: equipment,
      assets: assets.length, assetsDue: assetsDue.length, assetsCalDue: assetsCalDue.length,
      maintenanceDue: assetsDue.slice(0, 8), calibrationDueRows: assetsCalDue.slice(0, 8),
    },
    capacity: { recorded: capacity.length, rows: capacity },
    signals,
  };
}
