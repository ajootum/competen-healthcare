import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OUTCOME_CONFIG, MATURITY_LABELS, AUTH_TYPE_LABELS, AUTH_STATUS_CONFIG, CREDENTIAL_TYPE_LABELS, CREDENTIAL_STATUS_CONFIG, RECOGNITION_TYPE_LABELS, type DecisionOutcome, type Maturity, type AuthorizationType, type AuthStatus } from "@/lib/ckcm";
import { ROLE_CONFIG, type AppRole } from "@/lib/roles";

// Competency Passport 2.0 — the clinician's living professional record
// (Passport 2.0 Developer Specification). Identity, readiness gauge, KPI row,
// domain progress, upcoming assessments, skills portfolio, journey, insights
// and trend — every figure computed from the governed record. No evidence
// vault or peer benchmark percentile is shown because the schema does not yet
// store uploads or peer cohorts; omissions are deliberate, not oversights.

const SCORE_COLORS = ["#ef4444", "#f97316", "#eab308", "#14b8a6", "#0d9488", "#3b82f6", "#8b5cf6"];
const SCORE_LABELS = ["Training Required", "Novice", "Advanced Beginner", "Competent", "Competent+", "Proficient", "Expert"];

// Employment passport statuses (Lifetime Passport spec §5)
const EMPLOYMENT_STATUS: Record<string, { label: string; cls: string }> = {
  orientation:          { label: "Orientation",          cls: "bg-amber-100 text-amber-700" },
  probation:            { label: "Probation",            cls: "bg-blue-100 text-blue-700" },
  confirmed:            { label: "Confirmed",            cls: "bg-green-100 text-green-700" },
  secondment:           { label: "Secondment",           cls: "bg-violet-100 text-violet-700" },
  temporary_assignment: { label: "Temporary",            cls: "bg-sky-100 text-sky-700" },
  resigned:             { label: "Resigned",             cls: "bg-gray-100 text-gray-500" },
  contract_ended:       { label: "Contract ended",       cls: "bg-gray-100 text-gray-500" },
  retired:              { label: "Retired",              cls: "bg-gray-100 text-gray-500" },
  suspended:            { label: "Suspended",            cls: "bg-red-100 text-red-600" },
  terminated:           { label: "Terminated",           cls: "bg-red-100 text-red-600" },
};
const dayMs = 86400000;
// Server component renders once per request, so "now" is stable for a render.
const nowMs = () => Date.now();
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

function reassessmentState(expiry: string | null): { label: string; cls: string; days: number } | null {
  if (!expiry) return null;
  const days = Math.ceil((new Date(expiry).getTime() - nowMs()) / dayMs);
  if (days < 0) return { label: "Expired", cls: "bg-red-50 text-red-600", days };
  if (days <= 60) return { label: `Due in ${days}d`, cls: "bg-amber-50 text-amber-700", days };
  return { label: `Valid to ${new Date(expiry).toLocaleDateString()}`, cls: "bg-gray-50 text-gray-500", days };
}

function Gauge({ pct }: { pct: number }) {
  const r = 52, c = 2 * Math.PI * r;
  const color = pct >= 80 ? "#16a34a" : pct >= 50 ? "#0d9488" : "#f59e0b";
  return (
    <svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-label={`${pct}% overall readiness`}>
      <circle cx="64" cy="64" r={r} fill="none" stroke="#f3f4f6" strokeWidth="11" />
      <circle cx="64" cy="64" r={r} fill="none" stroke={color} strokeWidth="11"
        strokeDasharray={`${Math.max((pct / 100) * c, 1)} ${c}`} strokeLinecap="round" transform="rotate(-90 64 64)" />
      <text x="64" y="60" textAnchor="middle" fontSize="26" fontWeight="800" fill="#111827">{pct}%</text>
      <text x="64" y="78" textAnchor="middle" fontSize="9" fill="#9ca3af">Overall readiness</text>
    </svg>
  );
}

