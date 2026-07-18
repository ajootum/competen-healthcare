import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CREDENTIAL_TYPE_LABELS, RECOGNITION_TYPE_LABELS, OUTCOME_CONFIG, type DecisionOutcome } from "@/lib/ckcm";
import CredentialsWorkspace, { type CredRow } from "./CredentialsWorkspace";
import CredentialManager from "./CredentialManager";

// Certificates & Credentials workspace (Volume 3 spec). Professional
// credentials come from the org's governed record; competency certificates
// are the validated passing decisions (spec rule: only validated decisions
// create certificates), stamped with the issuing employer; badges are
// professional recognitions. No QR/wallet/upload — no backing yet, so no
// dead buttons; portfolio export is the printable passport.

const dayMs = 86400000;
// Server component renders once per request, so "now" is stable for a render.
const nowMs = () => Date.now();
const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";

const CRED_ICON: Record<string, string> = {
  professional_license: "🪪", academic_qualification: "🎓", board_certification: "🏛️",
  specialty_certification: "🧠", internal_certification: "🏥", external_certification: "📜",
  cpd_certificate: "⏱️", instructor_certification: "🧭", mandatory_training: "✅",
};

function statusOf(expiry: string | null, base: "active" | "pending" | "suspended" = "active"):
  { status: CredRow["status"]; label: string } {
  if (base !== "active") return { status: base, label: base === "pending" ? "Pending verification" : "Suspended" };
  if (!expiry) return { status: "active", label: "Active" };
  const days = Math.ceil((new Date(expiry).getTime() - nowMs()) / dayMs);
  if (days < 0) return { status: "expired", label: "Expired" };
  if (days <= 90) return { status: "expiring", label: `Expires in ${days}d` };
  return { status: "active", label: "Active" };
}

