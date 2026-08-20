import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRootCause } from "@/lib/qie/root-cause";
import { StartInvestigation, InvestigationPanel } from "./RootCauseActions";
import { cardClass } from "@/components/ui/primitives";
import { requireHqCapability } from "@/lib/hq/context";

// QIE-005 — Root Cause & Causal Intelligence.
//
// The one engine the QIE-000 inventory found genuinely missing. Everything else in the spec already
// existed under another name; this did not, and the consequence was measurable: every incident recorded,
// closed, and never analysed.
//
// The page leads with the BACKLOG rather than with the investigations, because on the day it ships there
// are none, and a list of zero investigations tells a quality manager nothing. A list of eight incidents
// nobody has explained tells them exactly what to do next.

export const dynamic = "force-dynamic";

const SEV: Record<string, string> = {
  critical: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
  major: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]",
  moderate: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  minor: "bg-gray-100 text-gray-600",
};

export default async function RootCausePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  await requireHqCapability("hq.quality.intelligence.view");

  const v = await loadRootCause(admin, profile?.hospital_id ?? null, true);
  const s = v.stats;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] font-bold text-gray-500 tracking-widest">QIE-005</p>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Root Cause &amp; Causal Intelligence</h1>
          <p className="text-sm text-gray-500">Explain why events happen, not just that they did.</p>
        </div>
        <Link href="/super-admin/quality-intelligence" className="text-xs text-[var(--cmp-text-information)] hover:underline shrink-0">← Quality Intelligence</Link>
      </div>

      {!v.ready ? (
        <div className={cardClass}>
          <p className="text-sm font-semibold text-gray-900">Not deployed</p>
          <p className="text-[11px] text-gray-500 mt-1">{v.reason}</p>
        </div>
      ) : (
        <>
          <div className={cardClass}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { n: s.incidents, l: "Incidents recorded" },
                { n: s.investigated, l: "With an investigation" },
                { n: s.analysisRate === null ? "—" : `${s.analysisRate}%`, l: "Analysis rate" },
                { n: s.linkedToCapa, l: "Linked to a CAPA" },
              ].map(x => (
                <div key={x.l}>
                  <p className="text-2xl font-bold text-gray-900 leading-none tabular-nums">{x.n}</p>
                  <p className="text-[11px] text-gray-500 mt-1">{x.l}</p>
                </div>
              ))}
            </div>
            {s.analysisRate === 0 && s.incidents > 0 && (
              <p className="text-[11px] text-[var(--cmp-text-warning)] mt-3">
                Every recorded incident is unexplained. Until migration 180 there was nowhere to record an analysis —
                this is a new capability, not a neglected one.
              </p>
            )}
            {s.analysisRate === null && (
              <p className="text-[11px] text-gray-500 mt-3">
                No incidents recorded, so there is no rate to show. A 0% here would be a made-up number, not an empty one.
              </p>
            )}
          </div>

          {/* The backlog first: on day one this is the only thing with content in it. */}
          <div className={cardClass}>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Awaiting analysis</h2>
                <p className="text-[11px] text-gray-500">Incidents with no root-cause investigation.</p>
              </div>
              <span className="text-[11px] text-gray-500 shrink-0">{v.unanalysed.length}</span>
            </div>
            {v.unanalysed.length === 0 ? (
              <p className="text-[11px] text-gray-500">Every recorded incident has an investigation.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {v.unanalysed.slice(0, 25).map(i => (
                  <div key={i.id} className="py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 truncate">{i.description ?? i.incident_type ?? "Incident"}</p>
                      <p className="text-[10px] text-gray-500">{i.incident_type ?? "—"} · {new Date(i.created_at).toLocaleDateString()}</p>
                    </div>
                    <span className="flex items-center gap-2 shrink-0">
                      {i.severity && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${SEV[String(i.severity)] ?? "bg-gray-100 text-gray-600"}`}>{i.severity}</span>
                      )}
                      <StartInvestigation incidentId={i.id} label={i.description ?? i.incident_type ?? "Incident"} />
                    </span>
                  </div>
                ))}
                {v.unanalysed.length > 25 && (
                  <p className="text-[10px] text-gray-500 pt-2">… and {v.unanalysed.length - 25} more. Not truncated silently: this is the count.</p>
                )}
              </div>
            )}
          </div>

          {/* Contributing-factor distribution — the causal pattern across everything analysed so far. */}
          <div className={cardClass}>
            <h2 className="text-sm font-bold text-gray-900 mb-1">Contributing factors by category</h2>
            <p className="text-[11px] text-gray-500 mb-3">
              Ishikawa categories. A contributing factor is not a root cause — several contribute, few are causal,
              and the counts are kept apart so an investigation does not end with eight &ldquo;causes&rdquo;.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {s.factorsByCategory.map(c => (
                <div key={c.category} className={`rounded-lg border p-2.5 ${c.total > 0 ? "border-gray-200 bg-white" : "border-dashed border-gray-200 bg-gray-50/60"}`}>
                  <p className={`text-lg font-bold leading-none tabular-nums ${c.total > 0 ? "text-gray-900" : "text-gray-500"}`}>{c.total}</p>
                  <p className="text-[11px] text-gray-600 mt-1">{c.label}</p>
                  <p className="text-[9px] text-gray-500">{c.root} root cause{c.root === 1 ? "" : "s"}</p>
                </div>
              ))}
            </div>
          </div>

          <div className={cardClass}>
            <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
              <h2 className="text-sm font-bold text-gray-900">Investigations</h2>
              <span className="text-[11px] text-gray-500 shrink-0">{s.open} open · {s.completed} completed</span>
            </div>
            {v.investigations.length === 0 ? (
              <p className="text-[11px] text-gray-500">
                None yet. The store exists and is empty — which is the true state, not a rendering of nothing.
              </p>
            ) : (
              <div className="divide-y divide-gray-50">
                {v.investigations.map(inv => (
                  <div key={inv.id} className="py-3">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{inv.title}</p>
                        <p className="text-[10px] text-gray-500">
                          {inv.method.replace(/_/g, " ")} · opened {new Date(inv.opened_at).toLocaleDateString()}
                          {inv.opened_by_name ? ` by ${inv.opened_by_name}` : ""}
                          {inv.confidence ? ` · confidence ${inv.confidence}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{inv.status.replace(/_/g, " ")}</span>
                    </div>
                    {inv.root_cause_summary && <p className="text-[11px] text-gray-600 mt-1.5">{inv.root_cause_summary}</p>}
                    {inv.factors.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {inv.factors.map(f => (
                          <span key={f.id} className={`text-[10px] px-1.5 py-0.5 rounded border ${f.is_root_cause ? "border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" : "border-gray-200 bg-gray-50 text-gray-600"}`}>
                            {f.category}: {f.description}{f.is_root_cause ? " · root" : ""}
                          </span>
                        ))}
                      </div>
                    )}
                    {inv.capa_action_id && (
                      <p className="text-[10px] text-[var(--cmp-text-success)] mt-1.5">
                        A corrective action was opened from this finding.
                      </p>
                    )}
                    <InvestigationPanel id={inv.id} status={inv.status} hasRootCause={inv.factors.some(f => f.is_root_cause)} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
