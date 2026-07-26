import { qaGuard, Head, Tabs, Stat, Card, Pill, Donut, Legend, Bars, Gauge, Ring, Table, Foot } from "../_ui";
import { loadImprovementCapa } from "@/lib/qaw/improvement-capa";
import Link from "next/link";

export const dynamic = "force-dynamic";

// QAW-003 Improvement Plans & CAPA Centre — corrective/preventive actions, RCA, improvement projects.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TABS = ["Overview", "CAPA Register", "Improvement Plans", "Root Cause Analysis", "Action Tracking", "Effectiveness", "Reports & Analytics"];
const PR_TONE: Record<string, string> = { "High / Critical": "rose", Medium: "amber", Low: "emerald" };
const LIFECYCLE = [["🔍", "Identify", "Finding or issue"], ["🧪", "Analyze", "Root cause analysis"], ["📋", "Plan", "Action plan approved"], ["▶️", "Implement", "Actions executed"], ["✅", "Verify", "Effectiveness verified"], ["🏁", "Close", "Closed & archived"]];

export default async function ImprovementCapaPage() {
  const { admin, isSuper, hid } = await qaGuard();
  const d = await loadImprovementCapa(admin, hid, isSuper);
  const head = <Head code="QAW-003 · Quality & Accreditation" title="Improvement Plans & CAPA Centre" sub="Manage corrective and preventive actions, improvement plans and effectiveness outcomes." action={{ label: "+ New CAPA / Action", href: "/admin/quality" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Tabs tabs={TABS} active="Overview" /><Card><p className="text-sm text-gray-400">The CAPA store is not provisioned yet.</p></Card></div>;
  const k = d.kpis, im = d.improvements;

  return (
    <div className="space-y-4">
      {head}
      <Tabs tabs={TABS} active="Overview" />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <Stat icon="📋" tone="teal" label="Total actions" value={k.total} />
        <Stat icon="✅" tone="emerald" label="Completed" value={k.completed} sub={`${k.completionRate}% completion`} />
        <Stat icon="🕓" tone="amber" label="In progress" value={k.inProgress} />
        <Stat icon="⏰" tone="rose" label="Overdue" value={k.overdue} sub={k.total ? `${Math.round((k.overdue / k.total) * 100)}% overdue` : ""} />
        <Stat icon="🎯" tone="violet" label="Effectiveness due" value={k.effDue} sub="awaiting verification" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card title="CAPA status overview">
          <div className="flex items-center gap-2">
            <Donut segments={d.statusDonut} total={k.total} label="Total actions" size={130} />
            <Legend items={d.statusDonut.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone, pct: k.total ? Math.round((s.value / k.total) * 100) : 0 }))} />
          </div>
        </Card>

        <Card title="Actions by priority">
          <Bars items={d.byPriority.map((p: any) => ({ label: p.label, pct: p.pct, tone: PR_TONE[p.label] ?? "slate", value: `${p.value} (${p.pct}%)` }))} />
        </Card>

        <Card title="Actions by source">
          <Legend items={d.bySource.map((s: any) => ({ label: s.label, value: s.value, tone: s.tone, pct: k.total ? Math.round((s.value / k.total) * 100) : 0 }))} />
          <p className="text-[10px] text-gray-400 mt-3">Source is derived from whether an action links to an audit (<code>audit_id</code>). Finer provenance (incident / risk / complaint / accreditation) is captured as those producers are wired in.</p>
        </Card>

        <Card title="Improvement projects">
          <div className="flex items-center gap-3">
            <Ring pct={im.overallProgress} size={62} tone="teal" />
            <div className="text-[12px] space-y-1">
              <div className="flex justify-between gap-4"><span className="text-gray-500">Active plans</span><b className="tabular-nums">{im.active}</b></div>
              <div className="flex justify-between gap-4"><span className="text-gray-500">Completed</span><b className="tabular-nums">{im.completed}</b></div>
              <div className="flex justify-between gap-4"><span className="text-gray-500">Avg duration</span><b className="tabular-nums">{im.avgDuration != null ? `${im.avgDuration}d` : "—"}</b></div>
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Overall progress is modelled from each project&apos;s lifecycle stage.</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Top overdue actions" className="xl:col-span-2" right={`${k.overdue} overdue`}>
          <Table cols={["Action", "Source", "Priority", "Due", "Owner", "Overdue"]} rows={d.topOverdue.map((c: any) => [
            <span key="t" className="font-medium text-gray-800">{c.title}</span>,
            <span key="s" className="text-gray-500">{c.source}</span>,
            <Pill key="p" text={c.priority} tone={c.priority === "high" ? "rose" : c.priority === "medium" ? "amber" : "emerald"} />,
            <span key="d" className="text-gray-500 tabular-nums">{c.due}</span>,
            <span key="o" className="text-gray-500">{c.owner ?? "—"}</span>,
            <Pill key="x" text={`${c.daysOver}d`} tone="rose" />,
          ])} empty="No overdue actions. ✅" />
        </Card>

        <Card title="CAPA effectiveness">
          <div className="flex flex-col items-center">
            <Gauge pct={d.effectiveness ?? 0} label="verified effective" tone={d.effectiveness == null ? "gray" : undefined} />
            {d.effectiveness == null && <p className="text-[11px] text-gray-400 mt-1">No actions finished yet.</p>}
          </div>
          <div className="mt-2"><Legend items={d.effectiveBreak.map((e: any) => ({ label: e.label, value: e.value, tone: e.tone }))} /></div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="CAPA lifecycle" className="xl:col-span-2">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {LIFECYCLE.map(([icon, label, sub], i) => (
              <div key={i} className="flex items-center gap-1 shrink-0">
                <div className="flex flex-col items-center text-center w-24">
                  <span className="w-9 h-9 rounded-full bg-teal-50 flex items-center justify-center text-base">{icon}</span>
                  <span className="text-[11px] font-medium text-gray-800 mt-1">{label}</span>
                  <span className="text-[9px] text-gray-400 leading-tight">{sub}</span>
                </div>
                {i < LIFECYCLE.length - 1 && <span className="text-gray-300">→</span>}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Improvement methodologies" right="in use">
          {im.byMethod.length ? <div className="space-y-1.5">{im.byMethod.map((m: any, i: number) => (
            <div key={i} className="flex items-center justify-between text-[12.5px]"><span className="text-gray-600 capitalize">{m.label}</span><b className="tabular-nums text-gray-800">{m.value}</b></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No improvement projects yet.</p>}
          <p className="text-[10px] text-gray-400 mt-3"><Link href="/quality-accreditation/ai" className="text-teal-600 hover:underline">AI CAPA assistant →</Link> ranks overdue risk and suggests root causes (QAW-012).</p>
        </Card>
      </div>

      <Foot>QAW-003 — live over <code>capa_actions</code> + <code>improvement_objects</code>/<code>improvement_actions</code>. Status mix, priority, source split, overdue queue, effectiveness and project progress are all real and tenant-scoped. Structured RCA capture (5-Whys / Fishbone) is a free-text methodology today; a dedicated RCA workspace is the next phase.</Foot>
    </div>
  );
}
