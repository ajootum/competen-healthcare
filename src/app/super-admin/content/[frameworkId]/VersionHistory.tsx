"use client";
import { useState } from "react";

type Version = {
  id: string;
  version_num: number;
  published_by_name: string | null;
  published_at: string;
  notes: string | null;
  snapshot: {
    name: string;
    library: string;
    description?: string | null;
    framework_domains?: {
      name: string;
      sort_order: number;
      framework_competencies?: {
        name: string;
        sort_order: number;
        competency_skills?: { name: string; sort_order: number }[];
      }[];
    }[];
  };
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function VersionHistory({ versions }: { versions: Version[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!versions.length) return null;

  return (
    <div className="mt-8">
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
        Version History ({versions.length})
      </h2>
      <div className="flex flex-col gap-2">
        {versions.map((v, i) => {
          const isOpen = expanded === v.id;
          const domainCount = v.snapshot.framework_domains?.length ?? 0;
          const compCount = (v.snapshot.framework_domains ?? []).reduce(
            (s, d) => s + (d.framework_competencies?.length ?? 0), 0
          );
          return (
            <div key={v.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : v.id)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50/40 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                    i === 0 ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                  }`}>
                    v{v.version_num}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900">
                        Version {v.version_num}
                        {i === 0 && <span className="ml-1.5 text-[10px] bg-green-100 text-green-700 font-bold px-1.5 py-0.5 rounded">Current</span>}
                      </p>
                    </div>
                    <p className="text-[10px] text-gray-400">
                      {domainCount} domains · {compCount} competencies · Published {fmt(v.published_at)}
                      {v.published_by_name && ` by ${v.published_by_name}`}
                    </p>
                  </div>
                </div>
                <span className="text-gray-400 text-sm">{isOpen ? "▲" : "▼"}</span>
              </button>

              {isOpen && (
                <div className="px-5 pb-4 border-t border-gray-50">
                  <div className="pt-3 flex flex-col gap-2">
                    {(v.snapshot.framework_domains ?? [])
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map(domain => (
                        <div key={domain.name} className="rounded-lg bg-gray-50 px-4 py-2.5">
                          <p className="text-xs font-semibold text-gray-700 mb-1.5">{domain.name}</p>
                          <div className="flex flex-col gap-1">
                            {(domain.framework_competencies ?? [])
                              .sort((a, b) => a.sort_order - b.sort_order)
                              .map(comp => (
                                <div key={comp.name} className="flex items-start gap-2">
                                  <span className="text-gray-300 text-xs mt-0.5">—</span>
                                  <div>
                                    <p className="text-[11px] text-gray-600 font-medium">{comp.name}</p>
                                    {(comp.competency_skills ?? []).length > 0 && (
                                      <p className="text-[10px] text-gray-400">
                                        {(comp.competency_skills ?? []).map(s => s.name).join(" · ")}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      ))}
                  </div>
                  {v.notes && (
                    <p className="mt-2 text-xs text-gray-400 italic">&ldquo;{v.notes}&rdquo;</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
