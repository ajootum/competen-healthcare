"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const SCORE_COLORS = ["#ef4444","#f97316","#eab308","#14b8a6","#0d9488","#3b82f6","#8b5cf6"];

export function CompleteCycleButton({ cycleId }: { cycleId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function complete() {
    setLoading(true);
    const res = await fetch(`/api/cycles/${cycleId}/complete`, { method: "POST" });
    setLoading(false);
    if (res.ok) {
      setConfirming(false);
      router.refresh();
    } else {
      alert("Failed to complete cycle.");
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Confirm?</span>
        <button onClick={complete} disabled={loading}
          className="px-3 py-1 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50">
          {loading ? "…" : "Yes, complete"}
        </button>
        <button onClick={() => setConfirming(false)}
          className="px-3 py-1 bg-white border border-gray-200 text-gray-600 text-xs rounded-lg">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)}
      className="px-3 py-1.5 bg-white border border-gray-200 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-50">
      Mark Complete
    </button>
  );
}

export function ClinicalReadinessScore({ score }: { score: number | null }) {
  if (score == null) return null;
  const idx = Math.round(score);
  return (
    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-50">
      <span className="text-[10px] text-gray-400 font-medium">Clinical Readiness Score</span>
      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
        style={{ backgroundColor: SCORE_COLORS[idx] ?? "#9ca3af" }}>
        {score}
      </div>
    </div>
  );
}
