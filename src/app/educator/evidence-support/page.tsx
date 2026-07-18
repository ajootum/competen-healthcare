import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics } from "@/lib/analytics";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";

// Evidence Support — where learners need help with evidence: rejected and
// returned items to follow up, pending backlog by learner, and learners with
// no recent evidence at all. Links into Evidence Review and the profile.

export const dynamic = "force-dynamic";

export default async function EvidenceSupportPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const ctx = await loadAnalytics(admin, hospitalId);
  const nameOf = new Map(ctx.nurses.map(n => [n.id, n.name]));

  const rejected = ctx.entries.filter(e => e.status === "rejected");
  const returned = ctx.entries.filter(e => e.status === "changes_requested");
  const pending = ctx.entries.filter(e => e.status === "pending");

  const { data: rejectedDetail } = hospitalId
    ? await admin.from("skill_log_entries")
        .select("nurse_id, skill_name, status, verifier_comment, verified_at, profiles!nurse_id(hospital_id)")
        .in("status", ["rejected", "changes_requested"])
        .order("verified_at", { ascending: false }).limit(30)
    : { data: [] };
  const followUps = (rejectedDetail ?? [])
    .filter(e => !hospitalId || (e.profiles as unknown as { hospital_id: string | null } | null)?.hospital_id === hospitalId)
    .slice(0, 10);

  const pendingByNurse = new Map<string, number>();
  for (const e of pending) pendingByNurse.set(e.nurse_id, (pendingByNurse.get(e.nurse_id) ?? 0) + 1);
  const backlog = [...pendingByNurse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const active = new Set(ctx.entries.map(e => e.nurse_id));
  const silent = ctx.nurses.filter(n => !active.has(n.id)).slice(0, 8);

  return (
    <div className="max-w-4xl">
      <EduHeader icon="🖇️" title="Evidence Support" sub="Where learners need evidence help — rejections to follow up, backlogs, and learners with no recent submissions." />
      <StatTiles tiles={[
        { label: "Rejected", value: String(rejected.length), sub: "needs learner follow-up", alert: rejected.length > 0 },
        { label: "Returned for Changes", value: String(returned.length) },
        { label: "Pending Review", value: String(pending.length) },
        { label: "No Recent Evidence", value: String(ctx.nurses.length - active.size), sub: "learners, last ~1500 entries" },
      ]} />

      <Card title="Follow-Ups Needed" sub="rejected or returned — the verifier's reason is the coaching point">
        {followUps.length ? (
          <div className="space-y-1.5">
            {followUps.map((e, i) => (
              <div key={i} className="border border-gray-100 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/educator/profiles?n=${e.nurse_id}`} className="text-xs font-semibold text-gray-800 hover:text-purple-700">{nameOf.get(e.nurse_id) ?? "—"}</Link>
                  <span className="text-[11px] text-gray-500 flex-1 truncate">{e.skill_name}</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${e.status === "rejected" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{e.status.replace("_", " ")}</span>
                </div>
                {e.verifier_comment && <p className="text-[10px] text-gray-500 italic mt-0.5">“{e.verifier_comment}”</p>}
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">Nothing awaiting follow-up. ✅</p>}
      </Card>

      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <Card title="Pending Backlog by Learner">
          {backlog.length ? backlog.map(([id, n]) => (
            <div key={id} className="flex items-center gap-2 text-[11px] py-1">
              <span className="text-gray-700 flex-1">{nameOf.get(id) ?? "—"}</span>
              <span className="text-[10px] font-bold bg-blue-100 text-blue-700 rounded-full px-1.5 py-0.5">{n}</span>
            </div>
          )) : <p className="text-xs text-gray-400">No pending evidence.</p>}
          <Link href="/educator/evidence" className="mt-2 inline-block text-[11px] font-semibold text-purple-600 hover:underline">Open Evidence Review →</Link>
        </Card>
        <Card title="No Recent Evidence" sub="learners who may need a nudge">
          {silent.length ? silent.map(nu => (
            <div key={nu.id} className="flex items-center gap-2 text-[11px] py-1">
              <span className="text-gray-700 flex-1">{nu.name}</span>
              <span className="text-gray-400">{nu.dept}</span>
              <Link href={`/educator/profiles?n=${nu.id}`} className="text-[10px] font-semibold text-purple-600 hover:underline">Profile →</Link>
            </div>
          )) : <p className="text-xs text-gray-400">Every learner has recent evidence. ✅</p>}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        &quot;Missing evidence&quot; against per-competency requirements needs an evidence-requirements matrix on each competency — until that content exists,
        this view tracks the real submission pipeline.
      </p>
    </div>
  );
}
