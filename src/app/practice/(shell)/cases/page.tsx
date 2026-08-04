import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import {
  caseMemoryDashboard, findSimilarCases, listLearning, listCollections, type MatchedOn,
} from "@/lib/practice/case-memory";
import SimilarCasePicker from "./SimilarCasePicker";

// /practice/cases -- CPR-220 CASE MEMORY.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE COMP PUTS A SIMILARITY PERCENTAGE BESIDE EVERY RETRIEVED CASE. THIS PAGE PUTS THE REASON.
//
// "95% relevance", "92% similarity", each with a progress bar. In a product that computes no rates that
// would be refused anyway -- but this one is worse than a rate. A clinician reading "92% similar" beside
// a treatment and an outcome may reasonably let it inform what they do next, and no formula could earn
// that number. So each case says WHAT IT SHARES: same diagnosis, same procedure, age within five years.
// A clinician can weigh that. Order is by how many facts matched -- a count, not a score.
//
// Also refused: the four "Case Memory Insights" percentages (28% · 92% · 3.2% · 84%), the AI-assisted
// semantic search and outcome prediction (CPR-210, unbuilt), and the HIPAA compliance badge.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// NOT AT /practice/case-memory: that slug belongs to the public marketing page for this capability, and
// a static route here would shadow it silently. The content harness guards the collision.

export const dynamic = "force-dynamic";

