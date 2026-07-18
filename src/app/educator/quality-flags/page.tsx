import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import AskAi from "@/app/assessor/ai/AskAi";
import { EduHeader } from "../ui";

// Quality Flags — rule-derived quality assurance over live records: possible
// duplicate evidence, verified-without-files, stale queues, scoring
// inconsistency, expired competencies and critical failures. Every flag names
// its rule; the AI narrative is grounded in the same figures.

export const dynamic = "force-dynamic";

export default async function QualityFlagsPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const now = new Date().getTime();
  const d30 = new Date(now - 30 * 86400000).toISOString();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: entriesRaw }, { data: evidenceRows }, { data: assessRaw }, { data: nurses }] = await Promise.all([
    admin.from("skill_log_entries")
      .select("id, nurse_id, skill_name, status, created_at, verified_at, profiles!nurse_id(full_name, hospital_id)")
      .gte("created_at", d30).limit(1000),
    admin.from("evidence").select("skill_log_entry_id").not("skill_log_entry_id", "is", null).limit(2000),
    admin.from("assessments")
      .select("score, competency_id, competency_cycles!cycle_id(hospital_id, nurse_id, profiles!nurse_id(full_name)), framework_competencies!competency_id(name)")
      .eq("status", "complete").not("score", "is", null).gte("assessed_at", d30).limit(2000),
    hospitalId ? admin.from("profiles").select("id, full_name").eq("hospital_id", hospitalId).eq("role", "nurse") : Promise.resolve({ data: [] }),
  ]);

  const nurseIds = new Set((nurses ?? []).map(n => n.id));
  const entries = (entriesRaw ?? []).filter(e =>
    !hospitalId || (e.profiles as unknown as { hospital_id: string | null } | null)?.hospital_id === hospitalId);
  const withFiles = new Set((evidenceRows ?? []).map(e => e.skill_log_entry_id));

  type Flag = { icon: string; severity: "high" | "medium" | "low"; text: string; href: string };
  const flags: Flag[] = [];

  // 1. Possible duplicate evidence: same nurse + same skill name verified ≥2× in 30d.
  const dupKey = new Map<string, number>();
  for (const e of entries.filter(e => e.status === "verified")) {
    const k = `${e.nurse_id}:${e.skill_name.trim().toLowerCase()}`;
    dupKey.set(k, (dupKey.get(k) ?? 0) + 1);
  }
  for (const [k, n] of dupKey) {
    if (n < 2) continue;
    const e = entries.find(x => `${x.nurse_id}:${x.skill_name.trim().toLowerCase()}` === k);
    flags.push({ icon: "🔁", severity: "medium", href: "/educator/evidence", text: `Possible duplicate evidence: ${(e?.profiles as unknown as { full_name: string } | null)?.full_name ?? "learner"} — “${e?.skill_name}” verified ${n}× in 30 days.` });
  }

  // 2. Verified without attached files.
  const noFiles = entries.filter(e => e.status === "verified" && !withFiles.has(e.id));
  if (noFiles.length) flags.push({ icon: "🖇️", severity: "medium", href: "/educator/evidence", text: `${noFiles.length} entr${noFiles.length === 1 ? "y" : "ies"} verified without attached files in 30 days — notes-only evidence.` });

  // 3. Stale pending queue.
  const stale = entries.filter(e => e.status === "pending" && new Date(e.created_at).getTime() < now - 7 * 86400000);
  if (stale.length) flags.push({ icon: "⏳", severity: "high", href: "/educator/evidence", text: `${stale.length} pending entr${stale.length === 1 ? "y" : "ies"} older than 7 days — review queue is aging.` });

  // 4. Inconsistent scoring: same nurse+competency spread ≥3 across assessments (30d).
  const spreadMap = new Map<string, { min: number; max: number; nurse: string; comp: string }>();
  for (const a of assessRaw ?? []) {
    const c = a.competency_cycles as unknown as { hospital_id: string | null; nurse_id: string; profiles: { full_name: string } | null } | null;
    if (!c || (hospitalId && c.hospital_id !== hospitalId) || !a.competency_id) continue;
    const k = `${c.nurse_id}:${a.competency_id}`;
    const cur = spreadMap.get(k) ?? { min: a.score as number, max: a.score as number, nurse: c.profiles?.full_name ?? "learner", comp: (a.framework_competencies as unknown as { name: string } | null)?.name ?? "competency" };
    cur.min = Math.min(cur.min, a.score as number);
    cur.max = Math.max(cur.max, a.score as number);
    spreadMap.set(k, cur);
  }
  for (const v of spreadMap.values()) {
    if (v.max - v.min >= 3) flags.push({ icon: "📏", severity: "high", href: "/educator/validations", text: `Inconsistent scoring: ${v.nurse} — ${v.comp} scored ${v.min} to ${v.max} by different assessors.` });
  }

  // 5. Expired competencies + critical failures from latest decisions.
  const { data: decisions } = nurseIds.size
    ? await admin.from("competency_decisions")
        .select("nurse_id, competency_id, outcome, critical_failure, expiry_date, created_at")
        .in("nurse_id", [...nurseIds]).order("created_at", { ascending: false }).limit(3000)
    : { data: [] };
  const seen = new Set<string>();
  let expired = 0, critical = 0;
  for (const d of decisions ?? []) {
    const k = `${d.nurse_id}:${d.competency_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const passing = OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing ?? false;
    if (passing && d.expiry_date && d.expiry_date < today) expired++;
    if (d.critical_failure) critical++;
  }
  if (expired) flags.push({ icon: "📅", severity: "high", href: "/educator/approvals", text: `${expired} competenc${expired === 1 ? "y" : "ies"} expired — reassessment and re-approval needed.` });
  if (critical) flags.push({ icon: "🚨", severity: "high", href: "/educator/students", text: `${critical} active critical-failure decision${critical === 1 ? "" : "s"} on record.` });

  const order = { high: 0, medium: 1, low: 2 } as const;
  flags.sort((a, b) => order[a.severity] - order[b.severity]);

  const SEV = { high: "bg-red-100 text-red-700", medium: "bg-amber-100 text-amber-700", low: "bg-gray-100 text-gray-600" };

  return (
    <div className="max-w-4xl">
      <EduHeader icon="🚩" title="Quality Flags" sub="Items flagged for quality review — each flag states the rule that raised it. No invented risk scores." />
      <StatTiles tiles={[
        { label: "Active Flags", value: String(flags.length), alert: flags.some(f => f.severity === "high") },
        { label: "High Severity", value: String(flags.filter(f => f.severity === "high").length) },
        { label: "Entries Scanned (30d)", value: String(entries.length) },
        { label: "Decisions Scanned", value: String(seen.size) },
      ]} />

      <Card title="Flags" sub="rule-derived from live records">
        {flags.length ? (
          <div className="space-y-1.5">
            {flags.slice(0, 15).map((f, i) => (
              <Link key={i} href={f.href} className="flex items-start gap-2 border border-gray-100 rounded-lg px-3 py-2 hover:border-purple-200 transition-colors">
                <span>{f.icon}</span>
                <span className="text-xs text-gray-700 flex-1">{f.text}</span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase shrink-0 ${SEV[f.severity]}`}>{f.severity}</span>
              </Link>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">No quality flags — all rules pass on current records. ✅</p>}
      </Card>

      <div className="mt-4">
        <Card title="AI Quality Commentary" sub="Claude, grounded in live validation figures">
          <AskAi endpoint="/api/ai/insights" body={{ scope: "overview" }} label="Analyse validation quality" />
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Flag rules: duplicate = same learner + skill verified twice in 30 days; notes-only = verified with no files; aging = pending &gt;7 days;
        inconsistent = score spread ≥3 on the same competency; plus expiries and critical failures from latest decisions.
        Policy-violation detection needs a machine-readable policy store — not simulated.
      </p>
    </div>
  );
}
