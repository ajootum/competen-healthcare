import { redirect } from "next/navigation";
import { getLandlordCaller } from "@/lib/platform/landlord";

export const dynamic = "force-dynamic";

// Global Audit Centre (LCP-001 §16) — the landlord-plane action trail.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200 p-5";
const titleCase = (s: string) => s.split(/[_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

export default async function AuditCentrePage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");

  let events: any[] = []; let ready = false;
  try {
    const { data, error } = await caller.admin.from("plat_audit_events").select("actor_name, actor_plane, action, entity_type, entity_name, tenant_id, reason, created_at").order("created_at", { ascending: false }).limit(100);
    if (!error) { events = data ?? []; ready = true; }
  } catch { /* pre-migration */ }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Audit Centre</h1>
        <p className="text-sm text-gray-500 mt-1">Every landlord-plane action — provisioning, lifecycle, configuration — with actor, target and reason.</p>
      </div>
      {!ready ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">Apply migrations <code className="font-mono text-xs">040–042</code> to activate the audit centre.</div>
      ) : (
        <div className={card}>
          {events.length === 0 && <p className="text-sm text-gray-400">No landlord actions recorded yet. Provisioning a tenant writes the first event.</p>}
          <div className="divide-y divide-gray-100">
            {events.map((e, i) => (
              <div key={i} className="py-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide bg-violet-50 text-violet-700 rounded px-1.5 py-0.5">{e.actor_plane}</span>
                  <span className="font-medium text-gray-800">{e.actor_name ?? "Operator"}</span>
                  <span className="text-gray-500">{e.action ? titleCase(e.action) : "action"}</span>
                  <span className="ml-auto text-xs text-gray-400 shrink-0">{e.created_at ? new Date(e.created_at).toLocaleString() : ""}</span>
                </div>
                {(e.entity_name || e.reason) && <p className="text-xs text-gray-400 mt-0.5">{e.entity_type ? titleCase(e.entity_type) : ""}{e.entity_name ? ` · ${e.entity_name}` : ""}{e.reason ? ` — ${e.reason}` : ""}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-gray-400">Append-only trail in <code className="font-mono">plat_audit_events</code>. Immutable before/after values, approval and rollback references extend in Phase 2.</p>
    </div>
  );
}
