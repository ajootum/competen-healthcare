import { redirect } from "next/navigation";
import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadEventCentre } from "@/lib/platform/events";

export const dynamic = "force-dynamic";

// Global Event Centre (LCP-001 §15).
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200 p-5";
const sevCls: Record<string, string> = { info: "bg-gray-100 text-gray-600", warning: "bg-amber-100 text-amber-700", critical: "bg-red-100 text-red-700" };

export default async function EventCentrePage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const { ready, events, byType, bySeverity } = await loadEventCentre(caller.admin);
  const maxType = Math.max(1, ...byType.map(t => t.count));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Event Centre</h1>
        <p className="text-sm text-gray-500 mt-1">The platform event stream — provisioning, lifecycle, subscription and system events as they happen.</p>
      </div>
      {!ready ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">Apply migration <code className="font-mono text-xs">043</code> to activate the event stream.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{events.length}</div><div className="text-xs text-gray-500 mt-1">Recent events</div></div>
            <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-600">{bySeverity.info}</div><div className="text-xs text-gray-500 mt-1">Info</div></div>
            <div className={card}><div className={`text-3xl font-bold tabular-nums ${bySeverity.warning ? "text-amber-600" : "text-gray-900"}`}>{bySeverity.warning}</div><div className="text-xs text-gray-500 mt-1">Warning</div></div>
            <div className={card}><div className={`text-3xl font-bold tabular-nums ${bySeverity.critical ? "text-red-600" : "text-gray-900"}`}>{bySeverity.critical}</div><div className="text-xs text-gray-500 mt-1">Critical</div></div>
          </div>

          <div className="grid lg:grid-cols-3 gap-5">
            <div className={card}>
              <h3 className="font-semibold text-gray-900 mb-3">By type</h3>
              {byType.length === 0 && <p className="text-sm text-gray-400">No events yet. Provisioning a tenant emits the first one.</p>}
              <div className="space-y-1.5">
                {byType.map(t => (
                  <div key={t.type} className="flex items-center gap-2 text-xs">
                    <span className="w-40 shrink-0 font-mono text-gray-600 truncate">{t.type}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${(t.count / maxType) * 100}%` }} /></div>
                    <span className="w-8 text-right tabular-nums text-gray-500">{t.count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className={`${card} lg:col-span-2`}>
              <h3 className="font-semibold text-gray-900 mb-3">Stream</h3>
              {events.length === 0 && <p className="text-sm text-gray-400">No events recorded yet.</p>}
              <div className="divide-y divide-gray-100 max-h-[30rem] overflow-y-auto">
                {events.map((e: any, i: number) => (
                  <div key={i} className="py-2 text-sm flex items-center gap-2">
                    <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${sevCls[e.severity] ?? sevCls.info}`}>{e.severity}</span>
                    <span className="font-mono text-gray-800">{e.event_type}</span>
                    <span className="ml-auto text-xs text-gray-400 shrink-0">{e.created_at ? new Date(e.created_at).toLocaleString() : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      <p className="text-[11px] text-gray-400">Events are system telemetry (what happened); the <Link href="/platform/control-plane/audit" className="text-violet-600 hover:underline">Audit Centre</Link> records who did what. Both are append-only.</p>
    </div>
  );
}
