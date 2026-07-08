"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Item = {
  id: string; competency_name: string | null; reason: string | null;
  resource_id: string | null; resource_title: string | null; resource_type: string | null;
  status: string; sort_order: number;
};

const TYPE_ICON: Record<string, string> = {
  course: "📘", policy: "📄", video: "🎬", guideline: "📋",
  simulation: "🧪", question_bank: "❓", article: "📰", reflection: "✍️",
};

export default function PathwayItems({ items }: { items: Item[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  // Group by competency gap
  const byComp = items.reduce((acc, it) => {
    const key = it.competency_name ?? "General";
    (acc[key] ??= { reason: it.reason, items: [] }).items.push(it);
    return acc;
  }, {} as Record<string, { reason: string | null; items: Item[] }>);

  async function toggle(item: Item) {
    setBusy(item.id);
    const next = item.status === "completed" ? "pending" : "completed";
    await fetch("/api/learning/pathway-items", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, status: next }),
    });
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {Object.entries(byComp).map(([comp, group]) => (
        <div key={comp} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 bg-amber-50/40 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-800">{comp}</p>
            {group.reason && <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded">{group.reason}</span>}
          </div>
          <div className="divide-y divide-gray-50">
            {group.items.map(it => (
              <div key={it.id} className="flex items-center gap-3 px-5 py-3">
                {it.resource_title ? (
                  <>
                    <button onClick={() => toggle(it)} disabled={busy === it.id}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        it.status === "completed" ? "bg-teal-500 border-teal-500 text-white" : "border-gray-300 hover:border-teal-400"
                      }`}>
                      {it.status === "completed" && <span className="text-[11px] leading-none">✓</span>}
                    </button>
                    <span className="text-base">{TYPE_ICON[it.resource_type ?? "course"] ?? "📘"}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${it.status === "completed" ? "text-gray-400 line-through" : "text-gray-800"}`}>{it.resource_title}</p>
                      <p className="text-[10px] text-gray-400 capitalize">{it.resource_type}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="w-5 h-5 shrink-0 flex items-center justify-center text-amber-400">!</span>
                    <div className="flex-1">
                      <p className="text-sm text-gray-500 italic">No learning resource linked yet</p>
                      <p className="text-[10px] text-gray-400">Your educator can attach resources for this competency.</p>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
