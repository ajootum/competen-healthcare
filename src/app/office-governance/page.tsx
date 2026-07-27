import { ogsGuard, Head, Stat, Card, Pill, Donut, Legend, Bars, Foot, T } from "./_ui";
import { loadOgsCommandCentre } from "@/lib/ogs/ogs-data";
import Link from "next/link";

export const dynamic = "force-dynamic";

// OGS-000/001 Office Governance Command Centre — the executive authority surface for constituting,
// appointing, delegating and overseeing offices across the organisation.
/* eslint-disable @typescript-eslint/no-explicit-any */
const LEVEL_TONE: Record<string, string> = { Enterprise: "violet", Country: "indigo", Facility: "teal", Department: "blue", Specialty: "amber" };
const STATUS_TONE: Record<string, string> = { active: "emerald", approved: "emerald", under_review: "amber", pending_approval: "amber", proposed: "blue", in_design: "blue", suspended: "rose", restructuring: "amber", closing: "rose", dissolved: "slate", archived: "slate" };

export default async function OgsCommandCentre() {
  const { admin, isSuper, hid, fullName } = await ogsGuard();
  const d = await loadOgsCommandCentre(admin, hid, isSuper);
  const head = <Head code="OGS-000 · Office Governance System" title="Office Governance Command Centre" sub={`Constitute offices, appoint leaders, delegate authority and oversee governance across the organisation · ${fullName}`} action={{ label: "AI governance copilot →", href: "/office-governance/ai" }} />;
  if (!d.provisioned) return <div className="space-y-4">{head}<Card><p className="text-sm text-gray-400">No governance offices provisioned yet.</p></Card></div>;
  const k = d.kpis;

  return (
    <div className="space-y-4">
      {head}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat icon="🏛️" tone="teal" label="Active offices" value={k.activeOffices} sub={`${k.totalOffices} total`} />
        <Stat icon="👥" tone="blue" label="Members" value={k.members} sub="distinct" />
        <Stat icon="🪪" tone="indigo" label="Appointments" value={k.appointments} />
        <Stat icon="🗝️" tone="violet" label="Delegations" value={k.delegations} sub="active" />
        <Stat icon="⚖️" tone="emerald" label="Decisions made" value={k.decisionsMade} />
        <Stat icon="🛡️" tone={k.complianceScore != null && k.complianceScore >= 85 ? "emerald" : "amber"} label="Compliance score" value={k.complianceScore != null ? `${k.complianceScore}%` : "—"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Office portfolio">
          <div className="flex items-center gap-2">
            <Donut segments={d.portfolio} total={k.totalOffices} label="Offices" size={130} />
            <Legend items={d.portfolio.map((p: any) => ({ label: p.label, value: p.value, tone: p.tone, pct: k.totalOffices ? Math.round((p.value / k.totalOffices) * 100) : 0 }))} />
          </div>
        </Card>

        <Card title="Office governance status" className="xl:col-span-2" right={<Link href="/office-governance/offices" className="text-teal-600 hover:underline">Constitute / manage →</Link>}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100"><th className="pb-2 pr-3 font-medium">Office</th><th className="pb-2 pr-3 font-medium">Level</th><th className="pb-2 pr-3 font-medium">Chair</th><th className="pb-2 pr-3 font-medium">Members</th><th className="pb-2 pr-3 font-medium">Health</th><th className="pb-2 font-medium">Status</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {d.officeCards.map((o: any) => (
                  <tr key={o.id} className="text-gray-700">
                    <td className="py-2 pr-3 font-medium text-gray-800">{o.name}</td>
                    <td className="py-2 pr-3"><Pill text={o.level} tone={LEVEL_TONE[o.level[0].toUpperCase() + o.level.slice(1)] ?? "slate"} /></td>
                    <td className="py-2 pr-3 text-gray-500">{o.chair ?? <span className="text-rose-500">unfilled</span>}</td>
                    <td className="py-2 pr-3 tabular-nums text-gray-500">{o.members}/{o.quorum}</td>
                    <td className="py-2 pr-3"><span className={`font-semibold tabular-nums ${o.health >= 85 ? "text-emerald-600" : o.health >= 60 ? "text-amber-600" : "text-rose-600"}`}>{o.health}%</span></td>
                    <td className="py-2"><Pill text={(o.status ?? (o.active ? "active" : "inactive")).replace(/_/g, " ")} tone={STATUS_TONE[o.status] ?? (o.active ? "emerald" : "slate")} /></td>
                  </tr>
                ))}
                {!d.officeCards.length && <tr><td colSpan={6} className="py-6 text-center text-gray-400">No offices registered.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Office lifecycle" className="xl:col-span-2" right="constitute → operate → retire">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {d.lifecycle.map((s: any, i: number) => (
              <div key={s.stage} className="flex items-center gap-1 shrink-0">
                <div className="flex flex-col items-center text-center w-[92px]">
                  <span className="w-11 h-11 rounded-full flex items-center justify-center text-base font-bold tabular-nums" style={{ backgroundColor: T(s.tone).hex + "22", color: T(s.tone).hex }}>{s.n}</span>
                  <span className="text-[11px] text-gray-600 mt-1 leading-tight">{s.stage}</span>
                </div>
                {i < d.lifecycle.length - 1 && <span className="text-gray-300">→</span>}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1">{d.source === "ogs" ? <>Real office lifecycle states from the first-class <code>ogs_offices</code> model (Proposed→In-design→Approved→Active→Under-review→Suspended→Dissolved). Activation gates &amp; state-change workflows are the next build.</> : <>Grounded in office active-state + quorum. Apply migrations 116/117 to light up the full <code>ogs_offices</code> lifecycle states.</>}</p>
        </Card>

        <Card title="Key governance alerts">
          <div className="space-y-2">{d.alerts.map((a: any, i: number) => (
            <div key={i} className="flex items-start gap-2"><span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: T(a.tone).hex }} /><div className="min-w-0"><p className="text-[12px] font-medium text-gray-800 leading-snug">{a.title}</p><p className="text-[11px] text-gray-500">{a.detail}</p></div></div>
          ))}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Recent appointments">
          {d.recentAppointments.length ? <div className="space-y-2">{d.recentAppointments.map((a: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[12px]"><span className="w-7 h-7 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xs font-bold shrink-0">{(a.name?.[0] ?? "?").toUpperCase()}</span><div className="min-w-0 flex-1"><p className="text-gray-800 truncate">{a.name}</p><p className="text-[10px] text-gray-400 truncate">{a.office}</p></div><Pill text={a.role} tone={a.role === "chair" ? "violet" : a.role === "reviewer" ? "amber" : "blue"} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No recent appointments.</p>}
        </Card>

        <Card title="Governance performance">
          <Bars items={d.performance.map((p: any) => ({ label: p.label, pct: p.pct, value: `${p.pct}%` }))} />
        </Card>

        <Card title="Governance audit trail" right={<Link href="/office-governance/audit" className="text-teal-600 hover:underline">All →</Link>}>
          {d.events.length ? <div className="space-y-1.5">{d.events.map((e: any, i: number) => (
            <div key={i} className="text-[11.5px]"><span className="text-gray-700">{e.actor ?? "system"}</span> <span className="text-gray-500">{e.action}</span> <span className="text-gray-400">· {e.entity}</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No recent governance events.</p>}
        </Card>
      </div>

      {d.transitions?.length ? (
        <Card title="Recent lifecycle transitions" right="immutable record">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
            {d.transitions.map((t: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-[12px] border-b border-gray-50 py-1">
                <span className="text-gray-800 font-medium truncate flex-1">{t.office}</span>
                {t.from && <span className="text-gray-400 text-[11px]">{String(t.from).replace(/_/g, " ")} →</span>}
                <Pill text={String(t.to ?? "").replace(/_/g, " ")} tone={STATUS_TONE[t.to] ?? "blue"} />
                <span className="text-gray-400 text-[10px] w-20 text-right tabular-nums">{t.when ? new Date(t.when).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : ""}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Foot>OGS-000 — the Office Governance System command centre. Offices, appointments, charters and immutable lifecycle transitions now come from the first-class <code>ogs_offices</code> model (migrations 116/117), with automatic fail-soft fallback to the <code>governance_committees</code> / <code>committee_members</code> mapping until it is applied. Delegations (<code>adm_delegations</code>), governance decisions (<code>change_requests</code>) and events (<code>audit_log</code>) remain their own stores. Office health &amp; compliance are transparent composites (active + chaired + at-quorum). The write-workflows (constitute / appoint / delegate / dissolve), meetings &amp; votes and activation gates are the next build; the Education &amp; Research governance offices are greenfield.</Foot>
    </div>
  );
}
