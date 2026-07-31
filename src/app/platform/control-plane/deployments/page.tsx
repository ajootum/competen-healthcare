import { redirect } from "next/navigation";
import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadDeployments } from "@/lib/platform/phase3";
import DeployForm from "./DeployForm";
import { cardClass } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

// Deployments — platform release log (LCP-001 §7).
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = cardClass;
const chan: Record<string, string> = { stable: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", staged: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", canary: "bg-[var(--cmp-surface-information)] text-blue-700" };

export default async function DeploymentsPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const { ready, deployments, current } = await loadDeployments(caller.admin);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Deployments</h1>
        <p className="text-sm text-gray-500 mt-1">The platform release log. All tenants run the current release; per-tenant capability differences are delivered via feature flags, not code versions.</p>
      </div>
      {!ready ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-5 text-sm text-[var(--cmp-text-warning)]">Apply migration <code className="font-mono text-xs">044</code> to activate the release log.</div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-5 items-start">
          <DeployForm />
          <div className={`${card} lg:col-span-2`}>
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Releases</h3>
              {current && <span className="text-xs text-gray-500">current: <span className="font-mono text-gray-800">{current.version}</span></span>}
            </div>
            {deployments.length === 0 && <p className="text-sm text-gray-400">No releases recorded yet.</p>}
            <div className="divide-y divide-gray-100">
              {deployments.map((d: any, i: number) => (
                <div key={i} className="py-2.5 flex items-center gap-3 text-sm">
                  <span className="font-mono font-medium text-gray-800">{d.version}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${chan[d.channel] ?? "bg-gray-100 text-gray-500"}`}>{d.channel}</span>
                  {d.notes && <span className="text-gray-500 truncate">{d.notes}</span>}
                  <span className="ml-auto text-xs text-gray-400 shrink-0">{d.released_at ? new Date(d.released_at).toLocaleDateString() : ""}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <p className="text-[11px] text-gray-400">Per-tenant code versioning and staged rollout across separate deployments require a multi-deployment architecture (beyond a single managed app), so they are not modelled here. Independent capability control is available today via <Link href="/platform/control-plane/feature-flags" className="text-violet-600 hover:underline">Feature Flags</Link>.</p>
    </div>
  );
}
