import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";
import AccountSettings from "./AccountSettings";

// Account & Subscription (Nurse Workspace Account & Subscription spec v1.0).
// Enterprise-first: members of an organisation see their Organisation Licence
// (never pricing cards); self-registered users see the membership summary and
// the licence catalogue. Usage analytics are computed live from real activity.
// Honest gaps (not faked): payment processing, saved cards, invoices, billing
// history, auto-renew and renewal dates have no backing store yet — noted in
// the page instead of simulated.

const PLAN_FEATURES = [
  { icon: "🎓", name: "CPD Academy",          sub: "All CPD courses" },
  { icon: "🧪", name: "Simulation Lab",       sub: "AI-run scenarios" },
  { icon: "✨", name: "AI Clinical Copilot",  sub: "Smart clinical support" },
  { icon: "📝", name: "Assessments",          sub: "Knowledge & workplace" },
  { icon: "📚", name: "Clinical Library",     sub: "Evidence-based content" },
  { icon: "🏆", name: "CPD Certificates",     sub: "Download & share" },
  { icon: "🛂", name: "Competency Passport",  sub: "Track & validate skills" },
  { icon: "📖", name: "Skills Logbook",       sub: "Verified practice record" },
];

const WHY_ITEMS = [
  { icon: "🩺", text: "Maintain your clinical competence" },
  { icon: "✅", text: "Stay compliant with CPD requirements" },
  { icon: "📈", text: "Advance your career" },
  { icon: "❤️", text: "Improve patient outcomes" },
  { icon: "🌍", text: "Be part of a global healthcare community" },
];

// §5 licence catalogue — shown only to self-paying users (no organisation).
const CATALOGUE = [
  { name: "Community",    price: "Free",   sub: "Core learning tools",              features: ["3 CPD courses", "Basic question bank", "Progress tracking"] },
  { name: "Professional", price: "$4/mo",  sub: "For individual clinicians",        features: ["All CPD courses", "AI Clinical Copilot", "Simulation Lab", "CPD certificates"] },
  { name: "Enterprise",   price: "Custom", sub: "For hospitals & institutions",     features: ["Everything in Professional", "Workforce dashboard", "Compliance reports", "Bulk onboarding"] },
  { name: "Education",    price: "Custom", sub: "For schools & training bodies",    features: ["Cohort management", "Curriculum mapping", "Student analytics"] },
];

const SUPPORT_EMAIL = "gabriel@semacast.com";

