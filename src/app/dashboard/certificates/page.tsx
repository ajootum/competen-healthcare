import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  OUTCOME_CONFIG, CREDENTIAL_TYPE_LABELS, CREDENTIAL_STATUS_CONFIG,
  RECOGNITION_TYPE_LABELS, type DecisionOutcome,
} from "@/lib/ckcm";

// Certificates & Credentials — everything the nurse has earned, plus what's expiring.

export default async function CertificatesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: credentials }, { data: recognitions }, { data: decisions }] = await Promise.all([
    admin.from("professional_credentials")
      .select("id, credential_type, title, issuing_body, status, verified, issue_date, expiry_date")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
    admin.from("professional_recognitions")
      .select("id, recognition_type, title, awarded_by_name, awarded_at")
      .eq("nurse_id", user.id).order("awarded_at", { ascending: false }),
    admin.from("competency_decisions")
      .select("competency_id, outcome, effective_date, expiry_date, created_at, framework_competencies(name)")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
  ]);

  // Latest passing decision per competency = a live "competency certificate"
  const seen = new Set<string>();
  const compCerts: { name: string; effective: string; expiry: string | null; days: number | null }[] = [];
  for (const d of decisions ?? []) {
    if (seen.has(d.competency_id)) continue;
    seen.add(d.competency_id);
    if (!OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing) continue;
    const days = d.expiry_date ? Math.ceil((new Date(d.expiry_date).getTime() - Date.now()) / 86400000) : null;
    compCerts.push({
      name: (d.framework_competencies as unknown as { name: string } | null)?.name ?? "—",
      effective: d.effective_date, expiry: d.expiry_date, days,
    });
  }

  const expiring = [
    ...compCerts.filter(c => c.days != null && c.days <= 90).map(c => ({ what: c.name, days: c.days! })),
    ...(credentials ?? []).filter(c => c.expiry_date).map(c => ({
      what: c.title, days: Math.ceil((new Date(c.expiry_date!).getTime() - Date.now()) / 86400000),
    })).filter(c => c.days <= 90),
  ].sort((a, b) => a.days - b.days);

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Certificates &amp; Credentials</h1>
          <p className="text-gray-400 text-sm mt-0.5">Your earned qualifications, live competency certificates and badges.</p>
        </div>
        <Link href="/dashboard/passport/print"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 px-3 py-1.5 rounded-lg transition-colors shrink-0">
          🖨️ Export portfolio
        </Link>
      </div>

      {expiring.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <p className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-2">⏰ Renewal alerts</p>
          {expiring.map((e, i) => (
            <p key={i} className="text-sm text-amber-900">
              {e.what} — {e.days < 0 ? <b>expired {-e.days} days ago</b> : <>expires in <b>{e.days} days</b></>}
            </p>
          ))}
        </div>
      )}

      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Professional Credentials 🎖️</h2>
      {(credentials ?? []).length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400 mb-6">
          No credentials recorded yet — your organisation adds licenses and certifications here.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 mb-6">
          {(credentials ?? []).map(c => {
            const st = CREDENTIAL_STATUS_CONFIG[c.status] ?? CREDENTIAL_STATUS_CONFIG.pending_verification;
            return (
              <div key={c.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="text-xl">🎖️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{c.title}
                    {c.verified && <span className="ml-1.5 text-[10px] text-blue-600 font-semibold">✓ verified</span>}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {CREDENTIAL_TYPE_LABELS[c.credential_type] ?? c.credential_type}
                    {c.issuing_body ? ` · ${c.issuing_body}` : ""}
                    {c.expiry_date ? ` · expires ${new Date(c.expiry_date).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Competency Certificates 🪪</h2>
      {compCerts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400 mb-6">
          Each competent decision becomes a live certificate here.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 mb-6">
          {compCerts.map((c, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3">
              <span className="text-xl">🪪</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800">{c.name}</p>
                <p className="text-[10px] text-gray-400">
                  Awarded {new Date(c.effective).toLocaleDateString()}
                  {c.expiry ? ` · valid to ${new Date(c.expiry).toLocaleDateString()}` : ""}
                </p>
              </div>
              {c.days != null && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  c.days < 0 ? "bg-red-50 text-red-600" : c.days <= 60 ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-600"}`}>
                  {c.days < 0 ? "Expired" : "Current"}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Badges 🏆</h2>
      {(recognitions ?? []).length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
          Awards and recognitions from your organisation appear here.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {(recognitions ?? []).map(r => {
            const t = RECOGNITION_TYPE_LABELS[r.recognition_type] ?? RECOGNITION_TYPE_LABELS.custom;
            return (
              <div key={r.id} className="bg-white rounded-xl border border-amber-100 px-4 py-3 flex items-center gap-2.5">
                <span className="text-xl">{t.icon}</span>
                <div>
                  <p className="text-sm font-medium text-gray-800">{r.title}</p>
                  <p className="text-[10px] text-gray-400">{t.label} · {new Date(r.awarded_at).toLocaleDateString()}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
