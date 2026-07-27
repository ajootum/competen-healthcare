import { loadCmoGovernance } from "@/lib/competency/cmo-governance";
import { cmoGuard, Head, Card, Kpi, Donut, Pill, Bars, Provision, Foot } from "../_cmo-ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

// COMP-011 Competency Governance & Publication — the Competency Office governs (reviews, approves,
// publishes, versions, monitors, retires, audits) competencies authored in Competency Studio.
/* eslint-disable @typescript-eslint/no-explicit-any */
const HEX: Record<string, string> = { slate: "#94a3b8", amber: "#f59e0b", blue: "#3b82f6", violet: "#a855f7", emerald: "#22c55e", rose: "#ef4444", teal: "#14b8a6" };
const fmtD = (t: string | null) => { if (!t) return "—"; try { return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); } catch { return "—"; } };

export default async function GovernancePublicationPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadCmoGovernance(admin, hid, isSuper);
  const head = <Head code="COMP-011 · Competency Office" title="Governance & Publication" sub="Govern, approve, publish, version and monitor competencies authored in Competency Studio. The Office governs — it does not author." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="Governance & Publication" part="part 2" /></div>;
  const k = d.kpis;

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Submitted for review" value={k.submitted} sub="from Studio" />
        <Kpi label="In review" value={k.inReview} sub="technical → governance" tone="text-amber-600" />
        <Kpi label="Approval pending" value={k.approvalPending} sub="awaiting decision" tone={k.approvalPending ? "text-violet-600" : undefined} />
        <Kpi label="Approved" value={k.approved} sub="ready to publish" tone="text-blue-600" />
        <Kpi label="Published" value={k.published} sub="live" tone="text-emerald-600" />
        <Kpi label="Retiring / review due" value={k.retiringSoon} sub="≤ 90 days" tone={k.retiringSoon ? "text-rose-600" : undefined} />
      </div>

      <Card title="Governance pipeline" right={<span className="text-[11px] text-gray-400">Studio → review → approval → publication</span>}>
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {d.pipeline.map((s: any, i: number) => (
            <div key={s.stage} className="flex items-center gap-1 shrink-0">
              <div className="flex flex-col items-center text-center w-24">
                <span className="w-11 h-11 rounded-full flex items-center justify-center text-base font-bold tabular-nums" style={{ backgroundColor: HEX[s.tone] + "22", color: HEX[s.tone] }}>{s.n}</span>
                <span className="text-[11px] font-medium text-gray-700 mt-1 leading-tight">{s.stage}</span>
              </div>
              {i < d.pipeline.length - 1 && <span className="text-gray-300">→</span>}
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-2">Counts from the live publication spine (<code>cmo_publications</code>). The full COMP-011 stage split (technical / clinical / governance review) is tracked in the <Link href="/competency-office/review-board" className="text-teal-600 hover:underline">Review &amp; Approval Centre</Link> via the multi-step approval engine.</p>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Publication status">
          <div className="flex items-center gap-3">
            <Donut segs={d.statusDonut.filter((s: any) => s.value > 0).map((s: any) => ({ n: s.value, color: HEX[s.tone] }))} total={k.total} centre={k.total} sub="publications" size={110} />
            <div className="flex-1 space-y-1 text-[11px]">{d.statusDonut.filter((s: any) => s.value > 0).map((s: any) => <div key={s.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: HEX[s.tone] }} /><span className="text-gray-600 flex-1">{s.label}</span><span className="font-semibold text-gray-900 tabular-nums">{s.value}</span></div>)}</div>
          </div>
        </Card>

        <Card title="Review & approval queue" className="xl:col-span-2" right={<Link href="/competency-office/review-board" className="text-[11px] text-teal-600 hover:underline">Approval centre →</Link>}>
          {d.approvalQueue.length ? <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Item</span><span className="w-28">Workflow</span><span className="w-16 text-center">Stage</span><span className="w-16 text-right">Age</span></div>
            {d.approvalQueue.map((r: any, i: number) => (
              <div key={i} className="flex items-center px-1 py-1.5 text-[12px] border-b border-gray-50"><span className="flex-1 text-gray-800 truncate">{r.entity}</span><span className="w-28 text-gray-500 capitalize text-[11px] truncate">{r.workflow}</span><span className="w-16 text-center text-gray-500 tabular-nums">{r.step ?? "—"}/{r.total ?? "—"}</span><span className={`w-16 text-right tabular-nums ${r.overdue ? "text-rose-600 font-semibold" : "text-gray-400"}`}>{r.age}d</span></div>
            ))}
          </div> : <div className="py-6 text-center"><p className="text-sm text-gray-400">No publications awaiting review.</p><p className="text-[10px] text-gray-400 mt-1">Multi-stage reviews are tracked in <code>plat_approval_requests</code> (workflow engine); the queue populates as Studio submits competencies for governance.</p></div>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Recently published" className="xl:col-span-2">
          {d.recentlyPublished.length ? <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Competency artifact</span><span className="w-24">Type</span><span className="w-14">Version</span><span className="w-24">Target</span><span className="w-24 text-right">Published</span></div>
            {d.recentlyPublished.map((p: any, i: number) => (
              <div key={i} className="flex items-center px-1 py-1.5 text-[12px] border-b border-gray-50"><span className="flex-1 text-gray-800 truncate">{p.name}</span><span className="w-24 text-gray-500 capitalize text-[11px]">{p.type}</span><span className="w-14 text-gray-400 tabular-nums">v{p.version}</span><span className="w-24 text-gray-500 capitalize text-[11px]">{p.target}</span><span className="w-24 text-right text-gray-400 text-[11px]">{fmtD(p.when)}</span></div>
            ))}
          </div> : <p className="text-sm text-gray-400 py-6 text-center">No published competencies yet.</p>}
        </Card>

        <Card title="Version management" right={<span className="text-[11px] text-gray-400">frameworks</span>}>
          <div className="grid grid-cols-3 gap-2 text-center mb-3">
            <div className="border border-gray-100 rounded-lg p-2"><p className="text-xl font-bold text-gray-900 tabular-nums">{d.versionMgmt.activeFrameworks}</p><p className="text-[10px] text-gray-400">active</p></div>
            <div className="border border-gray-100 rounded-lg p-2"><p className="text-xl font-bold text-gray-900 tabular-nums">{d.versionMgmt.libraries}</p><p className="text-[10px] text-gray-400">libraries</p></div>
            <div className="border border-gray-100 rounded-lg p-2"><p className={`text-xl font-bold tabular-nums ${d.versionMgmt.reviewDue ? "text-amber-600" : "text-gray-900"}`}>{d.versionMgmt.reviewDue}</p><p className="text-[10px] text-gray-400">review due</p></div>
          </div>
          {d.versionMgmt.byLibrary.length ? <Bars rows={d.versionMgmt.byLibrary.map((l: any) => ({ label: l.label, n: l.value }))} /> : <p className="text-[11px] text-gray-400 text-center">No framework libraries.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Change request centre" right={<span className="text-[11px] text-gray-400">{d.openChanges} open</span>}>
          {d.changeRequests.length ? <div className="space-y-2">{d.changeRequests.map((c: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[12px] border-b border-gray-50 pb-1.5"><div className="min-w-0 flex-1"><p className="text-gray-800 truncate">{c.entity}</p><p className="text-[10px] text-gray-400">{c.by ?? "—"}</p></div><Pill text={c.kind} tone={c.kind === "major" ? "rose" : c.kind === "revision" ? "amber" : "blue"} /><Pill text={c.status} tone={c.status === "approved" || c.status === "implemented" ? "emerald" : c.status === "rejected" ? "rose" : "amber"} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No competency change requests.</p>}
        </Card>

        <Card title="Deployment status" right={<Link href="/competency-office/assignments" className="text-[11px] text-teal-600 hover:underline">Assignments →</Link>}>
          {d.deployment.length ? <><Donut segs={d.deployment.map((s: any, i: number) => ({ n: s.value, color: ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#94a3b8"][i % 5] }))} total={d.deployTotal} centre={d.deployTotal} sub="assignments" size={100} /><div className="mt-2 space-y-1 text-[11px]">{d.deployment.map((s: any) => <div key={s.label} className="flex justify-between"><span className="text-gray-600 capitalize">{s.label}</span><b className="tabular-nums">{s.value}</b></div>)}</div></> : <p className="text-sm text-gray-400 py-4 text-center">No deployment records yet.</p>}
        </Card>

        <Card title="Alerts & escalations">
          <div className="space-y-2">{d.alerts.map((a: any, i: number) => (
            <div key={i} className="flex items-start gap-2"><span className={`w-2 h-2 rounded-full mt-1.5 shrink-0`} style={{ background: HEX[a.tone] }} /><div className="min-w-0"><p className="text-[12px] font-medium text-gray-800 leading-snug">{a.title}</p><p className="text-[11px] text-gray-500">{a.detail}</p></div></div>
          ))}</div>
        </Card>
      </div>

      <Card title="Governance audit trail" right={<span className="text-[11px] text-gray-400">immutable · recent</span>}>
        {d.audit.length ? <div className="space-y-1.5">{d.audit.map((e: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-[12px]"><span className="text-gray-400 tabular-nums w-32 shrink-0">{e.when ? new Date(e.when).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</span><span className="text-gray-700 w-28 truncate">{e.actor ?? "system"}</span><span className="text-gray-600 flex-1 truncate">{e.action} · {e.entity}</span></div>
        ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No recent governance events in the audit log.</p>}
      </Card>

      <Foot>COMP-011 — live over the real governance substrate: <code>cmo_publications</code> (publication + version spine), <code>plat_approval_requests</code> (multi-stage review engine, incl. the <code>framework_publication</code> workflow), <code>change_requests</code> (change centre), <code>frameworks</code> version fields + review dates, and <code>audit_log</code> (immutable trail). Authoring stays in Competency Studio — the Office governs. Digital signatures, the rollback/supersession write-engine and notification SLA escalation are the next build phase.</Foot>
    </div>
  );
}
