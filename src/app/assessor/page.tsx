import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AssessorDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, hospital_id")
    .eq("id", user.id)
    .single();

  const hospitalId = profile?.hospital_id ?? "";

  const { data: nurses } = hospitalId
    ? await supabase.from("profiles").select("id, full_name, specialization").eq("hospital_id", hospitalId).eq("role", "nurse").order("full_name").limit(5)
    : { data: [] };

  const { data: courses } = await supabase
    .from("courses")
    .select("id")
    .eq("is_published", true);

  const tools = [
    { title: "Nursing Assessment Audit", desc: "Grade nurse performance against 62 competency items", href: "/assessor/assess?tab=0", icon: "📋", color: "bg-indigo-50 border-indigo-200 text-indigo-700" },
    { title: "Concurrent Audit",         desc: "Compare independent nurse & assessor findings on same patient", href: "/assessor/assess?tab=1", icon: "🔄", color: "bg-blue-50 border-blue-200 text-blue-700" },
    { title: "Retrospective Chart Audit",desc: "Review patient file for documentation completeness", href: "/assessor/assess?tab=2", icon: "📁", color: "bg-sky-50 border-sky-200 text-sky-700" },
  ];

  return (
    <>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Assessor Dashboard</h1>
        <p className="text-gray-400 text-sm mt-0.5">Welcome back, {profile?.full_name?.split(" ")[0]}. Ready to assess?</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { label: "Nurses to Assess", value: nurses?.length ?? 0, icon: "👩‍⚕️", color: "text-indigo-600" },
          { label: "Audit Tools",      value: 3,                    icon: "📋", color: "text-blue-600"   },
          { label: "OSCE Templates",   value: 0,                    icon: "🩺", color: "text-sky-600"    },
          { label: "Published Courses",value: courses?.length ?? 0, icon: "📚", color: "text-teal-600"   },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl p-4 border border-gray-100">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{s.label}</p>
              <span className="text-base">{s.icon}</span>
            </div>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Audit tools */}
      <div className="mb-8">
        <h2 className="text-sm font-bold text-gray-700 mb-3">Assessment Tools</h2>
        <div className="flex flex-col gap-3">
          {tools.map(t => (
            <Link key={t.title} href={t.href}
              className={`flex items-start gap-4 p-4 rounded-xl border ${t.color} hover:shadow-sm transition-shadow`}>
              <span className="text-2xl mt-0.5">{t.icon}</span>
              <div>
                <p className="font-semibold text-sm">{t.title}</p>
                <p className="text-xs mt-0.5 opacity-80">{t.desc}</p>
              </div>
              <span className="ml-auto text-sm font-bold opacity-60">→</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Assigned nurses */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-700">Nurses in Your Hospital</h2>
          <Link href="/assessor/nurses" className="text-xs text-indigo-600 hover:underline">View all →</Link>
        </div>
        {!nurses?.length ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-gray-400">
            <p className="text-2xl mb-2">👩‍⚕️</p>
            <p className="text-sm">No nurses linked to your hospital yet.</p>
            {!hospitalId && <p className="text-xs mt-1">Link a hospital in your profile settings.</p>}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {nurses.map((n, i) => (
              <div key={n.id} className={`flex items-center gap-3 px-5 py-3.5 ${i > 0 ? "border-t border-gray-50" : ""}`}>
                <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {n.full_name[0]}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{n.full_name}</p>
                  <p className="text-xs text-gray-400">{n.specialization ?? "General Nursing"}</p>
                </div>
                <Link href={`/assessor/assess?nurse=${n.id}`}
                  className="ml-auto text-xs text-indigo-600 hover:text-indigo-700 border border-indigo-200 px-3 py-1 rounded-lg">
                  Assess →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
