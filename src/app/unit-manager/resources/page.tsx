import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadResourceOperations } from "@/lib/operations/resource-operations";
import { cardClass, Section, Badge, Alert, NotProvisioned, EmptyState, TableWrap, Th, type BadgeTone } from "@/components/ui/primitives";
import { KpiRibbon, StackedBar } from "@/components/ui/charts";
import { estateRolesOf } from "@/lib/roles";

// Resource Operations (UMW-RES-001) — migration 165 over the existing equipment and asset stores.
//
// A shortage is only ever reported against a threshold someone configured. Items with no minimum recorded
// are counted and named separately, because "no shortages detected" from a unit that set no floors is a
// false reassurance, and this module exists to prevent shortages reaching patients.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const ALLOWED = ["hospital_admin", "super_admin"];
const titleCase = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const when = (t: string | null) => t ? new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }) : "—";
const STATE: Record<string, { tone: BadgeTone; label: string }> = {
  critical: { tone: "critical", label: "Critical" },
  low: { tone: "warning", label: "Low" },
  ok: { tone: "success", label: "OK" },
  unset: { tone: "neutral", label: "No threshold" },
};
const URGENCY: Record<string, BadgeTone> = { emergency: "critical", urgent: "warning", routine: "neutral" };
const REQ_STATUS: Record<string, BadgeTone> = {
  requested: "info", approved: "primary", ordered: "primary", fulfilled: "success", rejected: "neutral", cancelled: "neutral",
};

