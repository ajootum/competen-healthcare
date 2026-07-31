"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Acknowledge a broadcast (HWW-COM-001) — the recipient's read receipt,
// recorded per user for ack-rate tracking.

export default function AckBroadcast({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button className="px-2.5 py-1 rounded-lg border border-[var(--cmp-color-success)] text-xs text-emerald-700 hover:bg-[var(--cmp-surface-success)] disabled:opacity-50"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/operations/broadcasts?id=${id}`, { method: "PATCH" });
        setBusy(false);
        router.refresh();
      }}>
      Acknowledge
    </button>
  );
}