export default async function CaseMemoryPage({ searchParams }: {
  searchParams: Promise<{ similarTo?: string; mine?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "encounter.list")) redirect("/practice/home");

  const { similarTo, mine } = await searchParams;
  const admin = createAdminClient();

  const [summary, learning, collections, similar] = await Promise.all([
    caseMemoryDashboard(admin, shell.ctx),
    listLearning(admin, shell.ctx, { mine: mine === "1", limit: 12 }),
    listCollections(admin, shell.ctx),
    similarTo ? findSimilarCases(admin, shell.ctx, { encounterId: similarTo, limit: 12 }) : Promise.resolve(null),
  ]);

  const card = "rounded-xl border border-gray-200 bg-white p-4";

  return (
    <div className="max-w-6xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Case memory</h1>
        <p className="mt-0.5 text-[13px] text-gray-500">
          Everything you have already seen, findable by what it had in common.
        </p>
      </div>

      {/* ── KPI strip (comp: six tiles) ─────────────────────────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Cases</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{summary.cases}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">consultations recorded here</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Conditions seen</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{summary.distinctConditions}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">distinct labels, as typed</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Learning points</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{summary.learnings}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">written by this practice</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-500">Collections</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{summary.collections}</p>
          <p className="mt-0.5 text-[10px] text-gray-500">{summary.casesInCollections} cases filed</p>
        </div>
        {/* THE COMP'S "SIMILAR CASES FOUND 386" TILE. A standing count of similar cases is a count of
            nothing: similarity is relative to a case you are looking at, so there is no number until
            you name one. */}
        <div className={`${card} border-dashed bg-gray-50/60`}>
          <p className="text-[11px] font-semibold text-gray-500">Similar cases found</p>
          <p className="mt-1 text-2xl font-bold text-gray-300">&mdash;</p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            Similar to what? Pick a case below.
          </p>
        </div>
      </div>

      <div className="mt-4 grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* ── Find similar cases (comp: five search tabs) ──────────────────────────────────── */}
          <section className={card}>
            <h2 className="text-[13px] font-bold text-gray-900">Find cases like this one</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Matching is on what was actually written down &mdash; the diagnosis, the procedure, the age
              band, the sex. Each result says which of those it shares.
            </p>
            <SimilarCasePicker current={similarTo ?? ""} />

            {similar && similar.matchedNothing && (
              <p className="mt-3 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-3 text-[12px] text-gray-600">
                {similar.reason}
              </p>
            )}

            {similar && !similar.matchedNothing && (
              <>
                <p className="mt-3 text-[11px] text-gray-500">
                  Compared against: {[...similar.source.diagnoses ?? [], ...similar.source.procedures ?? []].join(" · ") || "nothing recorded"}
                  {similar.source.ageBand ? ` · ${similar.source.ageBand}` : ""}
                </p>
                {similar.cases.length === 0 ? (
                  <p className="mt-2 text-[12px] text-gray-400">Nothing else here shares a fact with it.</p>
                ) : (
                  <ul className="mt-2 flex flex-col">
                    {similar.cases.map(c => (
                      <li key={c.encounterId} className="border-b border-gray-100 py-2 last:border-0">
                        <div className="flex items-baseline gap-2">
                          <Link href={c.href} className="text-[12px] font-semibold text-gray-900 hover:underline">
                            {c.patientName ?? [c.ageBand, c.sex !== "unspecified" ? c.sex : null].filter(Boolean).join(", ") || "A case"}
                          </Link>
                          <span className="ml-auto shrink-0 text-[11px] text-gray-500">
                            {String(c.when).slice(0, 10)}
                          </span>
                        </div>
                        {/* WHERE THE COMP DRAWS A PROGRESS BAR AND A PERCENTAGE. */}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.matchedOn.map((m: MatchedOn) => (
                            <span key={`${m.field}-${m.value}`}
                              className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-700">
                              {m.label}{m.value ? `: ${m.value}` : ""}
                            </span>
                          ))}
                        </div>
                        {c.outcomes.length > 0 && (
                          <p className="mt-1 text-[10px] text-gray-500">
                            Outcome: {c.outcomes.map(o => o.severity ? `${o.type} (${o.severity})` : o.type).join(" · ")}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {!similar.identified && (
                  <p className="mt-2 text-[10px] text-gray-500">
                    You hold clinical access but not patient access, so these cases show without names.
                    The clinical content is the part you learn from.
                  </p>
                )}
              </>
            )}
          </section>

          {/* ── Top conditions (comp: bars with percentages) ─────────────────────────────────── */}
          <section className={card}>
            <h2 className="text-[13px] font-bold text-gray-900">What you see most</h2>
            {summary.topConditions.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">No diagnoses recorded yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {summary.topConditions.map(c => (
                  <li key={c.label} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                    <span className="min-w-0 truncate text-[12px] text-gray-800">{c.label}</span>
                    <span className="ml-auto text-[12px] font-bold text-gray-900">{c.total}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4">
          {/* ── Learning points ─────────────────────────────────────────────────────────────── */}
          <section className={card}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[13px] font-bold text-gray-900">Learning points</h2>
              <Link href={mine === "1" ? "/practice/cases" : "/practice/cases?mine=1"}
                className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                {mine === "1" ? "Everyone's" : "Only mine"}
              </Link>
            </div>
            {learning.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">
                Nothing written down yet. A learning point is captured against a consultation.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {learning.map(l => (
                  <li key={l.id} className="border-b border-gray-100 pb-2 last:border-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{l.kindLabel}</p>
                    <p className="mt-0.5 text-[12px] text-gray-800">{l.body}</p>
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      {l.mine ? "You" : (l.authorName ?? "A colleague")} · <Link href={l.href} className="hover:underline">the case</Link>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Collections ─────────────────────────────────────────────────────────────────── */}
          <section className={card}>
            <h2 className="text-[13px] font-bold text-gray-900">Collections</h2>
            {collections.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">No collections yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {collections.map(c => (
                  <li key={c.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-0">
                    <span className="min-w-0 truncate text-[12px] text-gray-800">{c.name}</span>
                    <span className="shrink-0 text-[10px] text-gray-400">{c.scope === "practice" ? "shared" : "yours"}</span>
                    <span className="ml-auto text-[12px] font-bold text-gray-900">{c.cases}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* THE PANEL THE COMP HAS NO ROOM FOR. */}
          <section className={`${card} border-dashed bg-gray-50/60`}>
            <h2 className="text-[13px] font-bold text-gray-900">What this page will not tell you</h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              <li>
                <p className="text-[12px] font-semibold text-gray-700">A similarity percentage</p>
                <p className="text-[10px] text-gray-500">
                  The design puts &ldquo;92% similar&rdquo; beside each case. No formula could earn that,
                  and a wrong one would look exactly like a right one. Each result names what it shares instead.
                </p>
              </li>
              <li>
                <p className="text-[12px] font-semibold text-gray-700">An outcome rate, or a complication rate</p>
                <p className="text-[10px] text-gray-500">
                  A percentage is where a small number hides. The outcomes themselves are on each case.
                </p>
              </li>
              <li>
                <p className="text-[12px] font-semibold text-gray-700">Semantic search, and outcome prediction</p>
                <p className="text-[10px] text-gray-500">
                  Both need the AI clinical assistant, which is not built. Matching here is on stated facts.
                </p>
              </li>
              <li>
                <p className="text-[12px] font-semibold text-gray-700">A compliance badge</p>
                <p className="text-[10px] text-gray-500">
                  The design carries one. A badge is a claim about an audit nobody has performed.
                </p>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
