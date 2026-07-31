import Link from "next/link";
import { loadHandoverCommand } from "@/lib/operations/ops-handover";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import { opcGuard, TopStrip, SurfaceHead, Card, Kpi, Donut, Pill, OpsFoot, fmtT } from "../_ui";

export const dynamic = "force-dynamic";

// UMW-OPC-008 Shift Timeline & Handover Centre — real shift timeline, auto-generated SBAR from live state, handover
// readiness, outstanding actions, high-risk watch list and staff overview. Dark surface. Gate admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const toneDot: Record<string, string> = { rose: "bg-[var(--cmp-color-error)]", amber: "bg-[var(--cmp-color-warning)]", emerald: "bg-[var(--cmp-color-success)]", blue: "bg-[var(--cmp-color-information)]" };
const CHECKLIST = ["Patient summary reviewed", "High-risk patients discussed", "Open actions reviewed", "Escalations reviewed", "Safety & equipment issues", "Staffing & assignments", "Key messages communicated"];

export default async function HandoverPage({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const { dept } = await searchParams;
  const { admin, isSuper, hid } = await opcGuard();
  const [d, departments] = await Promise.all([
    loadHandoverCommand(admin, hid, isSuper, dept || null) as Promise<any>,
    loadUnitDepartments(admin, hid, isSuper).catch(() => []),
  ]);

  const strip = <TopStrip code="UMW-OPC-008 · Operational Command" title="Shift Timeline & Handover Centre" departments={departments} />;
  if (!d.provisioned) return <div className="space-y-4">{strip}<div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational stores not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 038 then seed shifts + patients.</p></div></div>;

  const k = d.kpis;
  return (
    <div className="space-y-3">
      {strip}
      <div className="bg-slate-900 rounded-2xl p-4 md:p-5 space-y-4 text-slate-100">
        <SurfaceHead title="Shift Timeline & Handover Centre" meta="day shift · 07:00–19:00 (template window)" refresh="30s" />

        {/* KPI ribbon */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Kpi label="Shift Progress" value={`${k.shiftProgress}%`} sub="of window" />
          <Kpi label="Patients in Care" value={k.patientsInCare} sub="admitted" />
          <Kpi label="Open Actions" value={k.openActions} sub="to hand over" tone={k.openActions ? "text-amber-400" : "text-white"} />
          <Kpi label="Escalations" value={k.escalations} sub="open" tone={k.escalations ? "text-rose-400" : "text-white"} />
          <Kpi label="Handover Status" value={k.handoverStatus} sub="recorded" tone={k.handoverStatus === "Accepted" ? "text-emerald-400" : "text-amber-400"} />
          <Kpi label="Unresolved Issues" value={k.unresolvedIssues} sub="high priority" tone={k.unresolvedIssues ? "text-rose-400" : "text-white"} />
          <Kpi label="Staff On Duty" value={`${k.staffOnDuty}${k.staffRequired ? `/${k.staffRequired}` : ""}`} sub={d.coverage != null ? `${d.coverage}%` : "on duty"} />
          <Kpi label="Handover Readiness" value={`${k.readiness}%`} sub="target ≥90%" tone={k.readiness >= 90 ? "text-emerald-400" : "text-amber-400"} />
        </div>

        {/* Timeline + SBAR + checklist */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Shift Timeline" right={<span className="text-[9px] text-slate-500">today&apos;s events</span>}>
            {d.timeline.length ? <div className="space-y-2.5">{d.timeline.map((e: any, i: number) => (
              <div key={i} className="flex items-start gap-2"><div className="flex flex-col items-center"><span className={`w-2 h-2 rounded-full ${toneDot[e.tone]}`} />{i < d.timeline.length - 1 && <span className="w-px h-5 bg-slate-700" />}</div><div className="min-w-0 flex-1 -mt-0.5"><p className="text-[11px] text-slate-200 leading-tight">{e.label}{e.detail ? ` — ${e.detail}` : ""}</p><p className="text-[9px] text-slate-500">{fmtT(e.at)}</p></div></div>
            ))}</div> : <p className="text-xs text-slate-400 py-6 text-center">No timeline events today.</p>}
          </Card>

          <Card title="Electronic Handover (SBAR)" className="xl:col-span-2" right={<span className="text-[9px] text-slate-500">auto-generated from live state</span>}>
            <div className="space-y-2">
              {[["S", "Situation", d.sbar.situation, "bg-[var(--cmp-color-information)]"], ["B", "Background", d.sbar.background, "bg-purple-500"], ["A", "Assessment", d.sbar.assessment, "bg-[var(--cmp-color-warning)]"], ["R", "Recommendation", d.sbar.recommendation, "bg-[var(--cmp-color-success)]"]].map(([letter, label, text, c2]: any) => (
                <div key={letter} className="flex gap-2.5"><span className={`w-7 h-7 rounded-lg ${c2} text-white font-bold flex items-center justify-center shrink-0 text-sm`}>{letter}</span><div className="min-w-0 flex-1"><p className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</p><p className="text-[12px] text-slate-200 leading-snug">{text}</p></div></div>
              ))}
            </div>
            {d.handover && <div className="mt-3 pt-3 border-t border-slate-700/60 flex items-center gap-2 text-[10px] text-slate-500"><span>Recorded handover:</span><Pill text={k.handoverStatus} tone={k.handoverStatus === "Accepted" ? "emerald" : "amber"} /><span className="truncate">{d.handover.summary} · {fmtT(d.handover.created_at)}</span></div>}
            <p className="text-[9px] text-slate-500 mt-2">This is a live-state summary to support handover — not a signed clinical record. Complete the signed SBAR in the SSW.</p>
          </Card>

          <Card title="Handover Checklist" right={<span className="text-[9px] text-slate-500">template</span>}>
            <div className="space-y-1.5">{CHECKLIST.map((item, i) => (
              <div key={item} className="flex items-center gap-2 text-[11px]"><span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] ${i < 5 ? "bg-[var(--cmp-color-success)] text-slate-900" : "bg-slate-700 text-slate-500"}`}>{i < 5 ? "✓" : ""}</span><span className="text-slate-300 flex-1">{item}</span></div>
            ))}</div>
            <div className="mt-2 pt-2 border-t border-slate-700/60 flex items-center justify-between"><span className="text-[10px] text-slate-400">Readiness</span><span className={`text-sm font-bold tabular-nums ${k.readiness >= 90 ? "text-emerald-400" : "text-amber-400"}`}>{k.readiness}%</span></div>
          </Card>
        </div>

        {/* Outstanding actions + watch list + staff overview + incoming */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
          <Card title="Outstanding Actions">
            {d.outstanding.length ? <div className="space-y-2">{d.outstanding.map((a: any, i: number) => (
              <div key={i} className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[11px] text-slate-200 leading-tight truncate">{a.desc}</p><p className="text-[10px] text-slate-500">{fmtT(a.due)}</p></div><Pill text={a.overdue ? "overdue" : a.priority} tone={a.overdue ? "rose" : a.priority === "urgent" ? "rose" : a.priority === "high" ? "amber" : "slate"} /></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No outstanding actions. ✅</p>}
          </Card>

          <Card title="High Risk Patients to Watch">
            {d.watch.length ? <div className="space-y-2">{d.watch.map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-[var(--cmp-color-error)]/10 border border-rose-500/25 px-2.5 py-1.5"><span className="w-6 h-6 rounded bg-[var(--cmp-color-error)]/80 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{String(p.label).replace(/\D/g, "").slice(-3) || "•"}</span><div className="min-w-0 flex-1"><p className="text-[11px] text-slate-200 leading-tight truncate">{p.label}</p><p className="text-[9px] text-slate-500 capitalize">{p.acuity}{p.isolation ? ` · ${p.isolation}` : ""}</p></div></div>
            ))}</div> : <p className="text-xs text-slate-400 py-4 text-center">No high-risk patients.</p>}
          </Card>

          <Card title="Staff & Shift Overview">
            <div className="flex items-center gap-3">
              <Donut segs={d.staffOverview.map((s: any) => ({ n: s.n, color: s.color }))} total={d.onDuty} centre={d.onDuty} sub="On Duty" size={96} />
              <div className="space-y-1 text-[11px] flex-1">{d.staffOverview.map((s: any) => <div key={s.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: s.color }} /><span className="text-slate-300 flex-1">{s.label}</span><span className="font-semibold text-white">{s.n}</span></div>)}</div>
            </div>
          </Card>

          <Card title="Incoming Shift Preview" right={<span className="text-[9px] text-slate-500">template</span>}>
            <div className="space-y-2 text-[11px]">
              {[["Incoming shift", "Night (19:00–07:00)"], ["Expected admissions", "6"], ["High-risk carry-over", `${d.watch.length} patients`], ["Key focus", "Monitor deteriorating patients"]].map(([l, v]) => (
                <div key={l} className="flex items-center justify-between"><span className="text-slate-400">{l}</span><span className="text-slate-200 font-medium text-right">{v}</span></div>
              ))}
              <Link href="/unit-manager/shift-intelligence" className="block text-center rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 py-2 text-[11px] text-slate-200 font-medium mt-1">Shift Intelligence →</Link>
            </div>
          </Card>
        </div>
      </div>

      <OpsFoot>UMW-OPC-008 — shift timeline &amp; handover over the live stores. The timeline is today&apos;s real events (escalations / safety / task completions / movements); the SBAR is <strong>auto-generated from live unit state</strong> (with the recorded op_handover shown when present) — a working summary, not a signed clinical handover; readiness is derived from open high-severity issues + overdue actions. Checklist &amp; incoming-shift preview are templates. Read-only manager lens.</OpsFoot>
    </div>
  );
}
