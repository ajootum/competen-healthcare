import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOrganisationalLearning } from "@/lib/cgr/learning";
import ProposeLink from "./ProposeLink";
import LinkDecisions from "./LinkDecisions";

// CGR-027 — Organisational Learning & Knowledge Transformation. Two layers, kept honestly distinct:
// CAUSAL (competency_learning_links, mig 150 — proven signal→change closure) above OPERATIONAL (op_incidents —
// how events are handled). Signal→domain correlation is owned by COMP-028. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_META: Record<string, { label: string; cls: string }> = {
  proposed: { label: "Proposed", cls: "text-amber-700 bg-amber-50 border-amber-100" },
  confirmed: { label: "Confirmed", cls: "text-blue-700 bg-blue-50 border-blue-100" },
  implemented: { label: "Implemented", cls: "text-emerald-700 bg-emerald-50 border-emerald-100" },
  rejected: { label: "Rejected", cls: "text-gray-500 bg-gray-50 border-gray-200" },
};
const deltaFmt = (v: number | null) => (v == null ? "—" : v > 0 ? `+${v}%` : `${v}%`);

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3.5">
      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide leading-tight">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

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
  const L = d.linkage;
  const lifeMax = Math.max(1, ...d.lifecycle.map((l: any) => l.n));
  const typeMax = Math.max(1, ...d.types.map((t: any) => Math.max(t.recent, t.prior)));
  const hasLinks = L.ready && L.total > 0;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-027 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Organisational Learning &amp; Knowledge Transformation</h1>
          <p className="text-gray-400 text-sm mt-0.5">Does the learning loop actually close? Proven signal→competency causation above the operational picture of how events are handled.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/competency-office/quality-feedback" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">Signal correlation →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No quality events, competency changes or learning links recorded yet.</p></div>
      ) : (
        <div className="space-y-4">
          {/* ── LAYER 1: causal closure ── */}
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Proven closure — signal caused change</h2>
              <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-1.5 py-0.5">CAUSAL</span>
              {L.ready && (
                <div className="ml-auto flex items-center gap-2">
                  {d.candidates.unlinkedTotal > 0 && <span className="text-[10px] text-gray-400">{d.candidates.unlinkedTotal} unlinked signal{d.candidates.unlinkedTotal === 1 ? "" : "s"}</span>}
                  <ProposeLink signals={d.candidates.signals} competencies={d.candidates.competencies} />
                </div>
              )}
            </div>

            {!L.ready ? (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                <p className="text-[11px] text-amber-900 leading-relaxed"><span className="font-bold">Linkage not enabled.</span> The competency learning-link table is missing — apply <span className="font-mono font-semibold">migration 150 (150-competency-learning-links.sql)</span> to record which signal caused which competency change. Until then only the operational layer below is available, and loop closure stays inferred rather than proven.</p>
              </div>
            ) : L.total === 0 ? (
              <div className="bg-white border border-gray-200 rounded-xl p-5">
                <p className="text-[12px] text-gray-500 leading-relaxed"><span className="font-semibold text-gray-700">Linkage is enabled but no links have been asserted yet.</span> When a quality event, audit finding or guideline drives a competency change, record the link (with its rationale) and this section becomes the provable closed loop — real signal→improvement duration and a closure rate that isn&apos;t inferred. Links are proposed by educators or admins and confirmed under governance review.</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-3">
                  <Kpi label="Loops closed" value={L.byStatus.implemented} sub="change implemented" tone={L.byStatus.implemented ? "text-emerald-600" : "text-gray-900"} />
                  <Kpi label="Closure rate" value={L.closureRate == null ? "—" : `${L.closureRate}%`} sub="of non-rejected links" tone={L.closureRate == null ? "text-gray-900" : L.closureRate >= 70 ? "text-emerald-600" : "text-amber-600"} />
                  <Kpi label="Time to improvement" value={L.causalMedian == null ? "—" : `${L.causalMedian}d`} sub={L.causalAvg == null ? "measured, signal→change" : `median · avg ${L.causalAvg}d`} tone="text-emerald-600" />
                  <Kpi label="Awaiting review" value={L.awaitingReview} sub="proposed links" tone={L.awaitingReview ? "text-amber-600" : "text-gray-900"} />
                  <Kpi label="Links asserted" value={L.total} sub={`${L.byStatus.confirmed} confirmed`} />
                  <Kpi label="Signal coverage" value={L.coverage == null ? "—" : `${L.coverage}%`} sub="events with a link" tone={L.coverage != null && L.coverage < 25 ? "text-amber-600" : "text-gray-900"} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                      <p className="text-sm font-bold text-gray-800">Learning linkage register</p>
                      <p className="text-[10px] text-gray-400">signal → competency change</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[680px]">
                        <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                          <th className="text-left py-2 pl-4 pr-2">Signal</th>
                          <th className="text-left py-2 px-2">Change</th>
                          <th className="text-left py-2 px-2">Type</th>
                          <th className="text-center py-2 px-2">Days</th>
                          <th className="text-left py-2 pr-4 pl-2">Status</th>
                        </tr></thead>
                        <tbody>
                          {L.register.map((r: any) => (
                            <tr key={r.id} className="border-t border-gray-50">
                              <td className="py-2 pl-4 pr-2">
                                <p className="text-[12px] font-medium text-gray-800 truncate max-w-[220px]">{r.source}{r.byAi && <span className="ml-1 text-[9px] font-bold text-violet-600">AI</span>}</p>
                                <p className="text-[10px] text-gray-400">{r.sourceType}</p>
                              </td>
                              <td className="py-2 px-2 text-[12px] text-gray-700 truncate max-w-[180px]">{r.target}</td>
                              <td className="py-2 px-2 text-[11px] text-gray-500">{r.linkType}</td>
                              <td className="py-2 px-2 text-center text-[11px] tabular-nums">{r.days == null ? <span className="text-gray-300">—</span> : <span className="font-semibold text-gray-700">{r.days}</span>}</td>
                              <td className="py-2 pr-4 pl-2">
                                <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${(STATUS_META[r.status] ?? STATUS_META.proposed).cls}`}>{(STATUS_META[r.status] ?? STATUS_META.proposed).label}</span>
                                <LinkDecisions id={r.id} status={r.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Transformation type (§7)</p>
                    {L.types.length === 0 ? <p className="text-[12px] text-gray-400">—</p> : (
                      <div className="space-y-1.5">
                        {L.types.map((t: any) => (
                          <div key={t.type} className="flex items-center justify-between gap-2 border border-gray-50 rounded-lg px-2.5 py-1.5">
                            <span className="text-[11px] text-gray-600">{t.label}</span>
                            <span className="text-[12px] font-bold text-gray-700 tabular-nums">{t.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-gray-400 mt-3">Every link carries a mandatory rationale and is confirmed by a person — AI may propose, never confirm.</p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Lifecycle */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Knowledge transformation lifecycle (§6)</p>
              <span className="text-[10px] text-gray-400">signal → action → linkage → proven closure</span>
            </div>
            <div className="space-y-2">
              {d.lifecycle.map((l: any, i: number) => (
                <div key={l.step} className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-gray-300 tabular-nums w-4">{i + 1}</span>
                  <span className="text-[11px] text-gray-600 w-40 shrink-0">{l.step}</span>
                  <div className="flex-1 h-3 rounded bg-gray-50 overflow-hidden"><div className={`h-full rounded ${i === d.lifecycle.length - 1 ? "bg-emerald-600" : "bg-emerald-500"}`} style={{ width: `${(l.n / lifeMax) * 100}%` }} /></div>
                  <span className="text-[12px] font-bold text-gray-700 tabular-nums w-10 text-right">{l.n}</span>
                  <span className="text-[10px] text-gray-400 w-44 shrink-0">{l.note}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── LAYER 2: operational ── */}
          <div className="flex items-center gap-2 pt-1">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Operational handling — all events</h2>
            <span className="text-[9px] font-bold text-gray-500 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5">RECORDED FACTS</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Learning signals" value={k.signals} sub="quality events captured" />
            <Kpi label="Action recorded" value={k.conversion == null ? "—" : `${k.conversion}%`} sub={`${k.withAction} with corrective action`} tone={k.conversion == null ? "text-gray-900" : k.conversion >= 70 ? "text-emerald-600" : k.conversion >= 40 ? "text-amber-600" : "text-rose-600"} />
            <Kpi label="Event cycle time" value={k.medianCycle == null ? "—" : `${k.medianCycle}d`} sub={k.avgCycle == null ? "median, open→closed" : `median · avg ${k.avgCycle}d`} />
            <Kpi label="Open signals" value={k.open} sub={`${k.openNoAction} with no action`} tone={k.openNoAction ? "text-rose-600" : "text-gray-900"} />
            <Kpi label="Recurring types" value={k.recurringTypes} sub="repeat across periods" tone={k.recurringTypes ? "text-amber-600" : "text-emerald-600"} />
            <Kpi label="Competency changes" value={k.evoDone} sub={`${k.evoOpen} in flight`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Recurrence by event type (§14)</p>
                <span className={`text-[11px] font-bold ${k.recurrenceDelta == null ? "text-gray-400" : k.recurrenceDelta < 0 ? "text-emerald-600" : k.recurrenceDelta > 0 ? "text-rose-600" : "text-gray-500"}`}>overall {deltaFmt(k.recurrenceDelta)} vs prior 90d</span>
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

          <p className="text-[11px] text-gray-400 leading-relaxed">
            {hasLinks
              ? <><span className="font-medium text-gray-500">Two layers, deliberately separated.</span> The causal layer is proven: each link is a governance assertion — signal, resulting change, mandatory rationale, human confirmation — so closure rate and time-to-improvement are measured, not inferred. Signal coverage tells you how much of the event stream is actually linked; the operational layer below covers every event, linked or not. </>
              : <><span className="font-medium text-gray-500">The operational layer is real but not proof.</span> Conversion, cycle time and recurrence are computed from recorded fields on quality events. Competency changes are counted alongside — not causally attributed — until learning links are asserted above. </>}
            Signal-to-competency-domain correlation is owned by <Link href="/competency-office/quality-feedback" className="text-emerald-600 hover:underline">the Quality → Competency Feedback Loop (COMP-028)</Link>, and remediation by <Link href="/competency-office/remediation" className="text-emerald-600 hover:underline">the Remediation Centre</Link>. Per the CGR mandate, AI may propose links and identify themes but never confirms causation or creates mandatory competencies without governance review.
          </p>
        </div>
      )}
    </div>
  );
}
