import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";

// Escalations — critical cases raised to senior review: live escalated
// evidence with SLA ageing, who escalated and why, plus recently resolved
// escalations. Senior assessors decide (in Evidence Review); educators manage
// who holds senior status.

export const dynamic = "force-dynamic";

export default async function EscalationsPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const now = new Date().getTime();

  const [{ data: escalated }, { data: resolved }, { data: seniors }] = await Promise.all([
    admin.from("skill_log_entries")
      .select("id, skill_name, status, created_at, escalated_at, escalated_by_name, escalation_reason, profiles!nurse_id(full_name, hospital_id)")
      .eq("status", "escalated").order("escalated_at", { ascending: true }).limit(50),
    admin.from("skill_log_entries")
      .select("id, skill_name, status, escalated_by_name, verified_by_name, verified_at, profiles!nurse_id(full_name, hospital_id)")
      .not("escalated_at", "is", null).neq("status", "escalated")
      .order("verified_at", { ascending: false }).limit(8),
    hospitalId
      ? admin.from("profiles").select("id, full_name").eq("hospital_id", hospitalId).eq("is_senior_assessor", true).limit(20)
      : Promise.resolve({ data: [] }),
  ]);

  const inHospital = <T extends { profiles: unknown }>(rows: T[] | null) =>
    (rows ?? []).filter(r => !hospitalId || (r.profiles as { hospital_id: string | null } | null)?.hospital_id === hospitalId);
  const live = inHospital(escalated);
  const done = inHospital(resolved);

  const ageH = (iso: string | null) => iso ? Math.round((now - new Date(iso).getTime()) / 36e5) : null;
  const overSla = live.filter(e => (ageH(e.escalated_at) ?? 0) > 48).length;

  return (
    <div className="max-w-4xl">
      <EduHeader icon="⬆️" title="Escalations" sub="Escalated items requiring senior attention — SLA ageing, ownership and resolution tracking." />
      <StatTiles tiles={[
        { label: "Open Escalations", value: String(live.length), alert: live.length > 0 },
        { label: "Over 48h SLA", value: String(overSla), sub: "aging beyond target", alert: overSla > 0 },
        { label: "Senior Assessors", value: String((seniors ?? []).length), sub: "can decide escalations" },
        { label: "Recently Resolved", value: String(done.length) },
      ]} />

      <Card title="Open Escalations" sub="oldest first — decided by senior assessors in Evidence Review">
        {live.length ? (
          <div className="space-y-2">
            {live.map(e => {
              const h = ageH(e.escalated_at);
              return (
                <div key={e.id} className="border border-gray-100 rounded-lg px-3 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-gray-800">{(e.profiles as unknown as { full_name: string } | null)?.full_name ?? "—"}</span>
                    <span className="text-[11px] text-gray-500 flex-1 truncate">{e.skill_name}</span>
                    {h != null && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${h > 48 ? "bg-red-100 text-red-700" : h > 24 ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                        {h}h open
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    Escalated by {e.escalated_by_name ?? "—"}{e.escalation_reason ? ` — “${e.escalation_reason}”` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        ) : <p className="text-xs text-gray-400">No open escalations. ✅</p>}
        <div className="flex items-center gap-3 mt-3">
          <Link href="/educator/evidence" className="text-[11px] font-semibold text-purple-600 hover:underline">Open Evidence Review →</Link>
          <Link href="/educator/seniors" className="text-[11px] font-semibold text-purple-600 hover:underline">Manage senior assessors →</Link>
        </div>
      </Card>

      <div className="mt-4">
        <Card title="Recently Resolved" sub="escalations decided by seniors">
          {done.length ? (
            <div className="space-y-1">
              {done.map(e => (
                <div key={e.id} className="flex items-center gap-2 text-[11px] py-1">
                  <span className="text-gray-800 font-medium truncate">{(e.profiles as unknown as { full_name: string } | null)?.full_name ?? "—"}</span>
                  <span className="text-gray-400 truncate flex-1">{e.skill_name}</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${e.status === "verified" ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}>{e.status.replace("_", " ")}</span>
                  <span className="text-gray-300 shrink-0">{e.verified_by_name ?? "—"}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">Nothing resolved yet.</p>}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        SLA target (48h) is a display threshold, not an enforced policy — configurable SLAs and in-thread messaging would need their own store.
        Escalation decisions are gated server-side to senior assessors and admins.
      </p>
    </div>
  );
}
