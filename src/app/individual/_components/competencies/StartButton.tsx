"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Btn } from "@/components/assessment/ui";

// "Start Self-Assessment" / "Repeat". Posts to the Scholar assessments API, which starts a NEW self-assessment on the latest published version
// (every attempt is its own record) and says where to go. The code is the instrument's permanent code, never an id of a person.

export default function StartButton({ code, label, primary = true, describedBy }: { code: string; label: string; primary?: boolean; describedBy?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/individual/scholar/assessments/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const json = await res.json().catch(() => ({}));
      if (res.ok && typeof json.href === "string") { router.push(json.href); return; }
      setError(res.status === 404 ? "This assessment is not available." : typeof json.error === "string" ? json.error : "It could not be started just now. Try again shortly.");
    } catch { setError("It could not be started just now. Check your connection and try again."); }
    setBusy(false);
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Btn kind={primary ? "primary" : "secondary"} onClick={start} disabled={busy} aria-describedby={describedBy}>{busy ? "Starting..." : label}</Btn>
      {error && <span role="alert" className="text-[12.5px] text-[var(--cmp-text-error)]">{error}</span>}
    </span>
  );
}
