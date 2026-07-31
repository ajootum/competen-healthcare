import { fetchCmoSuite, daysLeft, STATUS_TONE } from "@/lib/competency/cmo-suite";
import { cmoGuard, Head, Card, Kpi, Donut, Pill, Provision, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// CMO-012 Clinical Privileging Manager — lifecycle of clinical privileges: catalogue, applications, review, expiry.
/* eslint-disable @typescript-eslint/no-explicit-any */
const CAT_COLORS = ["#14b8a6", "#a855f7", "#f43f5e", "#3b82f6", "#f59e0b"];
const fmtD = (t: string | null) => { if (!t) return "—"; try { return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }); } catch { return "—"; } };

export default async function PrivilegingPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await fetchCmoSuite(admin, hid, isSuper);
  const head = <Head code="CMO-012 · Competency Office" title="Clinical Privileging Manager" sub="Manage clinical privileges end-to-end — practitioners perform only procedures for which they are approved, competent and currently authorised." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="Privileging Manager" part="part 1" /></div>;

  const privs = d.privileges.map((p: any) => ({ ...p, staff: d.nameById.get(p.staff_id) ?? "—", expIn: daysLeft(p.expiry_date) }));
  const CATS = [["core", "Core"], ["special", "Special"], ["procedural", "Procedural"], ["emergency", "Emergency"], ["telemedicine", "Telemedicine"]];
  const byCat = CATS.map(([k, label]) => ({ label, n: privs.filter((p: any) => p.category === k).length })).filter(x => x.n > 0);
  const review = privs.filter((p: any) => p.status === "under_review");
  const expiring = privs.filter((p: any) => p.expIn != null && p.expIn >= 0 && p.expIn <= 90).sort((a: any, b: any) => a.expIn - b.expIn);
  const noPrereq = privs.filter((p: any) => !p.prerequisites_met);

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Total Privileges" value={privs.length} sub="granted" />
        <Kpi label="Active" value={privs.filter((p: any) => p.status === "active").length} sub="authorised" tone="text-[var(--cmp-text-success)]" />
        <Kpi label="Under Review" value={review.length} sub="committee" tone={review.length ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Kpi label="Expiring" value={expiring.length} sub="≤ 90 days" tone={expiring.length ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Kpi label="Prereq. Lapsed" value={noPrereq.length} sub="auto-suspend" tone={noPrereq.length ? "text-[var(--cmp-text-error)]" : undefined} />
        <Kpi label="Categories" value={byCat.length} sub="privilege types" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="By Category">
          <div className="flex items-center gap-3">
            <Donut segs={byCat.map((c, i) => ({ n: c.n, color: CAT_COLORS[i % CAT_COLORS.length] }))} total={privs.length} centre={privs.length} sub="privileges" size={100} />
            <div className="flex-1 space-y-1 text-[11px]">{byCat.map((c, i) => <div key={c.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} /><span className="text-gray-600 flex-1">{c.label}</span><span className="font-semibold text-gray-900">{c.n}</span></div>)}</div>
          </div>
        </Card>

        <Card title="Expiry & Review" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">next 90 days</span>}>
          {expiring.length ? <div className="space-y-1.5">{expiring.slice(0, 8).map((p: any) => (
            <div key={p.id} className="flex items-center gap-2 text-[12px]"><span className="text-gray-800 flex-1 truncate">{p.privilege_name}</span><span className="text-gray-500 w-28 truncate">{p.staff}</span><span className="text-gray-400 w-20">{fmtD(p.expiry_date)}</span>{!p.prerequisites_met && <Pill text="prereq lapsed" tone="rose" />}<Pill text={`${p.expIn}d`} tone={p.expIn <= 30 ? "rose" : "amber"} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No privileges expiring in the next 90 days. ✅</p>}
        </Card>
      </div>

      <Card title="Privilege Registry" right={<span className="text-[11px] text-gray-400">{privs.length}</span>}>
        <div className="overflow-x-auto"><div className="min-w-[680px] space-y-1">
          <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Privilege</span><span className="w-28">Holder</span><span className="w-24">Category</span><span className="w-20">Granted</span><span className="w-20">Expiry</span><span className="w-16 text-center">Prereq</span><span className="w-24 text-right">Status</span></div>
          {privs.slice(0, 30).map((p: any) => (
            <div key={p.id} className="flex items-center px-1 py-1 text-[12px] border-b border-gray-50"><span className="flex-1 text-gray-800 truncate">{p.privilege_name}</span><span className="w-28 text-gray-500 truncate">{p.staff}</span><span className="w-24 text-gray-500 capitalize">{p.category}</span><span className="w-20 text-gray-400">{fmtD(p.granted_date)}</span><span className="w-20 text-gray-500">{fmtD(p.expiry_date)}</span><span className="w-16 text-center">{p.prerequisites_met ? <span className="text-[var(--cmp-text-success)]">✓</span> : <span className="text-rose-500">✗</span>}</span><span className="w-24 text-right"><Pill text={p.status} tone={STATUS_TONE[p.status]} /></span></div>
          ))}
        </div></div>
      </Card>

      <Foot>CMO-012 — clinical privileging over cmo_privileges. Catalogue, category mix, expiry and prerequisite status are real; the application/renewal workflow, approval-committee workspace and automatic suspension on prerequisite lapse are the next phase.</Foot>
    </div>
  );
}
