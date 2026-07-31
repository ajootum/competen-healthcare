import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadExecutiveAssurance } from "@/lib/cgr/executive";
import { Kpi } from "../_kit";

// CGR-029 — Strategic Decision Intelligence & Executive Assurance. The board-level competency-governance
// assurance statement (§8): assurance rating + the evidence behind it, strategic risk register, regulatory
// exposure, governance effectiveness and investment priorities. Broad executive intelligence → HEX. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const TONE: Record<string, { card: string; text: string; dot: string }> = {
  emerald: { card: "bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)]", text: "text-emerald-700", dot: "bg-[var(--cmp-color-success)]" },
  amber: { card: "bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]", text: "text-[var(--cmp-text-warning)]", dot: "bg-[var(--cmp-color-warning)]" },
  orange: { card: "bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]", text: "text-orange-700", dot: "bg-[var(--cmp-color-warning)]" },
  rose: { card: "bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)]", text: "text-[var(--cmp-text-error)]", dot: "bg-[var(--cmp-color-error)]" },
};
const RISK_META: Record<string, string> = {
  critical: "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)]",
  high: "text-orange-700 bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]",
};

export default async function ExecutiveAssurancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadExecutiveAssurance(admin) as any;

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-[var(--cmp-text-success)] uppercase tracking-widest mb-0.5">CGR-029 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Executive Assurance &amp; Strategic Decision Intelligence</h1>
          <p className="text-gray-400 text-sm mt-0.5">The board-level competency-governance assurance statement — can leadership be assured the workforce competency system is sound, and where should investment go?</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/hospital-executive" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)] rounded-lg px-3 py-2">Executive workspace →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No governance data to report on yet — the board assurance statement computes once competencies are under governance.</p></div>
      ) : (
        <div className="space-y-4">
          {/* Board assurance statement */}
          <div className={`rounded-xl border p-5 ${TONE[d.rating.tone].card}`}>
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">Board assurance statement · {d.today}</p>
                <div className="flex items-center gap-2.5">
                  <span className={`w-3 h-3 rounded-full ${TONE[d.rating.tone].dot}`} />
                  <p className={`text-2xl font-bold ${TONE[d.rating.tone].text}`}>{d.rating.label}</p>
                  <span className="text-[11px] text-gray-500">assurance score {d.assurance}/100</span>
                </div>
                <p className="text-[12px] text-gray-600 mt-1.5">{d.rating.statement}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
              {d.evidence.map((e: any) => (
                <div key={e.line} className="bg-white/70 border border-white rounded-lg p-2">
                  <div className="flex items-center gap-1"><span className={e.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-warning)]"}>{e.ok ? "✓" : "!"}</span><p className="text-[13px] font-bold text-gray-800 tabular-nums">{e.value}</p></div>
                  <p className="text-[10px] text-gray-500 leading-tight">{e.line}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Executive KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Under governance" value={d.capability.competencies} sub={`of ${d.capability.total} competencies`} />
            <Kpi label="Fully governed" value={d.capability.governed} sub="meet all criteria" tone="text-[var(--cmp-text-success)]" />
            <Kpi label="Capability at risk" value={d.capability.atRisk} sub="at-risk / ungoverned" tone={d.capability.atRisk ? "text-[var(--cmp-text-error)]" : "text-gray-900"} />
            <Kpi label="Regulatory alignment" value={`${d.regulatory.alignment}%`} sub="mapped to standards" />
            <Kpi label="Accreditation readiness" value={d.regulatory.accReadiness == null ? "—" : `${d.regulatory.accReadiness}%`} sub={`${d.regulatory.requirements} requirements`} tone={d.regulatory.accReadiness != null && d.regulatory.accReadiness >= 80 ? "text-[var(--cmp-text-success)]" : "text-gray-900"} />
            <Kpi label="Governance councils" value={d.effectiveness.councils} sub="active oversight" tone={d.effectiveness.councils ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Strategic risk register */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-800">Strategic risk register <span className="text-[10px] font-normal text-gray-400">(§5.3)</span></p>
                <Link href="/super-admin/cgr/risk" className="text-[10px] text-[var(--cmp-text-success)] hover:underline">full register →</Link>
              </div>
              {d.strategic.length === 0 ? (
                <div className="p-6 text-center"><p className="text-sm text-[var(--cmp-text-success)] font-medium">No high or critical-risk competency is currently ungoverned — no strategic escalation for the board.</p></div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {d.strategic.map((s: any, i: number) => (
                    <div key={i} className="flex items-start justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-gray-800 truncate">{s.name}</p>
                        <p className="text-[10px] text-gray-400">{s.domain ?? "—"} · {s.why}</p>
                      </div>
                      <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 capitalize shrink-0 ${RISK_META[s.risk] ?? RISK_META.high}`}>{s.risk}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Investment priorities */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-800">Investment priorities <span className="text-[10px] font-normal text-gray-400">(§5.4)</span></p>
                <Link href="/super-admin/cgr/analytics" className="text-[10px] text-[var(--cmp-text-success)] hover:underline">improvement engine →</Link>
              </div>
              {d.invest.length === 0 ? (
                <div className="p-6 text-center"><p className="text-sm text-[var(--cmp-text-success)] font-medium">No leadership investment asks outstanding — governance is fully resourced.</p></div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {d.invest.map((v: any, i: number) => (
                    <div key={i} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[12px] font-semibold text-gray-800">{v.ask}</p>
                        <span className="text-[9px] font-bold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 shrink-0">{v.lever}</span>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-0.5">{v.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Governance effectiveness */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Governance effectiveness (§7.4)</p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: "Review currency", v: `${d.capability.reviewPct}%`, warn: d.capability.reviewPct < 80 },
                { label: "Reviews overdue", v: d.capability.overdue, warn: !!d.capability.overdue },
                { label: "High-risk competencies", v: d.capability.highRisk, warn: false },
                { label: "Unmapped high-risk", v: d.regulatory.unmappedHighRisk, warn: !!d.regulatory.unmappedHighRisk },
                { label: "Changes in flight", v: d.effectiveness.changeOpen, warn: false },
                { label: "Changes delivered", v: d.effectiveness.changeDone, warn: false },
              ].map((x: any) => (
                <div key={x.label} className="border border-gray-100 rounded-lg p-2.5 text-center">
                  <p className={`text-lg font-bold tabular-nums ${x.warn ? "text-[var(--cmp-text-error)]" : "text-gray-900"}`}>{x.v}</p>
                  <p className="text-[10px] text-gray-500 leading-tight">{x.label}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is real — the assurance rating is derived from the live governance registry and the evidence lines behind it are the actual governance criteria (ownership, regulatory alignment, review currency, evidence, council oversight); the strategic risk register lists real high/critical-risk competencies that are ungoverned, unowned or overdue. This is the <span className="font-medium">governance</span> assurance position for the board; broad executive intelligence — financial, operational and workforce — is owned by the <Link href="/hospital-executive" className="text-[var(--cmp-text-success)] hover:underline">Hospital Executive workspace</Link>. Per the CGR mandate, AI may summarise insights and recommend priorities but never makes executive decisions, approves investment or replaces governance accountability.</p>
        </div>
      )}
    </div>
  );
}
