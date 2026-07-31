import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import CompetencyTabs from "../CompetencyTabs";
import { loadRecertPipeline } from "@/lib/operations/competency-centre";
import { cardClass } from "@/components/ui/primitives";

// Competency Management → Expiries & Recertification (UMG-CM). A dated pipeline of what lapses when, over the
// two real expiry sources: professional_credentials and competency_decisions. Read-only — renewals run through
// the credentialing and assessment surfaces (cross-linked). No migration.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const KIND_CLS: Record<string, string> = { Credential: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]", Competency: "bg-violet-50 text-violet-600" };
const daysCls = (d: number) => (d < 0 ? "text-[var(--cmp-text-error)]" : d <= 30 ? "text-[var(--cmp-text-warning)]" : "text-gray-500");
const daysLabel = (d: number) => (d < 0 ? `${Math.abs(d)}d overdue` : `in ${d}d`);

export default async function RecertPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const p = await loadRecertPipeline(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const card = cardClass;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Expiries & Recertification</h1>
        <p className="text-sm text-gray-500 mt-1">Credentials and competencies lapsing across your unit — soonest first — so renewals happen before deployment is blocked.</p>
      </div>
      <CompetencyTabs />

      {!p.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6 text-sm text-amber-800">Credential and competency expiry data isn&apos;t available for this unit yet.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "Lapsing ≤ 90 days", value: p.kpis.total, tone: "text-gray-900" },
              { label: "Already expired", value: p.kpis.expired, tone: "text-[var(--cmp-text-error)]" },
              { label: "Within 30 days", value: p.kpis.in30, tone: "text-[var(--cmp-text-warning)]" },
              { label: "Credentials", value: p.kpis.credentials, tone: "text-[var(--cmp-text-information)]" },
              { label: "Competencies", value: p.kpis.competencies, tone: "text-violet-600" },
            ].map(k => (
              <div key={k.label} className={card}><div className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.value}</div><div className="text-xs text-gray-500 mt-1 font-medium">{k.label}</div></div>
            ))}
          </div>

          <div className="flex items-center gap-3 text-[11px] text-gray-400">
            <span>Renew via:</span>
            <Link href="/competency-office/credentialing" className="text-teal-600 hover:underline">Credentialing ↗</Link>
            <Link href="/competency-office/assessments" className="text-teal-600 hover:underline">Assessments ↗</Link>
          </div>

          {p.buckets.length === 0 ? (
            <div className={card}><p className="text-sm text-gray-400">Nothing lapses within 90 days. 🎉</p></div>
          ) : p.buckets.map((b: any) => (
            <div key={b.label} className={card}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900 text-sm">{b.label}</h3>
                <span className="text-[11px] font-semibold text-gray-400 bg-gray-50 border border-gray-100 rounded px-2 py-0.5">{b.items.length}</span>
              </div>
              <div className="divide-y divide-gray-50">
                {b.items.slice(0, 40).map((it: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 py-2">
                    <span className={`text-[9px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 shrink-0 w-20 text-center ${KIND_CLS[it.kind]}`}>{it.kind}</span>
                    <span className="text-sm text-gray-800 truncate flex-1" title={it.label}>{it.label}</span>
                    <span className="text-xs text-gray-500 truncate max-w-[140px]">{it.person}{it.role ? ` · ${it.role}` : ""}</span>
                    <span className="text-[11px] text-gray-400 tabular-nums w-20 text-right">{it.expiry}</span>
                    <span className={`text-[11px] font-semibold tabular-nums w-24 text-right ${daysCls(it.days)}`}>{daysLabel(it.days)}</span>
                  </div>
                ))}
                {b.items.length > 40 && <p className="text-[11px] text-gray-400 pt-2">+ {b.items.length - 40} more…</p>}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
