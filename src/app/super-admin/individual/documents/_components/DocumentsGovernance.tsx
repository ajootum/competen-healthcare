"use client";
// The one action of the documents pathway for THIS person: submit the draft, review it, or (publishing) be pointed to the Publish
// button below. Posts to /api/hq/governance/documents-review; the database decides, and its refusal is shown in its own words.
import { useState } from "react";
import { useRouter } from "next/navigation";

type Kind = "submit" | "review" | "publish" | "none";

const primary = "inline-flex min-h-9 items-center justify-center rounded-lg border border-teal-800 bg-teal-800 px-3.5 py-1.5 text-[14px] font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const secondary = "inline-flex min-h-9 items-center justify-center rounded-lg border border-gray-400 bg-white px-3.5 py-1.5 text-[14px] font-semibold text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";

export default function DocumentsGovernance({ action, reviewId }: { action: Kind; reviewId: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function post(body: Record<string, unknown>, okText: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/hq/governance/documents-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: (data as { error?: string }).error ?? "The change could not be recorded." }); return; }
      setMsg({ ok: true, text: okText }); setNote(""); setAsking(false);
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Could not reach the server. Check your connection and try again." });
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      {action === "submit" && (
        <>
          <label htmlFor="docs-submit-note" className="block text-[12.5px] font-semibold text-gray-700">Note for the reviewer (optional)</label>
          <textarea id="docs-submit-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[14px]" />
          <button type="button" className={primary} disabled={busy} onClick={() => post({ action: "submit", note }, "Submitted. Another holder of the Competen Individual policy right can now review it.")}>
            {busy ? "Submitting..." : "Submit this draft for review"}
          </button>
        </>
      )}
      {action === "review" && reviewId && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={primary} disabled={busy} onClick={() => post({ action: "decide", reviewId, decision: "approved", note: "" }, "Approved. The draft can now be published.")}>
              {busy && !asking ? "Recording..." : "Review & approve"}
            </button>
            <button type="button" className={secondary} disabled={busy} aria-expanded={asking} onClick={() => setAsking((a) => !a)}>Request changes</button>
          </div>
          {asking && (
            <div className="space-y-2 rounded-lg border border-gray-200 p-3">
              <label htmlFor="docs-changes-note" className="block text-[12.5px] font-semibold text-gray-700">What must change (the submitter sees this note)</label>
              <textarea id="docs-changes-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[14px]" />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primary} disabled={busy || note.trim().length < 3} onClick={() => post({ action: "decide", reviewId, decision: "changes_requested", note }, "Changes requested. The submitter sees your note.")}>Send back with this note</button>
                <button type="button" className={secondary} disabled={busy} onClick={() => { setAsking(false); setNote(""); }}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
      {action === "publish" && <p className="text-[13px] font-semibold text-gray-800">Use the Publish button below the draft.</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`rounded-lg border px-3 py-2 text-[13px] ${msg.ok ? "border-green-300 bg-green-50 text-green-900" : "border-red-300 bg-red-50 text-red-900"}`}>{msg.text}</p>}
    </div>
  );
}
