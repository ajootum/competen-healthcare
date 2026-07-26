import { fetchCmoSuite, daysLeft, STATUS_TONE } from "@/lib/competency/cmo-suite";
import { cmoGuard, Head, Card, Kpi, Donut, Pill, Provision, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// CMO-011 Professional Certification Manager — lifecycle of licenses, registrations and mandatory certifications.
/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPE_COLORS = ["#14b8a6", "#3b82f6", "#a855f7", "#f59e0b"];
const fmtD = (t: string | null) => { if (!t) return "—"; try { return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" }); } catch { return "—"; } };

export default async function CertificationsPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await fetchCmoSuite(admin, hid, isSuper);
  const head = <Head code="CMO-011 · Competency Office" title="Professional Certification Manager" sub="Manage the lifecycle of professional registrations, licenses and mandatory credentials — with automatic expiry and renewal monitoring." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="Certification Manager" part="part 1" /></div>;

  const certs = d.certifications.map((c: any) => ({ ...c, staff: d.nameById.get(c.staff_id) ?? "—", expIn: daysLeft(c.expiry_date) }));
  const TYPES = [["license", "Licenses"], ["registration", "Registrations"], ["certification", "Certifications"], ["mandatory", "Mandatory"]];
  const byType = TYPES.map(([k, label]) => ({ label, n: certs.filter((c: any) => c.cert_type === k).length })).filter(x => x.n > 0);
  const expiring = certs.filter((c: any) => c.expIn != null && c.expIn >= 0 && c.expIn <= 60).sort((a: any, b: any) => a.expIn - b.expIn);
  const expired = certs.filter((c: any) => c.status === "expired");
  const verified = certs.filter((c: any) => c.verified).length;

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Total Certifications" value={certs.length} sub="tracked" />
        <Kpi label="Active" value={certs.filter((c: any) => c.status === "active").length} sub="current" tone="text-emerald-600" />
        <Kpi label="Expiring Soon" value={expiring.length} sub="≤ 60 days" tone={expiring.length ? "text-amber-600" : undefined} />
        <Kpi label="Expired" value={expired.length} sub="non-compliant" tone={expired.length ? "text-rose-600" : undefined} />
        <Kpi label="Verified" value={`${certs.length ? Math.round((verified / certs.length) * 100) : 0}%`} sub="validated" />
        <Kpi label="Types" value={byType.length} sub="credential types" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="By Type">
          <div className="flex items-center gap-3">
            <Donut segs={byType.map((t, i) => ({ n: t.n, color: TYPE_COLORS[i % TYPE_COLORS.length] }))} total={certs.length} centre={certs.length} sub="certs" size={100} />
            <div className="flex-1 space-y-1 text-[11px]">{byType.map((t, i) => <div key={t.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }} /><span className="text-gray-600 flex-1">{t.label}</span><span className="font-semibold text-gray-900">{t.n}</span></div>)}</div>
          </div>
        </Card>

        <Card title="Expiry & Renewal" className="xl:col-span-2" right={<span className="text-[11px] text-gray-400">next 60 days</span>}>
          {expiring.length ? <div className="space-y-1.5">{expiring.slice(0, 8).map((c: any) => (
            <div key={c.id} className="flex items-center gap-2 text-[12px]"><span className="text-gray-800 flex-1 truncate">{c.name}</span><span className="text-gray-500 w-28 truncate">{c.staff}</span><span className="text-gray-400 w-20">{fmtD(c.expiry_date)}</span><Pill text={c.expIn <= 14 ? `${c.expIn}d ⚠` : `${c.expIn}d`} tone={c.expIn <= 14 ? "rose" : "amber"} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No certifications expiring in the next 60 days. ✅</p>}
        </Card>
      </div>

      <Card title="Certification Registry" right={<span className="text-[11px] text-gray-400">{certs.length}</span>}>
        <div className="overflow-x-auto"><div className="min-w-[720px] space-y-1">
          <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Certification</span><span className="w-28">Holder</span><span className="w-24">Type</span><span className="w-28">Issuer</span><span className="w-20">Expiry</span><span className="w-16 text-center">Verified</span><span className="w-20 text-right">Status</span></div>
          {certs.slice(0, 30).map((c: any) => (
            <div key={c.id} className="flex items-center px-1 py-1 text-[12px] border-b border-gray-50"><span className="flex-1 text-gray-800 truncate">{c.name}</span><span className="w-28 text-gray-500 truncate">{c.staff}</span><span className="w-24 text-gray-500 capitalize">{c.cert_type}</span><span className="w-28 text-gray-400 truncate text-[11px]">{c.issuer}</span><span className="w-20 text-gray-500">{fmtD(c.expiry_date)}</span><span className="w-16 text-center">{c.verified ? <span className="text-emerald-600">✓</span> : <span className="text-gray-300">—</span>}</span><span className="w-20 text-right"><Pill text={c.status} tone={STATUS_TONE[c.status]} /></span></div>
          ))}
        </div></div>
      </Card>

      <Foot>CMO-011 — certification lifecycle over cmo_certifications. Registry, expiry monitoring and verification status are real; the renewal workflow, automated verification against issuer registries and configurable reminders are the next phase.</Foot>
    </div>
  );
}
