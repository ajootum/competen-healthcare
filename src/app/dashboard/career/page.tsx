import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OUTCOME_CONFIG, MATURITY_LABELS } from "@/lib/ckcm";
import { LADDER, latestPerCompetency, computeReadiness } from "@/lib/engines/career";

// My Career Growth — the Professional Growth Operating System (Volume 3
// Career Growth spec, Phases 1–2: dashboard + governed promotion rules).
// Readiness, the radar, requirements and peer position are all computed from
// the governed record via the shared career engine. Spec items with no data
// model — promotion probability, growth index, manager confidence, national
// benchmarks, opportunity matching, mentorship — are omitted, not simulated.

function Radar({ axes, overall }: { axes: { label: string; pct: number }[]; overall: number }) {
  const n = axes.length, cx = 110, cy = 95, r = 62;
  const pt = (i: number, scale: number) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(a) * r * scale, cy + Math.sin(a) * r * scale] as const;
  };
  const ring = (s: number) => axes.map((_, i) => pt(i, s).join(",")).join(" ");
  return (
    <svg viewBox="0 0 220 200" className="w-full max-w-[300px] mx-auto">
      {[0.33, 0.66, 1].map(s => <polygon key={s} points={ring(s)} fill="none" stroke="#f3f4f6" strokeWidth="1" />)}
      {axes.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#f3f4f6" strokeWidth="1" />;
      })}
      <polygon points={axes.map((a, i) => pt(i, Math.max(a.pct / 100, 0.05)).join(",")).join(" ")}
        fill="rgba(13,148,136,0.16)" stroke="#0d9488" strokeWidth="1.5" />
      <text x={cx} y={cy - 3} textAnchor="middle" fontSize="17" fontWeight="800" fill="#111827">{overall}%</text>
      <text x={cx} y={cy + 11} textAnchor="middle" fontSize="7.5" fill="#9ca3af">Overall</text>
      {axes.map((a, i) => {
        const [x, y] = pt(i, 1.28);
        return (
          <text key={a.label} x={x} y={y} textAnchor="middle" fontSize="7.5" fill="#6b7280">
            <tspan x={x} dy="0">{a.label}</tspan>
            <tspan x={x} dy="9" fontWeight="700" fill="#374151">{a.pct}%</tspan>
          </text>
        );
      })}
    </svg>
  );
}

