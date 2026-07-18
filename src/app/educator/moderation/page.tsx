import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import AppealsQueue, { type AppealRow } from "@/app/assessor/reports/quality/AppealsQueue";
import { EduHeader } from "../ui";

// Moderation Queue — second-review workflow: disputed assessments (appeals),
// a random sample of recent decisions for spot-checking, and inter-rater
// agreement computed from real multi-assessor overlap.

export const dynamic = "force-dynamic";

export default async function ModerationQueuePage() {
  const { admin, hospitalId } = await requireEducatorAccess();
  const d56 = new Date(new Date().getTime() - 8 * 7 * 86400000).toISOString();

  const [{ data: appealsRaw }, { data: sampleScores }, { data: assessRaw }] = await Promise.all([
    hospitalId
      ? admin.from("appeals")
          .select("id, nurse_id, competency_name, score, reason, status, created_at, profiles!nurse_id(full_name)")
          .eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] }),
    admin.from("competency_scores")
      .select("id, score, is_passing, educator_validated, validated_at, profiles!nurse_id(full_name), framework_competencies!competency_id(name)")
      .eq("educator_validated", true).not("validated_at", "is", null)
      .order("validated_at", { ascending: false }).limit(40),
    admin.from("assessments")
      .select("score, assessor_id, competency_id, competency_cycles!cycle_id(hospital_id, nurse_id)")
      .eq("status", "complete").not("score", "is", null).gte("assessed_at", d56).limit(2000),
  ]);

  const appeals: AppealRow[] = ((appealsRaw ?? []) as unknown as {
    id: string; competency_name: string | null; score: number | null; reason: string; status: string; created_at: string;
    profiles: { full_name: string } | null;
  }[]).map(a => ({
    id: a.id, nurse: a.profiles?.full_name ?? "—", competency: a.competency_name,
    score: a.score, reason: a.reason, status: a.status, at: a.created_at,
  }));
  const openAppeals = appeals.filter(a => ["open", "under_review"].includes(a.status));

  // Deterministic "random" sample per day: pick every Nth of recent validations.
  const pool = sampleScores ?? [];
  const step = Math.max(1, Math.floor(pool.length / 5));
  const sample = pool.filter((_, i) => i % step === 0).slice(0, 5);

  // Inter-rater agreement from real multi-assessor overlap (8 weeks).
  const hosAssess = (assessRaw ?? []).filter(a =>
    !hospitalId || (a.competency_cycles as unknown as { hospital_id: string | null } | null)?.hospital_id === hospitalId);
  const groups = new Map<string, Map<string, number>>();
  for (const a of hosAssess) {
    if (!a.competency_id || !a.assessor_id) continue;
    const c = a.competency_cycles as unknown as { nurse_id: string };
    const key = `${c.nurse_id}:${a.competency_id}`;
    const m = groups.get(key) ?? new Map<string, number>();
    if (!m.has(a.assessor_id)) m.set(a.assessor_id, a.score as number);
    groups.set(key, m);
  }
  const pairs: number[] = [];
  for (const m of groups.values()) {
    const scores = [...m.values()];
    for (let i = 0; i < scores.length; i++) for (let j = i + 1; j < scores.length; j++) pairs.push(Math.abs(scores[i] - scores[j]));
  }
  const agreement = pairs.length ? Math.round(pairs.filter(d => d <= 1).length / pairs.length * 100) : null;

  return (
    <div className="max-w-4xl">
      <EduHeader icon="📋" title="Moderation Queue" sub="Second-review workflow — disputed outcomes, random sampling of validated decisions, and rater agreement." />
      <StatTiles tiles={[
        { label: "Disputed (Appeals)", value: String(openAppeals.length), sub: `${appeals.length - openAppeals.length} resolved`, alert: openAppeals.length > 0 },
        { label: "Random Sample", value: String(sample.length), sub: "of recent validations" },
        { label: "Inter-Rater Agreement", value: agreement != null ? `${agreement}%` : "—", sub: agreement != null ? `within 1 point · ${pairs.length} pairs` : "insufficient multi-assessor overlap" },
        { label: "Validated Pool", value: String(pool.length), sub: "recent decisions" },
      ]} />

      <Card title="Disputed Assessments" sub="learner appeals awaiting moderation — decide with a note">
        <AppealsQueue rows={openAppeals} />
      </Card>

      <div className="mt-4">
        <Card title="Random Sample for Spot-Check" sub="systematic sample of recent validated scores — re-examine for consistency">
          {sample.length ? (
            <div className="space-y-1.5">
              {sample.map(s => (
                <div key={s.id} className="flex items-center gap-2 text-[11px] border border-gray-50 rounded-lg px-2.5 py-1.5">
                  <span className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center shrink-0 ${s.is_passing ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>{s.score ?? "—"}</span>
                  <span className="text-gray-800 font-medium truncate">{(s.profiles as unknown as { full_name: string } | null)?.full_name ?? "—"}</span>
                  <span className="text-gray-400 truncate flex-1">{(s.framework_competencies as unknown as { name: string } | null)?.name ?? "—"}</span>
                  <span className="text-gray-300 shrink-0" suppressHydrationWarning>{s.validated_at ? new Date(s.validated_at).toLocaleDateString() : ""}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-xs text-gray-400">No validated decisions to sample yet.</p>}
          <p className="text-[9px] text-gray-400 mt-2">
            Sampling is systematic (every Nth recent validation) — statistically random selection with configurable rates would need a sampling policy store.
            If a sampled decision looks wrong, return it via <Link href="/educator/validations" className="text-purple-600 hover:underline">Pending Validation</Link> or raise it in Escalations.
          </p>
        </Card>
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Appeal decisions notify the learner automatically and are audit-logged. Overturned appeals lead to reassessment — history is never edited.
      </p>
    </div>
  );
}
