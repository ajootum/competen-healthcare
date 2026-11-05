"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { learnAction } from "@/components/ui/scholar-learning";
import { studyHref } from "./question-view";
import { carry, studyField } from "./study-active";

// THE MISTAKE NOTEBOOK'S ONE ACTION -- SCHOLAR-COMPANION-01 P1. "Revise these" starts the EXISTING weak-areas revision
// session (POST /api/individual/scholar/revision/sessions, mode weak: the questions answered wrongly, most-missed first),
// scoped to one material or to the whole library. No new engine, no new route. Wrong and corrected questions are both in
// that pool, so a corrected one comes round again as a check. One column below md; touch targets grow on coarse pointers.


export function ReviseThese({ materialId, label }: { materialId: string | null; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/individual/scholar/revision/sessions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "weak", scope: materialId ? { kind: "documents", materialIds: [materialId] } : { kind: "library" }, ...studyField() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; session?: { id?: string } | null };
      if (!res.ok) { setError(json.error ?? "Revision could not start just now."); return; }
      if (json.session?.id) router.push(carry(`${studyHref("revise")}?session=${json.session.id}`));
      else setError("Revision sessions are not kept on this environment, so this one could not be started.");
    } catch {
      setError("Competen could not be reached. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="cmp-learn-record inline-flex flex-col items-start gap-1">
      <button type="button" className={learnAction.primary} disabled={busy} onClick={start}>{busy ? "Preparing…" : label}</button>
      {error && <span role="alert" className="text-[13px] font-semibold text-red-800">{error}</span>}
    </span>
  );
}
