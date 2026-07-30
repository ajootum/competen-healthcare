import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOrganisationalLearning } from "@/lib/cgr/learning";

// CGR-027 — Organisational Learning & Knowledge Transformation. The loop-CLOSURE performance lens: signal→action
// conversion, time-to-improvement, recurrence, and competency evolution enacted. Signal→domain correlation is
// owned by COMP-028 quality-feedback — cross-linked. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3.5">
      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide leading-tight">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

const deltaFmt = (v: number | null) => (v == null ? "—" : v > 0 ? `+${v}%` : `${v}%`);

export default async function OrganisationalLearningPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadOrganisationalLearning(admin) as any;
  const k = d.kpis;
  const lifeMax = Math.max(1, ...d.lifecycle.map((l: any) => l.n));
  const typeMax = Math.max(1, ...d.types.map((t: any) => Math.max(t.recent, t.prior)));

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-027 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Organisational Learning &amp; Knowledge Transformation</h1>
          <p className="text-gray-400 text-sm mt-0.5">Does the learning loop actually close? Signals transformed into action, time from event to improvement, recurrence, and the competency evolution enacted.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/competency-office/quality-feedback" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">Signal correlation →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No quality events or competency changes recorded yet — loop-closure performance computes once events are captured and changes raised.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Learning signals" value={k.signals} sub="quality events captured" />
            <Kpi label="Transformed into action" value={k.conversion == null ? "—" : `${k.conversion}%`} sub={`${k.withAction} with corrective action`} tone={k.conversion == null ? "text-gray-900" : k.conversion >= 70 ? "text-emerald-600" : k.conversion >= 40 ? "text-amber-600" : "text-rose-600"} />
            <Kpi label="Time to improvement" value={k.medianCycle == null ? "—" : `${k.medianCycle}d`} sub={k.avgCycle == null ? "median" : `median · avg ${k.avgCycle}d`} />
            <Kpi label="Open signals" value={k.open} sub={`${k.openNoAction} with no action`} tone={k.openNoAction ? "text-rose-600" : "text-gray-900"} />
            <Kpi label="Recurring types" value={k.recurringTypes} sub="repeat across periods" tone={k.recurringTypes ? "text-amber-600" : "text-emerald-600"} />
            <Kpi label="Competency evolution" value={k.evoDone} sub={`${k.evoOpen} in flight`} tone={k.evoDone ? "text-emerald-600" : "text-gray-900"} />
          </div>

          {/* Loop closure lifecycle */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Knowledge transformation lifecycle (§6)</p>
              <span className="text-[10px] text-gray-400">signal → action → closure → evolution</span>
            </div>
            <div className="space-y-2">
              {d.lifecycle.map((l: any, i: number) => (
                <div key={l.step} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-gray-300 tabular-nums w-4">{i + 1}</span>
                  <span className="text-[11px] text-gray-600 w-40 shrink-0">{l.step}</span>
                  <div className="flex-1 h-3 rounded bg-gray-50 overflow-hidden"><div className="h-full bg-emerald-500 rounded" style={{ width: `${(l.n / lifeMax) * 100}%` }} /></div>
                  <span className="text-[12px] font-bold text-gray-700 tabular-nums w-10 text-right">{l.n}</span>
                  <span className="text-[10px] text-gray-400 w-40 shrink-0">{l.note}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Recurrence */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Recurrence by event type (§14)</p>
                <span className={`text-[11px] font-bold ${k.recurrenceDelta == null ? "text-gray-400" : k.recurrenceDelta < 0 ? "text-emerald-600" : k.recurrenceDelta > 0 ? "text-rose-600" : "text-gray-500"}`}>
                  overall {deltaFmt(k.recurrenceDelta)} vs prior 90d
                </span>
              </div>
              {d.types.length === 0 ? (
                <p className="text-[12px] text-gray-400">Not enough event history to measure recurrence.</p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {d.types.map((t: any) => (
                      <div key={t.type} className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-600 w-36 shrink-0 truncate">{t.label}</span>
                        <div className="flex-1 flex items-center gap-1">
                          <div className="flex-1 h-2 rounded bg-gray-50 overflow-hidden"><div className="h-full bg-gray-300 rounded" style={{ width: `${(t.prior / typeMax) * 100}%` }} /></div>
                          <div className="flex-1 h-2 rounded bg-gray-50 overflow-hidden"><div className="h-full bg-emerald-500 rounded" style={{ width: `${(t.recent / typeMax) * 100}%` }} /></div>
                        </div>
                        <span className="text-[11px] tabular-nums w-14 text-right"><span className="text-gray-400">{t.prior}</span><span className="text-gray-300">→</span><span className="font-bold text-gray-700">{t.recent}</span></span>
                        <span className={`text-[10px] font-bold tabular-nums w-8 text-right ${t.delta < 0 ? "text-emerald-600" : t.delta > 0 ? "text-rose-600" : "text-gray-300"}`}>{t.delta > 0 ? `+${t.delta}` : t.delta || "—"}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3 mt-2.5 pt-2 border-t border-gray-50 text-[9px] text-gray-400">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300" />prior 90d</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />last 90d</span>
                    <span className="ml-auto">falling recurrence = the loop is working</span>
                  </div>
                </>
              )}
            </div>

            {/* Competency evolution */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Competency evolution (§7)</p>
              {d.evolution.total === 0 ? (
                <p className="text-[12px] text-gray-400">No competency changes raised yet.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="border border-gray-100 rounded-lg p-2.5"><p className="text-xl font-bold text-emerald-600 tabular-nums">{d.evolution.done}</p><p className="text-[10px] text-gray-500">enacted</p></div>
                    <div className="border border-gray-100 rounded-lg p-2.5"><p className={`text-xl font-bold tabular-nums ${d.evolution.open ? "text-amber-600" : "text-gray-900"}`}>{d.evolution.open}</p><p className="text-[10px] text-gray-500">in flight</p></div>
                  </div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">By kind</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(["major", "minor", "revision"] as const).map((kd) => (
                      <span key={kd} className="text-[10px] text-gray-600 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 capitalize">{kd} <span className="font-semibold">{d.evolution.byKind[kd]}</span></span>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-3"><Link href="/super-admin/cgr/change-control" className="text-emerald-600 hover:underline">Change control →</Link></p>
                </>
              )}
            </div>
          </div>

          {/* Honest data note */}
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
            <p className="text-[11px] text-amber-900 leading-relaxed">
              <span className="font-bold">What this does and doesn&apos;t evidence.</span> Conversion, cycle time and recurrence are computed from real recorded fields on quality events (corrective action, closure date, event type) — these are facts. But there is <span className="font-semibold">no persistent event↔competency linkage</span> in the platform today, so competency evolution is counted <span className="font-semibold">alongside</span> learning signals, not causally attributed to specific events. A linkage table joining a finding to the competency change it caused would make the loop provably closed end-to-end; until then, treat the two halves as correlated context, not proof.
            </p>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">This is the loop-<span className="font-medium">closure performance</span> lens; the signal-to-competency-domain correlation and risk view is owned by <Link href="/competency-office/quality-feedback" className="text-emerald-600 hover:underline">the Quality → Competency Feedback Loop (COMP-028)</Link>, and remediation in flight by <Link href="/competency-office/remediation" className="text-emerald-600 hover:underline">the Remediation Centre</Link>. Per the CGR mandate, AI may identify learning themes and recommend competency updates but never determines root cause independently or creates mandatory competencies without governance review.</p>
        </div>
      )}
    </div>
  );
}
