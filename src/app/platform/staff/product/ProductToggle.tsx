"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ProductToggle({ code, defaultOn }: { code: string; defaultOn: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(defaultOn);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (busy) return;
    setBusy(true); const next = !on;
    try {
      const res = await fetch("/api/platform/products/toggle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, defaultOn: next }) });
      if ((await res.json()).ok) { setOn(next); router.refresh(); }
    } finally { setBusy(false); }
  };
  return (
    <button onClick={toggle} disabled={busy} className={`text-[10px] rounded-full px-2 py-0.5 transition-colors ${on ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
      {on ? "on by default" : "off by default"}
    </button>
  );
}
