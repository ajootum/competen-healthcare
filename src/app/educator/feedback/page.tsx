import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics } from "@/lib/analytics";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import { EduHeader } from "../ui";

// Feedback & Comments — the unified feedback stream: assessor notes on
// assessments, verifier comments on evidence, educator validation notes and
// appeal resolutions, merged chronologically from real records.

export const dynamic = "force-dynamic";

export default async function FeedbackCommentsPage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const ctx = await loadAnalytics(admin, hospitalId);
  const nurseIds = ctx.nurses.map(n => n.id);
  const nameOf = new Map(ctx.nurses.map(n => [n.id, n.name]));

  const [{ data: assessNotes }, { data: verifierNotes }, { data: educatorNotes }, { data: appealNotes }] = await Promise.all([
    admin.from("assessments")
      .select("notes, score, assessed_at, profiles!assessor_id(full_name), framework_competencies!competency_id(name), competency_cycles!cycle_id(nurse_id, hospital_id)")
      .not("notes", "is", null).order("assessed_at", { ascending: false }).limit(60),
    nurseIds.length
      ? admin.from("skill_log_entries")
          .select("nurse_id, skill_name, status, verifier_comment, verified_by_name, verified_at")
          .in("nurse_id", nurseIds).not("verifier_comment", "is", null)
          .order("verified_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] }),
    nurseIds.length
      ? admin.from("competency_scores")
          .select("nurse_id, educator_notes, educator_validated, validated_at, framework_competencies!competency_id(name)")
          .in("nurse_id", nurseIds).not("educator_notes", "is", null)
          .order("validated_at", { ascending: false, nullsFirst: false }).limit(30)
      : Promise.resolve({ data: [] }),
    hospitalId
      ? admin.from("appeals")
          .select("nurse_id, competency_name, status, resolution_note, reviewer_name, resolved_at")
          .eq("hospital_id", hospitalId).not("resolution_note", "is", null)
          .order("resolved_at", { ascending: false, nullsFirst: false }).limit(20)
      : Promise.resolve({ data: [] }),
  ]);

  type Item = { kind: string; icon: string; who: string; learner: string; about: string; text: string; at: string | null };
  const items: Item[] = [
    ...((assessNotes ?? []) as unknown as { notes: string; score: number | null; assessed_at: string | null; profiles: { full_name: string } | null; framework_competencies: { name: string } | null; competency_cycles: { nurse_id: string; hospital_id: string | null } | null }[])
      .filter(a => !hospitalId || a.competency_cycles?.hospital_id === hospitalId)
      .map(a => ({
        kind: "Assessment", icon: "📝",
        who: a.profiles?.full_name ?? "Assessor",
        learner: nameOf.get(a.competency_cycles?.nurse_id ?? "") ?? "—",
        about: `${a.framework_competencies?.name ?? "Assessment"}${a.score != null ? ` · ${a.score}/6` : ""}`,
        text: a.notes, at: a.assessed_at,
      })),
    ...(verifierNotes ?? []).map(v => ({
      kind: "Evidence", icon: "🖇️",
      who: v.verified_by_name ?? "Verifier",
      learner: nameOf.get(v.nurse_id) ?? "—",
      about: `${v.skill_name} · ${v.status.replace("_", " ")}`,
      text: v.verifier_comment as string, at: v.verified_at,
    })),
    ...(educatorNotes ?? []).map(e => ({
      kind: "Validation", icon: "✅",
      who: "Educator",
      learner: nameOf.get(e.nurse_id) ?? "—",
      about: `${(e.framework_competencies as unknown as { name: string } | null)?.name ?? "Score"} · ${e.educator_validated ? "validated" : "returned"}`,
      text: e.educator_notes as string, at: e.validated_at,
    })),
    ...(appealNotes ?? []).map(a => ({
      kind: "Appeal", icon: "⚖️",
      who: a.reviewer_name ?? "Reviewer",
      learner: nameOf.get(a.nurse_id) ?? "—",
      about: `${a.competency_name ?? "Assessment"} · ${a.status}`,
      text: a.resolution_note as string, at: a.resolved_at,
    })),
  ].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")).slice(0, 30);

  return (
    <div className="max-w-3xl">
      <EduHeader icon="💬" title="Feedback & Comments" sub="Unified feedback stream — assessor notes, evidence comments, validation notes and appeal resolutions." />
      <StatTiles tiles={[
        { label: "Feedback Items", value: String(items.length), sub: "latest, all sources" },
        { label: "Assessment Notes", value: String(items.filter(i => i.kind === "Assessment").length) },
        { label: "Evidence Comments", value: String(items.filter(i => i.kind === "Evidence").length) },
        { label: "Validation & Appeals", value: String(items.filter(i => ["Validation", "Appeal"].includes(i.kind)).length) },
      ]} />

      <Card title="Feedback Stream" sub="chronological, all learners">
        {items.length ? (
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="border border-gray-100 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span>{it.icon}</span>
                  <span className="text-xs font-semibold text-gray-800">{it.learner}</span>
                  <span className="text-[10px] text-gray-400">{it.about}</span>
                  <span className="flex-1" />
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-purple-50 text-purple-600">{it.kind}</span>
                </div>
                <p className="text-[11px] text-gray-600 italic mt-1">“{it.text}” <span className="not-italic text-gray-400">— {it.who}</span></p>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-gray-400">No feedback recorded yet.</p>}
      </Card>

      <p className="text-[10px] text-gray-400 mt-4">
        Every item is a real recorded comment with its author. Threaded replies and learner acknowledgements would need a comments store — not simulated.
      </p>
    </div>
  );
}
