import { createClient } from "@/lib/supabase/server";

// 15 competency domains from the clinical framework
const DOMAINS = [
  { id: 1,  name: "Assessment",                                    icon: "🔍", match: ["assessment", "patient assessment"] },
  { id: 2,  name: "Airway",                                        icon: "💨", match: ["airway", "bls", "als", "basic life support"] },
  { id: 3,  name: "Breathing",                                     icon: "🫁", match: ["breathing", "bls", "critical care", "basic life support"] },
  { id: 4,  name: "Circulation",                                   icon: "🫀", match: ["circulation", "bls", "als", "cannulation", "basic life support"] },
  { id: 5,  name: "Disability",                                    icon: "🧠", match: ["disability", "neurological", "icp"] },
  { id: 6,  name: "Renal",                                         icon: "🔬", match: ["renal", "fluid", "kidney"] },
  { id: 7,  name: "GI & Nutrition",                                icon: "🍽️", match: ["nutrition", "gi", "gastro"] },
  { id: 8,  name: "Skin & Wound Care",                             icon: "🩹", match: ["wound", "skin", "dressing"] },
  { id: 9,  name: "Medication Safety",                             icon: "💊", match: ["medication", "pharmacology", "drug", "safe medication"] },
  { id: 10, name: "Infection Prevention & Control",                icon: "🧼", match: ["infection", "handwash", "hygiene", "aseptic"] },
  { id: 11, name: "Family Psychosocial & Mental Health",           icon: "🤝", match: ["mental", "psychosocial", "family"] },
  { id: 12, name: "Quality & Safety",                              icon: "✅", match: ["quality", "safety"] },
  { id: 13, name: "Interpersonal Skills & Communication & Teamwork", icon: "💬", match: ["communication", "interpersonal", "teamwork"] },
  { id: 14, name: "End of Life & Palliative Care",                 icon: "🕊️", match: ["palliative", "end of life"] },
  { id: 15, name: "Neonatal Care",                                 icon: "👶", match: ["neonatal", "pediatric", "paediatric", "newborn"] },
];

const CERT_NAMES = [
  { label: "BLS",      match: ["bls", "basic life support"] },
  { label: "PALS",     match: ["pals", "pediatric", "paediatric"] },
  { label: "ACLS",     match: ["acls", "als", "advanced life support"] },
  { label: "Epilepsy", match: ["epilepsy", "seizure"] },
];

const MANDATORY_COURSES = [
  { name: "Patient Assessment", keyword: "assessment" },
  { name: "Hand Hygiene",       keyword: "infection" },
  { name: "PPE Use",            keyword: "infection" },
  { name: "BLS",                keyword: "bls" },
];

type NurseComp = {
  id: string;
  competency_id: string;
  status: string;
  achieved_date: string | null;
  expiry_date: string | null;
  competencies: { name: string; category: string; expiry_months: number } | null;
};

