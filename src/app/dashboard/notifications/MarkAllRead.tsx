"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function MarkAllRead({ unread }: { unread: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (unread === 0) return null;

  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true }),
        });
        router.refresh();
        setBusy(false);
      }}
      className="text-xs font-semibold text-teal-700 border border-teal-200 hover:bg-teal-50 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors">
      {busy ? "…" : `Mark all ${unread} as read`}
    </button>
  );
}
