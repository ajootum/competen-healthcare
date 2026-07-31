import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadEvidenceIntegrity } from "@/lib/assurance/evidence-integrity";
import EvidenceActions from "./EvidenceActions";

// CAPA-004 — Evidence Integrity Platform (operator view). Verification backlog + integrity issues + chain-of-
// custody over the real evidence store (with the migration-149 verification lifecycle). Super-admin, enterprise.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const DOT: Record<string, string> = { emerald: "bg-[var(--cmp-color-success)]", amber: "bg-[var(--cmp-color-warning)]", rose: "bg-[var(--cmp-color-error)]", gray: "bg-gray-300" };
const fmt = (t: string | null) => { if (!t) return ""; try { return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); } catch { return ""; } };

export default async function EvidenceIntegrityPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const q = await loadEvidenceIntegrity(admin, profile?.hospital_id ?? null, true);
  const card = "bg-white rounded-xl border border-gray-100";
  const distTotal = q.provisioned && !q.empty ? q.statusDist.reduce((n: number, s: any) => n + s.n, 0) || 1 : 1;

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-indigo-500 uppercase tracking-widest mb-0.5">CAPA-004 · Competency Assurance</p>
          <h1 className="text-xl font-bold text-gray-900">Evidence Integrity</h1>
          <p className="text-gray-400 text-sm mt-0.5">Whether competency evidence is verified, authentic and traceable — the verification backlog, integrity issues, and chain-of-custody.</p>
        </div>
        <Link href="/super-admin/assurance" className="text-xs font-semibold text-gray-500 hover:text-indigo-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Assurance</Link>
      </div>

      {!q.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-4"><p className="text-[13px] text-amber-900">Evidence integrity isn&apos;t provisioned — apply migration 149 (<code className="text-[11px]">149-capa-evidence-integrity.sql</code>) to add the verification lifecycle to <code className="text-[11px]">evidence</code>.</p></div>
      ) : q.empty ? (
        <div className="bg-white border border-gray-100 rounded-xl p-6"><p className="text-sm text-gray-400">No evidence recorded yet. Once competency evidence is uploaded, the verification queue and integrity signals populate here.</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            {[
              { label: "Verification rate", value: `${q.kpis.verificationRate}%`, tone: q.kpis.verificationRate >= 80 ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]", sub: `${q.kpis.verified}/${q.kpis.total}` },
              { label: "Pending review", value: q.kpis.pending, tone: q.kpis.pending ? "text-[var(--cmp-text-warning)]" : "text-gray-900", sub: "backlog" },
              { label: "Integrity issues", value: q.kpis.integrityIssues, tone: q.kpis.integrityIssues ? "text-[var(--cmp-text-error)]" : "text-gray-900", sub: "flag/reject/expired/dupe" },
              { label: "Flagged", value: q.kpis.flagged, tone: q.kpis.flagged ? "text-[var(--cmp-text-error)]" : "text-gray-900", sub: "under review" },
              { label: "Expiring ≤30d", value: q.kpis.expiring, tone: q.kpis.expiring ? "text-[var(--cmp-text-warning)]" : "text-gray-900", sub: `${q.kpis.expired} expired` },
              { label: "Suspected dupes", value: q.kpis.duplicates, tone: q.kpis.duplicates ? "text-[var(--cmp-text-warning)]" : "text-gray-900", sub: "same file+size" },
            ].map(k => (
              <div key={k.label} className={`${card} p-3.5`}><p className={`text-xl font-bold tabular-nums ${k.tone}`}>{k.value}</p><p className="text-[10px] text-gray-400 font-medium mt-0.5 leading-tight">{k.label}</p><p className="text-[9px] text-gray-300 leading-tight">{k.sub}</p></div>
            ))}
          </div>

          {/* Verification queue */}
          <div className={`${card} overflow-hidden mb-5`}>
            <div className="px-4 py-2.5 border-b border-gray-50 flex items-center justify-between"><p className="text-[11px] font-semibold text-gray-500">Verification queue</p><span className="text-[10px] text-gray-400">{q.kpis.pending} pending — verify, flag or reject</span></div>
            {q.queue.length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-6 text-center">Nothing pending — all evidence has been reviewed. 🎯</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {q.queue.map((e: any) => (
                  <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-sm text-gray-800 truncate flex-1" title={e.file}>{e.file}</span>
                    <span className="text-[10px] text-gray-400 truncate max-w-[120px] hidden sm:inline">{e.owner}{e.competency !== "—" ? ` · ${e.competency}` : ""}</span>
                    <span className="text-[9px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 shrink-0">{String(e.kind).replace(/_/g, " ")}</span>
                    <EvidenceActions id={e.id} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Status distribution */}
            <div className={`${card} p-4`}>
              <p className="text-[11px] font-semibold text-gray-500 mb-3">Verification status</p>
              <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100 mb-3">
                {q.statusDist.map((s: any) => <div key={s.label} className={DOT[s.tone]} style={{ width: `${(s.n / distTotal) * 100}%` }} title={`${s.label}: ${s.n}`} />)}
              </div>
              <div className="space-y-1.5">
                {q.statusDist.map((s: any) => (
                  <div key={s.label} className="flex items-center gap-2 text-[12px]"><span className={`w-2 h-2 rounded-full ${DOT[s.tone]}`} /><span className="text-gray-600 capitalize flex-1">{s.label}</span><span className="font-semibold text-gray-800 tabular-nums">{s.n}</span></div>
                ))}
              </div>
              {q.byKind.length > 0 && <div className="mt-3 pt-3 border-t border-gray-50 space-y-1">{q.byKind.map((k: any) => <div key={k.kind} className="flex items-center justify-between text-[11px] text-gray-500"><span className="capitalize">{String(k.kind).replace(/_/g, " ")}</span><span className="tabular-nums">{k.n}</span></div>)}</div>}
            </div>

            {/* Suspicious duplicates */}
            <div className={`${card} p-4`}>
              <p className="text-[11px] font-semibold text-gray-500 mb-3">Suspected duplicates</p>
              {q.suspicious.length === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No duplicate files detected. ✅</p> : (
                <div className="space-y-2">
                  {q.suspicious.map((s: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[12px]"><span className="w-1.5 h-1.5 rounded-full bg-[var(--cmp-color-warning)] shrink-0" /><span className="text-gray-700 truncate flex-1" title={s.file}>{s.file}</span><span className="text-[10px] font-semibold text-[var(--cmp-text-warning)] shrink-0">×{s.count}</span></div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-gray-400 mt-3">Same file name + byte size across rows — a heuristic; a content hash on upload would make this exact.</p>
            </div>

            {/* Chain-of-custody log */}
            <div className={`${card} p-4`}>
              <p className="text-[11px] font-semibold text-gray-500 mb-3">Chain of custody</p>
              {q.events.length === 0 ? <p className="text-xs text-gray-400 py-6 text-center">No integrity events yet — verify an item to start the log.</p> : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {q.events.map((ev: any, i: number) => (
                    <div key={i} className="flex items-start gap-1.5 text-[11px]"><span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" /><span className="text-gray-600 flex-1 leading-tight"><span className="font-semibold capitalize">{ev.event_type}</span>{ev.actor_name ? ` · ${ev.actor_name}` : ""}</span><span className="text-gray-400 shrink-0">{fmt(ev.created_at)}</span></div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <p className="text-[11px] text-gray-400 mt-4 leading-relaxed">Verifying, flagging or rejecting an item writes an immutable integrity event (chain-of-custody). Duplicate detection is a file-name+size heuristic today; a content hash captured at upload would make authenticity/tamper exact — the honest next step.</p>
        </>
      )}
    </div>
  );
}
