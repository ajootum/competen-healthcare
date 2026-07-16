"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RISK_CONFIG as RISK_T } from "@/lib/ckcm";

const RISK_CONFIG = RISK_T as Record<string, { label: string; cls: string }>;

const STATUS_CLS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  in_review: "bg-amber-50 text-amber-700",
  approved: "bg-blue-50 text-blue-700",
  published: "bg-green-50 text-green-700",
  archived: "bg-gray-100 text-gray-400",
};

type PracticeRow = {
  id: string; name: string; code: string | null; domain: string; framework: string;
  frameworkId: string | null; cpuCount: number; compCount: number; published: number;
};
type CpuRow = {
  id: string; name: string; code: string | null; practice: string; frameworkId: string | null;
  risk: string; status: string; competencies: number; skills: number; assessments: number;
};

export default function CpuLibrary({ practices, cpus }: { practices: PracticeRow[]; cpus: CpuRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const visibleCpus = cpus.filter(c => !q || c.name.toLowerCase().includes(q) || c.practice.toLowerCase().includes(q));

  async function clone(id: string) {
    setBusy(id); setError(null);
    const res = await fetch("/api/studio", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "clone_cpu", cpu_id: id }),
    });
    setBusy(null);
    if (!res.ok) { setError((await res.json()).error ?? "Clone failed"); return; }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5">{error}</div>}

      {/* Clinical Practices */}
      <div>
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Clinical Practices ({practices.length})</h2>
        {practices.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
            No practices yet — create them inside a framework in the Content Builder.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="grid grid-cols-[1fr_90px_110px_90px] gap-2 px-5 py-2 bg-gray-50/60 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              <span>Practice</span><span className="text-right">CPUs</span><span className="text-right">Competencies</span><span className="text-right">Published</span>
            </div>
            <div className="divide-y divide-gray-50">
              {practices.map(p => (
                <Link key={p.id} href={p.frameworkId ? `/super-admin/content/${p.frameworkId}/cpus` : "/super-admin/content"}
                  className="grid grid-cols-[1fr_90px_110px_90px] gap-2 px-5 py-3 hover:bg-gray-50/50 transition-colors items-center">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 truncate">{p.name}
                      {p.code && <span className="ml-2 text-[10px] font-mono text-gray-300">{p.code}</span>}
                    </p>
                    <p className="text-[10px] text-gray-400">{p.framework} · {p.domain}</p>
                  </div>
                  <span className="text-sm font-bold text-gray-700 text-right">{p.cpuCount}</span>
                  <span className="text-sm font-bold text-gray-700 text-right">{p.compCount}</span>
                  <span className="text-sm font-bold text-green-600 text-right">{p.published}/{p.cpuCount}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* CPU library */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Clinical Practice Units ({cpus.length})</h2>
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter CPUs…"
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 w-56"
          />
        </div>
        {visibleCpus.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">No CPUs match.</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="hidden md:grid grid-cols-[1fr_110px_70px_70px_90px_95px_130px] gap-2 px-5 py-2 bg-gray-50/60 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              <span>CPU</span><span className="text-right">Competencies</span><span className="text-right">Skills</span><span className="text-right">Methods</span><span>Risk</span><span>Status</span><span></span>
            </div>
            <div className="divide-y divide-gray-50">
              {visibleCpus.map(c => {
                const risk = RISK_CONFIG[c.risk];
                return (
                  <div key={c.id} className="grid grid-cols-1 md:grid-cols-[1fr_110px_70px_70px_90px_95px_130px] gap-2 px-5 py-3 items-center">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 truncate">{c.name}
                        {c.code && <span className="ml-2 text-[10px] font-mono text-gray-300">{c.code}</span>}
                      </p>
                      <p className="text-[10px] text-gray-400">{c.practice}</p>
                    </div>
                    <span className="text-sm font-bold text-gray-700 md:text-right">{c.competencies}</span>
                    <span className="text-sm font-bold text-gray-700 md:text-right">{c.skills}</span>
                    <span className="text-sm font-bold text-gray-700 md:text-right">{c.assessments}</span>
                    <span>{risk && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${risk.cls}`}>{risk.label}</span>}</span>
                    <span><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded capitalize ${STATUS_CLS[c.status] ?? STATUS_CLS.draft}`}>{c.status.replace("_", " ")}</span></span>
                    <span className="flex gap-1.5 justify-end">
                      {c.frameworkId && (
                        <Link href={`/super-admin/content/${c.frameworkId}/cpus`}
                          className="text-[11px] font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 px-2.5 py-1 rounded-lg transition-colors">
                          Open
                        </Link>
                      )}
                      <button disabled={busy === c.id} onClick={() => clone(c.id)}
                        title="Clone with blueprint, evidence rules and critical failures"
                        className="text-[11px] font-semibold text-gray-600 bg-gray-50 hover:bg-gray-100 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50">
                        {busy === c.id ? "Cloning…" : "Clone"}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