export default async function CareerGrowthPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [
    { data: profile }, { data: decisions }, { data: credentials }, { data: recognitions },
    { data: myCycles }, { data: cpdLogs }, { data: employment }, { data: peerDecisions },
  ] = await Promise.all([
    admin.from("profiles").select("full_name, specialization, hospital_id").eq("id", user.id).single(),
    admin.from("competency_decisions")
      .select("competency_id, cpu_id, outcome, maturity, expiry_date, validation_outcome, created_at, framework_competencies(name)")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
    admin.from("professional_credentials").select("verified, status, expiry_date").eq("nurse_id", user.id),
    admin.from("professional_recognitions").select("recognition_type, title, awarded_at").eq("nurse_id", user.id).order("awarded_at", { ascending: false }),
    admin.from("competency_cycles").select("id").eq("nurse_id", user.id),
    admin.from("cpd_logs").select("hours, activity_date").eq("user_id", user.id),
    admin.from("employment_records").select("role_title, start_date, hospitals(name)").eq("nurse_id", user.id).order("start_date", { ascending: false }).limit(1).maybeSingle(),
    admin.from("competency_decisions").select("nurse_id, competency_id, outcome, created_at"),
  ]);
  const cycleIds = (myCycles ?? []).map(c => c.id);

  const [{ data: skillScores }, { data: attempts }] = await Promise.all([
    cycleIds.length
      ? admin.from("skill_scores").select("id, score, assessed_at").in("cycle_id", cycleIds)
      : Promise.resolve({ data: [] }),
    admin.from("knowledge_attempts").select("passed, score, completed_at").eq("nurse_id", user.id),
  ]);

  // ── Readiness (shared engine) ──
  const latest = latestPerCompetency(decisions ?? []);
  const creds = credentials ?? [];
  const { readiness, parts, nextRole } = computeReadiness(latest, creds, recognitions ?? []);
  const total = latest.length;
  const competent = latest.filter(l => OUTCOME_CONFIG[l.outcome]?.passing && !l.expired).length;
  const gaps = total - competent;
  const advanced = latest.filter(l => l.maturity === "proficient" || l.maturity === "expert").length;

  const radarAxes = parts.map(p => ({
    label: p.label.replace("Competency coverage", "Competency").replace("Educator validation", "Validation")
      .replace("Advanced practice", "Advanced").replace("Credentials current", "Credentials")
      .replace("Recognition & mentorship", "Recognition"),
    pct: Math.round(p.value * 100),
  }));

  // ── Peer position by competency coverage (real, org-wide) ──
  const peerSeen = new Map<string, Set<string>>();
  const peerPass = new Map<string, number>();
  for (const d of peerDecisions ?? []) {
    const s = peerSeen.get(d.nurse_id) ?? new Set<string>();
    if (s.has(d.competency_id)) continue;
    s.add(d.competency_id);
    peerSeen.set(d.nurse_id, s);
    if (OUTCOME_CONFIG[d.outcome as keyof typeof OUTCOME_CONFIG]?.passing) {
      peerPass.set(d.nurse_id, (peerPass.get(d.nurse_id) ?? 0) + 1);
    }
  }
  const myCoverage = total ? competent / total : 0;
  const peers = [...peerSeen.entries()].filter(([id]) => id !== user.id)
    .map(([id, s]) => (peerPass.get(id) ?? 0) / s.size);
  const peersBehind = peers.filter(p => p < myCoverage).length;

  // ── Promotion requirements checklist (governed readiness parts) ──
  const requirements = parts.map(p => ({
    label: p.label, detail: p.detail,
    state: p.value >= 1 ? "done" : p.value > 0 ? "partial" : "open",
  }));
  const reqDone = requirements.filter(r => r.state === "done").length;

  // ── Monthly analytics (real series) ──
  const monthOf = (iso: string) => iso.slice(0, 7);
  const series = (rows: { at: string | null }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.at) m.set(monthOf(r.at), (m.get(monthOf(r.at)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const compGrowth = series((decisions ?? []).filter(d => OUTCOME_CONFIG[d.outcome as keyof typeof OUTCOME_CONFIG]?.passing).map(d => ({ at: d.created_at })));
  const testsPassed = series((attempts ?? []).filter(a => a.passed).map(a => ({ at: a.completed_at })));
  const cpdMonthly = (() => {
    const m = new Map<string, number>();
    for (const l of cpdLogs ?? []) if (l.activity_date) m.set(monthOf(l.activity_date), (m.get(monthOf(l.activity_date)) ?? 0) + Number(l.hours));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();

  const ANALYTICS = [
    { title: "Competencies achieved", data: compGrowth, unit: "per month" },
    { title: "Knowledge tests passed", data: testsPassed, unit: "per month" },
    { title: "CPD hours", data: cpdMonthly, unit: "per month" },
  ];

  const currentEmployer = (employment?.hospitals as unknown as { name: string } | null)?.name ?? null;
  const memberSince = employment?.start_date ?? null;
  const card = "bg-white rounded-xl border border-gray-100";
  const secHead = "font-semibold text-gray-900 text-sm";

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">My Career Growth</h1>
          <p className="text-gray-400 text-sm mt-0.5">Your professional journey. Our support. Your future.</p>
        </div>
        <Link href="/dashboard/copilot"
          className="text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg">
          ✨ AI Career Coach
        </Link>
      </div>

      {/* Hero (spec §1) */}
      <div className="bg-[#0a2e38] rounded-2xl p-6 mb-5 text-white">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <p className="text-[10px] font-bold text-teal-300/60 uppercase tracking-widest">Overall readiness</p>
            <p className="text-4xl font-extrabold text-teal-300 mt-1">{readiness}%</p>
            <p className="text-[11px] text-teal-100/60">ready for the next level</p>
            <div className="flex gap-1 mt-2.5">
              {Array.from({ length: 10 }).map((_, i) => (
                <span key={i} className={`h-2 w-4 rounded-sm ${i < Math.round(readiness / 10) ? "bg-teal-400" : "bg-white/10"}`} />
              ))}
            </div>
            {peers.length > 0 && total > 0 && (
              <p className="text-[10px] text-teal-200/70 mt-2.5 bg-white/5 rounded-lg px-2.5 py-1.5 inline-block">
                📈 Ahead of {peersBehind} of {peers.length} assessed peer{peers.length === 1 ? "" : "s"} on competency coverage
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] font-bold text-teal-300/60 uppercase tracking-widest">Next step</p>
            <p className="text-xl font-bold mt-1">{nextRole}</p>
            <p className="text-[10px] font-bold text-teal-300/60 uppercase tracking-widest mt-4">Requirements met</p>
            <p className="text-sm font-semibold">{reqDone} of {requirements.length} readiness pillars</p>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden mt-1.5 max-w-[180px]">
              <div className="h-full bg-teal-400 rounded-full" style={{ width: `${Math.max((reqDone / requirements.length) * 100, 3)}%` }} />
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold text-teal-300/60 uppercase tracking-widest">Current level</p>
            <p className="text-sm font-semibold mt-1">🩺 {LADDER[0].role}</p>
            {profile?.specialization && <p className="text-[10px] text-teal-100/60">{profile.specialization}</p>}
            <p className="text-[10px] font-bold text-teal-300/60 uppercase tracking-widest mt-4">Target role</p>
            <p className="text-sm font-semibold">🧭 {nextRole}</p>
            {currentEmployer && <p className="text-[10px] text-teal-100/60 mt-1">at {currentEmployer}</p>}
          </div>
          <div className="bg-white/5 rounded-xl p-4">
            <p className="text-[10px] font-bold text-violet-300/80 uppercase tracking-widest">Career insight</p>
            <p className="text-[12px] text-teal-50/90 leading-relaxed mt-1.5">
              {total === 0
                ? "Your growth engine starts with your first assessed cycle — everything here is computed from your governed record."
                : gaps === 0
                ? `Strong position, ${profile?.full_name?.split(" ")[0] ?? "there"} — your record is fully current. Speak to your manager about the ${nextRole} pathway.`
                : `Closing your ${gaps} open gap${gaps === 1 ? "" : "s"} is the fastest path towards ${nextRole}.`}
            </p>
            <Link href="/dashboard/copilot" className="inline-block mt-2.5 text-[11px] font-semibold text-violet-300 hover:underline">
              Ask the Coach →
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_290px] gap-5">
        {/* Main column */}
        <div className="min-w-0 flex flex-col gap-5">
          <div className="grid md:grid-cols-2 gap-5">
            {/* Radar (spec §2 — the five governed readiness pillars) */}
            <div className={`${card} p-5`}>
              <h2 className={`${secHead} mb-1`}>Career Readiness Radar</h2>
              <p className="text-[10px] text-gray-400 mb-2">The five governed readiness pillars, from your record.</p>
              <Radar axes={radarAxes} overall={readiness} />
            </div>

            {/* Promotion requirements (spec §3) */}
            <div className={`${card} p-5`}>
              <div className="flex items-center justify-between mb-1">
                <h2 className={secHead}>Promotion Requirements</h2>
                <span className="text-[10px] text-gray-400">{reqDone} / {requirements.length} complete</span>
              </div>
              <p className="text-[10px] text-gray-400 mb-3">Become <b>{nextRole}</b></p>
              <div className="flex flex-col gap-2.5">
                {requirements.map(r => (
                  <div key={r.label} className="flex items-start gap-2.5">
                    <span className={`text-sm mt-0.5 ${r.state === "done" ? "text-green-500" : r.state === "partial" ? "text-amber-500" : "text-gray-300"}`}>
                      {r.state === "done" ? "✅" : r.state === "partial" ? "🕗" : "○"}
                    </span>
                    <div>
                      <p className="text-xs font-medium text-gray-800">{r.label}</p>
                      <p className="text-[10px] text-gray-400">{r.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Career timeline (spec §4) */}
          <div className={`${card} p-5`}>
            <h2 className={`${secHead} mb-3`}>Career Timeline</h2>
            <div className="flex flex-col">
              {LADDER.map((step, i) => (
                <div key={step.role} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                      i === 0 ? "bg-teal-600 text-white" : i === 1 ? "bg-teal-50 border-2 border-teal-400 text-teal-700" : "bg-gray-100 text-gray-400"}`}>
                      {i === 0 ? "✓" : i + 1}
                    </span>
                    {i < LADDER.length - 1 && <span className="w-0.5 flex-1 bg-gray-100 my-0.5" />}
                  </div>
                  <div className={`pb-4 ${i > 1 ? "opacity-60" : ""}`}>
                    <p className="text-sm font-medium text-gray-800">{step.icon} {step.role}
                      {i === 0 && <span className="ml-2 text-[9px] font-bold bg-teal-600 text-white px-1.5 py-0.5 rounded">Current</span>}
                      {i === 1 && <span className="ml-2 text-[9px] font-bold bg-teal-50 text-teal-700 border border-teal-200 px-1.5 py-0.5 rounded">Next goal · {readiness}% ready</span>}
                    </p>
                    <p className="text-[10px] text-gray-400" suppressHydrationWarning>
                      {i === 0
                        ? `${currentEmployer ? `${currentEmployer} · ` : ""}${memberSince ? `since ${new Date(memberSince).toLocaleDateString(undefined, { month: "short", year: "numeric" })}` : "current role"}`
                        : i === 1 ? "Unlocked by completing the readiness pillars above" : "Long-term pathway"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Growth analytics (spec §8 — the series the record supports) */}
          <div className={`${card} p-5`}>
            <h2 className={`${secHead} mb-3`}>Growth Analytics</h2>
            <div className="grid sm:grid-cols-3 gap-5">
              {ANALYTICS.map(a => (
                <div key={a.title}>
                  <p className="text-[10px] font-semibold text-gray-600 mb-1.5">{a.title}</p>
                  {a.data.length ? (
                    <>
                      <div className="flex items-end gap-1 h-16">
                        {a.data.slice(-6).map(([m, v]) => {
                          const max = Math.max(...a.data.map(d => d[1]));
                          return (
                            <div key={m} className="flex-1 flex flex-col items-center gap-0.5">
                              <span className="text-[8px] text-gray-500 font-bold">{v}</span>
                              <div className="w-full bg-teal-500 rounded-t" style={{ height: `${Math.max((v / max) * 44, 3)}px` }} />
                              <span className="text-[7px] text-gray-400">{m.slice(5)}</span>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[8px] text-gray-400 mt-1">{a.unit}</p>
                    </>
                  ) : <p className="text-[10px] text-gray-300 py-4">No data yet.</p>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-5">
          {/* Portfolio summary (spec §6) */}
          <div className={`${card} p-5`}>
            <div className="flex items-center gap-3 mb-3">
              <span className="w-10 h-10 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-bold">
                {profile?.full_name?.[0] ?? "?"}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{profile?.full_name}</p>
                <p className="text-[10px] text-gray-400">{LADDER[0].role}{currentEmployer ? ` · ${currentEmployer}` : ""}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              {[
                [(skillScores ?? []).length, "Skills scored"],
                [competent, "Competencies"],
                [creds.length + (recognitions ?? []).length, "Certificates"],
                [(cpdLogs ?? []).reduce((s, l) => s + Number(l.hours), 0) || "—", "CPD hours"],
              ].map(([v, l]) => (
                <div key={l as string} className="bg-gray-50/70 rounded-lg py-2">
                  <p className="text-base font-bold text-gray-900">{v}</p>
                  <p className="text-[9px] text-gray-400">{l}</p>
                </div>
              ))}
            </div>
            <Link href="/dashboard/passport"
              className="block text-center mt-3 text-xs font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 py-2 rounded-lg">
              View Full Passport →
            </Link>
          </div>

          {/* Strengths & focus */}
          <div className={`${card} p-5`}>
            <h2 className={`${secHead} mb-3`}>Strengths &amp; Focus Areas</h2>
            {total === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">Appears with your first assessed cycle. 🌱</p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center text-sm shrink-0">💪</span>
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Top strength</p>
                    <p className="text-xs text-gray-800">
                      {advanced > 0
                        ? `${advanced} competenc${advanced === 1 ? "y" : "ies"} at Proficient/Expert maturity`
                        : competent > 0 ? `${competent} current competenc${competent === 1 ? "y" : "ies"}` : "Building your record"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-sm shrink-0">🎯</span>
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Focus area</p>
                    <p className="text-xs text-gray-800">
                      {gaps > 0 ? `${gaps} open competency gap${gaps === 1 ? "" : "s"} — your pathway targets them` : "No open gaps — maintain currency"}
                    </p>
                  </div>
                </div>
                <Link href="/dashboard/learning" className="text-center text-xs font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 py-2 rounded-lg">
                  View Development Plan
                </Link>
              </div>
            )}
          </div>

          {/* Recent achievements (spec §9) */}
          <div className={`${card} p-5`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className={secHead}>Recent Achievements</h2>
              <Link href="/dashboard/certificates" className="text-xs text-teal-600 hover:underline">View all</Link>
            </div>
            {(recognitions ?? []).length ? (
              <div className="flex flex-wrap gap-3">
                {(recognitions ?? []).slice(0, 4).map((r, i) => (
                  <div key={i} className="text-center w-[72px]">
                    <span className="inline-flex w-12 h-12 rounded-full bg-amber-50 border border-amber-100 items-center justify-center text-xl">🏅</span>
                    <p className="text-[9px] font-semibold text-gray-700 leading-tight mt-1">{r.title}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-gray-400 text-center py-3">Awards appear here as they are earned. 🏅</p>}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mt-6">
        Maturity levels follow the Benner model: {Object.values(MATURITY_LABELS).join(" → ")}. Every figure on this page derives from your governed record.
      </p>
    </div>
  );
}
