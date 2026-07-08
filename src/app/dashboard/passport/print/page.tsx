import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import PrintButton from "./PrintButton";
import {
  OUTCOME_CONFIG, MATURITY_LABELS, AUTH_TYPE_LABELS, AUTH_STATUS_CONFIG,
  CREDENTIAL_TYPE_LABELS, RECOGNITION_TYPE_LABELS,
  type DecisionOutcome, type Maturity, type AuthorizationType, type AuthStatus,
} from "@/lib/ckcm";

// Printable Competency Passport — a formal, accreditation-ready record.
// Uses window.print(); browsers offer "Save as PDF" from the same dialog.

const SCORE_LABELS = ["Training Required", "Novice", "Advanced Beginner", "Competent", "Competent+", "Proficient", "Expert"];

const fmt = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default async function PassportPrintPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, role, hospital_id, hospitals(name)")
    .eq("id", user.id)
    .single();
  if (!profile) redirect("/login");
  const hospitalName = (profile.hospitals as unknown as { name: string } | null)?.name ?? null;

  const [{ data: allDecisions }, { data: authorizations }, { data: credentials }, { data: recognitions }, { data: allScores }] =
    await Promise.all([
      admin.from("competency_decisions")
        .select("competency_id, outcome, maturity, effective_date, expiry_date, critical_failure, decided_by_name, created_at, framework_competencies(name, framework_domains(name, frameworks(name)))")
        .eq("nurse_id", user.id).order("created_at", { ascending: false }),
      admin.from("clinical_authorizations")
        .select("authorization_number, authorization_type, authorization_level, status, scope, conditions, effective_date, expiry_date")
        .eq("nurse_id", user.id).in("status", ["active", "suspended"]).order("created_at", { ascending: false }),
      admin.from("professional_credentials")
        .select("credential_type, title, issuing_body, status, verified, issue_date, expiry_date")
        .eq("nurse_id", user.id).order("created_at", { ascending: false }),
      admin.from("professional_recognitions")
        .select("recognition_type, title, awarded_by_name, awarded_at")
        .eq("nurse_id", user.id).order("awarded_at", { ascending: false }),
      admin.from("competency_scores")
        .select("competency_id, score, label, is_passing, assessed_at, educator_validated, framework_competencies(name, framework_domains(name, frameworks(name)))")
        .eq("nurse_id", user.id).order("assessed_at", { ascending: false }),
    ]);

  type NamedComp = { name: string; framework_domains: { name: string; frameworks: { name: string } | null } | null } | null;
  const compName = (c: unknown) => {
    const n = c as NamedComp;
    return { name: n?.name ?? "—", domain: n?.framework_domains?.name ?? "—", framework: n?.framework_domains?.frameworks?.name ?? "—" };
  };

  // Latest decision per competency
  const dseen = new Set<string>();
  const decisions = (allDecisions ?? []).filter(d => {
    if (dseen.has(d.competency_id)) return false;
    dseen.add(d.competency_id);
    return true;
  });

  // Latest score per competency
  const sseen = new Set<string>();
  const scores = (allScores ?? []).filter(s => {
    if (sseen.has(s.competency_id)) return false;
    sseen.add(s.competency_id);
    return true;
  });

  const competent = decisions.filter(d => OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing).length;
  const generated = new Date().toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const th = "text-left text-[10px] font-bold uppercase tracking-wider text-gray-500 border-b-2 border-gray-800 pb-1.5 pr-4";
  const td = "text-[11px] text-gray-800 border-b border-gray-200 py-1.5 pr-4 align-top";

  return (
    <div className="min-h-screen bg-white text-gray-900 print-root">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-root { padding: 0 !important; }
          @page { margin: 14mm; }
        }
      `}</style>

      <div className="max-w-3xl mx-auto px-8 py-8">
        {/* Screen-only toolbar */}
        <div className="no-print flex items-center justify-between mb-8 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
          <Link href="/dashboard/passport" className="text-sm text-teal-700 hover:underline">← Back to passport</Link>
          <PrintButton />
        </div>

        {/* Document header */}
        <header className="border-b-4 border-teal-700 pb-4 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-teal-700 mb-1">Competen · Clinical Knowledge & Competency Management</p>
              <h1 className="text-2xl font-bold">Competency Passport</h1>
              <p className="text-sm text-gray-600 mt-1">
                {profile.full_name}
                {hospitalName ? ` · ${hospitalName}` : ""}
              </p>
            </div>
            <div className="text-right text-[10px] text-gray-500">
              <p>Record ID: {user.id.slice(0, 8).toUpperCase()}</p>
              <p>Generated: {generated}</p>
            </div>
          </div>
          <div className="flex gap-6 mt-3 text-[11px] text-gray-700">
            <span><b>{decisions.length}</b> formal decisions</span>
            <span><b>{competent}</b> competent</span>
            <span><b>{(authorizations ?? []).length}</b> active authorizations</span>
            <span><b>{(credentials ?? []).length}</b> credentials</span>
            <span><b>{(recognitions ?? []).length}</b> recognitions</span>
          </div>
        </header>

        {/* Formal competency decisions */}
        <section className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-800 mb-2">1 · Formal Competency Decisions</h2>
          {decisions.length === 0 ? (
            <p className="text-[11px] text-gray-500 italic">No formal competency decisions recorded.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead><tr>
                <th className={th}>Competency</th><th className={th}>Framework / Domain</th>
                <th className={th}>Outcome</th><th className={th}>Maturity</th>
                <th className={th}>Effective</th><th className={th}>Valid until</th>
              </tr></thead>
              <tbody>
                {decisions.map((d, i) => {
                  const c = compName(d.framework_competencies);
                  const oc = OUTCOME_CONFIG[d.outcome as DecisionOutcome];
                  return (
                    <tr key={i}>
                      <td className={td}>{c.name}{d.critical_failure ? " ⚠" : ""}</td>
                      <td className={td}>{c.framework} · {c.domain}</td>
                      <td className={`${td} font-semibold`}>{oc?.label ?? d.outcome}</td>
                      <td className={td}>{d.maturity ? MATURITY_LABELS[d.maturity as Maturity] : "—"}</td>
                      <td className={td}>{fmt(d.effective_date)}</td>
                      <td className={td}>{fmt(d.expiry_date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* Clinical authorizations */}
        <section className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-800 mb-2">2 · Clinical Authorizations</h2>
          {(authorizations ?? []).length === 0 ? (
            <p className="text-[11px] text-gray-500 italic">No active clinical authorizations.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead><tr>
                <th className={th}>Number</th><th className={th}>Type</th><th className={th}>Level</th>
                <th className={th}>Scope / Conditions</th><th className={th}>Status</th><th className={th}>Valid until</th>
              </tr></thead>
              <tbody>
                {(authorizations ?? []).map((a, i) => (
                  <tr key={i}>
                    <td className={`${td} font-mono text-[10px]`}>{a.authorization_number}</td>
                    <td className={td}>{AUTH_TYPE_LABELS[a.authorization_type as AuthorizationType] ?? a.authorization_type}</td>
                    <td className={`${td} capitalize`}>{a.authorization_level}</td>
                    <td className={td}>{a.scope ?? "—"}{a.conditions ? ` · ${a.conditions}` : ""}</td>
                    <td className={`${td} font-semibold`}>{AUTH_STATUS_CONFIG[a.status as AuthStatus]?.label ?? a.status}</td>
                    <td className={td}>{fmt(a.expiry_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Credentials */}
        <section className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-800 mb-2">3 · Professional Credentials</h2>
          {(credentials ?? []).length === 0 ? (
            <p className="text-[11px] text-gray-500 italic">No credentials recorded.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead><tr>
                <th className={th}>Credential</th><th className={th}>Type</th><th className={th}>Issuing body</th>
                <th className={th}>Issued</th><th className={th}>Expires</th><th className={th}>Verified</th>
              </tr></thead>
              <tbody>
                {(credentials ?? []).map((c, i) => (
                  <tr key={i}>
                    <td className={td}>{c.title}</td>
                    <td className={td}>{CREDENTIAL_TYPE_LABELS[c.credential_type] ?? c.credential_type}</td>
                    <td className={td}>{c.issuing_body ?? "—"}</td>
                    <td className={td}>{fmt(c.issue_date)}</td>
                    <td className={td}>{fmt(c.expiry_date)}</td>
                    <td className={`${td} font-semibold`}>{c.verified ? "✓ Verified" : "Pending"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Recognitions */}
        <section className="mb-6">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-800 mb-2">4 · Professional Recognitions</h2>
          {(recognitions ?? []).length === 0 ? (
            <p className="text-[11px] text-gray-500 italic">No recognitions recorded.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead><tr>
                <th className={th}>Recognition</th><th className={th}>Type</th><th className={th}>Awarded by</th><th className={th}>Date</th>
              </tr></thead>
              <tbody>
                {(recognitions ?? []).map((r, i) => (
                  <tr key={i}>
                    <td className={td}>{r.title}</td>
                    <td className={td}>{RECOGNITION_TYPE_LABELS[r.recognition_type]?.label ?? r.recognition_type}</td>
                    <td className={td}>{r.awarded_by_name ?? "—"}</td>
                    <td className={td}>{fmt(r.awarded_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Assessment scores */}
        <section className="mb-8">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-800 mb-2">5 · Assessment Scores (latest per competency)</h2>
          {scores.length === 0 ? (
            <p className="text-[11px] text-gray-500 italic">No assessment scores recorded.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead><tr>
                <th className={th}>Competency</th><th className={th}>Framework / Domain</th>
                <th className={th}>Score</th><th className={th}>Level</th>
                <th className={th}>Assessed</th><th className={th}>Validated</th>
              </tr></thead>
              <tbody>
                {scores.map((s, i) => {
                  const c = compName(s.framework_competencies);
                  return (
                    <tr key={i}>
                      <td className={td}>{c.name}</td>
                      <td className={td}>{c.framework} · {c.domain}</td>
                      <td className={`${td} font-semibold`}>{s.score}/6{s.is_passing ? " ✓" : ""}</td>
                      <td className={td}>{s.label ?? SCORE_LABELS[s.score] ?? "—"}</td>
                      <td className={td}>{fmt(s.assessed_at)}</td>
                      <td className={td}>{s.educator_validated ? "✓ Educator" : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* Footer */}
        <footer className="border-t-2 border-gray-800 pt-3 text-[9px] text-gray-500 leading-relaxed">
          <p>
            This Competency Passport is a system-generated extract of the governed competency record held in the
            Competen CKCM platform. Competency decisions are made by authorized human assessors under the
            organisation&apos;s assessment blueprints; this document does not itself confer clinical authorization.
            Verify currency against the live record — entries may have been updated after generation.
          </p>
          <p className="mt-1">Generated {generated} · Record ID {user.id.slice(0, 8).toUpperCase()} · Page printed from /dashboard/passport/print</p>
        </footer>
      </div>
    </div>
  );
}
