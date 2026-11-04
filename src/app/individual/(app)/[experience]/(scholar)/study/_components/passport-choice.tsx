"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ProgressMark, learnAction } from "@/components/ui/scholar-learning";
import { PASSPORT_LABEL_MAX, STUDY_ACHIEVEMENT, studyDetail, type EligibleAchievement } from "@/lib/individual/scholar/passport-items";

// The person's choice of which study achievements appear in their Competen Passport (migration 375).
// One achievement at a time, in and out independently. Nothing is shown until they choose it, and the
// route decides eligibility and ownership by the caller's own id, not this component.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

export function PassportChoices({ items }: { items: EligibleAchievement[] }) {
  return (
    <ul className="mt-3 divide-y divide-gray-200 rounded-xl bg-white ring-1 ring-[var(--learn-border)]">
      {items.map(a => <Choice key={`${a.materialId}-${a.achievement}`} a={a} />)}
    </ul>
  );
}

function Choice({ a }: { a: EligibleAchievement }) {
  const router = useRouter();
  const [label, setLabel] = useState(a.chosenLabel ?? a.materialTitle.slice(0, PASSPORT_LABEL_MAX));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = `passport-label-${a.materialId}-${a.achievement}`;

  async function send(method: "POST" | "DELETE") {
    setBusy(true); setError("");
    try {
      const res = method === "POST"
        ? await fetch("/api/individual/scholar/passport", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ materialId: a.materialId, achievement: a.achievement, label }) })
        : await fetch(`/api/individual/scholar/passport?materialId=${encodeURIComponent(a.materialId)}&achievement=${a.achievement}`, { method });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "That could not be saved. Nothing has changed."); return; }
      router.refresh();
    } catch {
      setError("Competen could not be reached. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="min-w-0 text-[15px] font-semibold text-gray-900">{a.materialTitle}</p>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-bold ${a.chosenLabel ? "border-[var(--learn-border)] bg-[var(--learn-surface)] text-[var(--learn-ink)]" : "border-gray-300 bg-white text-gray-700"}`}>
          <ProgressMark state={a.chosenLabel ? "checked" : "none"} />{a.chosenLabel ? "In your Passport" : "Not shown"}
        </span>
      </div>
      <p className="mt-0.5 text-[13px] text-gray-700">{STUDY_ACHIEVEMENT[a.achievement].name} · {studyDetail(a)}</p>
      {a.chosenLabel ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="min-w-0 text-[13.5px] text-gray-800">Shown as <span className="font-semibold">“{a.chosenLabel}”</span></p>
          <button type="button" className={learnAction.secondary} disabled={busy} onClick={() => send("DELETE")}>{busy ? "Saving…" : "Remove from my Passport"}</button>
        </div>
      ) : (
        <div className="mt-3">
          <label htmlFor={id} className="block text-[13px] font-semibold text-gray-800">Title shown in your Passport</label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input id={id} value={label} maxLength={PASSPORT_LABEL_MAX} onChange={e => setLabel(e.target.value)}
              className={`min-h-[44px] min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-[14px] text-gray-900 ${focusRing}`} />
            <button type="button" className={learnAction.primary} disabled={busy || !label.trim()} onClick={() => send("POST")}>{busy ? "Saving…" : "Show in my Passport"}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-red-700">{error}</p>}
    </li>
  );
}
