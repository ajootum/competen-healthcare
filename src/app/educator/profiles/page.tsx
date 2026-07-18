import Link from "next/link";
import { requireEducatorAccess } from "@/lib/educator-access";
import { loadAnalytics, riskBuckets, passRateOf, avgScoreOf } from "@/lib/analytics";
import { OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";
import { StatTiles, Card } from "@/app/assessor/reports/ui";
import AskAi from "@/app/assessor/ai/AskAi";
import { EduHeader } from "../ui";

// Learner Profiles — the 360° learner view: passport state, assessments,
// evidence, feedback, pathway and an AI development plan, all live.

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ n?: string }>;

export default async function LearnerProfilesPage({ searchParams }: { searchParams: SearchParams }) {
  const { admin, hospitalId } = await requireEducatorAccess();
  const { n } = await searchParams;
  const ctx = await loadAnalytics(admin, hospitalId);
  const risk = riskBuckets(ctx.latest, ctx.nurses.length);
  const sel = n ? ctx.nurses.find(x => x.id === n) ?? null : null;

  const mineDecisions = sel ? ctx.latest.filter(d => d.nurse_id === sel.id) : [];
  const mineAssess = sel ? ctx.assess.filter(a => a.nurse_id === sel.id) : [];
  const mineEntries = sel ? ctx.entries.filter(e => e.nurse_id === sel.id) : [];

  const [{ data: recentDec }, { data: feedback }, { data: pathway }] = sel
    ? await Promise.all([
        admin.from("competency_decisions")
          .select("outcome, created_at, expiry_date, framework_competencies!competency_id(name)")
          .eq("nurse_id", sel.id).order("created_at", { ascending: false }).limit(6),
        admin.from("skill_log_entries")
          .select("skill_name, verifier_comment, verified_by_name, verified_at")
          .eq("nurse_id", sel.id).not("verifier_comment", "is", null)
          .order("verified_at", { ascending: false }).limit(4),
        admin.from("pathway_items")
          .select("competency_name, reason, resource_title, learning_pathways!inner(nurse_id, status)")
          .eq("learning_pathways.nurse_id", sel.id).eq("learning_pathways.status", "active").limit(6),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  return (
    <div className="max-w-4xl">
      <EduHeader icon="🧬" title="Learner Profiles" sub="360° learner intelligence — passport, assessments, evidence, feedback and the AI development plan." />

      <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Learner</span>
        <form action="/educator/profiles" className="flex items-center gap-2">
          <select name="n" defaultValue={sel?.id ?? ""}
            className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:border-purple-400">
            <option value="">Choose a learner…</option>
            {ctx.nurses.map(x => <option key={x.id} value={x.id}>{x.name} · {x.dept}</option>)}
          </select>
          <button type="submit" className="text-xs font-semibold text-white bg-purple-600 rounded-lg px-3 py-1.5 hover:bg-purple-700">Open</button>
        </form>
        {sel && (
          <span className="ml-auto flex items-center gap-3">
            <Link href={`/assessor/passports?n=${sel.id}`} className="text-[11px] font-semibold text-purple-600 hover:underline">Passport →</Link>
            <Link href="/educator/plans" className="text-[11px] font-semibold text-purple-600 hover:underline">Learning plans →</Link>
          </span>
        )}
      </div>

      {sel ? (
        <>
          <StatTiles tiles={[
            { label: "Risk", value: (risk.byNurse.get(sel.id) ?? "low").toUpperCase(), alert: risk.byNurse.get(sel.id) === "high", sub: "from decision records" },
            { label: "Competency Progress", value: mineDecisions.length ? `${Math.round(mineDecisions.filter(d => d.passing && !d.expired).length / mineDecisions.length * 100)}%` : "—", sub: `${mineDecisions.length} decided` },
            { label: "Assessments (8w)", value: String(mineAssess.length), sub: `pass ${passRateOf(mineAssess) ?? "—"}% · avg ${avgScoreOf(mineAssess) ?? "—"}` },
            { label: "Evidence", value: String(mineEntries.length), sub: `${mineEntries.filter(e => e.status === "pending").length} pending` },
          ]} />

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <Card title="Recent Decisions">
              {(recentDec ?? []).length ? (recentDec ?? []).map((d, i) => {
                const oc = OUTCOME_CONFIG[d.outcome as DecisionOutcome];
                return (
                  <div key={i} className="flex items-center gap-2 text-[11px] py-1">
                    <span className="text-gray-700 flex-1 truncate">{(d.framework_competencies as unknown as { name: string } | null)?.name ?? "—"}</span>
                    <span className="text-gray-300" suppressHydrationWarning>{new Date(d.created_at).toLocaleDateString()}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${oc?.cls ?? "bg-gray-100 text-gray-600"}`}>{oc?.label ?? d.outcome}</span>
                  </div>
                );
              }) : <p className="text-xs text-gray-400">No decisions yet.</p>}
            </Card>
            <Card title="Active Learning Path" sub="auto-generated from decision gaps">
              {(pathway ?? []).length ? (
                <ul className="space-y-1">
                  {(pathway ?? []).map((p, i) => (
                    <li key={i} className="text-[11px] text-gray-700">
                      🎓 {p.competency_name}{p.resource_title ? <span className="text-gray-400"> — {p.resource_title}</span> : <span className="text-amber-600"> — no resource linked</span>}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-gray-400">No active pathway — runs after a decision process.</p>}
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Recent Feedback" sub="verifier comments">
              {(feedback ?? []).length ? (feedback ?? []).map((f, i) => (
                <div key={i} className="border border-gray-50 rounded-lg px-2.5 py-1.5 mb-1.5">
                  <p className="text-[11px] font-semibold text-gray-800">{f.skill_name}</p>
                  <p className="text-[10px] text-gray-500 italic">“{f.verifier_comment}” — {f.verified_by_name ?? "verifier"}</p>
                </div>
              )) : <p className="text-xs text-gray-400">No feedback comments yet.</p>}
            </Card>
            <Card title="AI Development Plan" sub="coach engine — grounded in this learner's real gaps">
              <AskAi endpoint="/api/ai/coach" body={{ nurse_id: sel.id }} label={`Generate plan for ${sel.name.split(" ")[0]}`} />
            </Card>
          </div>
        </>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
          <p className="text-3xl mb-2">🧬</p>
          <p className="text-sm text-gray-500">Choose a learner from the selector or the <Link href="/educator/students" className="text-purple-600 hover:underline">Learner Directory</Link>.</p>
        </div>
      )}
    </div>
  );
}
