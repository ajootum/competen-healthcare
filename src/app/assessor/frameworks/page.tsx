import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";

// Assessment Frameworks (Competency Frameworks Assessment View spec): the
// assessor's READ-ONLY operational view of approved frameworks — per-framework
// learner counts, completion, domain progress, gaps and decision trends, all
// computed from live decisions. Authoring stays in the admin/educator studio.
// Blueprints, evidence rules, decision rules and performance standards have no
// assessor-facing stores yet and appear as explicit "soon" tabs.

const DOMAIN_ICONS = ["🫁", "💨", "❤️", "🧠", "💊", "🩹", "🍼", "📋", "🩺", "📝"];

export default async function AssessmentFrameworksPage({ searchParams }: { searchParams: Promise<{ fw?: string }> }) {
  const { fw } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, hospital_id").eq("id", user.id).single();
  if (!profile || !["assessor", "educator", "hospital_admin"].includes(profile.role)) redirect("/dashboard");

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(); in30.setDate(in30.getDate() + 30);
  const in30Key = in30.toISOString().slice(0, 10);

  const [{ data: frameworks }, { data: domains }, { data: nurses }, { count: logbookPending }] = await Promise.all([
    admin.from("frameworks")
      .select("id, name, description, library, is_active, version_major, version_minor, version_revision, created_at")
      .eq("is_active", true).order("sort_order"),
    admin.from("framework_domains").select("id, name, framework_id, framework_competencies(id)"),
    admin.from("profiles").select("id, full_name").eq("hospital_id", profile.hospital_id ?? "").eq("role", "nurse").limit(200),
    admin.from("skill_log_entries").select("id", { count: "exact", head: true })
      .eq("status", "pending").neq("nurse_id", user.id),
  ]);

  const nurseIds = (nurses ?? []).map(n => n.id);
  const nameById = new Map((nurses ?? []).map(n => [n.id, n.full_name as string]));

  const { data: decisions } = nurseIds.length
    ? await admin.from("competency_decisions")
        .select("nurse_id, competency_id, framework_id, outcome, expiry_date, created_at, framework_competencies(name, domain_id)")
        .in("nurse_id", nurseIds).order("created_at", { ascending: false })
    : { data: [] };

  // Latest decision per nurse+competency
  type Dec = {
    nurse_id: string; competency_id: string; framework_id: string | null; outcome: string;
    expiry_date: string | null; created_at: string;
    framework_competencies: { name: string; domain_id: string } | null;
  };
  const seen = new Set<string>();
  const latest: Dec[] = [];
  for (const d of (decisions ?? []) as unknown as Dec[]) {
    const key = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(d);
  }
  const isPassing = (o: string) => OUTCOME_CONFIG[o as DecisionOutcome]?.passing ?? false;

  // Per-framework aggregates
  type FwAgg = { learners: Set<string>; decided: number; passing: number; expiring: number; expired: number };
  const fwAgg = new Map<string, FwAgg>();
  for (const d of latest) {
    if (!d.framework_id) continue;
    const a = fwAgg.get(d.framework_id) ?? { learners: new Set(), decided: 0, passing: 0, expiring: 0, expired: 0 };
    a.learners.add(d.nurse_id);
    a.decided++;
    if (isPassing(d.outcome)) {
      if (d.expiry_date && d.expiry_date < today) a.expired++;
      else {
        a.passing++;
        if (d.expiry_date && d.expiry_date <= in30Key) a.expiring++;
      }
    }
    fwAgg.set(d.framework_id, a);
  }

  const compCountByFw = new Map<string, number>();
  const domainsByFw = new Map<string, { id: string; name: string; comps: number }[]>();
  for (const d of (domains ?? []) as unknown as { id: string; name: string; framework_id: string; framework_competencies: { id: string }[] }[]) {
    compCountByFw.set(d.framework_id, (compCountByFw.get(d.framework_id) ?? 0) + (d.framework_competencies?.length ?? 0));
    const list = domainsByFw.get(d.framework_id) ?? [];
    list.push({ id: d.id, name: d.name, comps: d.framework_competencies?.length ?? 0 });
    domainsByFw.set(d.framework_id, list);
  }

  const rows = (frameworks ?? []).map(f => {
    const a = fwAgg.get(f.id);
    return {
      id: f.id, name: f.name, description: f.description as string | null,
      library: (f.library as string | null) ?? "core",
      version: `v${f.version_major ?? 1}.${f.version_minor ?? 0}${f.version_revision ? `.${f.version_revision}` : ""}`,
      learners: a?.learners.size ?? 0,
      competencies: compCountByFw.get(f.id) ?? 0,
      decided: a?.decided ?? 0,
      passing: a?.passing ?? 0,
      completion: a?.decided ? Math.round((a.passing / a.decided) * 100) : null,
    };
  }).sort((x, y) => y.decided - x.decided);

  const selected = rows.find(r => r.id === fw) ?? rows.find(r => r.decided > 0) ?? rows[0] ?? null;
  const selAgg = selected ? fwAgg.get(selected.id) : undefined;
  const selDecisions = selected ? latest.filter(d => d.framework_id === selected.id) : [];

  // Domain overview for the selected framework
  const domainRows = selected ? (domainsByFw.get(selected.id) ?? []).map((d, i) => {
    const decs = selDecisions.filter(x => x.framework_competencies?.domain_id === d.id);
    const pass = decs.filter(x => isPassing(x.outcome) && !(x.expiry_date && x.expiry_date < today)).length;
    const due = decs.filter(x => isPassing(x.outcome) && x.expiry_date && x.expiry_date >= today && x.expiry_date <= in30Key).length
      + decs.filter(x => !isPassing(x.outcome)).length;
    return {
      ...d, icon: DOMAIN_ICONS[i % DOMAIN_ICONS.length],
      assessed: decs.length, pct: decs.length ? Math.round((pass / decs.length) * 100) : null, due,
    };
  }).filter(d => d.comps > 0) : [];

  // Analytics for the selected framework
  const gaps = new Map<string, number>();
  for (const d of selDecisions) {
    if (!isPassing(d.outcome)) {
      const n = d.framework_competencies?.name ?? "Competency";
      gaps.set(n, (gaps.get(n) ?? 0) + 1);
    }
  }
  const topGaps = [...gaps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const gapMax = Math.max(1, ...topGaps.map(([, n]) => n));

  const months: { key: string; label: string; n: number }[] = [];
  const mBase = new Date(); mBase.setDate(1);
  for (let i = 4; i >= 0; i--) {
    const m = new Date(mBase); m.setMonth(m.getMonth() - i);
    months.push({ key: m.toISOString().slice(0, 7), label: m.toLocaleDateString(undefined, { month: "short" }), n: 0 });
  }
  for (const d of (decisions ?? []) as unknown as Dec[]) {
    if (d.framework_id !== selected?.id) continue;
    const mm = months.find(x => x.key === d.created_at.slice(0, 7));
    if (mm) mm.n++;
  }
  const monthMax = Math.max(1, ...months.map(m => m.n));

  // Recent decisions on the selected framework
  const recent = selDecisions.slice(0, 3);

  const totalExpiring = [...fwAgg.values()].reduce((s, a) => s + a.expiring, 0);
  const totalReassess = [...fwAgg.values()].reduce((s, a) => s + a.expired, 0);
  const activeLearners = new Set(latest.map(d => d.nurse_id)).size;

  const KPIS = [
    { icon: "🗂️", value: rows.length, label: "Active Frameworks", sub: "approved for assessment", tint: "bg-indigo-50" },
    { icon: "👥", value: activeLearners, label: "Active Learners", sub: "with recorded decisions", tint: "bg-blue-50" },
    { icon: "⏳", value: totalExpiring, label: "Competencies Due", sub: "expiring within 30 days", tint: "bg-amber-50" },
    { icon: "🖊️", value: logbookPending ?? 0, label: "Evidence Awaiting", sub: "validate evidence", tint: "bg-green-50" },
    { icon: "🔁", value: totalReassess, label: "Reassessments Due", sub: "expired competencies", tint: "bg-red-50" },
  ];

  const TABS = ["My Competencies", "Assessment Blueprints", "Evidence Requirements", "Decision Rules", "Performance Standards"];

  return (
    <div className="max-w-[1400px]">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Assessment Frameworks</h1>
          <p className="text-gray-400 text-sm mt-0.5">Manage and assess competencies using approved frameworks — read-only for assessors.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/library" className="text-xs font-semibold text-gray-600 border border-gray-200 bg-white hover:border-indigo-300 px-3 py-2 rounded-lg transition-colors">
            📚 Framework Library
          </Link>
          <Link href="/assessor/schedule" className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors">
            📅 View My Schedule
          </Link>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-5">
        {KPIS.map(k => (
          <div key={k.label} className="bg-white border border-gray-100 rounded-2xl p-4">
            <span className={`w-9 h-9 rounded-xl ${k.tint} flex items-center justify-center text-lg`}>{k.icon}</span>
            <p className="text-2xl font-extrabold text-gray-900 mt-2 leading-none">{k.value}</p>
            <p className="text-[11px] font-semibold text-gray-700 mt-1 leading-tight">{k.label}</p>
            <p className="text-[10px] text-gray-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-3 mb-4 border-b border-gray-100 pb-2">
        <span className="text-xs font-bold text-indigo-700 border-b-2 border-indigo-600 pb-1.5 -mb-2.5">Assigned Frameworks</span>
        {TABS.map(t => (
          <span key={t} className="text-xs text-gray-300 cursor-default" title="This module has no assessor-facing store yet">
            {t} <span className="text-[8px] font-bold uppercase bg-gray-100 text-gray-400 rounded px-1 py-0.5">soon</span>
          </span>
        ))}
        <Link href="/assessor/history" className="text-xs font-semibold text-gray-400 hover:text-indigo-700 pb-0.5">History</Link>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
        <div className="min-w-0 flex flex-col gap-5">
          {/* Frameworks table */}
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            {rows.length === 0 ? (
              <p className="px-5 py-12 text-center text-xs text-gray-400">No active frameworks published yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px]">
                  <thead>
                    <tr className="text-[9px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100">
                      <th className="text-left px-4 py-2.5">Framework</th>
                      <th className="text-left px-2 py-2.5">Library</th>
                      <th className="text-left px-2 py-2.5">Version</th>
                      <th className="text-left px-2 py-2.5">Learners</th>
                      <th className="text-left px-2 py-2.5">Competencies</th>
                      <th className="text-left px-2 py-2.5 w-32">Completion</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map(r => (
                      <tr key={r.id} className={r.id === selected?.id ? "bg-indigo-50/40" : "hover:bg-gray-50/60 transition-colors"}>
                        <td className="px-4 py-3">
                          <p className="text-sm font-semibold text-gray-900">{r.name}</p>
                          {r.description && <p className="text-[10px] text-gray-400 truncate max-w-[260px]">{r.description}</p>}
                        </td>
                        <td className="px-2 py-3">
                          <span className="text-[9px] font-bold bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded capitalize">{r.library}</span>
                        </td>
                        <td className="px-2 py-3 text-xs text-gray-600">{r.version}</td>
                        <td className="px-2 py-3 text-xs font-semibold text-gray-800">{r.learners}</td>
                        <td className="px-2 py-3 text-xs text-gray-600">{r.competencies}</td>
                        <td className="px-2 py-3">
                          {r.completion !== null ? (
                            <>
                              <div className="flex items-center justify-between text-[10px] mb-0.5">
                                <span className="font-bold text-gray-700">{r.completion}%</span>
                                <span className="text-gray-300">{r.passing}/{r.decided}</span>
                              </div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${r.completion >= 75 ? "bg-green-500" : r.completion >= 50 ? "bg-amber-400" : "bg-red-400"}`}
                                  style={{ width: `${r.completion}%` }} />
                              </div>
                            </>
                          ) : <p className="text-[10px] text-gray-300">no decisions yet</p>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/assessor/frameworks?fw=${r.id}`}
                            className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                              r.id === selected?.id ? "bg-indigo-600 text-white" : "text-indigo-700 border border-indigo-200 hover:bg-indigo-50"
                            }`}>
                            {r.id === selected?.id ? "Open" : "View"}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Domain overview */}
          {selected && domainRows.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-0.5">Framework Domain Overview</h2>
              <p className="text-[10px] text-gray-400 mb-4">Domains in {selected.name} — completion from latest decisions</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {domainRows.slice(0, 10).map(d => (
                  <div key={d.id} className="border border-gray-100 rounded-xl p-3">
                    <p className="text-lg mb-1">{d.icon}</p>
                    <p className="text-[11px] font-semibold text-gray-800 leading-tight">{d.name}</p>
                    <p className="text-[9px] text-gray-400 mb-1.5">{d.comps} competenc{d.comps === 1 ? "y" : "ies"}</p>
                    {d.pct !== null ? (
                      <>
                        <div className="flex items-center justify-between text-[10px] mb-0.5">
                          <span className="font-bold text-gray-700">{d.pct}%</span>
                          {d.due > 0 && <span className="text-red-500 font-semibold">{d.due} due</span>}
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${d.pct >= 75 ? "bg-green-500" : d.pct >= 50 ? "bg-amber-400" : "bg-red-400"}`}
                            style={{ width: `${d.pct}%` }} />
                        </div>
                        <p className="text-[9px] text-gray-400 mt-0.5">{d.assessed} assessed</p>
                      </>
                    ) : <p className="text-[9px] text-gray-300">not assessed yet</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Framework analytics */}
          {selected && (
            <div className="bg-white border border-gray-100 rounded-2xl p-5">
              <h2 className="text-sm font-bold text-gray-900 mb-4">
                Framework Analytics <span className="text-gray-300 font-normal">({selected.name})</span>
              </h2>
              {selected.decided === 0 ? (
                <p className="text-xs text-gray-400">No decisions recorded on this framework yet.</p>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Pass Rate</p>
                    <p className="text-2xl font-extrabold text-green-600 leading-none">{selected.completion}%</p>
                    <p className="text-[9px] text-gray-400 mt-1">of latest decisions</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Competencies Passed</p>
                    <p className="text-2xl font-extrabold text-gray-900 leading-none">{selected.passing} <span className="text-sm text-gray-400 font-semibold">of {selected.decided}</span></p>
                    <p className="text-[9px] text-gray-400 mt-1">across {selected.learners} learner{selected.learners === 1 ? "" : "s"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Most Common Gaps</p>
                    {topGaps.length === 0 ? <p className="text-[10px] text-gray-400">No gaps recorded 🎉</p> : (
                      <div className="flex flex-col gap-1">
                        {topGaps.map(([name, n]) => (
                          <div key={name} className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-600 truncate flex-1">{name}</span>
                            <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden shrink-0">
                              <div className="h-full bg-red-400 rounded-full" style={{ width: `${(n / gapMax) * 100}%` }} />
                            </div>
                            <span className="text-[10px] font-bold text-red-500 shrink-0">{n}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Decision Trend</p>
                    <div className="flex items-end gap-1 h-14">
                      {months.map(m => (
                        <div key={m.key} className="flex-1 flex flex-col items-center gap-0.5">
                          <div className="w-full bg-indigo-400 rounded-t" style={{ height: `${(m.n / monthMax) * 100}%`, minHeight: m.n ? 3 : 1 }} />
                          <span className="text-[8px] text-gray-400">{m.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="text-[10px] text-gray-300">
            Frameworks are read-only here — authoring lives in the admin studio. Blueprints, evidence rules,
            decision rules and performance standards aren&apos;t exposed to assessors yet.
          </p>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4">
          {selected && (
            <div className="bg-white border border-gray-100 rounded-2xl p-4">
              <p className="text-sm font-bold text-gray-900 leading-snug">{selected.name}</p>
              <p className="text-[10px] text-green-600 font-semibold mb-3">{selected.version} · Active</p>
              <div className="relative w-24 mx-auto mb-2">
                <svg viewBox="0 0 100 100" className="w-full -rotate-90">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="#f3f4f6" strokeWidth="12" />
                  {selected.decided > 0 && (
                    <circle cx="50" cy="50" r="40" fill="none" stroke="#10b981" strokeWidth="12"
                      strokeDasharray={`${((selected.completion ?? 0) / 100) * 2 * Math.PI * 40} ${2 * Math.PI * 40}`} />
                  )}
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-sm font-extrabold text-gray-900">{selected.completion !== null ? `${selected.completion}%` : "—"}</p>
                </div>
              </div>
              <p className="text-center text-[10px] text-gray-400 mb-3">
                {selected.passing} of {selected.decided} decided competencies passing
              </p>
              <div className="flex flex-col gap-1.5 text-[11px] border-t border-gray-50 pt-3">
                <div className="flex justify-between"><span className="text-gray-400">👥 Learners</span><span className="font-semibold text-gray-700">{selected.learners}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">🛡️ Competencies</span><span className="font-semibold text-gray-700">{selected.competencies}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">⏳ Expiring 30d</span><span className="font-semibold text-gray-700">{selAgg?.expiring ?? 0}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">🔁 Reassessments due</span><span className="font-semibold text-gray-700">{selAgg?.expired ?? 0}</span></div>
              </div>
            </div>
          )}

          {/* Quick links — all real destinations */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-gray-800 mb-2.5">Quick Links</h2>
            <div className="flex flex-col gap-1">
              {[
                { label: "✨ AI Co-pilot for Assessors", href: "/dashboard/copilot" },
                { label: "🖊️ Evidence Validation", href: "/assessor/logbook" },
                { label: "📁 Assessment History", href: "/assessor/history" },
                { label: "🩺 OSCE Sessions", href: "/assessor/osce" },
                { label: "❓ Question Bank", href: "/dashboard/questions" },
                { label: "🧪 Simulation Library", href: "/dashboard/simulation" },
              ].map(l => (
                <Link key={l.href} href={l.href} className="text-[11px] text-gray-600 hover:text-indigo-700 py-0.5 transition-colors">
                  {l.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Recent decisions on this framework */}
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <h2 className="text-xs font-bold text-gray-800 mb-2.5">Recent Activity</h2>
            {recent.length === 0 ? (
              <p className="text-[10px] text-gray-400">Decisions on this framework appear here.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {recent.map((d, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${isPassing(d.outcome) ? "bg-green-400" : "bg-red-400"}`} />
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-700 leading-snug">
                        <b>{nameById.get(d.nurse_id) ?? "—"}</b> — {d.framework_competencies?.name ?? "Competency"}
                        <span className={isPassing(d.outcome) ? "text-green-600" : "text-red-500"}> · {d.outcome.replace(/_/g, " ")}</span>
                      </p>
                      <p className="text-[9px] text-gray-300" suppressHydrationWarning>
                        {new Date(d.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
