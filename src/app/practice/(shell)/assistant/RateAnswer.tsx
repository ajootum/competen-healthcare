"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// CPR-PI-001 v1 s9 / CPR-PI-003 s8 -- "mark an insight useful or not useful".
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ EVERYTHING EXCEPT THIS EXISTED, AND THAT IS THE WHOLE STORY. rateMessage() has been in
// ai-assistant.ts, the route has accepted a PATCH-shaped body with messageId + helpful, the column
// exists on practice_ai_message, and assistantUsage() counts both sides of it -- so two panels have
// been rendering "Marked useful: 0 / Marked not useful: 0" since the day they were written, and could
// never have shown anything else. A counter over a control nobody built reads as "nobody finds it
// useful", which is the opposite of what it measures.
//
// The engine is the ONLY writer of `helpful`; this posts to the same route the console uses, so the
// capability check, the workspace scoping and the audit all stay in one place.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function RateAnswer({ messageId, helpful }: {
  messageId: string;
  /** The rating already recorded, so a second visit shows what this practitioner said. */
  helpful: boolean | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState<boolean | null>(helpful);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const rate = async (next: boolean) => {
    // ⚠ CLICKING THE SAME VERDICT AGAIN IS NOT A TOGGLE-OFF. rateMessage takes a boolean, so there is
    // no "unrated" to return to -- offering it here would be a control whose state the store cannot
    // hold. Changing your mind to the other verdict is the supported correction.
    if (busy || value === next) return;
    setBusy(true);
    setFailed(false);
    const previous = value;
    setValue(next);                                   // optimistic: the press should feel immediate
    try {
      const r = await fetch("/api/v1/practice/assistant", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId, helpful: next }),
      });
      if (!r.ok) throw new Error(String(r.status));
      // The usage counters are rendered by a server component, so the page has to re-read to move them.
      router.refresh();
    } catch {
      // ⚠ ROLLED BACK AND SAID, not swallowed. A rating that silently did not save is worse than one
      // that refused: the practitioner believes the feedback landed and stops giving it.
      setValue(previous);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const btn = (on: boolean) =>
    `rounded-lg border px-2 py-0.5 text-[10.5px] font-semibold disabled:opacity-50 max-md:min-h-[var(--cp-touch)] max-md:px-3 max-md:text-[12px] ${
      on ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
         : "border-gray-200 text-gray-600 hover:bg-gray-50"}`;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] text-gray-500">Was this useful?</span>
      <button type="button" className={btn(value === true)} disabled={busy}
        aria-pressed={value === true} onClick={() => rate(true)}>
        Useful
      </button>
      <button type="button" className={btn(value === false)} disabled={busy}
        aria-pressed={value === false} onClick={() => rate(false)}>
        Not useful
      </button>
      {failed && (
        <span className="text-[10px] text-[var(--cmp-text-critical)]">
          That did not save. Nothing was recorded.
        </span>
      )}
    </div>
  );
}
