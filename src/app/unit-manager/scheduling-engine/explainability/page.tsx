import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadExplainability } from "@/lib/operations/explainable-ai";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import SchedulingTabs from "../SchedulingTabs";

export const dynamic = "force-dynamic";

// Explainable AI (WSE-001J) — transparent, auditable explanations for scheduling
// decisions. "Why this decision?" reconstructs the deterministic solver logic for any
// roster assignment (or why a post is uncovered): rationale, applied rules, contributing
// factors, a confidence gauge and runner-up alternatives, plus the roster's score
// formulas. No black-box scoring. Every decision has an explanation.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

export default async function ExplainableAI({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const slot = typeof sp.slot === "string" ? Number(sp.slot) : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadExplainability(admin, profile?.hospital_id ?? null, isSuper, Number.isFinite(slot) ? slot : undefined) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🔍</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Explainable AI</h1><p className="text-sm text-gray-500">Why every scheduling decision was made — transparent, traceable, auditable.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <SchedulingTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Roster store not provisioned</p><p className="text-sm text-amber-800 mt-1">Run migration <code>080</code> and generate a roster — every decision then has an explanation.</p></div></div>;
  if (!d.hasRoster) return <div className="space-y-4">{header}<div className={`${card} p-8 text-center`}><p className="text-3xl mb-2">🔍</p><p className="text-sm font-semibold text-gray-700">No roster to explain for week of {d.weekStart}</p><p className="text-xs text-gray-400 mt-1">Generate a roster in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link> — its decisions are explained here.</p></div></div>;

  const e = d.explanation;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={`${card} p-4`}><p className="text-xs text-gray-500">Decisions explained</p><p className="text-2xl font-bold text-gray-900 mt-1">{d.kpis.assigned}</p><p className="text-[11px] text-gray-400">Assigned posts</p></div>
        <div className={`${card} p-4`}><p className="text-xs text-gray-500">Uncovered explained</p><p className="text-2xl font-bold text-gray-900 mt-1">{d.kpis.uncovered}</p><p className="text-[11px] text-gray-400">With rationale</p></div>
        <div className={`${card} p-4`}><p className="text-xs text-gray-500">Overrides</p><p className={`text-2xl font-bold mt-1 ${d.kpis.overrides ? "text-amber-600" : "text-gray-900"}`}>{d.kpis.overrides}</p><p className="text-[11px] text-gray-400">Competency exceptions</p></div>
        <div className={`${card} p-4`}><p className="text-xs text-gray-500">Roster quality</p><p className="text-2xl font-bold text-gray-900 mt-1">{d.scoreExplain[3].value}</p><p className="text-[11px] text-gray-400">Composite score</p></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Decision picker */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-2">Inspect a decision</h3>
          <div className="space-y-1 max-h-[420px] overflow-y-auto">{d.sample.map((s: any) => (
            <Link key={s.i} href={`/unit-manager/scheduling-engine/explainability?slot=${s.i}`} className={`block rounded-lg border p-2 text-xs ${d.selectedIndex === s.i ? "border-emerald-400 bg-emerald-50/40" : "border-gray-100 hover:border-emerald-200"}`}>
              <span className={s.uncovered ? "text-rose-600" : "text-gray-700"}>{s.uncovered ? "⛔ " : "👤 "}{s.label}</span>
            </Link>
          ))}</div>
        </div>

        {/* Why this decision */}
        <div className={`${card} p-5 xl:col-span-2`}>
          {!e ? <p className="text-sm text-gray-400 py-8 text-center">Select a decision to explain.</p> : (
            <>
              <div className="flex items-start justify-between mb-2"><div><h3 className="text-sm font-bold text-gray-900">Why this decision?</h3><p className="text-[11px] text-gray-500">{e.title} · <span className="text-gray-400">{e.sub}</span></p></div>
                <div className="text-center shrink-0"><div className="relative w-14 h-14"><div className="w-14 h-14 rounded-full" style={{ background: `conic-gradient(${e.confidence >= 80 ? "#10b981" : e.confidence >= 65 ? "#f59e0b" : "#ef4444"} ${e.confidence}%, #f1f5f9 0)` }} /><div className="absolute inset-[20%] rounded-full bg-white flex items-center justify-center text-[11px] font-bold text-gray-900">{e.confidence}%</div></div><p className="text-[8px] text-gray-400 mt-0.5">Confidence</p></div>
              </div>
              <p className="text-xs text-gray-700 bg-gray-50 rounded-lg p-2.5 mb-3">{e.rationale}</p>
              {e.override && <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg p-2 mb-3">⚠ Override reason: {e.override}</p>}

              <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Contributing factors</p>
              <div className="space-y-1 mb-3">{e.factors.map((f: any, i: number) => (<div key={i} className="flex items-center gap-2 text-xs"><span className={f.ok ? "text-emerald-600" : "text-amber-500"}>{f.ok ? "✓" : "!"}</span><span className="text-gray-500 w-32 shrink-0">{f.label}</span><span className="text-gray-700 flex-1">{f.value}</span></div>))}</div>

              {e.alternatives.length > 0 && (<>
                <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Alternatives considered</p>
                <div className="space-y-1">{e.alternatives.map((a: any, i: number) => (<div key={i} className="flex items-center gap-2 text-xs"><span className="text-gray-700 w-32 shrink-0 truncate">{a.name}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${a.valid ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{a.valid ? "competent" : "not validated"}</span><span className="text-gray-400">{a.shifts} shifts</span><span className="text-gray-500 flex-1 text-right">{a.why}</span></div>))}</div>
              </>)}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Applied rules */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Applied business rules</h3>
          <div className="space-y-2">{d.appliedRules.map((r: any, i: number) => (<div key={i} className="flex items-start gap-2 text-xs"><span className="w-5 h-5 rounded bg-gray-50 border border-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-500 shrink-0">{i + 1}</span><div><p className="font-semibold text-gray-800">{r.rule}</p><p className="text-[11px] text-gray-500">{r.detail}</p></div></div>))}</div>
        </div>

        {/* Score explanation */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">How the roster is scored</h3>
          <div className="space-y-2">{d.scoreExplain.map((s: any) => (<div key={s.label} className="flex items-center justify-between text-xs"><div><p className="font-semibold text-gray-800">{s.label}</p><p className="text-[10px] text-gray-400 font-mono">{s.formula}</p></div><span className="text-sm font-bold text-gray-900">{s.value}</span></div>))}</div>
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-100">Every score is a plain formula over real roster counts — auditable, not a black box. Explanations are retained with the roster&apos;s audit trail.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Explainable AI (WSE-001J) makes every scheduling decision transparent. Because the solver is deterministic (ordered allocation → competency → continuity → fairness, under max-shift + rest constraints), each assignment is faithfully explained — why this clinician (competency, continuity, fairness, limits) or why a post is honestly uncovered — with a confidence gauge and the runner-up alternatives that were considered. It consumes the outputs of every scheduling engine (WSE-001A–001I). Immutable audit records + a dedicated explanation-retention/report export are honest next-phase; the underlying decisions and their generation/publication are already in <Link href="/super-admin/platform-ops/collaboration" className="text-emerald-700 hover:underline">audit_log</Link>. <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">← Scheduling Engine</Link></p>
    </div>
  );
}
