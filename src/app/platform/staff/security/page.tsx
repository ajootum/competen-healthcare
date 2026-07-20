import { redirect } from "next/navigation";
import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadSecurity } from "@/lib/platform/phase3";

export const dynamic = "force-dynamic";

// Security Operations (SEC-001) — SOC view over the audit & event streams.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200 p-5";
const titleCase = (s: string) => s.split(/[_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

export default async function SecurityPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const s = await loadSecurity(caller.admin);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Security Operations</h1>
        <p className="text-sm text-gray-500 mt-1">Security signal across the platform — landlord actions, platform events and tenant access events.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={card}><div className={`text-3xl font-bold tabular-nums ${s.critical ? "text-red-600" : "text-gray-900"}`}>{s.critical}</div><div className="text-xs text-gray-500 mt-1">Critical events</div></div>
        <div className={card}><div className={`text-3xl font-bold tabular-nums ${s.warning ? "text-amber-600" : "text-gray-900"}`}>{s.warning}</div><div className="text-xs text-gray-500 mt-1">Warning events</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{s.landlordActions.length}</div><div className="text-xs text-gray-500 mt-1">Recent landlord actions</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{s.tenantSecEvents.length}</div><div className="text-xs text-gray-500 mt-1">Recent access events</div></div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Landlord actions</h3>
          {s.landlordActions.length === 0 && <p className="text-sm text-gray-400">No landlord actions recorded yet.</p>}
          <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
            {s.landlordActions.map((a: any, i: number) => (
              <div key={i} className="py-2 text-sm flex items-center gap-2">
                <span className="font-medium text-gray-800 truncate">{a.actor_name ?? "Operator"}</span>
                <span className="text-gray-500">{a.action ? titleCase(a.action) : "action"}</span>
                <span className="ml-auto text-xs text-gray-400 shrink-0">{a.created_at ? new Date(a.created_at).toLocaleDateString() : ""}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Tenant access events</h3>
          {s.tenantSecEvents.length === 0 && <p className="text-sm text-gray-400">No security-relevant tenant events.</p>}
          <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
            {s.tenantSecEvents.map((a: any, i: number) => (
              <div key={i} className="py-2 text-sm flex items-center gap-2">
                <span className="font-medium text-gray-800 truncate">{a.actor_name ?? "Someone"}</span>
                <span className="text-gray-500">{a.action ? titleCase(a.action) : "action"}</span>
                <span className="ml-auto text-xs text-gray-400 shrink-0">{a.created_at ? new Date(a.created_at).toLocaleDateString() : ""}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Derived from the audit &amp; event streams. Authentication itself (sessions, MFA, login geography) is handled by the auth provider; threat detection &amp; SIEM integration are a later phase. Related: <Link href="/platform/control-plane/events" className="text-violet-600 hover:underline">Event Centre</Link>.</p>
    </div>
  );
}