export default async function ResourceOperationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.some(r => ALLOWED.includes(r))) redirect("/dashboard");

  const d: any = await loadResourceOperations(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const k = d.kpis;

  return (
    <div className="space-y-4 max-w-[1500px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Resource Operations</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Consumables, equipment readiness and resource requests — requests and checks from the last {d.window.days} days.
          </p>
        </div>
        <Link href="/unit-manager/administration/assets" className="text-sm font-medium text-teal-700 hover:underline self-center">Asset register →</Link>
      </div>

      {!d.provisioned && <NotProvisioned what="Consumables, stock levels, requests and readiness checks" migration="165-resource-operations.sql" />}

      <KpiRibbon
        kpis={[
          { label: "Items tracked", value: k.itemsTracked, sub: `${k.stockRows} stock record${k.stockRows === 1 ? "" : "s"}` },
          { label: "At critical level", value: k.critical, tone: k.critical ? "critical" : "default", sub: "escalate now" },
          { label: "Below minimum", value: k.low, tone: k.low ? "warning" : "default", sub: "reorder" },
          { label: "No threshold set", value: k.unset, tone: k.unset ? "warning" : "default", sub: "shortage undetectable" },
          { label: "Open requests", value: k.openRequests, tone: k.awaitingDecision ? "warning" : "default", sub: `${k.awaitingDecision} awaiting a decision` },
          { label: "Readiness checks", value: k.checksRecorded, tone: k.checksFailing ? "critical" : "default", sub: k.checksFailing ? `${k.checksFailing} failing` : "in window" },
          { label: "Equipment out of service", value: k.equipmentOut, tone: k.equipmentOut ? "warning" : "default", sub: `${k.equipmentMaint} in maintenance` },
        ]}
      />

      {d.signals.length > 0 && (
        <div className="space-y-2">
          {d.signals.map((s: any, i: number) => (
            <Alert key={i} tone={s.severity === "high" ? "critical" : "warning"}>{s.text}</Alert>
          ))}
        </div>
      )}

      {/* ── Stock ── */}
      <Section title="Consumables &amp; Stock" sub={`${d.stock.recorded} tracked`}
        note="A shortage is measured against a threshold someone set. Thresholds resolve per-unit override → item default, so a ward can hold a deeper buffer than the hospital norm.">
        {d.stock.recorded === 0 ? (
          <EmptyState title={d.provisioned ? "No stock records yet" : "Stock tracking is not provisioned"} icon="📦"
            body={d.provisioned ? "Nothing has been counted into a location, so no shortage can be computed." : undefined} />
        ) : (
          <>
            <StackedBar label="Stock position"
              segments={(["critical", "low", "ok", "unset"] as const)
                .map(s => ({ name: STATE[s].label, value: d.stock.rows.filter((r: any) => r.state === s).length,
                  color: s === "critical" ? "var(--cmp-color-critical)" : s === "low" ? "var(--cmp-color-warning)"
                    : s === "ok" ? "var(--cmp-color-success)" : "var(--cmp-color-neutral, #9ca3af)" }))
                .filter(x => x.value > 0)} />
            <TableWrap>
              <table className="w-full text-sm mt-3">
                <thead><tr className="border-b border-gray-100">
                  <Th>Item</Th><Th>Category</Th><Th>Location</Th><Th align="right">On hand</Th><Th align="right">Min</Th><Th align="right">Critical</Th><Th>Counted</Th><Th>State</Th>
                </tr></thead>
                <tbody>
                  {d.stock.rows.slice(0, 25).map((r: any, i: number) => (
                    <tr key={`${r.itemId}-${i}`} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 text-gray-900 font-medium">
                        {r.name} {r.critical && <Badge tone="critical" icon="▲">Critical item</Badge>}
                      </td>
                      <td className="py-2 text-[11px] text-gray-500">{r.category ?? "—"}</td>
                      <td className="py-2 text-[11px] text-gray-500">{r.location ?? "—"}</td>
                      <td className="py-2 text-right tabular-nums text-gray-900">{r.onHand} <span className="text-[10px] text-gray-400">{r.unit}</span></td>
                      <td className="py-2 text-right tabular-nums text-gray-500">{r.minLevel ?? "—"}</td>
                      <td className="py-2 text-right tabular-nums text-gray-500">{r.criticalLevel ?? "—"}</td>
                      <td className="py-2 text-[11px] text-gray-400">
                        {r.countedAt ? `${when(r.countedAt)}${r.countedDaysAgo != null && r.countedDaysAgo > 14 ? ` (${r.countedDaysAgo}d)` : ""}` : "never"}
                      </td>
                      <td className="py-2">
                        <Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge>
                        {r.expiringSoon && <Badge tone="warning">Expiring</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            {d.stock.itemsWithoutStock.length > 0 && (
              <p className="text-[11px] text-gray-500 mt-2">
                <span className="font-medium text-gray-700">{d.stock.itemsWithoutStock.length} catalogued item(s) have no stock record anywhere</span> —
                {" "}{d.stock.itemsWithoutStock.slice(0, 5).map((i: any) => i.name).join(", ")}{d.stock.itemsWithoutStock.length > 5 ? "…" : ""}.
                That is unrecorded, not zero on hand.
              </p>
            )}
          </>
        )}
      </Section>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Requests ── */}
        <Section title="Resource Requests" sub={`${d.requests.recorded} in window`}
          note="Awaiting a decision and approved-but-not-delivered are different states — merging them would hide which requests are blocked on a person.">
          {d.requests.recorded === 0 ? (
            <EmptyState title="No requests raised in this window" icon="📝" />
          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100"><Th>Item</Th><Th align="right">Qty</Th><Th>Urgency</Th><Th>Status</Th><Th>Raised</Th></tr></thead>
                <tbody>
                  {d.requests.rows.slice(0, 12).map((r: any) => (
                    <tr key={r.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-2">
                        <span className="text-gray-900">{r.itemName}</span>
                        {r.unitName && <span className="block text-[10px] text-gray-400">{r.unitName}</span>}
                      </td>
                      <td className="py-2 text-right tabular-nums text-gray-600">{r.quantity}</td>
                      <td className="py-2"><Badge tone={URGENCY[r.urgency] ?? "neutral"}>{titleCase(r.urgency)}</Badge></td>
                      <td className="py-2">
                        <Badge tone={REQ_STATUS[r.status] ?? "neutral"}>{titleCase(r.status)}</Badge>
                        {r.awaitingDecision && r.ageDays >= 3 && <Badge tone="warning">{r.ageDays}d</Badge>}
                      </td>
                      <td className="py-2 text-[11px] text-gray-400">
                        {when(r.created_at)}{r.requested_by_name ? ` · ${r.requested_by_name}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Section>

        {/* ── Readiness ── */}
        <Section title="Emergency Readiness" sub={`${d.readiness.latest.length} checked`}
          note="Latest check per item. A check that found a problem still counts as a check having happened — a unit that stopped checking must not look like one that checks and passes.">
          {d.readiness.recorded === 0 ? (
            <EmptyState title="No readiness checks recorded" icon="🧰"
              body={d.provisioned ? "Crash carts and emergency equipment have no recorded check in this window." : undefined} />
          ) : (
            <ul className="space-y-2">
              {d.readiness.latest.slice(0, 10).map((c: any) => (
                <li key={c.id} className="flex items-start justify-between gap-3 border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900">{c.label}</p>
                    <p className="text-[10px] text-gray-400">
                      {titleCase(c.check_type)}{c.unitName ? ` · ${c.unitName}` : ""} · checked {when(c.checked_at)}
                      {c.checked_by_name ? ` by ${c.checked_by_name}` : ""}
                    </p>
                    {c.issues && <p className="text-[11px]" style={{ color: "var(--cmp-text-critical)" }}>{c.issues}</p>}
                  </div>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {c.overdue && <Badge tone="warning">Overdue</Badge>}
                    <Badge tone={c.passed ? "success" : "critical"}>{c.passed ? "Passed" : "Failed"}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* ── Categories ── */}
        <Section title="Resource Categories" sub={`${d.categories.recorded} configured`}
          note="Categories are rows, not a fixed list, so a tenant can define its own without a schema change.">
          {d.categories.byCategory.length === 0 ? (
            <p className="text-sm text-gray-500">No categories configured{d.provisioned ? " — every item is uncategorised." : "."}</p>
          ) : (
            <ul className="space-y-1.5">
              {d.categories.byCategory.map((c: any) => (
                <li key={c.code} className="flex items-center justify-between text-sm">
                  <span className="text-gray-800">{c.label} {c.critical && <Badge tone="critical">Critical</Badge>}</span>
                  <span className="text-[11px] text-gray-500 tabular-nums">
                    {c.shortages > 0 && <span className="font-medium" style={{ color: "var(--cmp-text-warning)" }}>{c.shortages} short · </span>}
                    {c.tracked}/{c.items} tracked
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* ── Equipment (existing stores) ── */}
        <Section title="Equipment Status" sub={`${d.equipment.recorded} items`}
          note="From op_equipment and the asset register — not a fourth equipment store.">
          {d.equipment.recorded === 0 && d.equipment.assets === 0 ? (
            <p className="text-sm text-gray-500">No equipment or assets recorded for this unit.</p>
          ) : (
            <div className="space-y-1.5 text-sm">
              <p className="text-gray-700">Operational <span className="font-semibold tabular-nums">{d.equipment.rows.filter((e: any) => e.status === "operational").length}</span></p>
              <p className="text-gray-700">In maintenance <span className="font-semibold tabular-nums">{d.kpis.equipmentMaint}</span></p>
              <p className="text-gray-700">Out of service <span className="font-semibold tabular-nums" style={d.kpis.equipmentOut ? { color: "var(--cmp-text-critical)" } : undefined}>{d.kpis.equipmentOut}</span></p>
              <p className="text-gray-700">Calibration due <span className="font-semibold tabular-nums">{d.kpis.calibrationDue}</span></p>
              <p className="text-[11px] text-gray-500 pt-1 border-t border-gray-50">
                Asset register: {d.equipment.assets} asset(s), {d.equipment.assetsDue} due maintenance and {d.equipment.assetsCalDue} due calibration within 30 days.
              </p>
            </div>
          )}
        </Section>

        {/* ── Capacity ── */}
        <Section title="Bookable Capacity" sub={`${d.capacity.recorded} resources`}
          note="Theatres, treatment rooms and transport from op_resources.">
          {d.capacity.recorded === 0 ? (
            <p className="text-sm text-gray-500">No bookable resources recorded.</p>
          ) : (
            <ul className="space-y-1.5">
              {d.capacity.rows.slice(0, 8).map((r: any) => (
                <li key={r.id} className="flex items-center justify-between text-sm">
                  <span className="text-gray-800">{r.name} <span className="text-[10px] text-gray-400">{titleCase(r.category)}</span></span>
                  <span className="text-[11px] tabular-nums text-gray-600">
                    {r.available}/{r.total} free
                    {r.demand === "high" && <Badge tone="warning">High demand</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">What this module does not do</h2>
        <ul className="space-y-1.5 text-[11px] text-gray-600">
          <li><span className="font-medium text-gray-700">No shortage prediction or demand forecasting.</span> The spec asks for both. Forecasting consumption needs a history of issues and usage per item; stock counts alone cannot produce one, and a predicted shortage that is really a guess would be acted on as if it were real.</li>
          <li><span className="font-medium text-gray-700">No procurement or biomedical integration.</span> There is no connected inventory or purchasing system, so requests stop at the approval recorded here rather than claiming an order was placed.</li>
          <li><span className="font-medium text-gray-700">No medication availability.</span> op_med_schedule records what is due to be given, not what is held in stock. Deriving pharmacy stock from administration records would be an invention.</li>
          <li><span className="font-medium text-gray-700">Automatic escalation is not wired to the escalation engine.</span> Critical shortages are flagged and surfaced here; raising them into op_escalations is a write path, and this module is read-only.</li>
        </ul>
      </div>
    </div>
  );
}
