import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadReleaseReadiness } from "@/lib/studio/release-readiness";
import { requireHqCapability } from "@/lib/hq/context";

// CST-010 — Testing & Sandbox (release readiness gate). Composes the QA (CST-107), dependency (CST-105)
// and traceability (CST-104) checks into one "ready to publish?" verdict per framework, with the blocking
// checks named. Read-only, no new store. A full persona-driven workflow sandbox is the next-phase layer.

export const dynamic = "force-dynamic";

const VERDICT: Record<string, { label: string; cls: string }> = {
  ready: { label: "Ready", cls: "text-teal-700 bg-teal-50 border-teal-200" },
  needs_work: { label: "Needs work", cls: "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]" },
  blocked: { label: "Blocked", cls: "text-[var(--cmp-text-critical)] bg-[var(--cmp-surface-critical)] border-[var(--cmp-color-critical)]" },
};
const STATUS_ICON: Record<string, { icon: string; cls: string }> = {
  pass: { icon: "✓", cls: "text-teal-600" }, warn: { icon: "!", cls: "text-[var(--cmp-text-warning)]" }, fail: { icon: "✗", cls: "text-[var(--cmp-text-critical)]" },
};

export default async function StudioTestingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  await requireHqCapability("hq.learning.studio.view");

  const rr = await loadReleaseReadiness(admin, profile?.hospital_id ?? null, true);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-010 · Testing &amp; Sandbox</p>
          <h1 className="text-xl font-bold text-gray-900">Release Readiness</h1>
          <p className="text-gray-500 text-sm mt-0.5">Validate frameworks before publication — completeness, coverage, structure and dependency integrity in one gate.</p>
        </div>
        <Link href="/super-admin/studio" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Studio</Link>
      </div>

      {!rr.provisioned ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-500">Content tables are not available in this environment.</div>
      ) : rr.empty ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-500">No frameworks to validate yet — author competencies in the Studio first.</div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-5">
            {[
              { label: "Frameworks", value: rr.kpis.frameworks, tone: "text-gray-900" },
              { label: "Ready", value: rr.kpis.ready, tone: "text-teal-600" },
              { label: "Needs work", value: rr.kpis.needsWork, tone: "text-[var(--cmp-text-warning)]" },
              { label: "Blocked", value: rr.kpis.blocked, tone: rr.kpis.blocked > 0 ? "text-[var(--cmp-text-critical)]" : "text-gray-500" },
              { label: "Prerequisite cycles", value: rr.kpis.cycles, tone: rr.kpis.cycles > 0 ? "text-[var(--cmp-text-critical)]" : "text-gray-500" },
              { label: "High QA issues", value: rr.kpis.highIssues, tone: rr.kpis.highIssues > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-500" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-500 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Global dependency-cycle gate */}
          {rr.cycles.length > 0 && (
            <div className="bg-[var(--cmp-surface-critical)] border border-[var(--cmp-color-critical)] rounded-xl p-4 mb-5">
              <p className="text-xs font-bold text-[var(--cmp-text-critical)] uppercase tracking-widest mb-2">⛔ Platform-level blocker · prerequisite cycles</p>
              {rr.cycles.map((chain, i) => <p key={i} className="text-xs text-red-800">{chain.join("  →  ")}</p>)}
              <p className="text-[10px] text-red-500 mt-2">Resolve in the <Link href="/super-admin/studio/dependencies" className="underline">Dependency Manager</Link> before publishing affected competencies.</p>
            </div>
          )}

          {/* Per-framework readiness */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900 text-sm">Framework readiness</h2>
              <span className="text-[9px] text-gray-500">blocked &amp; lowest first</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {rr.frameworks.map(f => {
                const v = VERDICT[f.verdict];
                return (
                  <div key={f.id} className="border border-gray-100 rounded-lg p-3">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <Link href={`/super-admin/content/${f.id}`} className="text-sm font-semibold text-gray-800 hover:text-teal-700 truncate max-w-[40%]">{f.name}</Link>
                      <span className="text-[10px] text-gray-500">{f.competencies} competenc{f.competencies === 1 ? "y" : "ies"}</span>
                      <span className={`ml-auto text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${v.cls}`}>{v.label}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {f.checks.map(c => {
                        const s = STATUS_ICON[c.status];
                        return (
                          <span key={c.label} className="inline-flex items-center gap-1 text-[11px] text-gray-500">
                            <span className={`font-bold ${s.cls}`}>{s.icon}</span>
                            {c.label} <b className="text-gray-700 font-semibold">{c.value}</b>
                          </span>
                        );
                      })}
                    </div>
                    {f.blockers.length > 0 && <p className="text-[10px] text-red-500 mt-1.5">Blocking: {f.blockers.join(", ")}</p>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 mt-5">
            <p className="text-[11px] text-teal-900">
              <span className="font-bold">Composed gate.</span> This readiness check reuses the QA completeness, dependency-cycle and traceability-coverage engines — one verdict, no duplicate logic. A full persona-driven workflow sandbox that simulates worker, assessor and educator journeys against authored content is the next-phase layer.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
