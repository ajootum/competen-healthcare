"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// PW-014 PW-AC-08 — completes a directly-executable universal action via POST /api/me/actions/{id}/execute.
// The server re-authorizes + re-validates the source at execution time; if it comes back deep-link-only (clinical
// / high-risk) we send the user to the source workspace instead of completing in place.
export default function CompleteAction({ actionId }: { actionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const go = () => start(async () => {
    setMsg(null);
    const r = await fetch(`/api/me/actions/${encodeURIComponent(actionId)}/execute`, { method: "POST" }).catch(() => null);
    const j = await r?.json().catch(() => null);
    if (r?.ok && j?.ok) { setDone(true); router.refresh(); }
    else if (j?.requiresDeepLink && j?.deepLink) { window.location.href = j.deepLink; }
    else { setMsg(j?.reason ?? "Couldn't complete"); router.refresh(); }
  });

  if (done) return <span className="text-[11px] font-medium text-emerald-600">Completed ✓</span>;
  return (
    <button onClick={go} disabled={pending} title={msg ?? "Complete this action"} className="text-[11px] font-medium text-emerald-600 hover:underline disabled:opacity-50">
      {pending ? "…" : "Complete"}
    </button>
  );
}
