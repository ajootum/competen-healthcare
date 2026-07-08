"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Framework = { id: string; name: string; library: string; scope?: string | null; parent_framework_id?: string | null };

const LIB_COLORS: Record<string, string> = {
  core:      "text-teal-600 bg-teal-50",
  specialty: "text-indigo-600 bg-indigo-50",
  role:      "text-violet-600 bg-violet-50",
};

export default function FrameworkLibrary({
  masterFrameworks,
  adoptedFrameworks,
}: {
  masterFrameworks: Framework[];
  adoptedFrameworks: Framework[];
}) {
  const router = useRouter();
  const [adopting, setAdopting] = useState<string | null>(null);
  const [error, setError]       = useState("");

  const adoptedParentIds = new Set(adoptedFrameworks.map(f => f.parent_framework_id).filter(Boolean));

  async function adopt(frameworkId: string) {
    setAdopting(frameworkId); setError("");
    const res = await fetch("/api/content/adopt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ framework_id: frameworkId }),
    });
    setAdopting(null);
    if (res.ok) { router.refresh(); }
    else {
      const d = await res.json();
      setError(d.error === "Already adopted" ? "Already in your library" : (d.error ?? "Failed to adopt"));
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Framework Library</h2>

      {error && <p className="mb-3 text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {/* Adopted frameworks */}
      {adoptedFrameworks.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 mb-2">Your Adopted Frameworks</p>
          <div className="flex flex-col gap-2">
            {adoptedFrameworks.map(f => (
              <div key={f.id} className="flex items-center justify-between px-4 py-3 rounded-lg bg-green-50 border border-green-100">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Adopted</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize ${LIB_COLORS[f.library] ?? "text-gray-500 bg-gray-100"}`}>{f.library}</span>
                  <p className="text-sm font-medium text-gray-900">{f.name}</p>
                </div>
                <span className="text-[10px] text-green-600 font-medium">✓ Customisable</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Master library */}
      <div>
        <p className="text-xs font-semibold text-gray-500 mb-2">Master Library</p>
        <div className="flex flex-col gap-2">
          {masterFrameworks.map(f => {
            const isAdopted = adoptedParentIds.has(f.id);
            return (
              <div key={f.id} className="flex items-center justify-between px-4 py-3 rounded-lg bg-gray-50 border border-gray-100">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize ${LIB_COLORS[f.library] ?? "text-gray-500 bg-gray-100"}`}>{f.library}</span>
                  <p className="text-sm font-medium text-gray-800">{f.name}</p>
                </div>
                {isAdopted ? (
                  <span className="text-[10px] text-green-600 font-semibold">✓ In your library</span>
                ) : (
                  <button
                    onClick={() => adopt(f.id)}
                    disabled={adopting === f.id}
                    className="px-3 py-1.5 text-xs font-semibold bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
                    {adopting === f.id ? "Adopting…" : "Adopt"}
                  </button>
                )}
              </div>
            );
          })}
          {!masterFrameworks.length && (
            <p className="text-xs text-gray-400 italic">No master frameworks available yet.</p>
          )}
        </div>
      </div>

      <p className="mt-4 text-[10px] text-gray-400">
        Adopted frameworks are your own customisable copies. Changes to the master library will not affect your adopted versions.
      </p>
    </div>
  );
}
