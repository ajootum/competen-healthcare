"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SessionActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(status: "completed" | "cancelled") {
    setBusy(true);
    await fetch("/api/schedule", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    router.refresh();
    setBusy(false);
  }

  return (
    <span className="flex gap-1.5 shrink-0">
      <button onClick={() => act("completed")} disabled={busy} title="Mark completed"
        className="text-[10px] font-semibold text-green-700 border border-green-200 hover:bg-green-50 px-2 py-0.5 rounded-lg transition-colors disabled:opacity-50">✓ Done</button>
      <button onClick={() => act("cancelled")} disabled={busy} title="Cancel session"
        className="text-[10px] font-semibold text-gray-400 border border-gray-200 hover:text-red-600 hover:border-red-200 px-2 py-0.5 rounded-lg transition-colors disabled:opacity-50">✕</button>
    </span>
  );
}
