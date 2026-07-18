import Link from "next/link";
import { loadAnalytics, requireAnalyticsAccess, deltaLabel } from "@/lib/analytics";
import { ModuleHeader, StatTiles, PctChip, Card } from "../ui";

// Evidence Analytics module — submission pipeline, weekly trend, file-type
// mix (from the evidence register's real mime types), approval by department
// and backlog ageing. Rejection reasons are free-text, stated as such.

export const dynamic = "force-dynamic";

export default async function EvidenceAnalyticsPage() {
  const { admin, hospitalId } = await requireAnalyticsAccess();
  const ctx = await loadAnalytics(admin, hospitalId);

  const { data: filesRaw } = hospitalId
    ? await admin.from("evidence").select("mime_type, created_at").eq("hospital_id", hospitalId).eq("kind", "evidence").limit(2000)
    : { data: [] };

  const now = new Date().getTime();
  const d30 = new Date(now - 30 * 86400000).toISOString();
  const d60 = new Date(now - 60 * 86400000).toISOString();
  const ev30 = ctx.entries.filter(e => e.created_at >= d30);
  const evPrev = ctx.entries.filter(e => e.created_at >= d60 && e.created_at < d30);
  const rateOf = (xs: typeof ctx.entries) => {
    const v = xs.filter(e => e.status === "verified").length;
    const r = xs.filter(e => e.status === "rejected").length;
    return v + r ? Math.round(v / (v + r) * 100) : null;
  };
  const pending = ctx.entries.filter(e => e.status === "pending");

  // Weekly trend (8 weeks): submitted vs verified
  const weeks: { label: string; sub: number; ver: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const start = new Date(now - (i + 1) * 7 * 86400000).toISOString();
    const end = new Date(now - i * 7 * 86400000).toISOString();
    weeks.push({
      label: `W${8 - i}`,
      sub: ctx.entries.filter(e => e.created_at >= start && e.created_at < end).length,
      ver: ctx.entries.filter(e => e.verified_at && e.verified_at >= start && e.verified_at < end).length,
    });
  }
  const weekMax = Math.max(1, ...weeks.map(w => Math.max(w.sub, w.ver)));

  // File-type mix from the evidence register (real mime types)
  const typeOf = (m: string) =>
    m.includes("pdf") ? "Documents" : m.startsWith("image/") ? "Photos" : m.startsWith("video/") ? "Video" : m.startsWith("audio/") ? "Voice notes" : "Other";
  const typeAgg = new Map<string, number>();
  for (const f of filesRaw ?? []) typeAgg.set(typeOf(f.mime_type), (typeAgg.get(typeOf(f.mime_type)) ?? 0) + 1);
  const types = [...typeAgg.entries()].sort((a, b) => b[1] - a[1]);
  const typeTotal = Math.max(1, types.reduce((s, [, n]) => s + n, 0));

  // Approval rate by department
  const deptOf = new Map(ctx.nurses.map(n => [n.id, n.dept]));
  const deptAgg = new Map<string, { v: number; r: number }>();
  for (const e of ctx.entries) {
    if (!["verified", "rejected"].includes(e.status)) continue;
    const dep = deptOf.get(e.nurse_id) ?? "General";
    const a = deptAgg.get(dep) ?? { v: 0, r: 0 };
    if (e.status === "verified") a.v++; else a.r++;
    deptAgg.set(dep, a);
  }
  const deptRows = [...deptAgg.entries()].map(([dep, a]) => ({ dep, n: a.v + a.r, pct: Math.round(a.v / (a.v + a.r) * 100) }))
    .sort((a, b) => b.n - a.n).slice(0, 8);

  // Backlog ageing
  const ageOf = (iso: string) => (now - new Date(iso).getTime()) / 86400000;
  const ageBuckets = [
    { label: "≤3 days", n: pending.filter(e => ageOf(e.created_at) <= 3).length },
    { label: "4–7 days", n: pending.filter(e => ageOf(e.created_at) > 3 && ageOf(e.created_at) <= 7).length },
    { label: "8–14 days", n: pending.filter(e => ageOf(e.created_at) > 7 && ageOf(e.created_at) <= 14).length },
    { label: "15+ days", n: pending.filter(e => ageOf(e.created_at) > 14).length },
  ];
  const ageMax = Math.max(1, ...ageBuckets.map(b => b.n));

  return (
    <div className="max-w-4xl">
      <ModuleHeader icon="🖇️" title="Evidence Analytics" sub="Evidence submission and approval insights — logbook pipeline plus the evidence file register." />
      <StatTiles cols="grid-cols-2 md:grid-cols-5" tiles={[
        { label: "Submitted (30d)", value: String(ev30.length), d: deltaLabel(ev30.length, evPrev.length) },
        { label: "Approved (30d)", value: String(ev30.filter(e => e.status === "verified").length) },
        { label: "Rejected (30d)", value: String(ev30.filter(e => e.status === "rejected").length) },
        { label: "Approval Rate", value: rateOf(ev30) != null ? `${rateOf(ev30)}%` : "—", d: deltaLabel(rateOf(ev30), rateOf(evPrev)) },
        { label: "Pending Now", value: String(pending.length), alert: pending.length > 10 },
      ]} />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card title="Submission Trend" sub="8 weeks — submitted vs verified">
          <div className="flex items-end gap-1.5 h-24">
            {weeks.map(w => (
              <div key={w.label} className="flex-1 flex flex-col items-center gap-1" title={`${w.label}: ${w.sub} submitted, ${w.ver} verified`}>
                <div className="w-full flex items-end justify-center gap-0.5" style={{ height: "70px" }}>
                  <div className="w-2.5 bg-indigo-400 rounded-t" style={{ height: `${Math.round(w.sub / weekMax * 68)}px` }} />
                  <div className="w-2.5 bg-green-400 rounded-t" style={{ height: `${Math.round(w.ver / weekMax * 68)}px` }} />
                </div>
                <span className="text-[8px] text-gray-400">{w.label}</span>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-400 mt-2"><span className="text-indigo-500">■</span> submitted · <span className="text-green-500">■</span> verified</p>
        </Card>
        <Card title="Evidence by Type" sub="file register mime types">
          {types.length ? (
            <div className="space-y-2">
              {types.map(([t, n]) => (
                <div key={t}>
                  <div className="flex items-center justify-between text-[11px] mb-0.5">
                    <span className="text-gray-600">{t}</span>
                    <span className="font-bold text-gray-900">{n} <span className="font-normal text-gray-300">({Math.round(n / typeTotal * 100)}%)</span></span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-teal-400 rounded-full" style={{ width: `${Math.round(n / typeTotal * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">No evidence files uploaded yet.</p>}
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Approval Rate by Department">
          {deptRows.length ? deptRows.map(r => (
            <div key={r.dep} className="flex items-center gap-2 text-[11px] py-1">
              <span className="text-gray-600 flex-1">{r.dep}</span>
              <span className="text-gray-300">{r.n} decided</span>
              <PctChip v={r.pct} />
            </div>
          )) : <p className="text-xs text-gray-400">No decided evidence yet.</p>}
        </Card>
        <Card title="Backlog by Age" sub="pending entries">
          <div className="space-y-2">
            {ageBuckets.map(b => (
              <div key={b.label}>
                <div className="flex items-center justify-between text-[11px] mb-0.5">
                  <span className="text-gray-600">{b.label}</span><span className="font-bold text-gray-900">{b.n}</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${b.label === "15+ days" ? "bg-red-400" : "bg-amber-400"}`} style={{ width: `${Math.round(b.n / ageMax * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <Link href="/assessor/logbook" className="mt-2 inline-block text-[11px] font-semibold text-indigo-600 hover:underline">Open Evidence Validation Centre →</Link>
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Rejection reasons are free-text verifier comments (readable per entry in the Evidence Centre) — a categorised reason taxonomy isn&apos;t tracked, so no reason chart is shown.
      </p>
    </div>
  );
}
