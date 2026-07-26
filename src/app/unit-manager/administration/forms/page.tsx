import { loadAdmForms } from "@/lib/admin/admin-modules";
import { admGuard, Head, Tabs, Card, Kpi, Donut, Pill, Provision, Foot } from "../_ui";
import { STATUS_TONE } from "@/lib/admin/admin-suite";

export const dynamic = "force-dynamic";

// UMW-ADM-005 Forms, Registers & Documentation Configuration — metadata-driven forms, registers, checklists and logs.
// Gate hospital_admin/super_admin.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7"];

export default async function FormsPage() {
  const { admin, isSuper, hid } = await admGuard();
  const d = await loadAdmForms(admin, hid, isSuper) as any;
  const head = <Head code="UMW-ADM-005 · Administration & Configuration" title="Forms, Registers & Documentation Configuration" sub="Design, govern and publish all unit forms, registers, checklists and logs — standardised, no-code documentation capture." />;
  if (!d.provisioned) return <div className="max-w-[1500px] space-y-4">{head}<Tabs active="005" /><Provision module="Forms & Registers" part="part 2" /></div>;

  const k = d.kpis;
  return (
    <div className="max-w-[1500px] space-y-4">
      {head}<Tabs active="005" />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
        <Kpi label="Total Forms" value={k.total} sub="templates" />
        <Kpi label="Active" value={k.active} sub="published + active" tone="text-emerald-600" />
        <Kpi label="Submissions" value={k.submissions.toLocaleString()} sub="captured" />
        <Kpi label="Submission Compliance" value={`${k.compliance}%`} sub="avg" tone={k.compliance >= 90 ? "text-emerald-600" : "text-amber-600"} />
        <Kpi label="Pending Review" value={k.pendingReview} sub="next 30 days" tone={k.pendingReview ? "text-amber-600" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <Card title="By Type">
          <div className="flex items-center gap-3">
            <Donut segs={d.byType.map((t: any, i: number) => ({ n: t.n, color: TYPE_COLORS[i % TYPE_COLORS.length] }))} total={k.total} centre={k.total} sub="forms" size={100} />
            <div className="flex-1 space-y-1 text-[11px]">{d.byType.map((t: any, i: number) => <div key={t.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }} /><span className="text-gray-600 flex-1">{t.label}</span><span className="font-semibold text-gray-900">{t.n}</span></div>)}</div>
          </div>
        </Card>

        <Card title="Forms & Registers" className="xl:col-span-3" right={<span className="text-[11px] text-gray-400">by submissions</span>}>
          <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Name</span><span className="w-20">Type</span><span className="w-24">Category</span><span className="w-20 text-right">Submissions</span><span className="w-16 text-right">Compl.</span><span className="w-20 text-right">Status</span></div>
            {d.forms.map((f: any) => (
              <div key={f.id} className="flex items-center px-1 py-1 text-[12px] border-b border-gray-50"><span className="flex-1 text-gray-800 truncate">{f.name}</span><span className="w-20 text-gray-500 text-[11px] capitalize">{f.form_type}</span><span className="w-24 text-gray-500 text-[11px] truncate">{f.category}</span><span className="w-20 text-right text-gray-900 tabular-nums">{Number(f.submissions).toLocaleString()}</span><span className="w-16 text-right text-gray-900 tabular-nums font-semibold">{Math.round(Number(f.compliance_pct || 0))}%</span><span className="w-20 text-right"><Pill text={f.status} tone={STATUS_TONE[f.status]} /></span></div>
            ))}
          </div>
        </Card>
      </div>

      <Foot>UMW-ADM-005 — forms &amp; registers over adm_forms. Template inventory, submission counts and compliance are real; the drag-and-drop form builder, workflow designer and field-to-KPI analytics mapping are the next phase.</Foot>
    </div>
  );
}
