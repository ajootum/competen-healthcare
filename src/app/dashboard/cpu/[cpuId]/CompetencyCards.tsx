"use client";

import { useState } from "react";

// Expandable competency cards (CPU Workspace spec §2): description, skills,
// learning resources, score, decision history — everything from the record.

export type CompCard = {
  id: string; number: number; name: string; description: string | null;
  outcome: { label: string; cls: string } | null;
  score: { value: number; label: string; validated: boolean } | null;
  progressPct: number;
  skills: { name: string; active: boolean }[];
  resources: { title: string; type: string; url: string | null }[];
  history: { outcome: string; cls: string; at: string; by: string | null; expiry: string | null }[];
};

export default function CompetencyCards({ cards }: { cards: CompCard[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(true);

  const toggle = (id: string) => setOpen(p => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const shown = showDone ? cards : cards.filter(c => c.progressPct < 100);

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
        <h2 className="font-semibold text-gray-900 text-sm">
          Competencies <span className="text-[10px] font-normal text-gray-400 ml-1">{cards.length} total</span>
        </h2>
        <button onClick={() => setShowDone(s => !s)} className="text-[10px] text-gray-400 hover:text-gray-600">
          {showDone ? "Hide" : "Show"} completed
        </button>
      </div>
      {shown.map(c => {
        const isOpen = open.has(c.id);
        return (
          <div key={c.id} className="border-b border-gray-50 last:border-0">
            <button onClick={() => toggle(c.id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50/50 transition-colors">
              <span className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 ${
                c.progressPct >= 100 ? "bg-green-500 text-white" : c.progressPct > 0 ? "bg-teal-500 text-white" : "bg-gray-100 text-gray-500"}`}>
                {c.number}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800">{c.name}</p>
                {c.skills.length > 0 && (
                  <p className="text-[10px] text-gray-400 truncate">{c.skills.slice(0, 3).map(s => s.name).join(" · ")}{c.skills.length > 3 ? " …" : ""}</p>
                )}
              </div>
              {c.outcome
                ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${c.outcome.cls}`}>{c.outcome.label}</span>
                : <span className="text-[10px] text-gray-300 shrink-0">Not started</span>}
              <div className="hidden sm:flex items-center gap-2 w-28 shrink-0">
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${c.progressPct >= 100 ? "bg-green-500" : "bg-teal-500"}`}
                    style={{ width: `${Math.max(c.progressPct, 2)}%` }} />
                </div>
                <span className="text-[10px] font-bold text-gray-500 w-8 text-right">{c.progressPct}%</span>
              </div>
              <span className="text-gray-300 text-xs">{isOpen ? "▾" : "▸"}</span>
            </button>

            {isOpen && (
              <div className="px-4 pb-4 pl-[52px] flex flex-col gap-3">
                {c.description && <p className="text-xs text-gray-500 leading-relaxed">{c.description}</p>}
                {c.score && (
                  <p className="text-[11px] text-gray-600">
                    Latest score: <b>{c.score.value}/6 — {c.score.label}</b>
                    {c.score.validated && <span className="ml-1.5 text-[9px] font-bold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">Validated</span>}
                  </p>
                )}
                {c.skills.length > 0 && (
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Skills checklist</p>
                    <div className="flex flex-wrap gap-1">
                      {c.skills.map(s => (
                        <span key={s.name} className={`text-[10px] px-1.5 py-0.5 rounded border ${s.active ? "bg-teal-50 border-teal-100 text-teal-700" : "bg-gray-50 border-gray-100 text-gray-400"}`}>
                          {s.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {c.resources.length > 0 && (
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Learning resources</p>
                    <div className="flex flex-col gap-1">
                      {c.resources.map(r => (
                        <p key={r.title} className="text-[11px] text-gray-600">
                          📄 {r.url
                            ? <a href={r.url} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline">{r.title}</a>
                            : r.title}
                          <span className="text-gray-300 ml-1.5 uppercase text-[9px]">{r.type}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {c.history.length > 0 && (
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Decision history</p>
                    <div className="flex flex-col gap-1">
                      {c.history.map((h, i) => (
                        <p key={i} className="text-[11px] text-gray-500">
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded mr-1.5 ${h.cls}`}>{h.outcome}</span>
                          {new Date(h.at).toLocaleDateString()}{h.by ? ` · by ${h.by}` : ""}
                          {h.expiry ? ` · valid to ${new Date(h.expiry).toLocaleDateString()}` : ""}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
