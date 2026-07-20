import { redirect } from "next/navigation";
import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadEngineering } from "@/lib/platform/phase3";

export const dynamic = "force-dynamic";

// Engineering (ENG-001).
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function EngineeringPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const { ready, deployments, current, tenants, users } = await loadEngineering(caller.admin);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Engineering</h1>
        <p className="text-sm text-gray-500 mt-1">Platform release state and scale. Deployment orchestration is managed by the hosting platform (Vercel).</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={card}><div className="text-xl font-bold font-mono text-gray-900 truncate">{ready && current ? current.version : "—"}</div><div className="text-xs text-gray-500 mt-1">Current release</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{ready ? deployments.length : "—"}</div><div className="text-xs text-gray-500 mt-1">Releases logged</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{tenants}</div><div className="text-xs text-gray-500 mt-1">Tenants served</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{users}</div><div className="text-xs text-gray-500 mt-1">Users served</div></div>
      </div>
      <div className={card}>
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Recent releases</h3>
          <Link href="/platform/control-plane/deployments" className="text-xs text-violet-600 hover:underline">Release log →</Link>
        </div>
        {!ready || deployments.length === 0 ? (
          <p className="text-sm text-gray-400">{ready ? "No releases recorded — log the first in the release log." : "Apply migration 044 to activate the release log."}</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {deployments.slice(0, 8).map((d: any, i: number) => (
              <div key={i} className="py-2 flex items-center gap-3 text-sm">
                <span className="font-mono font-medium text-gray-800">{d.version}</span>
                <span className="text-[10px] text-gray-400">{d.channel}</span>
                {d.notes && <span className="text-gray-500 truncate">{d.notes}</span>}
                <span className="ml-auto text-xs text-gray-400">{d.released_at ? new Date(d.released_at).toLocaleDateString() : ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={`${card} border-dashed`}>
        <h3 className="font-semibold text-gray-900 mb-1">Not measured in-app</h3>
        <p className="text-sm text-gray-400">CI/CD pipelines, build logs, error rates and infrastructure metrics live in the hosting consoles (Vercel &amp; Supabase), not the database — so they are referenced, not mirrored here.</p>
      </div>
    </div>
  );
}