export default async function AccountSubscriptionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles")
    .select("id, full_name, email, role, created_at, hospital_id, organisation_id, phone, country, specialization, avatar_url")
    .eq("id", user.id).single();

  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthISO = monthStart.toISOString();
  const monthKey = monthISO.slice(0, 7);

  const [
    { data: hospital }, { data: org }, { data: admins },
    { data: cpdLogs }, { data: decisions },
    { count: quizMonth }, { count: skillsMonth }, { data: assessRows },
  ] = await Promise.all([
    me?.hospital_id
      ? admin.from("hospitals").select("name, tier, type, city, country").eq("id", me.hospital_id).single()
      : Promise.resolve({ data: null }),
    me?.organisation_id
      ? admin.from("organisations").select("name, group_name, email").eq("id", me.organisation_id).single()
      : Promise.resolve({ data: null }),
    me?.hospital_id
      ? admin.from("profiles").select("full_name").eq("hospital_id", me.hospital_id).eq("role", "hospital_admin").limit(3)
      : Promise.resolve({ data: null }),
    admin.from("cpd_logs").select("hours, activity_date").eq("user_id", user.id),
    admin.from("competency_decisions").select("id, outcome, validation_outcome, created_at").eq("nurse_id", user.id),
    admin.from("quiz_attempts").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("attempted_at", monthISO),
    admin.from("skill_log_entries").select("id", { count: "exact", head: true }).eq("nurse_id", user.id).gte("performed_at", monthISO),
    admin.from("assessments").select("id, status, assessed_at, competency_cycles!inner(nurse_id)").eq("competency_cycles.nurse_id", user.id),
  ]);

  const isEnterprise = !!me?.hospital_id;

  // ── Usage this month (all live) ────────────────────────────────────────────
  const cpdHoursMonth = Math.round(
    (cpdLogs ?? []).filter(l => l.activity_date?.slice(0, 7) === monthKey)
      .reduce((s, l) => s + Number(l.hours || 0), 0) * 10,
  ) / 10;
  const assessDone = (assessRows ?? []).filter(a => a.assessed_at || ["completed", "validated"].includes(a.status));
  const assessMonth = assessDone.filter(a => a.assessed_at && a.assessed_at >= monthISO).length;
  const validated = (decisions ?? []).filter(d =>
    d.validation_outcome === "validated" && OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing);
  const compMonth = validated.filter(d => d.created_at >= monthISO).length;

  const USAGE: { label: string; value: string; sub: string; icon: string; tone: string }[] = [
    { label: "CPD Hours",             value: String(cpdHoursMonth), sub: "Hours",                      icon: "🕐", tone: "bg-teal-50 border-teal-100" },
    { label: "Assessments",           value: String(assessMonth),   sub: `Completed · ${assessDone.length} all time`, icon: "📝", tone: "bg-blue-50 border-blue-100" },
    { label: "Competencies Achieved", value: String(compMonth),     sub: `New · ${validated.length} all time`,        icon: "🎖️", tone: "bg-green-50 border-green-100" },
    { label: "Skills Logged",         value: String(skillsMonth ?? 0), sub: "Logbook entries",         icon: "📖", tone: "bg-amber-50 border-amber-100" },
    { label: "Knowledge Checks",      value: String(quizMonth ?? 0),   sub: "Questions answered",      icon: "❓", tone: "bg-violet-50 border-violet-100" },
    { label: "Certificates Earned",   value: String(compMonth),     sub: "This month",                 icon: "🏅", tone: "bg-rose-50 border-rose-100" },
  ];

  const memberSince = me?.created_at
    ? new Date(me.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "—";
  const adminNames = (admins ?? []).map(a => a.full_name).filter(Boolean);
  const contactEmail = org?.email || SUPPORT_EMAIL;

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Account &amp; Subscription</h1>
        <p className="text-gray-400 text-sm mt-0.5">Manage your account, subscription and billing details.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_260px] gap-5 items-start">
        <div className="min-w-0 flex flex-col gap-5">

          {/* Membership / licence hero */}
          {isEnterprise ? (
            <div className="bg-white border border-gray-100 rounded-2xl p-6">
              <div className="flex items-start gap-4">
                <span className="w-12 h-12 rounded-xl bg-teal-50 flex items-center justify-center text-2xl shrink-0">🏥</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold text-gray-900">Organisation Licence</h2>
                    <span className="text-[9px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded uppercase tracking-wider">Active</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Your access is provided by your organisation — no personal subscription or payment is needed.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-4 mt-5 pt-5 border-t border-gray-50">
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">Organisation</p>
                  <p className="text-sm font-semibold text-gray-900">{org?.name ?? "—"}</p>
                  {org?.group_name && <p className="text-[10px] text-gray-400">{org.group_name}</p>}
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">Facility</p>
                  <p className="text-sm font-semibold text-gray-900">{hospital?.name ?? "—"}</p>
                  {hospital && <p className="text-[10px] text-gray-400">{[hospital.city, hospital.country].filter(Boolean).join(", ")}</p>}
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">Licence Type</p>
                  <p className="text-sm font-semibold text-gray-900 capitalize">{hospital?.type ?? "Hospital"} licence</p>
                  <p className="text-[10px] text-gray-400 capitalize">{hospital?.tier ?? "—"} tier</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">Managed By</p>
                  <p className="text-sm font-semibold text-gray-900">{adminNames.length ? adminNames.join(", ") : "Organisation admin"}</p>
                  <p className="text-[10px] text-gray-400">Hospital administrator{adminNames.length === 1 ? "" : "s"}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">Member Since</p>
                  <p className="text-sm font-semibold text-gray-900" suppressHydrationWarning>{memberSince}</p>
                  <p className="text-[10px] text-gray-400">Renewal date not tracked yet</p>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-gray-50 flex flex-wrap items-center gap-3">
                <a href={`mailto:${contactEmail}?subject=Organisation licence — ${org?.name ?? hospital?.name ?? "Competen"}`}
                  className="text-xs font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 px-4 py-2 rounded-lg transition-colors">
                  Contact Administrator
                </a>
                <p className="text-[10px] text-gray-400">
                  Questions about your licence, seats or renewal go to your organisation — not to a payment page.
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-gray-100 rounded-2xl p-6">
              <div className="flex items-start gap-4">
                <span className="w-12 h-12 rounded-xl bg-teal-50 flex items-center justify-center text-2xl shrink-0">👑</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-bold text-gray-900">Community Membership</h2>
                    <span className="text-[9px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded uppercase tracking-wider">Active</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">You&apos;re on the free Community plan.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 mt-5 pt-5 border-t border-gray-50">
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">Current Plan</p>
                  <p className="text-sm font-semibold text-gray-900">Community</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">Status</p>
                  <p className="text-sm font-semibold text-green-600">Active</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 mb-0.5">Member Since</p>
                  <p className="text-sm font-semibold text-gray-900" suppressHydrationWarning>{memberSince}</p>
                </div>
              </div>
            </div>
          )}

          {/* Account management: profile, photo, password */}
          <AccountSettings profile={{
            full_name: me?.full_name ?? "",
            email: me?.email ?? user.email ?? "",
            phone: me?.phone ?? "",
            country: me?.country ?? "",
            specialization: me?.specialization ?? "",
            avatar_url: me?.avatar_url ?? null,
            role: me?.role ?? "nurse",
          }} />

          {/* Plan includes + usage */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-4">Your Plan Includes</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
                {PLAN_FEATURES.map(f => (
                  <div key={f.name} className="flex items-start gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-teal-50 flex items-center justify-center text-sm shrink-0">{f.icon}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-800">{f.name}</p>
                      <p className="text-[10px] text-gray-400">{f.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-bold text-gray-900">Your Usage This Month</h2>
                <span className="text-[10px] text-gray-400" suppressHydrationWarning>
                  {new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {USAGE.map(u => (
                  <div key={u.label} className={`border rounded-xl p-3 ${u.tone}`}>
                    <p className="text-[9px] font-bold text-gray-500 uppercase tracking-wide leading-tight">{u.label}</p>
                    <div className="flex items-end justify-between mt-1.5">
                      <p className="text-xl font-extrabold text-gray-900 leading-none">{u.value}</p>
                      <span className="text-base leading-none">{u.icon}</span>
                    </div>
                    <p className="text-[9px] text-gray-400 mt-1">{u.sub}</p>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-gray-300 mt-3 leading-snug">
                Simulation completions, AI Copilot sessions, storage and portfolio growth aren&apos;t tracked yet and are not shown.
              </p>
            </div>
          </div>

          {/* Pricing catalogue — self-paying users only (spec §3/§5) */}
          {!isEnterprise && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-1">Licence Catalogue</h2>
              <p className="text-[10px] text-gray-400 mb-4">
                Online payment isn&apos;t live yet — plans are activated manually via{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-teal-600 hover:underline">{SUPPORT_EMAIL}</a>.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {CATALOGUE.map(p => (
                  <div key={p.name} className={`border rounded-xl p-4 flex flex-col ${p.name === "Community" ? "border-teal-300 ring-1 ring-teal-100" : "border-gray-100"}`}>
                    <p className="text-xs font-bold text-gray-900">{p.name}</p>
                    <p className="text-lg font-extrabold text-gray-900 mt-1">{p.price}</p>
                    <p className="text-[10px] text-gray-400 mb-2">{p.sub}</p>
                    <ul className="flex flex-col gap-1 flex-1">
                      {p.features.map(f => (
                        <li key={f} className="text-[10px] text-gray-500 flex gap-1.5"><span className="text-teal-500">✓</span>{f}</li>
                      ))}
                    </ul>
                    {p.name === "Community" ? (
                      <span className="mt-3 text-center text-[10px] font-bold text-teal-700 bg-teal-50 py-1.5 rounded-lg">Current plan</span>
                    ) : (
                      <a href={`mailto:${SUPPORT_EMAIL}?subject=Upgrade to ${p.name}`}
                        className="mt-3 text-center text-[10px] font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 py-1.5 rounded-lg transition-colors">
                        Enquire →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Billing infrastructure note + support */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5">
              <p className="text-xs font-bold text-gray-700 mb-1">💳 Billing history, payment methods &amp; invoices</p>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                {isEnterprise
                  ? "Billing for your access is handled by your organisation, so no payment details are stored on your account."
                  : "These sections appear here once online payments launch. No payment details are stored yet."}
              </p>
            </div>
            <div className="bg-white border border-gray-100 rounded-2xl p-5 flex items-center gap-4">
              <span className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center text-lg shrink-0">🎧</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-800">Need help?</p>
                <p className="text-[11px] text-gray-400 truncate">Contact <a href={`mailto:${SUPPORT_EMAIL}`} className="text-teal-600 hover:underline">{SUPPORT_EMAIL}</a></p>
              </div>
              <a href={`mailto:${SUPPORT_EMAIL}?subject=Support request`}
                className="text-[11px] font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 px-3 py-1.5 rounded-lg transition-colors shrink-0">
                Get Support
              </a>
            </div>
          </div>
        </div>

        {/* Right rail — why membership matters */}
        <div className="flex flex-col gap-4">
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">🛡️</span>
              <h2 className="text-sm font-bold text-amber-900 leading-tight">Why your membership matters</h2>
            </div>
            <div className="flex flex-col gap-3">
              {WHY_ITEMS.map(w => (
                <div key={w.text} className="flex items-start gap-2.5">
                  <span className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-sm shrink-0">{w.icon}</span>
                  <p className="text-[11px] text-amber-900/80 leading-snug pt-1">{w.text}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-amber-800/60 mt-4">Thank you for investing in your professional growth! 💛</p>
          </div>

          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <p className="text-[10px] text-gray-400 leading-relaxed">
              🔒 No payment information is stored on Competen. When online billing launches, payments will be
              processed by a certified provider — we will never store your full card details.
            </p>
          </div>

          <Link href="/dashboard/career"
            className="bg-[#0a2e38] rounded-2xl p-5 block group">
            <p className="text-teal-300/70 text-[10px] font-bold uppercase tracking-widest mb-1">Keep growing</p>
            <p className="text-white text-sm font-semibold group-hover:text-teal-200 transition-colors">
              See how your usage feeds your Career Growth profile →
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
