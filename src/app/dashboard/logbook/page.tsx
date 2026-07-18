import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import LogbookWorkspace, { type SkillOption, type EntryRow, type ScoredRow } from "./LogbookWorkspace";

// Clinical Skills Logbook (Skills Logbook Redesign spec) — the worker's
// procedural record: self-logged entries awaiting supervisor verification
// (migration 028) alongside assessor-scored skills from competency cycles.
// Miller's Pyramid and domain analytics are computed from real entries only.

export default async function SkillsLogbookPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: cycles }, { data: rawEntries }, { data: skillLib }] = await Promise.all([
    admin.from("competency_cycles").select("id").eq("nurse_id", user.id),
    admin.from("skill_log_entries")
      .select("id, skill_name, performed_at, location, supervision_level, notes, status, verified_by_name, verifier_comment, framework_competencies!competency_id(name, framework_domains(name))")
      .eq("nurse_id", user.id).order("performed_at", { ascending: false }),
    admin.from("competency_skills")
      .select("id, name, is_active, framework_competencies!competency_id(id, name, cpu_id)")
      .eq("is_active", true).order("name").limit(400),
  ]);
  const cycleIds = (cycles ?? []).map(c => c.id);

  const { data: skillScores } = cycleIds.length
    ? await admin.from("skill_scores")
        .select("skill_id, score, assessed_at, competency_skills(name), framework_competencies!competency_id(name), profiles!assessor_id(full_name)")
        .in("cycle_id", cycleIds).order("assessed_at", { ascending: false })
    : { data: [] };

  // Evidence attached to these entries (empty until migration 029 is applied)
  const entryIds = (rawEntries ?? []).map(e => e.id);
  const { data: evidenceRows } = entryIds.length
    ? await admin.from("evidence")
        .select("id, skill_log_entry_id, file_name, mime_type, size_bytes, note, created_at")
        .in("skill_log_entry_id", entryIds).order("created_at")
    : { data: [] };
  const evidenceByEntry = new Map<string, { id: string; file_name: string; mime_type: string; size_bytes: number; note: string | null; created_at: string }[]>();
  for (const ev of (evidenceRows ?? []) as unknown as { id: string; skill_log_entry_id: string; file_name: string; mime_type: string; size_bytes: number; note: string | null; created_at: string }[]) {
    const list = evidenceByEntry.get(ev.skill_log_entry_id) ?? [];
    list.push(ev);
    evidenceByEntry.set(ev.skill_log_entry_id, list);
  }

  // Entries (self-logged; degrades to empty if migration 028 not applied)
  const entries: EntryRow[] = ((rawEntries ?? []) as unknown as {
    id: string; skill_name: string; performed_at: string; location: string | null;
    supervision_level: string; notes: string | null; status: string;
    verified_by_name: string | null; verifier_comment: string | null;
    framework_competencies: { name: string; framework_domains: { name: string } | null } | null;
  }[]).map(e => ({
    id: e.id, skillName: e.skill_name,
    competencyName: e.framework_competencies?.name ?? null,
    domainName: e.framework_competencies?.framework_domains?.name ?? null,
    performedAt: e.performed_at, location: e.location,
    supervision: e.supervision_level, notes: e.notes,
    status: e.status, verifierName: e.verified_by_name, verifierComment: e.verifier_comment,
    evidence: evidenceByEntry.get(e.id) ?? [],
  }));

  // Skill library for the modal
  const skills: SkillOption[] = ((skillLib ?? []) as unknown as {
    id: string; name: string; framework_competencies: { id: string; name: string; cpu_id: string | null } | null;
  }[]).map(s => ({
    id: s.id, name: s.name,
    competencyId: s.framework_competencies?.id ?? null,
    competencyName: s.framework_competencies?.name ?? null,
    cpuId: s.framework_competencies?.cpu_id ?? null,
  }));

  // Latest assessor score per skill (existing governed record)
  const seen = new Set<string>();
  const scored: ScoredRow[] = [];
  for (const s of skillScores ?? []) {
    if (seen.has(s.skill_id)) continue;
    seen.add(s.skill_id);
    scored.push({
      skill: (s.competency_skills as unknown as { name: string } | null)?.name ?? "—",
      competency: (s.framework_competencies as unknown as { name: string } | null)?.name ?? "—",
      score: s.score,
      assessor: (s.profiles as unknown as { full_name: string } | null)?.full_name ?? "—",
      date: s.assessed_at,
    });
  }

  // ── Analytics: Miller distribution + top domains (entries + scorings) ──
  const miller = { p1: 0, p2: 0, p3: 0 };
  for (const e of entries) {
    if (e.supervision === "observed") miller.p1++;
    else if (e.supervision === "independent") miller.p3++;
    else miller.p2++;
  }
  const domainCount = new Map<string, number>();
  for (const e of entries) {
    if (e.domainName) domainCount.set(e.domainName, (domainCount.get(e.domainName) ?? 0) + 1);
  }
  const topDomains = [...domainCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxDomain = topDomains[0]?.[1] ?? 1;

  return (
    <div className="max-w-5xl">
      <LogbookWorkspace skills={skills} entries={entries} scored={scored} />

      {/* Analytics band */}
      <div className="grid md:grid-cols-2 gap-5 mt-5">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Skills by Competency Level</h2>
          <p className="text-[10px] text-gray-400 mb-3">Miller&apos;s Pyramid, from your logged supervision levels.</p>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: "Knows (P1)", sub: "Observed practice", value: miller.p1, cls: "text-gray-500" },
              { label: "Knows How (P2)", sub: "Supervised practice", value: miller.p2, cls: "text-teal-600" },
              { label: "Shows How (P3)", sub: "Independent performance", value: miller.p3, cls: "text-green-600" },
            ].map(m => (
              <div key={m.label} className="bg-gray-50/70 rounded-lg py-3">
                <p className="text-lg">🔺</p>
                <p className={`text-xl font-bold ${m.cls}`}>{m.value}</p>
                <p className="text-[10px] font-semibold text-gray-600">{m.label}</p>
                <p className="text-[9px] text-gray-400">{m.sub}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="font-semibold text-gray-900 text-sm mb-1">Top Skill Domains</h2>
          <p className="text-[10px] text-gray-400 mb-3">Where your logged practice concentrates.</p>
          {topDomains.length ? topDomains.map(([name, n]) => (
            <div key={name} className="flex items-center gap-2.5 py-1">
              <span className="text-[11px] text-gray-700 w-36 truncate">{name}</span>
              <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-teal-500 rounded-full" style={{ width: `${Math.round((n / maxDomain) * 100)}%` }} />
              </div>
              <span className="text-[10px] font-bold text-gray-500 w-5 text-right">{n}</span>
            </div>
          )) : <p className="text-xs text-gray-400 text-center py-4">Log skills to see your domain distribution. 📊</p>}
        </div>
      </div>
    </div>
  );
}
