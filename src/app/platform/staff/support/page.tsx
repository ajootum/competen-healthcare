import { redirect } from "next/navigation";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadSupport } from "@/lib/platform/staff-data";
import SupportClient from "./SupportClient";

export const dynamic = "force-dynamic";

// Support (SUP-001) — the platform support ticket queue.
const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function SupportPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const { ready, tickets, counts, tenants } = await loadSupport(caller.admin);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Support</h1>
        <p className="text-sm text-gray-500 mt-1">The platform support queue — raise and track tenant support tickets.</p>
      </div>
      {!ready ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-700">Apply migration <code className="font-mono text-xs">043</code> to activate the support queue.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={card}><div className="text-3xl font-bold tabular-nums text-blue-600">{counts.open}</div><div className="text-xs text-gray-500 mt-1">Open</div></div>
            <div className={card}><div className="text-3xl font-bold tabular-nums text-amber-600">{counts.pending}</div><div className="text-xs text-gray-500 mt-1">Pending</div></div>
            <div className={card}><div className="text-3xl font-bold tabular-nums text-green-600">{counts.resolved}</div><div className="text-xs text-gray-500 mt-1">Resolved</div></div>
            <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-500">{counts.closed}</div><div className="text-xs text-gray-500 mt-1">Closed</div></div>
          </div>
          <SupportClient tickets={tickets} tenants={tenants} />
        </>
      )}
    </div>
  );
}
