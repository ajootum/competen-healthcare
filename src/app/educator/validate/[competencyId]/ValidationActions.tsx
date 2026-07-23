"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ValidationActions({
  competencyScoreId,
  alreadyValidated,
}: {
  competencyScoreId: string;
  alreadyValidated: boolean;
  nurseId: string;
  cycleId: string;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(action: "validate" | "return") {
    setSaving(true);
    const res = await fetch("/api/educator/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ competency_score_id: competencyScoreId, action, notes }),
    });
    setSaving(false);
    if (res.ok) router.push("/educator");
    else alert("Failed to save. Please try again.");
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Educator Decision</p>
      {alreadyValidated ? (
        <p className="text-teal-600 font-semibold text-sm">✓ This assessment has already been validated.</p>
      ) : (
        <>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Validation notes (optional) — comments on the assessment quality or any concerns…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none mb-4"
          />
          <div className="flex gap-3">
            <button
              onClick={() => submit("return")}
              disabled={saving}
              className="flex-1 py-2.5 border border-gray-200 bg-white rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              Return for Re-assessment
            </button>
            <button
              onClick={() => submit("validate")}
              disabled={saving}
              className="flex-1 py-2.5 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
              {saving ? "Saving…" : "✓ Validate & Sign Off"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
