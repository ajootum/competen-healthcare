import { loadAdmDocuments } from "@/lib/admin/admin-modules";
import { admGuard, Head, Tabs, Card, Kpi, Donut, Ring, Pill, Progress, Provision, Foot } from "../_ui";
import { STATUS_TONE } from "@/lib/admin/admin-suite";

export const dynamic = "force-dynamic";

// UMW-ADM-003 Policies, SOPs & Document Management — controlled document lifecycle: library, review, acknowledgement,
// regulatory mapping. Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const DOC_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#14b8a6", "#ef4444"];
const dueTone = (n: number | null) => (n == null ? "slate" : n < 0 ? "rose" : n <= 7 ? "rose" : n <= 30 ? "amber" : "emerald");

export default async function DocumentsPage() {
  const { admin, isSuper, hid } = await admGuard();
  const d = await loadAdmDocuments(admin, hid, isSuper) as any;
  const head = <Head code="UMW-ADM-003 · Administration & Configuration" title="Unit Policies, SOPs & Document Management" sub="Create, govern, publish and monitor all unit documents and policies — controlled lifecycle, acknowledgement and regulatory mapping." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="003" /><Provision module="Document Management" part="part 1" /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="003" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-3.5 flex items-center gap-2"><Ring pct={k.governanceScore} size={56} /><div><p className="text-[11px] text-gray-500 uppercase tracking-wide leading-tight">Governance</p><p className="text-[11px] text-emerald-600 font-medium">Score</p></div></div>
        <Kpi label="Total Documents" value={k.total} sub={`${k.published} published`} />
        <Kpi label="Awaiting Review" value={k.awaitingReview} sub="in workflow" tone={k.awaitingReview ? "text-amber-600" : undefined} />
        <Kpi label="Acknowledgement" value={`${k.ackRate}%`} sub="staff compliant" tone={k.ackRate >= 85 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="Expiring Soon" value={k.expiring} sub="within 30 days" tone={k.expiring ? "text-rose-600" : undefined} />
        <Kpi label="Published" value={k.published} sub="live documents" tone="text-emerald-600" />
        <Kpi label="Regulatory Sets" value={d.regulatory.length} sub="frameworks" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="Document Library" right={<span className="text-[11px] text-gray-400">by type</span>}>
          <div className="flex items-center gap-3">
            <Donut segs={d.byType.map((t: any, i: number) => ({ n: t.n, color: DOC_COLORS[i % DOC_COLORS.length] }))} total={k.total} centre={k.total} sub="docs" size={100} />
            <div className="flex-1 space-y-1 text-[11px]">{d.byType.map((t: any, i: number) => <div key={t.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: DOC_COLORS[i % DOC_COLORS.length] }} /><span className="text-gray-600 flex-1 truncate">{t.label}</span><span className="font-semibold text-gray-900">{t.n}</span></div>)}</div>
          </div>
        </Card>

        <Card title="Documents by Status">
          <div className="space-y-2 text-[12px]">{d.byStatus.map((s: any) => <div key={s.status} className="flex items-center gap-2"><Pill text={s.status} tone={STATUS_TONE[s.status]} /><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-blue-500" style={{ width: `${(s.n / k.total) * 100}%` }} /></div><span className="font-semibold text-gray-900 tabular-nums w-6 text-right">{s.n}</span></div>)}</div>
        </Card>

        <Card title="Review Due" right={<span className="text-[11px] text-gray-400">next 45 days</span>}>
          {d.reviewDue.length ? <div className="space-y-2">{d.reviewDue.map((x: any) => (
            <div key={x.id} className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-[11px] text-gray-800 leading-tight truncate">{x.title}</p><p className="text-[10px] text-gray-400 capitalize">{x.doc_type} · v{x.version}</p></div><Pill text={x.reviewIn < 0 ? `${-x.reviewIn}d over` : `${x.reviewIn}d`} tone={dueTone(x.reviewIn)} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">Nothing due.</p>}
        </Card>

        <Card title="Regulatory Mapping">
          <div className="space-y-2.5">{d.regulatory.map((r: any) => (
            <div key={r.reg}><div className="flex items-center justify-between text-[12px] mb-0.5"><span className="text-gray-700">{r.reg}</span><span className="font-semibold text-gray-900">{r.coverage}%</span></div><Progress pct={r.coverage} /></div>
          ))}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="My Pending Approvals" right={<span className="text-[11px] text-gray-400">{d.pending.length}</span>}>
          {d.pending.length ? <div className="space-y-2">{d.pending.map((x: any) => (
            <div key={x.id} className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[12px] text-gray-800 leading-tight truncate">{x.title}</p><p className="text-[10px] text-gray-400">{x.ownerName} · {x.category}</p></div><Pill text={x.status} tone={STATUS_TONE[x.status]} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No pending approvals. ✅</p>}
        </Card>

        <Card title="Recently Published" className="xl:col-span-2">
          <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Title</span><span className="w-24">Category</span><span className="w-16">Version</span><span className="w-24">Owner</span><span className="w-14 text-right">Ack</span></div>
            {d.recent.map((x: any) => (
              <div key={x.id} className="flex items-center px-1 py-1 text-[12px]"><span className="flex-1 text-gray-800 truncate">{x.title}</span><span className="w-24 text-gray-500 text-[11px] truncate">{x.category}</span><span className="w-16 text-gray-500 tabular-nums">v{x.version}</span><span className="w-24 text-gray-500 text-[11px] truncate">{x.ownerName}</span><span className="w-14 text-right text-gray-900 tabular-nums font-semibold">{Math.round(Number(x.acknowledgement_pct))}%</span></div>
            ))}
          </div>
        </Card>
      </div>

      <Foot>UMW-ADM-003 — controlled document management over adm_documents. Library, status workflow, review dates, acknowledgement and regulatory mapping are real from the store; the authoring studio, digital-signature approval chain and AI drafting are the next phase.</Foot>
    </div>
  );
}