export default async function CertificatesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: credentials }, { data: recognitions }, { data: decisions }] = await Promise.all([
    admin.from("professional_credentials")
      .select("id, credential_number, credential_type, title, issuing_body, status, verified, issue_date, expiry_date, document_url")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
    admin.from("professional_recognitions")
      .select("id, recognition_type, title, description, awarded_by_name, awarded_at")
      .eq("nurse_id", user.id).order("awarded_at", { ascending: false }),
    admin.from("competency_decisions")
      .select("id, competency_id, outcome, validation_outcome, effective_date, expiry_date, created_at, framework_competencies(name), hospitals(name)")
      .eq("nurse_id", user.id).order("created_at", { ascending: false }),
  ]);

  // Competency certificates: latest validated passing decision per competency
  const seen = new Set<string>();
  const certRows: CredRow[] = [];
  for (const d of decisions ?? []) {
    if (seen.has(d.competency_id)) continue;
    seen.add(d.competency_id);
    if (d.validation_outcome !== "validated") continue;
    if (!OUTCOME_CONFIG[d.outcome as DecisionOutcome]?.passing) continue;
    const st = statusOf(d.expiry_date);
    certRows.push({
      id: `cert-${d.id}`, kind: "certificate", icon: "📜",
      title: (d.framework_competencies as unknown as { name: string } | null)?.name ?? "Competency",
      subtitle: (d.hospitals as unknown as { name: string } | null)?.name ?? "Issued on validation",
      refNumber: `CERT-${d.id.slice(0, 8).toUpperCase()}`, docUrl: null,
      issued: d.effective_date, expires: d.expiry_date,
      status: st.status, statusLabel: st.label,
    });
  }

  // Self-managed licences/registrations with attached documents (§A + §E)
  const credIds = (credentials ?? []).map(c => c.id);
  const { data: credEvidence } = credIds.length
    ? await admin.from("evidence")
        .select("id, credential_id, file_name, mime_type, size_bytes, note, created_at")
        .in("credential_id", credIds).order("created_at")
    : { data: [] };
  const evidenceByCred = new Map<string, { id: string; file_name: string; mime_type: string; size_bytes: number; note: string | null; created_at: string }[]>();
  for (const ev of (credEvidence ?? []) as unknown as { id: string; credential_id: string; file_name: string; mime_type: string; size_bytes: number; note: string | null; created_at: string }[]) {
    const list = evidenceByCred.get(ev.credential_id) ?? [];
    list.push(ev);
    evidenceByCred.set(ev.credential_id, list);
  }
  const ownCredentials = (credentials ?? []).map(c => ({
    id: c.id, title: c.title, credential_type: c.credential_type,
    issuing_body: c.issuing_body, credential_number: c.credential_number,
    issue_date: c.issue_date, expiry_date: c.expiry_date,
    status: c.status, verified: !!c.verified,
    evidence: evidenceByCred.get(c.id) ?? [],
  }));

  const credRows: CredRow[] = (credentials ?? []).map(c => {
    const base = c.status === "pending_verification" ? "pending" : c.status === "suspended" || c.status === "revoked" ? "suspended" : "active";
    const st = statusOf(c.expiry_date, base as "active" | "pending" | "suspended");
    return {
      id: `cred-${c.id}`, kind: "credential" as const,
      icon: CRED_ICON[c.credential_type] ?? "🪪",
      title: c.title,
      subtitle: `${CREDENTIAL_TYPE_LABELS[c.credential_type] ?? c.credential_type}${c.issuing_body ? ` · ${c.issuing_body}` : ""}${c.verified ? " · ✓ verified" : ""}`,
      refNumber: c.credential_number, docUrl: c.document_url,
      issued: c.issue_date, expires: c.expiry_date,
      status: st.status, statusLabel: st.label,
    };
  });

  const badgeRows: CredRow[] = (recognitions ?? []).map(r => ({
    id: `badge-${r.id}`, kind: "badge" as const,
    icon: RECOGNITION_TYPE_LABELS[r.recognition_type]?.icon ?? "🎖️",
    title: r.title,
    subtitle: `${RECOGNITION_TYPE_LABELS[r.recognition_type]?.label ?? "Recognition"}${r.awarded_by_name ? ` · ${r.awarded_by_name}` : ""}${r.description ? ` — ${r.description}` : ""}`,
    refNumber: null, docUrl: null,
    issued: r.awarded_at, expires: null,
    status: "active" as const, statusLabel: "Awarded",
  }));

  const rows = [...credRows, ...certRows, ...badgeRows];

  // ── KPIs + portfolio breakdown ──
  const expiringSoon = rows.filter(r => r.status === "expiring").length;
  const expired = rows.filter(r => r.status === "expired").length;
  const activeCount = rows.filter(r => r.status === "active").length;
  const upcoming = rows
    .filter(r => r.expires && new Date(r.expires).getTime() > nowMs())
    .sort((a, b) => a.expires!.localeCompare(b.expires!))
    .slice(0, 4)
    .map(r => ({ ...r, days: Math.ceil((new Date(r.expires!).getTime() - nowMs()) / dayMs) }));

  const donut = [
    { label: "Active", n: activeCount, color: "#16a34a" },
    { label: "Expiring soon", n: expiringSoon, color: "#f59e0b" },
    { label: "Expired", n: expired, color: "#ef4444" },
    { label: "Pending/other", n: rows.length - activeCount - expiringSoon - expired, color: "#9ca3af" },
  ];
  const total = rows.length;
  const circ = 2 * Math.PI * 40;
  let arcOffset = 0;
  const arcs = donut.filter(d => d.n > 0).map(d => {
    const len = total ? (d.n / total) * circ : 0;
    const a = { ...d, dash: `${len} ${circ - len}`, offset: -arcOffset };
    arcOffset += len;
    return a;
  });

  const card = "bg-white rounded-xl border border-gray-100";

  const KPI = [
    { icon: "🪪", value: credRows.length, label: "Professional Credentials", tint: "bg-green-50" },
    { icon: "📜", value: certRows.length, label: "Competency Certificates", tint: "bg-violet-50" },
    { icon: "🏅", value: badgeRows.length, label: "Badges & Recognitions", tint: "bg-amber-50" },
    { icon: "⏳", value: expiringSoon, label: "Expiring Soon (90 days)", tint: "bg-blue-50" },
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Certificates &amp; Credentials</h1>
          <p className="text-gray-400 text-sm mt-0.5">Your earned qualifications, certifications and recognitions.</p>
        </div>
        <Link href="/dashboard/passport/print"
          className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg">
          🖨️ Export portfolio
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
        {KPI.map(k => (
          <div key={k.label} className={`${card} p-4 flex items-center gap-3`}>
            <span className={`w-10 h-10 rounded-full ${k.tint} flex items-center justify-center text-lg shrink-0`}>{k.icon}</span>
            <div>
              <p className="text-2xl font-bold text-gray-900">{k.value}</p>
              <p className="text-[10px] text-gray-500 font-medium leading-tight">{k.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_290px] gap-5">
        <div className="min-w-0">
          <CredentialManager credentials={ownCredentials} />
          <CredentialsWorkspace rows={rows} />
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-5">
          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-sm mb-3">Your Credential Portfolio</h2>
            {total ? (
              <div className="flex items-center gap-4">
                <svg width="96" height="96" viewBox="0 0 96 96">
                  {arcs.map(a => (
                    <circle key={a.label} cx="48" cy="48" r="40" fill="none" stroke={a.color} strokeWidth="10"
                      strokeDasharray={a.dash} strokeDashoffset={a.offset} transform="rotate(-90 48 48)" />
                  ))}
                  <text x="48" y="45" textAnchor="middle" fontSize="18" fontWeight="800" fill="#111827">{total}</text>
                  <text x="48" y="60" textAnchor="middle" fontSize="8" fill="#9ca3af">Total</text>
                </svg>
                <div className="flex-1 flex flex-col gap-1">
                  {donut.map(d => (
                    <div key={d.label} className="flex items-center gap-1.5 text-[11px]">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="text-gray-600 flex-1">{d.label}</span>
                      <b className="text-gray-800">{d.n}</b>
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className="text-xs text-gray-400 text-center py-3">Your portfolio builds as records are added. 🗂️</p>}
          </div>

          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-sm mb-3">Upcoming Expirations</h2>
            {upcoming.length ? upcoming.map(u => (
              <div key={u.id} className="flex items-center gap-2.5 py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-base shrink-0">{u.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-gray-800 truncate">{u.title}</p>
                  <p className="text-[9px] text-gray-400" suppressHydrationWarning>Expires {fmt(u.expires)}</p>
                </div>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${u.days <= 90 ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-500"}`}>
                  {u.days} days
                </span>
              </div>
            )) : <p className="text-xs text-gray-400 text-center py-3">Nothing expiring on record. ✅</p>}
          </div>

          <div className={`${card} p-5`}>
            <h2 className="font-semibold text-gray-900 text-sm mb-2.5">Quick Actions</h2>
            <div className="flex flex-col gap-1.5">
              <Link href="/dashboard/passport/print" className="text-[11px] font-semibold text-teal-700 hover:underline">🖨️ Print / download portfolio</Link>
              <Link href="/dashboard/passport" className="text-[11px] font-semibold text-teal-700 hover:underline">🧠 View Competency Passport</Link>
              <Link href="/dashboard/cpd" className="text-[11px] font-semibold text-teal-700 hover:underline">⏱️ Log CPD activity</Link>
            </div>
            <p className="text-[9px] text-gray-300 mt-3">
              Credentials are recorded and verified by your organisation; competency certificates are issued automatically when an educator validates a passing decision.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
