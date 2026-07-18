import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { StatTiles, Card, PctChip } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";

// My Reviews — the educator's personal review workspace: validations decided,
// evidence verdicts given, turnaround and recent activity. All from real
// records; saved drafts have no store and are stated as such.

export const dynamic = "force-dynamic";

export default async function MyReviewsPage() {
  const { admin, userId } = await requireEducatorAccess();

  const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;

  const [{ data: myScores }, { data: myEntries }, { data: recentAudit }] = await Promise.all([
    admin.from("competency_scores")
      .select("id, score, is_passing, educator_validated, educator_notes, assessed_at, validated_at, profiles!nurse_id(full_name), framework_competencies!competency_id(name)")
      .eq("educator_id", userId).order("validated_at", { ascending: false, nullsFirst: false }).limit(200),
    admin.from("skill_log_entries")
      .select("id, skill_name, status, created_at, verified_at, verifier_comment, profiles!nurse_id(full_name)")
      .eq("verified_by", userId).order("verified_at", { ascending: false }).limit(200),
    admin.from("audit_log")
      .select("action, entity_name, created_at")
      .eq("actor_id", userId)
      .in("action", ["verify_skill_entry", "reject_skill_entry", "request_skill_entry_changes", "finalize_decisions", "review_appeal", "conduct_audit"])
      .order("created_at", { ascending: false }).limit(8),
  ]);

  const validated = (myScores ?? []).filter(s => s.educator_validated);
  const returned = (myScores ?? []).filter(s => !s.educator_validated && s.educator_notes);
  const decided = validated.length + returned.length;
  const monthCount = validated.filter(s => (s.validated_at ?? "") >= monthStart).length
    + (myEntries ?? []).filter(e => (e.verified_at ?? "") >= monthStart).length;

  const turns = validated
    .filter(s => s.validated_at && s.assessed_at)
    .map(s => (new Date(s.validated_at!).getTime() - new Date(s.assessed_at).getTime()) / 36e5)
    .filter(h => h >= 0);
  const avgTurnH = turns.length ? Math.round(turns.reduce((a, b) => a + b, 0) / turns.length) : null;

  const ACT: Record<string, string> = {
    verify_skill_entry: "verified evidence", reject_skill_entry: "rejected evidence",
    request_skill_entry_changes: "returned evidence for changes", finalize_decisions: "ran a decision process",
    review_appeal: "reviewed an appeal", conduct_audit: "conducted an audit",
  };

  return (
    <div className="max-w-4xl">
      <EduHeader icon="🗳️" title="My Reviews" sub="Your personal review activity — validations, evidence verdicts, turnaround and recent actions." />
      <StatTiles tiles={[
        { label: "Score Validations", value: String(validated.length), sub: `${returned.length} returned` },
        { label: "Evidence Verdicts", value: String((myEntries ?? []).length), sub: "logbook entries decided" },
        { label: "This Month", value: String(monthCount), sub: "all review actions" },
        { label: "Avg Turnaround", value: avgTurnH != null ? `${avgTurnH}h` : "—", sub: "score → validation", alert: avgTurnH != null && avgTurnH > 72 },
      ]} />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card title="Recent Score Validations" sub="latest decisions you made">
          {(myScores ?? []).length ? (myScores ?? []).slice(0, 8).map(s => (
            <div key={s.id} className="flex items-center gap-2 text-[11px] py-1">
              <span className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center shrink-0 ${s.is_passing ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>{s.score ?? "—"}</span>
              <span className="text-gray-800 font-medium truncate">{(s.profiles as unknown as { full_name: string } | null)?.full_name ?? "—"}</span>
              <span className="text-gray-400 truncate flex-1">{(s.framework_competencies as unknown as { name: string } | null)?.name ?? "—"}</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${s.educator_validated ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"}`}>
                {s.educator_validated ? "validated" : "returned"}
              </span>
            </div>
          )) : <p className="text-xs text-gray-400">No validations yet — start in <Link href="/educator/validations" className="text-purple-600 hover:underline">Pending Validation</Link>.</p>}
        </Card>
        <Card title="Recent Evidence Verdicts" sub="logbook entries you decided">
          {(myEntries ?? []).length ? (myEntries ?? []).slice(0, 8).map(e => (
            <div key={e.id} className="flex items-center gap-2 text-[11px] py-1">
              <span className="text-gray-800 font-medium truncate">{(e.profiles as unknown as { full_name: string } | null)?.full_name ?? "—"}</span>
              <span className="text-gray-400 truncate flex-1">{e.skill_name}</span>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${
                e.status === "verified" ? "bg-green-50 text-green-600" : e.status === "rejected" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"}`}>
                {e.status.replace("_", " ")}
              </span>
            </div>
          )) : <p className="text-xs text-gray-400">No evidence verdicts yet — review in <Link href="/educator/evidence" className="text-purple-600 hover:underline">Evidence Review</Link>.</p>}
        </Card>
      </div>

      <Card title="Recent Activity" sub="from the audit trail">
        {(recentAudit ?? []).length ? (
          <ul className="space-y-1.5">
            {(recentAudit ?? []).map((a, i) => (
              <li key={i} className="text-[11px] text-gray-600">
                You {ACT[a.action] ?? a.action.replace(/_/g, " ")}{a.entity_name ? <span className="text-gray-400"> · {a.entity_name}</span> : null}
                <span className="text-gray-300 ml-1" suppressHydrationWarning>{new Date(a.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-gray-400">No review activity recorded yet.</p>}
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        Approval rate across your decided scores: <PctChip v={decided ? Math.round(validated.length / decided * 100) : null} />.
        Saved review drafts have no backing store — decisions are single-step by design.
      </p>
    </div>
  );
}
