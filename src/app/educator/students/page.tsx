import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics, riskBuckets } from "@/lib/analytics";
import { StatTiles, PctChip } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";

// Learner Directory — searchable learner table with live competency progress,
// risk level and recent activity, linking into the 360° profile.

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ q?: string; dept?: string }>;

export default async function LearnerDirectoryPage({ searchParams }: { searchParams: SearchParams }) {
  const { admin, hospitalId } = await requireEducatorAccess();
  const { q, dept } = await searchParams;
  const ctx = await loadAnalytics(admin, hospitalId);
  const risk = riskBuckets(ctx.latest, ctx.nurses.length);

  const { data: avatars } = ctx.nurses.length
    ? await admin.from("profiles").select("id, avatar_url").in("id", ctx.nurses.map(n => n.id))
    : { data: [] };
  const avatarOf = new Map((avatars ?? []).map(a => [a.id, a.avatar_url]));

  const lastAct = new Map<string, string>();
  for (const a of ctx.assess) if (!lastAct.has(a.nurse_id)) lastAct.set(a.nurse_id, a.assessed_at);
  for (const e of ctx.entries) {
    const cur = lastAct.get(e.nurse_id);
    if (!cur || e.created_at > cur) lastAct.set(e.nurse_id, e.created_at);
  }

  const byNurse = new Map<string, { pass: number; total: number }>();
  for (const d of ctx.latest) {
    const v = byNurse.get(d.nurse_id) ?? { pass: 0, total: 0 };
    v.total++;
    if (d.passing && !d.expired) v.pass++;
    byNurse.set(d.nurse_id, v);
  }

  const departments = [...new Set(ctx.nurses.map(n => n.dept))].sort();
  const rows = ctx.nurses
    .filter(n => !q?.trim() || n.name.toLowerCase().includes(q.trim().toLowerCase()))
    .filter(n => !dept || n.dept === dept)
    .map(n => {
      const p = byNurse.get(n.id);
      return {
        ...n,
        avatar: avatarOf.get(n.id) ?? null,
        pct: p?.total ? Math.round(p.pass / p.total * 100) : null,
        decided: p?.total ?? 0,
        risk: risk.byNurse.get(n.id) ?? null,
        last: lastAct.get(n.id) ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const RISK_CLS = { high: "bg-red-100 text-red-700", medium: "bg-amber-100 text-amber-700" };

  return (
    <div className="max-w-5xl">
      <EduHeader icon="👩‍⚕️" title="Learner Directory" sub="All learners with live competency progress, risk level and activity — click through to the 360° profile." />
      <StatTiles tiles={[
        { label: "Learners", value: String(ctx.nurses.length) },
        { label: "With Decisions", value: String([...byNurse.keys()].length) },
        { label: "At Risk", value: String(risk.high + risk.medium), alert: risk.high > 0 },
        { label: "Departments", value: String(departments.length) },
      ]} />

      <form action="/educator/students" className="flex items-center gap-2 mb-4 flex-wrap">
        <input name="q" defaultValue={q ?? ""} placeholder="Search learners…"
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 w-64 focus:outline-none focus:border-purple-400" />
        <select name="dept" defaultValue={dept ?? ""}
          className="text-sm border border-gray-200 rounded-lg px-2 py-2 bg-white text-gray-600 focus:outline-none focus:border-purple-400">
          <option value="">All departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <button type="submit" className="text-sm font-semibold text-white bg-purple-600 rounded-lg px-4 py-2 hover:bg-purple-700">Filter</button>
      </form>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                <th className="px-5 py-3">Learner</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3 text-center">Progress</th>
                <th className="px-4 py-3 text-center">Decided</th>
                <th className="px-4 py-3 text-center">Risk</th>
                <th className="px-4 py-3">Last Activity</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/40">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2.5">
                      {r.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element -- avatar from storage
                        <img src={r.avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
                      ) : (
                        <span className="w-7 h-7 rounded-full bg-purple-500 text-white text-[11px] font-bold flex items-center justify-center">{r.name[0]}</span>
                      )}
                      <span className="font-medium text-gray-900">{r.name}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{r.dept}</td>
                  <td className="px-4 py-3 text-center"><PctChip v={r.pct} /></td>
                  <td className="px-4 py-3 text-center text-xs text-gray-600">{r.decided}</td>
                  <td className="px-4 py-3 text-center">
                    {r.risk
                      ? <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${RISK_CLS[r.risk]}`}>{r.risk}</span>
                      : <span className="text-[9px] text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400" suppressHydrationWarning>
                    {r.last ? new Date(r.last).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/educator/profiles?n=${r.id}`} className="text-xs font-semibold text-purple-600 hover:underline">Profile →</Link>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="px-5 py-8 text-center text-xs text-gray-400">No learners match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Progress = passing share of each learner&apos;s latest decisions. Learner accounts are created by administrators — no add-learner action here.
      </p>
    </div>
  );
}
