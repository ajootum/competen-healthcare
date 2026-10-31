"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

// FRAMEWORK-DESIGN-STUDIO-01 slice C: a published framework's pending layout draft. Reordering a published framework
// never changes what learners see: it is saved as a draft layout, previewed here, and published as a revision by an
// independent publisher through Framework publication (ruling 3). Discarding drops the draft and leaves the live order.

const btn = "inline-flex items-center justify-center rounded-lg border px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";

export function LayoutDraftBanner({ frameworkId, savedAt, by, editable }: { frameworkId: string; savedAt: string | null; by: string | null; editable: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const when = savedAt ? new Date(savedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala" }) : null;

  async function discard() {
    if (!window.confirm("Discard the draft layout? The published order is not changed.")) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/hq/competency/authoring", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "discard_layout", frameworkId }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "The draft layout could not be discarded. Nothing has changed." }); return; }
      setMsg({ ok: true, text: "The draft layout was discarded." }); router.refresh();
    } catch { setMsg({ ok: false, text: "The draft layout could not be discarded. Check your connection." }); } finally { setBusy(false); }
  }

  return (
    <section aria-label="Draft layout" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <p className="text-[14px] font-bold">Draft layout — learners still see the published order</p>
      <p className="mt-1 text-[13px]">{when || by ? `Saved${when ? ` ${when}` : ""}${by ? ` by ${by}` : ""}. ` : ""}Publishing it needs an independent publisher: put it forward for publication from Overview &amp; governance as a revision, and the publisher decides on <Link href="/super-admin/competencies/publication" className="font-semibold underline">Framework publication</Link>. Whoever reordered it cannot publish it.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href="?view=pack&layout=draft" className={`${btn} border-amber-400 bg-white text-amber-950 hover:bg-amber-100`}>Preview draft layout</Link>
        <button type="button" onClick={discard} disabled={busy || !editable} className={`${btn} border-amber-400 bg-white text-amber-950 hover:bg-amber-100`}>Discard draft layout</button>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-[12.5px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
    </section>
  );
}
