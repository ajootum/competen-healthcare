import { redirect } from "next/navigation";
import Link from "next/link";
import { getLandlordCaller } from "@/lib/platform/landlord";
import { loadQuality } from "@/lib/platform/phase3";

export const dynamic = "force-dynamic";

// Quality & Compliance (QLT-001) — platform-wide quality posture.
const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function QualityPage() {
  const caller = await getLandlordCaller();
  if (!caller) redirect("/dashboard");
  const q = await loadQuality(caller.admin);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Quality &amp; Compliance</h1>
        <p className="text-sm text-gray-500 mt-1">Platform-wide quality activity across all tenants, and the shared standards library.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{q.audits}</div><div className="text-xs text-gray-500 mt-1">Audits (all tenants)</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-green-600">{q.auditsCompleted}</div><div className="text-xs text-gray-500 mt-1">Completed audits</div></div>
        <div className={card}><div className={`text-3xl font-bold tabular-nums ${q.capaOpen ? "text-amber-600" : "text-gray-900"}`}>{q.capaOpen}</div><div className="text-xs text-gray-500 mt-1">Open CAPA</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{q.improvements}</div><div className="text-xs text-gray-500 mt-1">Improvement projects</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-violet-700">{q.masterStandards}</div><div className="text-xs text-gray-500 mt-1">Master standards</div></div>
      </div>
      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-1">Standards governance</h3>
        <p className="text-sm text-gray-500">{q.masterStandards} shared master competency framework{q.masterStandards !== 1 ? "s" : ""} inherited by every tenant. Govern versioning and publication in the <Link href="/enterprise-governance/standards" className="text-violet-600 hover:underline">Enterprise Standards</Link> surface and the <Link href="/super-admin/content" className="text-violet-600 hover:underline">competency studio</Link>.</p>
      </div>
      <p className="text-[11px] text-gray-400">Counts aggregate quality records across all tenants (a landlord-only view). Per-tenant detail lives in each organisation&apos;s Quality &amp; Accreditation workspace.</p>
    </div>
  );
}
