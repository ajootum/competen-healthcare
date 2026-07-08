import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OUTCOME_CONFIG, MATURITY_LABELS, type DecisionOutcome, type Maturity } from "@/lib/ckcm";

// My Career Growth — readiness for the next professional level, computed
// transparently from the nurse's governed record.

const LADDER = [
  { role: "Healthcare Worker", icon: "🩺" },
  { role: "Preceptor / Mentor", icon: "🧭" },
  { role: "Shift Supervisor", icon: "🕐" },
  { role: "Unit Manager", icon: "🏢" },
  { role: "Hospital Nurse Manager", icon: "🏥" },
];

export default async function CareerGrowthPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: profile }, { data: decisions }, { data: credentials }, { data: recognitions }] = await Promise.all([
    admin.from("profiles").select("full_name, role").eq("id", user.id).single(),
    admin.from("competency_decisions")
      .select("competency_id, outcome, maturity, expiry_date, validation_outcome, created_at")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
    admin.from("professional_credentials").select("verified, status, expiry_date").eq("nurse_id", user.id),
    admin.from("professional_recognitions").select("recognition_type").eq("nurse_id", user.id),
  ]);

  // Latest decision per competency
  const seen = new Set<string>();
  const latest: { outcome: DecisionOutcome; maturity: Maturity | null; expired: boolean; validated: boolean }[] = [];
  for (const d of decisions ?? []) {
    if (seen.has(d.competency_id)) continue;
    seen.add(d.competency_id);
    latest.push({
      outcome: d.outcome as DecisionOutcome,
      maturity: (d.maturity as Maturity) ?? null,
      expired: !!d.expiry_date && new Date(d.expiry_date).getTime() < Date.now(),
      validated: d.validation_outcome === "validated",
    });
  }

  const total = latest.length;
  const competent = latest.filter(l => OUTCOME_CONFIG[l.outcome]?.passing && !l.expired).length;
  const validated = latest.filter(l => l.validated).length;
  const advanced = latest.filter(l => l.maturity === "proficient" || l.maturity === "expert").length;
  const creds = credentials ?? [];
  const credsCurrent = creds.length > 0 && creds.every(c =>
    c.verified && c.status === "active" && (!c.expiry_date || new Date(c.expiry_date).getTime() > Date.now()));
  const isPreceptor = (recognitions ?? []).some(r => ["preceptor", "mentor"].includes(r.recognition_type));

  // Transparent readiness formula
  const parts = [
    { label: "Competency coverage", detail: `${competent}/${total || "—"} competencies current & competent`, weight: 40, value: total ? competent / total : 0 },
    { label: "Educator validation", detail: `${validated}/${total || "—"} decisions validated`, weight: 20, value: total ? validated / total : 0 },
    { label: "Advanced practice", detail: `${advanced} at Proficient/Expert maturity`, weight: 15, value: total ? Math.min(advanced / Math.max(total * 0.3, 1), 1) : 0 },
    { label: "Credentials current", detail: creds.length ? (credsCurrent ? "All verified & current" : "Verification or renewal needed") : "No credentials on record", weight: 15, value: credsCurrent ? 1 : 0 },
    { label: "Recognition & mentorship", detail: (recognitions ?? []).length ? `${(recognitions ?? []).length} recognition${(recognitions ?? []).length !== 1 ? "s" : ""}${isPreceptor ? " incl. preceptor/mentor" : ""}` : "None yet", weight: 10, value: isPreceptor ? 1 : (recognitions ?? []).length ? 0.6 : 0 },
  ];
  const readiness = Math.round(parts.reduce((s, p) => s + p.weight * p.value, 0));
  const nextRole = LADDER[1].role;

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">My Career Growth</h1>
        <p className="text-gray-400 text-sm mt-0.5">Readiness for your next professional level, computed from your governed record.</p>
      </div>

      {/* Readiness headline */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
        <div className="flex items-center gap-5">
          <div className={`w-24 h-24 rounded-full flex flex-col items-center justify-center text-white shrink-0 ${
            readiness >= 75 ? "bg-green-500" : readiness >= 45 ? "bg-teal-500" : "bg-amber-500"}`}>
            <span className="text-2xl font-bold">{readiness}%</span>
            <span className="text-[9px] uppercase tracking-wide opacity-90">ready</span>
          </div>
          <div>
            <p className="text-sm text-gray-500">Next step on your pathway</p>
            <p className="text-lg font-bold text-gray-900">{nextRole}</p>
            <p className="text-[11px] text-gray-400 mt-1">
              You are <b>{readiness}% ready</b> for the {nextRole} pathway. Close the items below to progress.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2.5">
          {parts.map(p => (
            <div key={p.label} className="flex items-center gap-3">
              <span className="text-xs text-gray-600 w-44 shrink-0">{p.label}</span>
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${p.value >= 1 ? "bg-green-500" : p.value > 0 ? "bg-teal-500" : "bg-gray-200"}`}
                  style={{ width: `${Math.max(p.value * 100, 2)}%` }} />
              </div>
              <span className="text-[10px] text-gray-400 w-52 shrink-0 text-right">{p.detail}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Career ladder */}
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Professional Pathway</h2>
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          {LADDER.map((step, i) => (
            <div key={step.role} className="flex items-center gap-2 flex-1">
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 flex-1 ${
                i === 0 ? "bg-teal-600 text-white" : i === 1 ? "bg-teal-50 text-teal-800 border border-teal-200" : "bg-gray-50 text-gray-500"}`}>
                <span>{step.icon}</span>
                <span className="text-xs font-medium leading-tight">{step.role}</span>
                {i === 0 && <span className="text-[9px] bg-white/20 rounded px-1 ml-auto">You</span>}
                {i === 1 && <span className="text-[9px] bg-teal-600 text-white rounded px-1 ml-auto">Next</span>}
              </div>
              {i < LADDER.length - 1 && <span className="text-gray-300 hidden sm:block">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* What to do next */}
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Recommended Next Steps</h2>
      <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
        {[
          total - competent > 0 && { icon: "🎯", text: `Close ${total - competent} open competency gap${total - competent !== 1 ? "s" : ""}`, href: "/dashboard/learning", link: "Learning Pathway" },
          !isPreceptor && { icon: "🧭", text: "Build toward preceptor/mentor recognition by supporting newer colleagues", href: "/dashboard/feedback", link: "My Feedback" },
          !credsCurrent && { icon: "🎖️", text: creds.length ? "Renew or verify your credentials" : "Ask your organisation to record your professional credentials", href: "/dashboard/certificates", link: "Certificates" },
          advanced === 0 && total > 0 && { icon: "📈", text: "Aim for Proficient-level performance at your next reassessment", href: "/dashboard/cpu", link: "My CPUs" },
        ].filter(Boolean).map((s, i) => {
          const step = s as { icon: string; text: string; href: string; link: string };
          return (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5">
              <span className="text-lg">{step.icon}</span>
              <p className="text-sm text-gray-700 flex-1">{step.text}</p>
              <Link href={step.href} className="text-xs text-teal-600 hover:underline shrink-0">{step.link} →</Link>
            </div>
          );
        })}
        {total > 0 && competent === total && isPreceptor && credsCurrent && (
          <div className="px-5 py-4 text-sm text-green-700">🎉 Your record is fully current — speak to your manager about the {nextRole} pathway.</div>
        )}
        {total === 0 && (
          <div className="px-5 py-4 text-sm text-gray-400">Your growth plan appears once your first competency cycle completes.</div>
        )}
      </div>

      <p className="text-[11px] text-gray-400 mt-6">
        Maturity levels follow the Benner model: {Object.values(MATURITY_LABELS).join(" → ")}.
      </p>
    </div>
  );
}
