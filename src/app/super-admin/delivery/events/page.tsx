import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadEventStream } from "@/lib/delivery/consumer";
import EventConsumerRunner from "./EventConsumerRunner";

// CDP-015 — Event bus & consumer (operator view). The delivery outbox stream + a control that drains pending
// events (auto-remediating failed assessments). The hourly delivery_event_consumer cron does the same. Real
// over domain_events (102). Super-admin, platform-wide.

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  pending: "text-amber-600 bg-amber-50 border-amber-100",
  processed: "text-teal-700 bg-teal-50 border-teal-100",
  failed: "text-rose-600 bg-rose-50 border-rose-100",
  dead_letter: "text-rose-700 bg-rose-50 border-rose-200",
};

function ago(iso: string) {
  const d = new Date(iso); if (isNaN(d.getTime())) return "";
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default async function EventsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const q = await loadEventStream(admin, null, true);

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-violet-500 uppercase tracking-widest mb-0.5">CDP-015 · APIs & Event Bus</p>
          <h1 className="text-xl font-bold text-gray-900">Event Consumer</h1>
          <p className="text-gray-400 text-sm mt-0.5">The reactive side of the outbox — drains delivery events and auto-remediates failed assessments.</p>
        </div>
        <Link href="/super-admin/delivery" className="text-xs font-semibold text-gray-500 hover:text-violet-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Delivery</Link>
      </div>

      {!q.provisioned ? (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4"><p className="text-[13px] text-amber-900">The event outbox isn&apos;t provisioned (migration 102 <code className="text-[11px]">domain_events</code>).</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Events", value: q.kpis.total, tone: "text-gray-900" },
              { label: "Pending", value: q.kpis.pending, tone: "text-amber-600" },
              { label: "Processed", value: q.kpis.processed, tone: "text-teal-600" },
              { label: "Dead-letter", value: q.kpis.dead, tone: "text-rose-600" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-4 mb-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-semibold text-gray-900 text-sm">Process the outbox</h2>
                <p className="text-[11px] text-gray-400">Drains pending delivery events: a failed assessment queues remediation (a nudge + a reinforcement card); known events are acknowledged; unknown types are left for other consumers. Runs hourly via the <code className="text-[10px]">delivery_event_consumer</code> cron.</p>
              </div>
              <EventConsumerRunner pending={q.kpis.pending} />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-50"><p className="text-[11px] text-gray-400">Recent events</p></div>
            {q.recent.length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-8 text-center">No domain events emitted yet.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {q.recent.map((e, idx) => (
                  <div key={idx} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-[11px] font-semibold text-gray-700 font-mono truncate flex-1">{e.event_type}</span>
                    <span className="text-[10px] text-gray-400 shrink-0 hidden sm:inline">{e.subject_type}</span>
                    <span className={`text-[8px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 shrink-0 ${STATUS[e.status] ?? STATUS.pending}`}>{e.status}</span>
                    <span className="text-[10px] text-gray-400 shrink-0 w-16 text-right">{e.occurred_at ? ago(e.occurred_at) : ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