function matchesKeywords(name: string, keywords: string[]): boolean {
  const lower = name.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

function getDomainStatus(domain: typeof DOMAINS[0], comps: NurseComp[]) {
  const matched = comps.filter(c => c.competencies && matchesKeywords(c.competencies.name, domain.match));
  if (matched.length === 0) return "pending";
  if (matched.some(c => c.status === "competent")) return "competent";
  if (matched.some(c => c.status === "in_progress")) return "in_progress";
  if (matched.some(c => c.status === "expired")) return "expired";
  return "pending";
}

const statusConfig = {
  competent:   { dot: "bg-green-500",  badge: "bg-green-100 text-green-700",  label: "Competent" },
  in_progress: { dot: "bg-blue-500",   badge: "bg-blue-100 text-blue-700",    label: "In Progress" },
  expired:     { dot: "bg-red-500",    badge: "bg-red-100 text-red-600",      label: "Expired" },
  pending:     { dot: "bg-gray-300",   badge: "bg-gray-100 text-gray-400",    label: "Pending" },
};

export default async function PassportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [{ data: userComps }, { data: allCourses }, { data: enrollments }, { data: profile }] = await Promise.all([
    supabase.from("nurse_competencies")
      .select("id, competency_id, status, achieved_date, expiry_date, competencies(name, category, expiry_months)")
      .eq("user_id", user!.id),
    supabase.from("courses").select("id, title, category").eq("is_published", true),
    supabase.from("course_enrollments").select("course_id, progress, completed_at").eq("user_id", user!.id),
    supabase.from("profiles")
      .select("full_name, role, specialization, country, phone")
      .eq("id", user!.id)
      .single(),
  ]);

  const comps = (userComps ?? []) as unknown as NurseComp[];

  // ── Overall level
  const competentCount  = comps.filter(c => c.status === "competent").length;
  const inProgressCount = comps.filter(c => c.status === "in_progress").length;
  const expiredCount    = comps.filter(c => c.status === "expired").length;
  const totalDomains    = DOMAINS.length;
  const domainStatuses  = DOMAINS.map(d => getDomainStatus(d, comps));
  const domainsComplete = domainStatuses.filter(s => s === "competent").length;
  const domainsPending  = totalDomains - domainsComplete;

  const overallLevel =
    domainsComplete >= 12 ? "Expert"
    : domainsComplete >= 6  ? "Competent"
    : domainsComplete >= 1  ? "Developing"
    : "Pending";

  const levelColors: Record<string, string> = {
    Expert:     "text-green-600 bg-green-50 border-green-200",
    Competent:  "text-teal-600 bg-teal-50 border-teal-200",
    Developing: "text-blue-600 bg-blue-50 border-blue-200",
    Pending:    "text-gray-500 bg-gray-50 border-gray-200",
  };

  // ── Certifications
  const certs = CERT_NAMES.map(cert => {
    const match = comps.find(c => c.competencies && matchesKeywords(c.competencies.name, cert.match));
    return {
      label: cert.label,
      status: match?.status ?? "pending",
      expiry: match?.expiry_date ?? null,
      achieved: match?.achieved_date ?? null,
    };
  });

  // ── Mandatory courses
  const mandatoryCourses = MANDATORY_COURSES.map(mc => {
    const course = allCourses?.find(c => c.title.toLowerCase().includes(mc.keyword));
    const enroll = course ? enrollments?.find(e => e.course_id === course.id) : null;
    return {
      name: mc.name,
      completed: !!(enroll?.completed_at),
      progress: enroll?.progress ?? 0,
    };
  });

  const mandatoryTaken   = mandatoryCourses.filter(c => c.completed).length;
  const mandatoryPending = mandatoryCourses.filter(c => !c.completed).length;

  const firstName = profile?.full_name?.split(" ")[0] ?? "N";
  const initials  = (profile?.full_name ?? "NN").split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="max-w-4xl">
      {/* ── PASSPORT HEADER CARD ── */}
      <div className="bg-[#0a2e38] rounded-2xl p-0 mb-5 overflow-hidden">
        {/* Top strip */}
        <div className="bg-teal-500/20 border-b border-teal-500/20 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-teal-500 flex items-center justify-center text-white font-bold text-xs">C</div>
            <span className="text-teal-200 text-xs font-semibold tracking-widest uppercase">Competen Healthcare · Clinical Competency Passport</span>
          </div>
          <button className="flex items-center gap-1.5 text-xs text-teal-300 hover:text-white transition-colors border border-teal-500/40 px-3 py-1 rounded-lg">
            ↓ Download PDF
          </button>
        </div>

        <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-start">
          <div>
            {/* Row 1: Name / Reg No / License / Expiry */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              {[
                { label: "Name",      value: profile?.full_name ?? "—" },
                { label: "Reg No",    value: "—" },
                { label: "License #", value: "—" },
                { label: "Expiry",    value: "—" },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[9px] font-bold text-teal-400/60 tracking-widest uppercase mb-0.5">{label}</p>
                  <p className="text-white text-sm font-semibold truncate">{value}</p>
                </div>
              ))}
            </div>
            {/* Row 2: Role / Dept / Specialty / Facility */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-teal-700/40">
              {[
                { label: "Role",      value: profile?.role?.replace(/_/g, " ") ?? "—" },
                { label: "Dept/Unit", value: "—" },
                { label: "Specialty", value: profile?.specialization ?? "—" },
                { label: "Facility",  value: "—" },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[9px] font-bold text-teal-400/60 tracking-widest uppercase mb-0.5">{label}</p>
                  <p className="text-white text-sm capitalize truncate">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Avatar */}
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-xl bg-teal-500 flex items-center justify-center text-white font-bold text-2xl">
              {initials}
            </div>
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded border ${levelColors[overallLevel]}`}>
              {overallLevel.toUpperCase()}
            </span>
          </div>
        </div>
      </div>

      {/* ── THREE INFO BOXES ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">

        {/* CERTIFICATIONS */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-3">Certifications</p>
          <table className="w-full">
            <thead>
              <tr className="text-[9px] text-gray-400 font-semibold uppercase tracking-wider border-b border-gray-100">
                <th className="text-left pb-1.5"></th>
                <th className="text-right pb-1.5">Expiry Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {certs.map(cert => {
                const cfg = statusConfig[cert.status as keyof typeof statusConfig] ?? statusConfig.pending;
                return (
                  <tr key={cert.label}>
                    <td className="py-2 flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                      <span className="text-sm font-semibold text-gray-800">{cert.label}</span>
                    </td>
                    <td className="py-2 text-right text-xs text-gray-400">
                      {cert.expiry ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* COMPETENCY */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-3">Competency</p>
          <div className="mb-3 pb-3 border-b border-gray-100">
            <p className="text-[10px] text-gray-400 mb-1">1. Level</p>
            <span className={`text-sm font-bold px-3 py-1 rounded border ${levelColors[overallLevel]}`}>
              {overallLevel}
            </span>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 mb-2">2. Core Competencies</p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-teal-50 rounded-lg p-2 border border-teal-100">
                <p className="text-lg font-bold text-teal-700">{domainsComplete}</p>
                <p className="text-[9px] text-teal-500 font-semibold">Completed Domains</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                <p className="text-lg font-bold text-gray-500">{domainsPending}</p>
                <p className="text-[9px] text-gray-400 font-semibold">Pending</p>
              </div>
            </div>
          </div>
        </div>

        {/* MANDATORY TRAININGS */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-3">Mandatory Trainings</p>
          <div className="grid grid-cols-2 gap-2 mb-4 text-center">
            <div className="bg-green-50 rounded-lg p-2 border border-green-100">
              <p className="text-lg font-bold text-green-600">{mandatoryTaken}</p>
              <p className="text-[9px] text-green-500 font-semibold">Taken</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-2 border border-amber-100">
              <p className="text-lg font-bold text-amber-600">{mandatoryPending}</p>
              <p className="text-[9px] text-amber-500 font-semibold">Pending</p>
            </div>
          </div>
          <div className="border-t border-gray-100 pt-3">
            <p className="text-[10px] text-gray-400 font-semibold mb-2">Mock Code (This Year)</p>
            <div className="flex gap-2">
              <div className="flex-1 text-center bg-teal-50 rounded-lg py-1.5 border border-teal-100">
                <p className="text-xs font-bold text-teal-700">C {competentCount}</p>
                <p className="text-[9px] text-teal-400">Completed</p>
              </div>
              <div className="flex-1 text-center bg-gray-50 rounded-lg py-1.5 border border-gray-100">
                <p className="text-xs font-bold text-gray-500">D {inProgressCount + expiredCount}</p>
                <p className="text-[9px] text-gray-400">Due</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 15 COMPETENCY DOMAINS ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase">Competency Domains</p>
          <div className="flex items-center gap-3 text-[10px]">
            {[
              { dot: "bg-green-500", label: "Competent" },
              { dot: "bg-blue-500",  label: "In Progress" },
              { dot: "bg-red-500",   label: "Expired" },
              { dot: "bg-gray-300",  label: "Pending" },
            ].map(({ dot, label }) => (
              <div key={label} className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${dot}`} />
                <span className="text-gray-400">{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {DOMAINS.map((domain, i) => {
            const status = domainStatuses[i];
            const cfg = statusConfig[status as keyof typeof statusConfig] ?? statusConfig.pending;
            return (
              <div key={domain.id}
                className={`flex items-center gap-2.5 p-2.5 rounded-lg border transition-colors ${
                  status === "competent" ? "bg-green-50 border-green-100"
                  : status === "in_progress" ? "bg-blue-50 border-blue-100"
                  : status === "expired" ? "bg-red-50 border-red-100"
                  : "bg-gray-50 border-gray-100"
                }`}>
                <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] text-gray-400 font-semibold">{domain.id}.</p>
                  <p className="text-xs font-semibold text-gray-800 leading-tight">{domain.name}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── MANDATORY COURSES ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <p className="text-[10px] font-bold text-gray-400 tracking-widest uppercase mb-4">Mandatory Courses</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {mandatoryCourses.map(course => (
            <div key={course.name}
              className={`rounded-xl p-3 border text-center ${
                course.completed ? "bg-green-50 border-green-200" : "bg-gray-50 border-gray-100"
              }`}>
              <p className="text-xl mb-1">{course.completed ? "✅" : "⏳"}</p>
              <p className="text-xs font-semibold text-gray-800 leading-tight">{course.name}</p>
              {course.completed ? (
                <p className="text-[10px] text-green-600 font-semibold mt-1">Complete</p>
              ) : course.progress > 0 ? (
                <>
                  <div className="h-1 bg-gray-200 rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-blue-400 rounded-full" style={{ width: `${course.progress}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">{course.progress}%</p>
                </>
              ) : (
                <p className="text-[10px] text-gray-400 mt-1">Not started</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