export default async function PassportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles")
    .select("full_name, role, specialization, hospital_id, department_id, organisation_id").eq("id", user.id).single();
  if (!profile) redirect("/login");

  const [
    { data: hospital }, { data: department }, { data: organisation },
    { data: cycles }, { data: allCompScores }, { data: allDecisions },
    { data: authorizations }, { data: credentials }, { data: recognitions },
    { data: skillScores }, { data: cpdLogs }, { data: orgScores }, { data: pathway },
  ] = await Promise.all([
    profile.hospital_id ? admin.from("hospitals").select("name").eq("id", profile.hospital_id).single() : Promise.resolve({ data: null }),
    profile.department_id ? admin.from("departments").select("name").eq("id", profile.department_id).single() : Promise.resolve({ data: null }),
    profile.organisation_id ? admin.from("organisations").select("name").eq("id", profile.organisation_id).single() : Promise.resolve({ data: null }),
    admin.from("competency_cycles").select("id, cycle_type, status, start_date, end_date").eq("nurse_id", user.id).order("start_date", { ascending: false }),
    admin.from("competency_scores")
      .select("competency_id, cycle_id, score, label, is_passing, assessed_at, educator_validated, framework_competencies(id, name, framework_domains(id, name, frameworks(id, name, library)))")
      .eq("nurse_id", user.id).order("assessed_at", { ascending: false }),
    admin.from("competency_decisions")
      .select("competency_id, outcome, maturity, effective_date, expiry_date, critical_failure, validation_outcome, created_at, framework_competencies(id, name, framework_domains(name, frameworks(name)))")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
    admin.from("clinical_authorizations")
      .select("id, authorization_number, authorization_type, authorization_level, status, scope, conditions, expiry_date")
      .eq("nurse_id", user.id).in("status", ["active", "suspended"]).order("created_at", { ascending: false }),
    admin.from("professional_credentials")
      .select("id, credential_type, title, issuing_body, status, verified, expiry_date")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
    admin.from("professional_recognitions")
      .select("id, recognition_type, title, description, awarded_by_name, awarded_at")
      .eq("nurse_id", user.id).order("awarded_at", { ascending: false }),
    admin.from("skill_scores")
      .select("skill_id, score, assessed_at, competency_skills(name), competency_cycles!inner(nurse_id)")
      .eq("competency_cycles.nurse_id", user.id).order("assessed_at", { ascending: false }).limit(200),
    admin.from("cpd_logs").select("hours, activity_date").eq("user_id", user.id),
    admin.from("competency_scores").select("score"),
    admin.from("learning_pathways").select("id, status").eq("nurse_id", user.id).eq("status", "active").limit(1).maybeSingle(),
  ]);

  // Lifetime passport layer (migration 027) — both queries degrade gracefully
  // to empty if the migration has not been applied yet.
  const [{ data: employments }, { data: decisionEmployers }] = await Promise.all([
    admin.from("employment_records")
      .select("id, role_title, status, start_date, end_date, organisations(name), hospitals(name), departments(name)")
      .eq("nurse_id", user.id).order("start_date", { ascending: false }),
    admin.from("competency_decisions")
      .select("competency_id, hospital_id, hospitals(name)")
      .eq("nurse_id", user.id).not("hospital_id", "is", null),
  ]);
  const employerByCompetency = new Map(
    ((decisionEmployers ?? []) as unknown as { competency_id: string; hospitals: { name: string } | null }[])
      .map(r => [r.competency_id, r.hospitals?.name ?? null]));
  const careerTimeline = ((employments ?? []) as unknown as {
    id: string; role_title: string; status: string; start_date: string; end_date: string | null;
    organisations: { name: string } | null; hospitals: { name: string } | null; departments: { name: string } | null;
  }[]);

  // ── Best score per competency ──
  type CompEntry = {
    competency_id: string; score: number; label: string; is_passing: boolean;
    assessed_at: string; educator_validated: boolean; name: string;
    domain_name: string; framework_name: string; framework_id: string; library: string;
  };
  const seen = new Set<string>();
  const best: CompEntry[] = [];
  for (const cs of allCompScores ?? []) {
    if (seen.has(cs.competency_id)) continue;
    seen.add(cs.competency_id);
    const comp = cs.framework_competencies as unknown as { id: string; name: string; framework_domains: { id: string; name: string; frameworks: { id: string; name: string; library: string } | null } | null } | null;
    if (!comp) continue;
    best.push({
      competency_id: cs.competency_id, score: cs.score,
      label: cs.label ?? SCORE_LABELS[cs.score] ?? "—",
      is_passing: cs.is_passing ?? false, assessed_at: cs.assessed_at,
      educator_validated: cs.educator_validated ?? false, name: comp.name,
      domain_name: comp.framework_domains?.name ?? "—",
      framework_name: comp.framework_domains?.frameworks?.name ?? "—",
      framework_id: comp.framework_domains?.frameworks?.id ?? "",
      library: comp.framework_domains?.frameworks?.library ?? "",
    });
  }
  const totalScored = best.length;
  const totalPassing = best.filter(b => b.is_passing).length;
  const validatedScores = best.filter(b => b.educator_validated).length;
  const avgScore = totalScored ? Math.round(best.reduce((s, b) => s + b.score, 0) / totalScored * 10) / 10 : null;

  // ── Latest decision per competency (the governed record) ──
  type DecisionEntry = {
    competency_id: string; outcome: DecisionOutcome; maturity: Maturity | null;
    effective_date: string; expiry_date: string | null; critical_failure: boolean;
    validated: boolean; name: string; domain_name: string; framework_name: string;
  };
  const dseen = new Set<string>();
  const decisions: DecisionEntry[] = [];
  for (const d of allDecisions ?? []) {
    if (dseen.has(d.competency_id)) continue;
    dseen.add(d.competency_id);
    const comp = d.framework_competencies as unknown as { name: string; framework_domains: { name: string; frameworks: { name: string } | null } | null } | null;
    if (!comp) continue;
    decisions.push({
      competency_id: d.competency_id, outcome: d.outcome as DecisionOutcome,
      maturity: (d.maturity as Maturity) ?? null, effective_date: d.effective_date,
      expiry_date: d.expiry_date, critical_failure: d.critical_failure ?? false,
      validated: d.validation_outcome === "validated",
      name: comp.name, domain_name: comp.framework_domains?.name ?? "—",
      framework_name: comp.framework_domains?.frameworks?.name ?? "—",
    });
  }
  const competentCount = decisions.filter(d => OUTCOME_CONFIG[d.outcome]?.passing && (!d.expiry_date || new Date(d.expiry_date).getTime() > nowMs())).length;
  const expiredCount = decisions.filter(d => d.expiry_date && new Date(d.expiry_date).getTime() < nowMs()).length;
  const criticalCount = decisions.filter(d => d.critical_failure).length;
  const dueSoonList = decisions
    .map(d => ({ ...d, re: reassessmentState(d.expiry_date) }))
    .filter(d => d.re && d.re.days >= 0 && d.re.days <= 120)
    .sort((a, b) => (a.re!.days - b.re!.days));

  // Readiness: governed decisions if any, else assessment scores
  const readinessBase = decisions.length || totalScored;
  const readinessGood = decisions.length ? competentCount : totalPassing;
  const readiness = readinessBase ? Math.round((readinessGood / readinessBase) * 100) : 0;

  // Passport status — derived, never asserted beyond the record
  const allValidated = decisions.length > 0 && decisions.every(d => d.validated);
  const status = criticalCount > 0 || expiredCount > 0
    ? { label: "ACTION NEEDED", cls: "text-red-600", box: "bg-red-50 border-red-100", icon: "⚠️", note: `${expiredCount ? `${expiredCount} expired` : ""}${expiredCount && criticalCount ? " · " : ""}${criticalCount ? `${criticalCount} critical` : ""}` }
    : allValidated
    ? { label: "VALIDATED", cls: "text-green-700", box: "bg-green-50 border-green-100", icon: "🛡️", note: "All assessed competencies validated" }
    : decisions.length || totalScored
    ? { label: "IN PROGRESS", cls: "text-teal-700", box: "bg-teal-50 border-teal-100", icon: "🔄", note: "Assessment and validation ongoing" }
    : { label: "NOT STARTED", cls: "text-gray-500", box: "bg-gray-50 border-gray-100", icon: "🪪", note: "Populates with your first assessed cycle" };
  const nextReview = decisions
    .map(d => d.expiry_date).filter((e): e is string => !!e && new Date(e).getTime() > nowMs())
    .sort()[0] ?? null;

  const activeCycle = (cycles ?? []).find(c => c.status === "active") ?? (cycles ?? [])[0] ?? null;

  // ── Skills portfolio: group scores per skill ──
  type SkillRow = { name: string; best: number; times: number; last: string };
  const skillMap = new Map<string, SkillRow>();
  for (const s of (skillScores ?? []) as unknown as { skill_id: string; score: number; assessed_at: string; competency_skills: { name: string } | null }[]) {
    const name = s.competency_skills?.name ?? "Skill";
    const row = skillMap.get(s.skill_id) ?? { name, best: 0, times: 0, last: s.assessed_at };
    row.times++;
    row.best = Math.max(row.best, s.score);
    if (s.assessed_at > row.last) row.last = s.assessed_at;
    skillMap.set(s.skill_id, row);
  }
  const skillRows = [...skillMap.values()].sort((a, b) => b.last.localeCompare(a.last));

  // ── CPD, benchmark, domains, journey, insights, trend ──
  const cpdHours = (cpdLogs ?? []).reduce((s, l) => s + Number(l.hours), 0);
  const orgAvg = (orgScores ?? []).length ? (orgScores!.reduce((s, r) => s + r.score, 0) / orgScores!.length) : null;
  const vsOrg = avgScore !== null && orgAvg !== null ? Math.round((avgScore - orgAvg) * 10) / 10 : null;

  const byDomain = new Map<string, { total: number; sum: number }>();
  for (const b of best) {
    const d = byDomain.get(b.domain_name) ?? { total: 0, sum: 0 };
    d.total++; d.sum += b.score;
    byDomain.set(b.domain_name, d);
  }
  const domainRows = [...byDomain.entries()]
    .map(([name, v]) => ({ name, avg: v.sum / v.total, pct: Math.round((v.sum / v.total / 6) * 100) }))
    .sort((a, b) => b.pct - a.pct);

  const expiringCreds = (credentials ?? []).filter(c => c.expiry_date && (new Date(c.expiry_date).getTime() - nowMs()) / dayMs <= 60 && new Date(c.expiry_date).getTime() > nowMs()).length;
  const dueSoon60 = dueSoonList.filter(d => d.re!.days <= 60).length;

  const advanced = decisions.filter(d => d.maturity === "proficient" || d.maturity === "expert").length;
  const journeyStage = advanced > 0 ? 4 : allValidated ? 3 : (decisions.length || totalScored) ? 2 : skillRows.length ? 1 : 0;
  const JOURNEY = [
    { icon: "📖", label: "Learn", sub: "Complete learning" },
    { icon: "🫱", label: "Practice", sub: "Gain experience" },
    { icon: "📋", label: "Assess", sub: "Demonstrate" },
    { icon: "🛡️", label: "Validate", sub: "Approved" },
    { icon: "⭐", label: "Expert", sub: "Maintain & grow" },
  ];

  const insights = [
    dueSoon60 > 0 && { icon: "⏳", tone: "text-amber-600", text: `${dueSoon60} competenc${dueSoon60 === 1 ? "y is" : "ies are"} due for reassessment within 60 days — book early.` },
    expiredCount > 0 && { icon: "🔴", tone: "text-red-600", text: `${expiredCount} competenc${expiredCount === 1 ? "y has" : "ies have"} expired — arrange reassessment before practising them.` },
    pathway && { icon: "📚", tone: "text-blue-600", text: "You have an active learning pathway — completing it closes your open gaps." },
    readiness >= 80 && readinessBase > 0 && { icon: "✅", tone: "text-green-600", text: `Strong record — ${readiness}% of your assessed competencies are current. Keep it up.` },
    readinessBase === 0 && { icon: "🪪", tone: "text-gray-500", text: "Your passport fills in as assessors score you during your active cycle." },
  ].filter(Boolean) as { icon: string; tone: string; text: string }[];

  // Trend: competencies assessed per month (cumulative)
  const monthly = new Map<string, number>();
  for (const cs of allCompScores ?? []) monthly.set(cs.assessed_at.slice(0, 7), (monthly.get(cs.assessed_at.slice(0, 7)) ?? 0) + 1);
  const months = [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const trend = months.reduce<{ m: string; v: number }[]>((acc, [m, n]) => {
    acc.push({ m, v: (acc[acc.length - 1]?.v ?? 0) + n });
    return acc;
  }, []);

  const byFramework = new Map<string, { name: string; library: string; competencies: CompEntry[] }>();
  for (const entry of best) {
    if (!byFramework.has(entry.framework_id)) byFramework.set(entry.framework_id, { name: entry.framework_name, library: entry.library, competencies: [] });
    byFramework.get(entry.framework_id)!.competencies.push(entry);
  }

  const KPI = [
    { label: "Competencies", value: `${decisions.length ? competentCount : totalPassing} / ${readinessBase}`, sub: readinessBase ? `${readiness}% current` : "none assessed", color: "text-green-600", href: "#decisions" },
    { label: "Skills Assessed", value: skillRows.length, sub: skillRows.length ? `${skillRows.reduce((s, r) => s + r.times, 0)} scorings` : "none yet", color: "text-teal-700", href: "#skills" },
    { label: "Validated", value: `${decisions.length ? decisions.filter(d => d.validated).length : validatedScores} / ${readinessBase}`, sub: "by an educator", color: "text-blue-600", href: "#decisions" },
    { label: "CPD Hours", value: cpdHours || "—", sub: cpdHours ? "logged" : "log in CPD Academy", color: "text-violet-600", href: "/dashboard/cpd" },
    { label: "Expiring Soon", value: dueSoon60 + expiringCreds, sub: "≤60 days (incl. credentials)", color: dueSoon60 + expiringCreds ? "text-amber-600" : "text-gray-400", href: "#upcoming" },
    { label: "vs Org Average", value: vsOrg === null ? "—" : `${vsOrg >= 0 ? "+" : ""}${vsOrg}`, sub: orgAvg !== null ? `org avg ${orgAvg.toFixed(1)}/6` : "no org data", color: vsOrg !== null && vsOrg >= 0 ? "text-green-600" : "text-orange-500", href: "#matrix" },
  ];

  const card = "bg-white rounded-xl border border-gray-100";
  const secHead = "text-xs font-bold text-gray-400 uppercase tracking-widest";
  const roleLabel = ROLE_CONFIG[(profile.role ?? "nurse") as AppRole]?.label ?? "Healthcare Worker";

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
            <Link href="/dashboard" className="hover:text-gray-600">Dashboard</Link>
            <span>/</span>
            <span className="text-gray-700 font-medium">Competency Passport</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Competency Passport</h1>
        </div>
        <Link href="/dashboard/passport/print"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 px-4 py-2 rounded-lg transition-colors">
          🖨️ Print / Export
        </Link>
      </div>

      {/* Identity + readiness + status */}
      <div className={`${card} p-6 mb-5`}>
        <div className="flex flex-col lg:flex-row lg:items-center gap-6">
          <div className="flex items-center gap-5 flex-1 min-w-0">
            <div className="w-20 h-20 rounded-full bg-teal-600 text-white flex items-center justify-center text-2xl font-bold shrink-0">
              {profile.full_name?.[0] ?? "?"}
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-gray-900 flex items-center gap-1.5">
                {profile.full_name}
                {allValidated && <span className="text-green-500 text-base" title="All assessed competencies validated">✓</span>}
              </p>
              <p className="text-sm text-gray-500">
                {roleLabel}
                {profile.specialization && <span className="ml-2 text-[10px] font-semibold bg-violet-50 text-violet-700 px-2 py-0.5 rounded">{profile.specialization}</span>}
              </p>
              <div className="text-[11px] text-gray-400 mt-2 flex flex-col gap-0.5">
                {department?.name && <span>🏥 Department: <b className="text-gray-600">{department.name}</b></span>}
                {(organisation?.name || hospital?.name) && <span>🏛️ Organisation: <b className="text-gray-600">{organisation?.name ?? hospital?.name}</b></span>}
                {activeCycle && (
                  <span>📅 Passport cycle: <b className="text-gray-600 capitalize">{activeCycle.cycle_type}</b> · {fmt(activeCycle.start_date)} – {fmt(activeCycle.end_date)}</span>
                )}
                <span className="text-teal-600">🪪 Lifetime passport — this record belongs to you and persists across employers.</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <Gauge pct={readiness} />
            <div className={`rounded-xl border p-4 w-52 ${status.box}`}>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Passport status</p>
              <p className={`text-lg font-extrabold ${status.cls} flex items-center gap-1.5`}>{status.label} <span className="text-base">{status.icon}</span></p>
              <p className="text-[10px] text-gray-500 mt-0.5">{status.note}</p>
              {nextReview && <p className="text-[10px] text-gray-500 mt-1.5">Next review: <b>{fmt(nextReview)}</b></p>}
            </div>
          </div>
        </div>
      </div>

      {/* Career timeline (employment passports) */}
      {careerTimeline.length > 0 && (
        <div className={`${card} p-5 mb-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-sm">Career Timeline</h2>
            <span className="text-[9px] text-gray-400">Employment passports — one per employer, kept for life</span>
          </div>
          <div className="flex flex-col gap-0">
            {careerTimeline.map((e, i) => {
              const st = EMPLOYMENT_STATUS[e.status] ?? EMPLOYMENT_STATUS.confirmed;
              const current = !e.end_date;
              return (
                <div key={e.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`w-3 h-3 rounded-full border-2 ${current ? "bg-teal-500 border-teal-200" : "bg-gray-200 border-gray-100"}`} />
                    {i < careerTimeline.length - 1 && <span className="w-0.5 flex-1 bg-gray-100" />}
                  </div>
                  <div className={`flex-1 flex flex-wrap items-center gap-x-3 gap-y-1 ${i < careerTimeline.length - 1 ? "pb-4" : ""}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800">
                        {e.hospitals?.name ?? e.organisations?.name ?? "Employer"}
                        <span className="text-gray-400 font-normal"> · {e.role_title}</span>
                      </p>
                      <p className="text-[10px] text-gray-400">
                        {e.departments?.name ? `${e.departments.name} · ` : ""}
                        {fmt(e.start_date)} – {e.end_date ? fmt(e.end_date) : "Present"}
                      </p>
                    </div>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ml-auto ${st.cls}`}>{st.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
        {KPI.map(k => (
          <Link key={k.label} href={k.href} className={`${card} p-3.5 hover:border-teal-200 transition-colors`}>
            <p className="text-[10px] text-gray-400 font-medium mb-1">{k.label}</p>
            <p className={`text-xl font-bold ${k.color}`}>{k.value}</p>
            <p className="text-[9px] text-gray-400 mt-0.5">{k.sub}</p>
          </Link>
        ))}
      </div>

      {/* Domains + upcoming + achievements */}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5 mb-5">
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-sm">Progress by Domain</h2>
            <a href="#matrix" className="text-xs text-teal-600 hover:underline">Full matrix →</a>
          </div>
          {domainRows.length ? domainRows.map(d => (
            <a key={d.name} href="#matrix" className="flex items-center gap-3 py-1.5 group">
              <span className="text-xs text-gray-700 w-36 truncate group-hover:text-teal-700">{d.name}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${d.pct}%`, backgroundColor: SCORE_COLORS[Math.round(d.avg)] ?? "#9ca3af" }} />
              </div>
              <span className="text-[11px] font-bold text-gray-600 w-9 text-right">{d.pct}%</span>
            </a>
          )) : <p className="text-xs text-gray-400 text-center py-6">Populates as assessors score you. 📊</p>}
        </div>

        <div id="upcoming" className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-sm">Upcoming Reassessments</h2>
            <Link href="/dashboard/assessments" className="text-xs text-teal-600 hover:underline">All assessments →</Link>
          </div>
          {dueSoonList.length ? dueSoonList.slice(0, 4).map(d => (
            <div key={d.competency_id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
              <div className="w-11 text-center bg-gray-50 rounded-lg py-1 shrink-0">
                <p className="text-[8px] font-bold text-teal-600 uppercase">{new Date(d.expiry_date!).toLocaleDateString(undefined, { month: "short" })}</p>
                <p className="text-sm font-bold text-gray-800">{new Date(d.expiry_date!).getDate()}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-800 truncate">{d.name}</p>
                <p className="text-[9px] text-gray-400">{d.domain_name}</p>
              </div>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${d.re!.days <= 14 ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}>
                {d.re!.days}d left
              </span>
            </div>
          )) : <p className="text-xs text-gray-400 text-center py-6">Nothing due within 120 days. ✅</p>}
        </div>

        <div className={`${card} p-5 md:col-span-2 xl:col-span-1`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-sm">Recent Achievements</h2>
            <Link href="/dashboard/certificates" className="text-xs text-teal-600 hover:underline">View all →</Link>
          </div>
          {[
            ...(recognitions ?? []).map(r => ({ id: r.id, icon: RECOGNITION_TYPE_LABELS[r.recognition_type]?.icon ?? "🏅", text: r.title, at: r.awarded_at })),
            ...(credentials ?? []).map(c => ({ id: c.id, icon: "🎖️", text: c.title, at: null as string | null })),
            ...decisions.filter(d => d.validated).slice(0, 3).map(d => ({ id: d.competency_id, icon: "✅", text: `Validated: ${d.name}`, at: d.effective_date })),
          ].slice(0, 5).map(a => (
            <div key={a.id} className="flex items-center gap-2.5 py-1.5 border-b border-gray-50 last:border-0">
              <span className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center text-sm shrink-0">{a.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-gray-800 leading-snug truncate">{a.text}</p>
                {a.at && <p className="text-[9px] text-gray-400">{fmt(a.at)}</p>}
              </div>
            </div>
          ))}
          {!(recognitions ?? []).length && !(credentials ?? []).length && !decisions.some(d => d.validated) && (
            <p className="text-xs text-gray-400 text-center py-6">Awards and validations appear here. 🏅</p>
          )}
        </div>
      </div>

      {/* Skills portfolio + journey + insights */}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5 mb-5">
        <div id="skills" className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-sm">Skills Portfolio</h2>
            <Link href="/dashboard/logbook" className="text-xs text-teal-600 hover:underline">View logbook →</Link>
          </div>
          {skillRows.length ? (
            <>
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 text-[9px] font-bold text-gray-400 uppercase tracking-wider pb-1.5 border-b border-gray-100">
                <span>Skill</span><span>Level</span><span className="text-right">Last</span>
              </div>
              {skillRows.slice(0, 5).map(s => (
                <div key={s.name} className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-center py-1.5 border-b border-gray-50 last:border-0">
                  <span className="text-xs text-gray-800 truncate">{s.name}{s.times > 1 ? <span className="text-gray-400"> ×{s.times}</span> : null}</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: SCORE_COLORS[s.best] ?? "#9ca3af" }}>
                    {SCORE_LABELS[s.best] ?? s.best}
                  </span>
                  <span className="text-[9px] text-gray-400 text-right" suppressHydrationWarning>{fmt(s.last)}</span>
                </div>
              ))}
            </>
          ) : <p className="text-xs text-gray-400 text-center py-6">Skills appear as assessors score them. 🖊️</p>}
        </div>

        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-sm mb-4">Competency Journey</h2>
          <div className="flex items-start justify-between">
            {JOURNEY.map((j, i) => (
              <div key={j.label} className="flex-1 text-center relative">
                {i > 0 && <div className={`absolute top-5 -left-1/2 w-full h-0.5 ${i <= journeyStage ? "bg-teal-400" : "bg-gray-100"}`} />}
                <div className={`relative w-10 h-10 mx-auto rounded-full flex items-center justify-center text-base border-2 ${
                  i < journeyStage ? "bg-teal-50 border-teal-400" : i === journeyStage ? "bg-teal-600 border-teal-600" : "bg-white border-gray-200"}`}>
                  {j.icon}
                </div>
                <p className={`text-[10px] font-semibold mt-1.5 ${i === journeyStage ? "text-teal-700" : "text-gray-600"}`}>{j.label}</p>
                <p className="text-[8px] text-gray-400 leading-tight">{j.sub}</p>
                {i === journeyStage && <p className="text-[8px] font-bold text-teal-600 mt-0.5">You are here</p>}
              </div>
            ))}
          </div>
        </div>

        <div className={`${card} p-5 md:col-span-2 xl:col-span-1`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-sm">Insights</h2>
            <Link href="/dashboard/copilot" className="text-xs text-teal-600 hover:underline">Ask Copilot →</Link>
          </div>
          <div className="flex flex-col gap-2.5">
            {insights.map((n, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-sm mt-0.5">{n.icon}</span>
                <p className={`text-[11px] leading-snug ${n.tone}`}>{n.text}</p>
              </div>
            ))}
          </div>
          <p className="text-[9px] text-gray-300 mt-3">Derived from your record — for AI guidance, ask the Copilot.</p>
        </div>
      </div>

      {/* Trend + quick actions */}
      <div className="grid md:grid-cols-[1fr_auto] gap-5 mb-8 items-stretch">
        <div className={`${card} p-5`}>
          <p className={`${secHead} mb-2.5`}>Quick actions</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {[
              { icon: "📝", label: "Assessments", href: "/dashboard/assessments" },
              { icon: "📚", label: "Learning Pathway", href: "/dashboard/learning" },
              { icon: "🏆", label: "Certificates", href: "/dashboard/certificates" },
              { icon: "📖", label: "Skills Logbook", href: "/dashboard/logbook" },
              { icon: "🖨️", label: "Print / Share", href: "/dashboard/passport/print" },
            ].map(q => (
              <Link key={q.label} href={q.href}
                className="border border-gray-100 hover:border-teal-200 hover:bg-teal-50/40 rounded-lg p-3 text-center transition-colors">
                <p className="text-lg">{q.icon}</p>
                <p className="text-[10px] font-semibold text-gray-700 mt-1 leading-tight">{q.label}</p>
              </Link>
            ))}
          </div>
        </div>
        {trend.length > 1 && (
          <div className={`${card} p-5 md:w-64`}>
            <p className={`${secHead} mb-2`}>Assessment trend</p>
            <svg viewBox="0 0 200 60" className="w-full h-16">
              {(() => {
                const max = trend[trend.length - 1].v;
                const pts = trend.map((t, i) => `${(i / (trend.length - 1)) * 190 + 5},${55 - (t.v / max) * 45}`);
                return (
                  <>
                    <polyline points={pts.join(" ")} fill="none" stroke="#0d9488" strokeWidth="2" strokeLinecap="round" />
                    {pts.map(p => { const [x, y] = p.split(","); return <circle key={p} cx={x} cy={y} r="2.5" fill="#0d9488" />; })}
                  </>
                );
              })()}
            </svg>
            <p className="text-[9px] text-gray-400">Cumulative competencies assessed · {trend[0].m} → {trend[trend.length - 1].m}</p>
          </div>
        )}
      </div>

      {/* ── Governed record (detail sections) ── */}
      {decisions.length > 0 && (
        <div id="decisions" className="mb-6">
          <h2 className={`${secHead} mb-3`}>
            Lifetime Competency Record ({competentCount} competent{dueSoon60 > 0 ? ` · ${dueSoon60} due soon` : ""}) — expired entries stay in your history
          </h2>
          <div className={`${card} overflow-hidden divide-y divide-gray-50`}>
            {decisions.map(d => {
              const oc = OUTCOME_CONFIG[d.outcome];
              const re = reassessmentState(d.expiry_date);
              return (
                <div key={d.competency_id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800">{d.name}</p>
                    <p className="text-[10px] text-gray-400">
                      {d.framework_name} · {d.domain_name}
                      {employerByCompetency.get(d.competency_id) ? <> · 🏥 {employerByCompetency.get(d.competency_id)}</> : null}
                    </p>
                  </div>
                  {d.maturity && <span className="text-[10px] text-gray-500 hidden sm:inline">{MATURITY_LABELS[d.maturity]}</span>}
                  {d.validated && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-semibold">Validated</span>}
                  {d.critical_failure && <span className="text-[10px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-semibold">⚠ Critical</span>}
                  {re && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${re.cls}`}>{re.label}</span>}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${oc?.cls ?? "bg-gray-100 text-gray-600"}`}>{oc?.label ?? d.outcome}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(authorizations ?? []).length > 0 && (
        <div className="mb-6">
          <h2 className={`${secHead} mb-3`}>Clinical Authorizations</h2>
          <div className={`${card} overflow-hidden divide-y divide-gray-50`}>
            {(authorizations ?? []).map(a => {
              const st = AUTH_STATUS_CONFIG[a.status as AuthStatus];
              return (
                <div key={a.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="text-lg">🔑</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800">
                      {AUTH_TYPE_LABELS[a.authorization_type as AuthorizationType] ?? a.authorization_type}
                      <span className="text-gray-400"> · {a.authorization_level}</span>
                    </p>
                    <p className="text-[10px] text-gray-400">
                      {a.scope ?? "—"}{a.conditions ? ` · ${a.conditions}` : ""}
                      {a.expiry_date ? ` · to ${new Date(a.expiry_date).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${st?.cls ?? "bg-gray-100 text-gray-600"}`}>{st?.label ?? a.status}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(credentials ?? []).length > 0 && (
        <div className="mb-6">
          <h2 className={`${secHead} mb-3`}>Professional Credentials</h2>
          <div className={`${card} overflow-hidden divide-y divide-gray-50`}>
            {(credentials ?? []).map(c => {
              const st = CREDENTIAL_STATUS_CONFIG[c.status] ?? CREDENTIAL_STATUS_CONFIG.pending_verification;
              return (
                <div key={c.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="text-lg">🎖️</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800">{c.title}{c.verified && <span className="ml-1.5 text-[10px] text-blue-600">✓ verified</span>}</p>
                    <p className="text-[10px] text-gray-400">
                      {CREDENTIAL_TYPE_LABELS[c.credential_type] ?? c.credential_type}
                      {c.issuing_body ? ` · ${c.issuing_body}` : ""}
                      {c.expiry_date ? ` · expires ${new Date(c.expiry_date).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Full matrix — each framework is a specialty passport (spec §2 Layer 3) */}
      <div id="matrix">
        {byFramework.size > 0 && <h2 className={`${secHead} mb-3`}>Specialty Passports</h2>}
        {byFramework.size > 0 ? (
          <div className="flex flex-col gap-6">
            {[...byFramework.entries()].map(([fwId, fw]) => {
              const byDom = new Map<string, CompEntry[]>();
              for (const c of fw.competencies) {
                if (!byDom.has(c.domain_name)) byDom.set(c.domain_name, []);
                byDom.get(c.domain_name)!.push(c);
              }
              const fwAvg = fw.competencies.reduce((s, c) => s + c.score, 0) / fw.competencies.length;
              const fwPassing = fw.competencies.filter(c => c.is_passing).length;
              return (
                <div key={fwId} className={`${card} overflow-hidden`}>
                  <div className="px-5 py-4 bg-gray-50/50 border-b border-gray-100 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-gray-900">{fw.name}</p>
                      <p className="text-[10px] text-gray-400 capitalize mt-0.5">{fw.library} library</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="text-[10px] text-gray-400">Pass rate</p>
                        <p className="text-sm font-bold text-gray-900">{fwPassing}/{fw.competencies.length}</p>
                      </div>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                        style={{ backgroundColor: SCORE_COLORS[Math.round(fwAvg)] ?? "#9ca3af" }}>
                        {fwAvg.toFixed(1)}
                      </div>
                    </div>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {[...byDom.entries()].map(([domainName, comps]) => (
                      <div key={domainName} className="px-5 py-4">
                        <p className={`${secHead} mb-3`}>{domainName}</p>
                        <div className="flex flex-col gap-2">
                          {comps.map(c => (
                            <div key={c.competency_id} className="flex items-center gap-3">
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                                style={{ backgroundColor: SCORE_COLORS[c.score] ?? "#9ca3af" }}>{c.score}</div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-800">{c.name}</p>
                                <p className="text-[10px] text-gray-400">{c.label} · {new Date(c.assessed_at).toLocaleDateString()}</p>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {c.is_passing && <span className="text-[10px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded font-semibold">✓ Pass</span>}
                                {c.educator_validated && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-semibold">Validated</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={`${card} p-12 text-center`}>
            <p className="text-4xl mb-3">🪪</p>
            <p className="font-semibold text-gray-700">No scores yet</p>
            <p className="text-gray-400 text-sm mt-2">Your passport populates as assessors score you during your active cycle.</p>
          </div>
        )}
      </div>

      {(cycles ?? []).length > 0 && (
        <div className={`mt-6 ${card} p-5`}>
          <p className={`${secHead} mb-3`}>Cycle History</p>
          <div className="flex flex-col gap-2">
            {cycles!.map(c => (
              <div key={c.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-gray-600 capitalize font-medium">{c.cycle_type}</span>
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-400 text-xs">{new Date(c.start_date).toLocaleDateString()}</span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${
                  c.status === "active" ? "bg-green-50 text-green-600" :
                  c.status === "completed" ? "bg-teal-50 text-teal-600" :
                  "bg-gray-100 text-gray-500"
                }`}>{c.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
