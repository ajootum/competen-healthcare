import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// COMP-023 PUBLIC passport verification page. NO auth — the unguessable token IS the access control.
// Renders ONLY a consented subset of the professional's OWN passport (verified/current achievements — never
// gaps, notes, patient data or anyone else's record), and only while the token is valid (not revoked/expired).
/* eslint-disable @typescript-eslint/no-explicit-any */

const nameOf = (row: any) => { const fc = row?.framework_competencies; return (Array.isArray(fc) ? fc[0]?.name : fc?.name) ?? null; };
const CRED_LABEL: Record<string, string> = { professional_license: "Professional licence", academic_qualification: "Academic qualification", board_certification: "Board certification", specialty_certification: "Specialty certification", internal_certification: "Internal certification", external_certification: "External certification", cpd_certificate: "CPD certificate", instructor_certification: "Instructor certification", mandatory_training: "Mandatory training" };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

function Shell({ children }: { children: any }) {
  return <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200 flex items-center justify-center p-4"><div className="w-full max-w-2xl">{children}</div></div>;
}
function Invalid({ reason }: { reason: string }) {
  return <Shell><div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center"><div className="text-4xl mb-3">🔒</div><h1 className="text-lg font-bold text-gray-900">Verification link unavailable</h1><p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto">{reason}</p><p className="text-[11px] text-gray-400 mt-6">Competen · Competency Passport Verification</p></div></Shell>;
}

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient() as any;

  const { data: share, error } = await admin.from("passport_share_tokens").select("id, nurse_id, scope, label, expires_at, consent, revoked, created_at, view_count").eq("token", token).maybeSingle();
  if (error || !share) return <Invalid reason="This verification link is invalid. Ask the professional to share a current link." />;
  if (share.revoked) return <Invalid reason="This verification link has been revoked by the professional." />;
  if (share.expires_at && new Date(share.expires_at) < new Date()) return <Invalid reason="This verification link has expired. Ask the professional for a new one." />;
  if (share.consent === false) return <Invalid reason="This verification link is no longer active." />;

  // Increment the view counter (fire-and-forget).
  admin.from("passport_share_tokens").update({ view_count: (share.view_count ?? 0) + 1 }).eq("id", share.id).then((r: any) => r, () => {});

  // ── Consented subset only ──
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, specialization, hospital_id").eq("id", share.nurse_id).maybeSingle();
  const today = new Date().toISOString().slice(0, 10);
  const { data: decRows } = await admin.from("competency_decisions").select("competency_id, outcome, expiry_date, created_at, framework_competencies(name)").eq("nurse_id", share.nurse_id).order("created_at", { ascending: false }).limit(3000);
  const latest = new Map<string, any>();
  (decRows ?? []).forEach((d: any) => { if (d.competency_id && !latest.has(d.competency_id)) latest.set(d.competency_id, d); });
  const current = [...latest.values()].filter(d => d.outcome === "competent" && (!d.expiry_date || d.expiry_date > today));
  const { data: creds } = await admin.from("professional_credentials").select("title, issuing_body, credential_type, expiry_date").eq("nurse_id", share.nurse_id).eq("verified", true).eq("status", "active").order("issue_date", { ascending: false }).limit(50);
  const credentials = (creds ?? []) as any[];

  const roleLabel = (profile?.roles?.[0] ?? profile?.role ?? "Healthcare professional").replace(/_/g, " ");
  const full = share.scope === "full";
  const competencyNames = current.map(nameOf).filter(Boolean) as string[];

  return (
    <Shell>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-gradient-to-r from-teal-700 to-teal-600 px-6 py-5 text-white">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-widest text-teal-100/80 font-semibold">Competen · Verified Passport</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] bg-white/15 rounded-full px-2.5 py-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-300" />Valid</span>
          </div>
          <div className="flex items-center gap-4 mt-3">
            <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold shrink-0">{profile?.full_name?.[0] ?? "?"}</div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold truncate">{profile?.full_name ?? "Professional"}</h1>
              <p className="text-teal-50 text-sm capitalize">{roleLabel}{profile?.specialization ? ` · ${profile.specialization}` : ""}</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-teal-50 rounded-xl p-3"><p className="text-2xl font-bold text-teal-700 tabular-nums">{current.length}</p><p className="text-[11px] text-gray-500">Current competencies</p></div>
            <div className="bg-teal-50 rounded-xl p-3"><p className="text-2xl font-bold text-teal-700 tabular-nums">{credentials.length}</p><p className="text-[11px] text-gray-500">Verified credentials</p></div>
            <div className="bg-teal-50 rounded-xl p-3"><p className="text-2xl font-bold text-teal-700 tabular-nums">{new Set(competencyNames).size}</p><p className="text-[11px] text-gray-500">Distinct areas</p></div>
          </div>

          {full && competencyNames.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-2">Current competencies</h2>
              <div className="flex flex-wrap gap-1.5">{competencyNames.slice(0, 40).map((n, i) => <span key={i} className="text-[11px] bg-gray-100 text-gray-700 rounded-full px-2.5 py-1">{n}</span>)}</div>
            </div>
          )}

          {full && credentials.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-900 mb-2">Verified credentials</h2>
              <div className="space-y-1.5">
                {credentials.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12.5px] border-b border-gray-50 pb-1.5">
                    <span className="text-emerald-500">✓</span>
                    <span className="font-medium text-gray-800 flex-1 min-w-0 truncate">{c.title}</span>
                    <span className="text-[10px] text-gray-400">{CRED_LABEL[c.credential_type] ?? c.credential_type}</span>
                    {c.issuing_body && <span className="text-[11px] text-gray-500 truncate max-w-[9rem]">{c.issuing_body}</span>}
                    {c.expiry_date && <span className="text-[10px] text-gray-400 tabular-nums">exp {fmt(c.expiry_date)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!full && <p className="text-[12px] text-gray-500">This is a summary verification. The professional can share a detailed link that lists their current competencies and verified credentials.</p>}

          <div className="border-t border-gray-100 pt-4 text-[11px] text-gray-400 space-y-0.5">
            {share.label && <p className="text-gray-500">Purpose: {share.label}</p>}
            <p>Shared {fmt(share.created_at)} · valid until {fmt(share.expires_at)}.</p>
            <p>A consented, time-limited verification shared by the professional. It shows only verified, current achievements and can be revoked at any time. Verified by the Competen Competency Passport.</p>
          </div>
        </div>
      </div>
    </Shell>
  );
}
