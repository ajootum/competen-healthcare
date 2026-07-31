"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Mark-read control for PW-004. Posts to the existing PATCH /api/notifications (own-scoped, ids[] or all:true),
// then refreshes the server component. Only real notification rows have a markable id; derived feed items don't.
export default function MarkRead({ id, all, label, className }: { id?: string; all?: boolean; label: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const go = () => start(async () => {
    const body = all ? { all: true } : { ids: [id] };
    const r = await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (r?.ok) { setDone(true); router.refresh(); }
  });
  return (
    <button onClick={go} disabled={pending || done} className={className ?? "text-[12px] font-medium text-[var(--cmp-text-information)] hover:underline disabled:opacity-50"}>
      {done ? "Read ✓" : pending ? "…" : label}
    </button>
  );
}
