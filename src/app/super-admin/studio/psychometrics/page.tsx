import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPsychometricsOverview, loadBankPsychometrics, MIN_ATTEMPTS } from "@/lib/studio/psychometrics";
import { requireHqCapability } from "@/lib/hq/context";

// CST-045 — Quality & Psychometric Analysis Studio. Real item statistics computed from knowledge_attempts
// (difficulty, point-biserial discrimination, distractor effectiveness, KR-20, SEM). Pick a question bank;
// banks with fewer than MIN_ATTEMPTS attempts are honestly reported as insufficient data.

export const dynamic = "force-dynamic";

const pColor = (p: number) => (p < 0.2 ? "#ef4444" : p > 0.9 ? "#f59e0b" : p >= 0.4 && p <= 0.8 ? "#10b981" : "#3b82f6");
const dColor = (d: number) => (d >= 0.3 ? "#10b981" : d >= 0.2 ? "#f59e0b" : "#ef4444");
const relTone = (v: number | null) => (v == null ? "text-gray-500" : v >= 0.8 ? "text-teal-600" : v >= 0.7 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-critical)]");

export default async function PsychometricsPage({ searchParams }: { searchParams: Promise<{ bank?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.learning.studio.view");

  const overview = await loadPsychometricsOverview(admin);
  const bankId = sp.bank || overview.banks[0]?.id || null;
  const detail = bankId ? await loadBankPsychometrics(admin, bankId) : null;

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-045 · Quality & Psychometrics</p>
          <h1 className="text-xl font-bold text-gray-900">Psychometric Analysis</h1>
          <p className="text-gray-500 text-sm mt-0.5">Item difficulty, discrimination, distractor effectiveness and reliability — computed live from real attempts.</p>
        </div>
        <Link href="/super-admin/studio/assessment" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Assessment</Link>
      </div>

      {!overview.provisioned ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-500">Question bank tables are not available in this environment.</div>
      ) : overview.banks.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-500">No question banks yet — author one in the <Link href="/super-admin/studio/questions" className="text-teal-600 hover:underline">Question Builder</Link>.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="bg-white rounded-xl border border-gray-100 p-3.5"><p className="text-xl font-bold text-gray-900">{overview.totalBanks}</p><p className="text-[10px] text-gray-500 font-medium mt-0.5">Question banks</p></div>
            <div className="bg-white rounded-xl border border-gray-100 p-3.5"><p className="text-xl font-bold text-teal-600">{overview.analysable}</p><p className="text-[10px] text-gray-500 font-medium mt-0.5">Analysable (≥{MIN_ATTEMPTS} attempts)</p></div>
            {detail?.found && !detail.insufficient && detail.reliability && (
              <>
                <div className="bg-white rounded-xl border border-gray-100 p-3.5"><p className={`text-xl font-bold ${relTone(detail.reliability.kr20)}`}>{detail.reliability.kr20 ?? "—"}</p><p className="text-[10px] text-gray-500 font-medium mt-0.5">KR-20 (this bank)</p></div>
                <div className="bg-white rounded-xl border border-gray-100 p-3.5"><p className="text-xl font-bold text-gray-900">{detail.reliability.sem ?? "—"}</p><p className="text-[10px] text-gray-500 font-medium mt-0.5">Std error (SEM)</p></div>
              </>
            )}
          </div>

          <div className="grid lg:grid-cols-[260px_1fr] gap-5">
            {/* Bank list */}
            <div className="bg-white rounded-xl border border-gray-100 p-3 h-fit">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-1 mb-2">Question banks</p>
              <div className="flex flex-col gap-0.5 max-h-[560px] overflow-y-auto">
                {overview.banks.map(b => (
                  <Link key={b.id} href={`/super-admin/studio/psychometrics?bank=${b.id}`}
                    className={`px-2.5 py-2 rounded-lg text-xs ${b.id === bankId ? "bg-teal-50 border border-teal-100" : "hover:bg-gray-50 border border-transparent"}`}>
                    <p className={`font-semibold truncate ${b.id === bankId ? "text-teal-800" : "text-gray-700"}`}>{b.name}</p>
                    <p className="text-[10px] text-gray-500">{b.attempts} attempt{b.attempts === 1 ? "" : "s"}{b.attempts >= MIN_ATTEMPTS ? ` · ${b.meanScore}% mean · ${b.passRate}% pass` : ""}</p>
                  </Link>
                ))}
              </div>
            </div>

            {/* Detail */}
            <div className="min-w-0">
              {!detail?.found ? (
                <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-500">Select a bank.</div>
              ) : detail.insufficient ? (
                <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
                  <p className="text-sm text-gray-500 font-medium">{detail.bank.name}</p>
                  <p className="text-xs text-gray-500 mt-1">{detail.attempts} attempt{detail.attempts === 1 ? "" : "s"} — need at least {MIN_ATTEMPTS} for reliable item statistics.</p>
                  <p className="text-[11px] text-gray-500 mt-2">Psychometrics require a candidate sample; this bank hasn&apos;t been taken enough yet.</p>
                </div>
              ) : (
                <>
                  <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="font-semibold text-gray-900 text-sm">{detail.bank.name}</h2>
                      <span className="text-[10px] text-gray-500">{detail.attempts} attempts · {detail.reliability!.items} items</span>
                    </div>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                      {[
                        { label: "KR-20", value: detail.reliability!.kr20 ?? "—", tone: relTone(detail.reliability!.kr20) },
                        { label: "SEM", value: detail.reliability!.sem ?? "—", tone: "text-gray-900" },
                        { label: "Mean score", value: `${detail.reliability!.meanScore}%`, tone: "text-gray-900" },
                        { label: "Pass rate", value: `${detail.reliability!.passRate}%`, tone: "text-gray-900" },
                        { label: "Mean difficulty", value: detail.reliability!.meanP, tone: "text-gray-900" },
                        { label: "Mean discrim.", value: detail.reliability!.meanDisc, tone: "text-gray-900" },
                      ].map(k => (
                        <div key={k.label}><p className={`text-lg font-bold ${k.tone}`}>{k.value}</p><p className="text-[10px] text-gray-500">{k.label}</p></div>
                      ))}
                    </div>
                    {detail.reliability!.flagged > 0 && <p className="text-[11px] text-[var(--cmp-text-warning)] mt-2">⚠ {detail.reliability!.flagged} item{detail.reliability!.flagged === 1 ? "" : "s"} flagged for review (too easy/hard or low discrimination).</p>}
                  </div>

                  {/* Item analysis */}
                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <h2 className="font-semibold text-gray-900 text-sm mb-3">Item analysis</h2>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="text-[10px] text-gray-500 uppercase tracking-wide text-left">
                            <th className="font-semibold py-1.5 pr-3 min-w-[280px]">Item</th>
                            <th className="font-semibold py-1.5 px-2 text-center w-16">Diff (p)</th>
                            <th className="font-semibold py-1.5 px-2 text-center w-20">Discrim.</th>
                            <th className="font-semibold py-1.5 px-2 text-center w-12">n</th>
                            <th className="font-semibold py-1.5 px-2 min-w-[160px]">Flags</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.items.map(it => (
                            <tr key={it.id} className="border-t border-gray-50 align-top">
                              <td className="py-2 pr-3 text-gray-700">{it.content || "—"}</td>
                              <td className="py-2 px-2 text-center"><span className="font-semibold tabular-nums" style={{ color: pColor(it.p) }}>{it.p.toFixed(2)}</span></td>
                              <td className="py-2 px-2 text-center"><span className="font-semibold tabular-nums" style={{ color: dColor(it.discrimination) }}>{it.discrimination.toFixed(2)}</span></td>
                              <td className="py-2 px-2 text-center text-gray-500">{it.responses}</td>
                              <td className="py-2 px-2">
                                <div className="flex flex-wrap gap-1">
                                  {it.flags.length === 0 ? <span className="text-[10px] text-teal-600">✓ ok</span> : it.flags.map(f => <span key={f} className="text-[9px] font-semibold text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded px-1.5 py-0.5">{f}</span>)}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-3">Difficulty p = proportion correct (0.4–0.8 optimal). Discrimination = point-biserial (≥0.3 good, &lt;0.2 review). Computed from real attempts using the same grading as delivery.</p>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
