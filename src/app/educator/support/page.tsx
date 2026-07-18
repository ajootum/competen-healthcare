import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics, riskBuckets, competencyProfile } from "@/lib/analytics";
import { StatTiles, Card } from "@/app/assessor/reports/ui";

// Learner Success Dashboard — the Learner Support home: live KPIs, at-risk
// list, today's sessions, pending actions, recent feedback and activity feed.
// Modules without stores (coaching, interventions, meetings, referrals) are
// soon-rows in the sidebar, not simulated numbers here.

export const dynamic = "force-dynamic";

export default async function LearnerSupportDashboardPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const ctx = await loadAnalytics(admin, hospitalId);
  const risk = riskBuckets(ctx.latest, ctx.nurses.length);
  const nurseIds = ctx.nurses.map(n => n.id);
  const nameOf = new Map(ctx.nurses.map(n => [n.id, n.name]));
  const deptOf = new Map(ctx.nurses.map(n => [n.id, n.dept]));

  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);

  const [{ count: pendingScores }, { data: todaySessions }, { data: recentFeedback }, { data: activity }, { data: openAppeals }, { count: pendingInterventions }, { count: coachingToday }] = await Promise.all([
    nurseIds.length
      ? admin.from("competency_scores").select("id", { count: "exact", head: true }).eq("educator_validated", false).in("nurse_id", nurseIds)
      : Promise.resolve({ count: 0 }),
    hospitalId
      ? admin.from("scheduled_assessments")
          .select("scheduled_for, method, location, nurse:profiles!nurse_id(full_name)")
          .eq("hospital_id", hospitalId).eq("status", "scheduled")
          .gte("scheduled_for", dayStart.toISOString()).lte("scheduled_for", dayEnd.toISOString())
          .order("scheduled_for").limit(5)
      : Promise.resolve({ data: [] }),
    nurseIds.length
      ? admin.from("skill_log_entries")
          .select("skill_name, status, verifier_comment, verified_by_name, verified_at, profiles!nurse_id(full_name)")
          .in("nurse_id", nurseIds).not("verifier_comment", "is", null)
          .order("verified_at", { ascending: false }).limit(4)
      : Promise.resolve({ data: [] }),
    admin.from("audit_log")
      .select("actor_name, action, entity_name, created_at")
      .in("action", ["verify_skill_entry", "educator_validate", "finalize_decisions", "conduct_assessment", "raise_appeal", "log_skill", "create_intervention", "schedule_support_session"])
      .order("created_at", { ascending: false }).limit(6),
    hospitalId ? admin.from("appeals").select("id").eq("hospital_id", hospitalId).in("status", ["open", "under_review"]) : Promise.resolve({ data: [] }),
    hospitalId ? admin.from("interventions").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).neq("status", "completed") : Promise.resolve({ count: 0 }),
    hospitalId
      ? admin.from("support_sessions").select("id", { count: "exact", head: true })
          .eq("hospital_id", hospitalId).eq("session_type", "coaching").eq("status", "scheduled")
          .gte("scheduled_for", dayStart.toISOString()).lte("scheduled_for", dayEnd.toISOString())
      : Promise.resolve({ count: 0 }),
  ]);

  const comps = competencyProfile(ctx.latest);
  const awaitingTeaching = comps.filter(c => c.total >= 2 && c.pct < 80).length;
  const avgProgress = ctx.latest.length
    ? Math.round(ctx.latest.filter(d => d.passing && !d.expired).length / ctx.latest.length * 100) : null;

  const atRisk = [...risk.byNurse.entries()]
    .sort((a, b) => (a[1] === "high" ? 0 : 1) - (b[1] === "high" ? 0 : 1)).slice(0, 5)
    .map(([id, level]) => {
      const mine = ctx.latest.filter(d => d.nurse_id === id);
      const pct = mine.length ? Math.round(mine.filter(d => d.passing && !d.expired).length / mine.length * 100) : null;
      return { id, level, name: nameOf.get(id) ?? "—", dept: deptOf.get(id) ?? "General", pct };
    });

  const pendingEvidence = ctx.entries.filter(e => e.status === "pending").length;
  const escalated = ctx.entries.filter(e => e.status === "escalated").length;

  const { data: dueReviews } = hospitalId
    ? await admin.from("interventions").select("id").eq("hospital_id", hospitalId).neq("status", "completed")
        .not("review_date", "is", null).lte("review_date", new Date().toISOString().slice(0, 10))
    : { data: [] };

  const ACT: Record<string, string> = {
    verify_skill_entry: "verified evidence", educator_validate: "validated a score",
    finalize_decisions: "ran a decision process", conduct_assessment: "conducted an assessment",
    raise_appeal: "raised an appeal", log_skill: "logged evidence",
    create_intervention: "created an intervention", schedule_support_session: "scheduled a session",
  };
  const PENDING = [
    { icon: "✅", label: "Assessments awaiting your validation", n: pendingScores ?? 0, href: "/educator/validations" },
    { icon: "🖇️", label: "Evidence items awaiting review", n: pendingEvidence, href: "/educator/evidence" },
    { icon: "🎯", label: "Interventions due for review", n: (dueReviews ?? []).length, href: "/educator/interventions" },
    { icon: "⬆️", label: "Escalated to senior review", n: escalated, href: "/educator/escalations" },
    { icon: "⚖️", label: "Appeals to moderate", n: (openAppeals ?? []).length, href: "/educator/moderation" },
  ].filter(p => p.n > 0);

  const RISK_CLS = { high: "bg-red-100 text-red-700", medium: "bg-amber-100 text-amber-700" };

  return (
    <div className="max-w-[1100px]">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gray-900">Learner Success Dashboard</h1>
        <p className="text-gray-400 text-sm mt-0.5">Learner Support home — monitoring, coaching signals and support actions, all from live records.</p>
      </div>

      <StatTiles cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-6" tiles={[
        { label: "Active Learners", value: String(ctx.nurses.length) },
        { label: "At-Risk Learners", value: String(risk.high + risk.medium), sub: `${risk.high} high`, alert: risk.high > 0 },
        { label: "Pending Interventions", value: String(pendingInterventions ?? 0), sub: "active remediation", alert: (pendingInterventions ?? 0) > 0 },
        { label: "Coaching Today", value: String(coachingToday ?? 0), sub: `${(todaySessions ?? []).length} assessments too` },
        { label: "Competencies Needing Teaching", value: String(awaitingTeaching), sub: "below 80% pass" },
        { label: "Average Progress", value: avgProgress != null ? `${avgProgress}%` : "—", sub: "current passing share" },
      ]} />

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Card title="At-Risk Learners" sub="from decision records">
          {atRisk.length ? (
            <div className="space-y-1.5">
              {atRisk.map(l => (
                <Link key={l.id} href={`/educator/profiles?n=${l.id}`} className="flex items-center gap-2 text-[11px] border border-gray-50 rounded-lg px-2.5 py-1.5 hover:border-purple-200">
                  <span className="text-gray-800 font-medium flex-1 truncate">{l.name}</span>
                  <span className="text-gray-400">{l.dept}</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${RISK_CLS[l.level]}`}>{l.level}</span>
                  {l.pct != null && <span className="font-bold text-gray-700">{l.pct}%</span>}
                </Link>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">No learners carry risk flags. ✅</p>}
          <Link href="/educator/at-risk" className="mt-2 inline-block text-[11px] font-semibold text-purple-600 hover:underline">View all at-risk learners →</Link>
        </Card>

        <Card title="Today's Schedule" sub="real assessment sessions">
          {(todaySessions ?? []).length ? (
            <div className="space-y-1.5">
              {(todaySessions ?? []).map((s, i) => (
                <div key={i} className="border border-gray-50 rounded-lg px-2.5 py-1.5">
                  <p className="text-[11px] font-semibold text-gray-800" suppressHydrationWarning>
                    {new Date(s.scheduled_for).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {(s.nurse as unknown as { full_name: string } | null)?.full_name ?? "—"}
                  </p>
                  <p className="text-[10px] text-gray-400">{s.method.replace(/_/g, " ")}{s.location ? ` · ${s.location}` : ""}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">No sessions scheduled today.</p>}
        </Card>

        <Card title="Pending Actions">
          {PENDING.length ? (
            <div className="space-y-1.5">
              {PENDING.map(p => (
                <Link key={p.label} href={p.href} className="flex items-center gap-2 text-[11px] text-gray-700 hover:text-purple-700">
                  <span>{p.icon}</span><span className="flex-1">{p.label}</span>
                  <span className="text-[10px] font-bold bg-red-100 text-red-700 rounded-full px-1.5 py-0.5">{p.n}</span>
                </Link>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">Nothing pending. ✅</p>}
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Recent Feedback" sub="verifier comments on learner evidence">
          {(recentFeedback ?? []).length ? (
            <div className="space-y-1.5">
              {(recentFeedback ?? []).map((f, i) => (
                <div key={i} className="border border-gray-50 rounded-lg px-2.5 py-1.5">
                  <p className="text-[11px] text-gray-800"><span className="font-semibold">{(f.profiles as unknown as { full_name: string } | null)?.full_name ?? "—"}</span> · {f.skill_name}</p>
                  <p className="text-[10px] text-gray-500 italic">“{f.verifier_comment}” — {f.verified_by_name ?? "verifier"}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">No feedback comments yet.</p>}
        </Card>
        <Card title="Learning Activity Feed" sub="from the audit trail">
          {(activity ?? []).length ? (
            <ul className="space-y-1.5">
              {(activity ?? []).map((a, i) => (
                <li key={i} className="text-[11px] text-gray-600">
                  <span className="font-medium text-gray-800">{a.actor_name ?? "—"}</span> {ACT[a.action] ?? a.action.replace(/_/g, " ")}
                  {a.entity_name ? <span className="text-gray-400"> · {a.entity_name}</span> : null}
                  <span className="text-gray-300 ml-1" suppressHydrationWarning>{new Date(a.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-gray-400">No recent activity.</p>}
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Quick actions live in each module. Coaching sessions, interventions, meetings and referrals need their own stores — marked soon in the sidebar rather than shown with invented numbers.
      </p>
    </div>
  );
}
