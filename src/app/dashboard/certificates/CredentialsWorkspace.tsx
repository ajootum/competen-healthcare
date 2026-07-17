"use client";

import { useMemo, useState } from "react";

// Certificates & Credentials workspace (Volume 3 spec): tabs + search over
// professional credentials, competency certificates (validated decisions) and
// badges — all real records passed from the server.

export type CredRow = {
  id: string; kind: "credential" | "certificate" | "badge";
  icon: string; title: string; subtitle: string | null;
  refNumber: string | null; docUrl: string | null;
  issued: string | null; expires: string | null;
  status: "active" | "expiring" | "expired" | "pending" | "suspended";
  statusLabel: string;
};

const STATUS_CLS: Record<CredRow["status"], string> = {
  active:   "bg-green-50 text-green-700",
  expiring: "bg-amber-50 text-amber-700",
  expired:  "bg-red-50 text-red-600",
  pending:  "bg-gray-100 text-gray-500",
  suspended: "bg-red-50 text-red-600",
};

const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SECTIONS: { kind: CredRow["kind"]; title: string; icon: string }[] = [
  { kind: "credential", title: "Professional Credentials", icon: "🪪" },
  { kind: "certificate", title: "Competency Certificates", icon: "📜" },
  { kind: "badge", title: "Badges & Recognitions", icon: "🏅" },
];

export default function CredentialsWorkspace({ rows }: { rows: CredRow[] }) {
  const [tab, setTab] = useState<"all" | CredRow["kind"] | "expired">("all");
  const [q, setQ] = useState("");

  const counts = useMemo(() => ({
    all: rows.length,
    credential: rows.filter(r => r.kind === "credential").length,
    certificate: rows.filter(r => r.kind === "certificate").length,
    badge: rows.filter(r => r.kind === "badge").length,
    expired: rows.filter(r => r.status === "expired").length,
  }), [rows]);

  const filtered = rows.filter(r => {
    if (tab === "expired" && r.status !== "expired") return false;
    if (tab !== "all" && tab !== "expired" && r.kind !== tab) return false;
    const s = q.trim().toLowerCase();
    if (s && ![r.title, r.subtitle, r.refNumber].some(v => (v ?? "").toLowerCase().includes(s))) return false;
    return true;
  });

  const TABS: { k: typeof tab; label: string }[] = [
    { k: "all", label: "All" },
    { k: "credential", label: "Professional Credentials" },
    { k: "certificate", label: "Certificates" },
    { k: "badge", label: "Badges" },
    { k: "expired", label: "Expired" },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="flex items-center gap-1 px-3 pt-2 border-b border-gray-50 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t.k ? "border-teal-600 text-teal-700" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
            {t.label} <span className="text-[9px] font-normal">{counts[t.k as keyof typeof counts]}</span>
          </button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search credentials…"
          className="ml-auto mb-1.5 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs w-40 focus:outline-none focus:ring-2 focus:ring-teal-500/30" />
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="text-3xl mb-2">🏆</p>
          <p className="text-sm text-gray-400">
            {rows.length === 0
              ? "Credentials, certificates and recognitions appear here as your organisation records them and as competencies are validated."
              : "Nothing matches the current filters."}
          </p>
        </div>
      ) : SECTIONS.filter(s => filtered.some(r => r.kind === s.kind)).map(sec => (
        <div key={sec.kind}>
          <p className="px-4 pt-4 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">{sec.icon} {sec.title}</p>
          {sec.kind === "badge" ? (
            <div className="flex flex-wrap gap-3 px-4 pb-4 pt-1">
              {filtered.filter(r => r.kind === "badge").map(b => (
                <div key={b.id} className="w-36 border border-amber-100 rounded-xl p-3 text-center" title={b.subtitle ?? undefined}>
                  <p className="text-2xl">{b.icon}</p>
                  <p className="text-[11px] font-semibold text-gray-800 leading-snug mt-1">{b.title}</p>
                  <p className="text-[9px] text-gray-400 mt-0.5" suppressHydrationWarning>Awarded {fmt(b.issued)}</p>
                </div>
              ))}
            </div>
          ) : filtered.filter(r => r.kind === sec.kind).map(r => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-50 last:border-0">
              <span className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-lg shrink-0">{r.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">
                  {r.title}
                  <span className={`ml-2 text-[9px] font-bold px-1.5 py-0.5 rounded ${STATUS_CLS[r.status]}`}>{r.statusLabel}</span>
                </p>
                <p className="text-[10px] text-gray-400">
                  {r.subtitle}{r.refNumber ? ` · ${r.refNumber}` : ""}
                  {r.docUrl && <> · <a href={r.docUrl} target="_blank" rel="noreferrer" className="text-teal-600 hover:underline">document</a></>}
                </p>
              </div>
              <div className="hidden sm:block text-right shrink-0">
                <p className="text-[9px] text-gray-400">Issued</p>
                <p className="text-[11px] text-gray-700" suppressHydrationWarning>{fmt(r.issued)}</p>
              </div>
              <div className="hidden sm:block text-right shrink-0 w-20">
                <p className="text-[9px] text-gray-400">Expires</p>
                <p className="text-[11px] text-gray-700" suppressHydrationWarning>{fmt(r.expires)}</p>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
