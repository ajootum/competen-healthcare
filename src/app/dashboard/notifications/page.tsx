import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import NotificationsWorkspace, { type Notif } from "@/components/notifications/NotificationsWorkspace";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

// Nurse Notifications Workspace (spec §2/§5): notification feed with category
// tabs plus a live rail — today's overview, upcoming deadlines (real expiries),
// upcoming learning (real pathway items), CPD progress and the AI assistant
// handoff. Everything computed from real records.

export default async function NotificationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const in60 = new Date(); in60.setDate(in60.getDate() + 60);
  const in7 = new Date(); in7.setDate(in7.getDate() + 7);
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;

  const [
    { data: rows }, { data: expDecisions }, { data: expCredentials },
    { data: pathways }, { data: cpdLogs }, { data: decisions }, { data: me },
  ] = await Promise.all([
    admin.from("notifications").select("id, type, title, body, href, read, created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
    admin.from("competency_decisions")
      .select("id, expiry_date, framework_competencies(name)")
      .eq("nurse_id", user.id).not("expiry_date", "is", null)
      .lte("expiry_date", in60.toISOString().slice(0, 10)).order("expiry_date").limit(6),
    admin.from("professional_credentials")
      .select("id, title, expiry_date")
      .eq("nurse_id", user.id).not("expiry_date", "is", null)
      .lte("expiry_date", in60.toISOString().slice(0, 10)).order("expiry_date").limit(6),
    admin.from("learning_pathways").select("id, pathway_items(competency_name, reason, resource_title, resource_type, status)")
      .eq("nurse_id", user.id).limit(1),
    admin.from("cpd_logs").select("hours, activity_date").eq("user_id", user.id).gte("activity_date", yearStart),
    admin.from("competency_decisions").select("id, outcome, validation_outcome").eq("nurse_id", user.id),
    admin.from("profiles").select("hospital_id").eq("id", user.id).single(),
  ]);

  const notifications = (rows ?? []) as Notif[];

  // Deadlines (real expiries)
  const deadlines = [
    ...(expDecisions ?? []).map(d => ({
      key: `d-${d.id}`, kind: "Competency",
      label: (d.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency",
      date: d.expiry_date as string, href: "/dashboard/passport",
    })),
    ...(expCredentials ?? []).map(c => ({
      key: `c-${c.id}`, kind: "Credential", label: c.title as string,
      date: c.expiry_date as string, href: "/dashboard/certificates",
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const dueSoon = deadlines.filter(d => d.date >= today && d.date <= in7.toISOString().slice(0, 10)).length;

  // Upcoming learning (real pathway items)
  const planItems = ((pathways?.[0]?.pathway_items ?? []) as { competency_name: string | null; reason: string | null; resource_title: string | null; resource_type: string | null; status: string | null }[])
    .filter(p => p.status !== "completed").slice(0, 3);

  // CPD progress vs org target
  const cpdHours = Math.round(((cpdLogs ?? []).reduce((s, l) => s + Number(l.hours || 0), 0)) * 10) / 10;
  let cpdTarget: number | null = null;
  if (me?.hospital_id) {
    const { data: hosp } = await admin.from("hospitals").select("cpd_target_hours").eq("id", me.hospital_id).single();
    cpdTarget = hosp?.cpd_target_hours != null ? Number(hosp.cpd_target_hours) : null;
  }

  const achievements = (decisions ?? []).filter(d =>
    d.validation_outcome === "validated" && OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing).length;

  const actionRequired = notifications.filter(n =>
    !n.read && ["logbook_changes_requested", "logbook_rejected", "assessment_scheduled"].includes(n.type)).length;
  const feedbackCount = notifications.filter(n =>
    ["logbook_verified", "logbook_rejected", "logbook_changes_requested"].includes(n.type)).length;

  const OVERVIEW = [
    { icon: "❗", n: actionRequired, label: "Action Required", tint: "bg-red-50 text-red-600" },
    { icon: "⏰", n: dueSoon, label: "Due Soon", tint: "bg-amber-50 text-amber-600" },
    { icon: "🏆", n: achievements, label: "Achievements", tint: "bg-green-50 text-green-600" },
    { icon: "💬", n: feedbackCount, label: "Feedback", tint: "bg-blue-50 text-blue-600" },
  ];

  const aiTips: string[] = [];
  if (actionRequired > 0) aiTips.push(`${actionRequired} notification${actionRequired === 1 ? "" : "s"} need${actionRequired === 1 ? "s" : ""} your action.`);
  if (dueSoon > 0) aiTips.push(`${dueSoon} expiry${dueSoon === 1 ? "" : "ies"} within 7 days — plan renewals.`);
  if (planItems.length > 0) aiTips.push(`${planItems.length} learning item${planItems.length === 1 ? "" : "s"} pending on your pathway.`);
  if (cpdTarget !== null) aiTips.push(cpdHours >= cpdTarget
    ? `CPD target reached — ${cpdHours}h of ${cpdTarget}h logged this year. 🎉`
    : `You have ${cpdHours}h CPD this year — ${Math.max(0, cpdTarget - cpdHours)}h more to reach the ${cpdTarget}h target.`);
  const coachPrompt = `I'm a nurse reviewing my notifications. Live picture: ${actionRequired} actions required, ${dueSoon} competency/credential expiries within 7 days, ${planItems.length} pending learning-pathway items${cpdTarget !== null ? `, ${cpdHours}h of ${cpdTarget}h annual CPD` : `, ${cpdHours}h CPD logged this year`}, ${achievements} validated competencies. Help me prioritise this week and suggest what to learn first.`;

  return (
    <div className="max-w-6xl">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_290px] gap-6 items-start">
        <NotificationsWorkspace items={notifications} variant="nurse" />

        {/* Right rail */}
        <div className="flex flex-col gap-4 xl:pt-1">
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-gray-800 mb-3">Today&apos;s Overview</h2>
            <div className="grid grid-cols-2 gap-2">
              {OVERVIEW.map(o => (
                <div key={o.label} className={`rounded-xl p-3 ${o.tint.split(" ")[0]}`}>
                  <p className={`text-lg font-extrabold leading-none ${o.tint.split(" ")[1]}`}>{o.icon} {o.n}</p>
                  <p className="text-[10px] font-semibold text-gray-600 mt-1 leading-tight">{o.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-xs font-bold text-gray-800">⏳ Upcoming Deadlines</h2>
              <Link href="/dashboard/passport" className="text-[10px] font-semibold text-teal-600 hover:underline">View all</Link>
            </div>
            {deadlines.length === 0 ? (
              <p className="text-[10px] text-gray-400">Nothing expiring within 60 days.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {deadlines.slice(0, 4).map(d => {
                  const overdue = d.date < today;
                  return (
                    <Link key={d.key} href={d.href} className="flex items-center gap-2 group">
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${overdue ? "bg-red-100 text-red-700" : "bg-amber-50 text-amber-700"}`}>{d.kind}</span>
                      <span className="text-[11px] text-gray-700 group-hover:text-teal-700 truncate flex-1">{d.label}</span>
                      <span className={`text-[9px] shrink-0 ${overdue ? "text-red-600 font-bold" : "text-gray-400"}`} suppressHydrationWarning>
                        {overdue ? "expired" : new Date(d.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-xs font-bold text-gray-800">📚 Upcoming Learning</h2>
              <Link href="/dashboard/learning" className="text-[10px] font-semibold text-teal-600 hover:underline">View all</Link>
            </div>
            {planItems.length === 0 ? (
              <p className="text-[10px] text-gray-400">No pending items on your learning pathway.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {planItems.map((p, i) => (
                  <Link key={i} href="/dashboard/learning" className="group">
                    <p className="text-[11px] text-gray-700 group-hover:text-teal-700 leading-snug truncate">
                      {p.resource_title ?? p.competency_name ?? "Learning item"}
                    </p>
                    <p className="text-[9px] text-gray-400 leading-snug truncate">{p.reason ?? p.resource_type ?? ""}</p>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="bg-teal-50 border border-teal-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-teal-900 mb-2">✨ AI Learning Assistant</h2>
            {aiTips.length > 0 ? (
              <div className="flex flex-col gap-1.5 mb-2.5">
                {aiTips.map(t => (
                  <p key={t} className="text-[10px] text-teal-900/80 leading-snug">✓ {t}</p>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-teal-900/60 mb-2.5">All clear — nothing urgent on your plate.</p>
            )}
            <Link href={`/dashboard/copilot?scenario=${encodeURIComponent(coachPrompt)}`}
              className="block text-center text-xs font-semibold text-teal-700 border border-teal-200 bg-white hover:bg-teal-100 py-2 rounded-lg transition-colors">
              View my recommendations →
            </Link>
            <p className="text-[8px] text-teal-900/40 mt-1.5">Summary lines are rule-derived from your live records.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
