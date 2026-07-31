"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// CGR-027 — trigger AI link suggestions (CGR-023 §7 human-in-the-loop). The AI reads real unlinked signals and
// the real competency library and writes PROPOSED links only; a governance lead confirms each one.
// The result deliberately reports what the model got WRONG (ids it invented, rationales too thin) alongside what
// it proposed — a suggestion count on its own would flatter the model and hide its miss rate from the reviewer.

type Result = { analysed: number; returned: number; proposed: number; rejected: number; skipped: number; note?: string } | null;

export default function SuggestLinks({ unlinked }: { unlinked: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null); setRes(null);
    const r = await fetch("/api/cgr/learning-links/suggest", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.ok === false) { setErr(j.error ?? "Suggestion failed"); return; }
    setRes({ analysed: j.analysed ?? 0, returned: j.returned ?? 0, proposed: j.proposed ?? 0, rejected: j.rejected ?? 0, skipped: j.skipped ?? 0, note: j.note });
    if (j.proposed > 0) router.refresh();
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={run} disabled={busy || unlinked === 0} title={unlinked === 0 ? "No unlinked signals to analyse" : undefined}
        className="text-[11px] font-semibold text-violet-700 border border-violet-200 bg-violet-50 hover:bg-violet-100 disabled:opacity-40 disabled:hover:bg-violet-50 rounded-lg px-3 py-1.5 transition-colors">
        {busy ? "Analysing signals…" : "✨ Suggest links with AI"}
      </button>

      {res && (
        <span className="text-[11px] text-gray-500">
          {res.note ? res.note : (
            <>
              Analysed <span className="font-semibold text-gray-700">{res.analysed}</span> signals ·{" "}
              <span className="font-semibold text-violet-700">{res.proposed} proposed</span> for review
              {res.rejected > 0 && <> · <span className="text-[var(--cmp-text-warning)]">{res.rejected} discarded</span> (invented ids or weak rationale)</>}
              {res.skipped > 0 && <> · {res.skipped} already linked</>}
            </>
          )}
        </span>
      )}
      {err && <span className="text-[11px] text-[var(--cmp-text-error)] font-medium">{err}</span>}
    </div>
  );
}
