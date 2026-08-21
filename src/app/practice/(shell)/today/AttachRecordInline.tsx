"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Walkthrough 2026-08-17 #18 -- CLOSE THE NAME-ONLY LOOP WHERE IT BLOCKS.
//
// "Find or register them first" was a bare pointer to the register, and the register never pointed
// back: a patient registered over there stayed unattached to the arrival, and the cockpit kept
// refusing the encounter it was right to refuse. This searches the register FROM the blocked row,
// prefilled with the arrival's own name, and one pick attaches the record -- after which Seen and
// Start appear on the row by the guards that were always there.
//
// ⚠ SEARCH FIRST, REGISTER SECOND, THE SAME s9 RULE AS THE WALK-IN DOOR: the prefilled search is a
// duplicate screen before it is anything else. The Register-new link stays for the genuinely new --
// registration keeps its own duplicate screening and this component never creates records.
//
// ⚠ AN INCOMPLETE SEARCH SAYS SO (the registry's own `complete` flag): "no match" over a failed
// probe is how duplicate records get made.

export default function AttachRecordInline({ entryId, prefillName }: {
  entryId: string;
  prefillName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(prefillName);
  const [hits, setHits] = useState<{ id: string; label: string }[]>([]);
  const [incomplete, setIncomplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (text: string) => {
    setQ(text);
    if (text.trim().length < 2) { setHits([]); return; }
    try {
      const res = await fetch(`/api/v1/practice/patients?q=${encodeURIComponent(text.trim())}`);
      const json = await res.json().catch(() => ({}));
      setIncomplete(json?.complete === false);
      setHits(((json?.results ?? []) as Record<string, unknown>[]).slice(0, 6).map(r => ({
        id: String(r.patientId ?? r.id ?? ""),
        label: `${r.displayName ?? r.display_name ?? "unnamed"}${r.patientNumber ? ` (${r.patientNumber})` : ""}`,
      })));
    } catch { setHits([]); }
  };

  const attach = async (patientId: string) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/v1/practice/queue/${entryId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "attach", patientId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error?.message ?? "That record could not be attached."); return; }
      // Refresh-not-mutate: the row's buttons, the attention brief and the Next Patient card all
      // recompute on the server from the attachment this just made.
      router.refresh();
    } catch {
      setError("That record could not be attached.");
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      // CPR-MOB-001 s4: thumb-sized below md (max-md:* no-ops); the desktop row keeps its compact
      // affordance untouched.
      // ⚠ PHASE 8 ADDS THE TABLET HALF. max-md: stops at 768, and the two tablet targets in s20's
      // matrix are touch devices ABOVE it -- so between 768 and 1199 this sat back at about 21px with
      // no bottom nav to fall back on. pointer-coarse asks what is pointing instead of how wide the
      // window is, which is the only question that separates an iPad from a small desktop window.
      <button type="button"
        onClick={() => { setOpen(true); if (prefillName.trim().length >= 2) void search(prefillName); }}
        className="shrink-0 rounded-md border border-amber-300 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-50 max-md:min-h-[var(--cp-touch)] max-md:rounded-lg max-md:px-3 max-md:text-[12px] pointer-coarse:min-h-[var(--cp-touch)]">
        Attach record
      </button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-amber-200 bg-amber-50/50 p-2">
      <div className="flex items-center gap-2">
        {/* max-md:text-[16px] is not styling: below 16px iOS zooms the whole page on focus, and a
            zoomed cockpit mid-clinic is a worse defect than a slightly larger input (s16). */}
        <input autoFocus value={q} onChange={e => search(e.target.value)}
          aria-label="Search the register by name, phone or number"
          placeholder="Search the register..."
          className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12px] max-md:min-h-[var(--cp-touch)] max-md:text-[16px]" />
        <button type="button" onClick={() => setOpen(false)}
          className="shrink-0 text-[11px] font-semibold text-gray-500 hover:text-gray-800 max-md:min-h-[var(--cp-touch)] max-md:px-2 max-md:text-[12px]">close</button>
      </div>
      {hits.length > 0 && (
        <ul className="mt-1 max-h-36 overflow-y-auto rounded-lg border border-gray-200 bg-white">
          {hits.map(h => (
            <li key={h.id}>
              <button type="button" disabled={busy} onClick={() => attach(h.id)}
                className="block w-full px-2 py-1.5 text-left text-[12px] text-gray-800 hover:bg-gray-50 disabled:opacity-50 max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center">
                {h.label} <span className="font-semibold text-[var(--cp-primary)]">attach</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && hits.length === 0 && (
        <p className="mt-1 text-[11px] text-gray-500">
          {incomplete
            ? "The search was incomplete -- absence here is not proof they are unregistered."
            : "No registered patient matches."}
        </p>
      )}
      <p className="mt-1 text-[11px] text-gray-600">
        Genuinely new here?{" "}
        {/* ⚠ THIS LANDED ON THE BARE REGISTER AND MADE THE PRACTITIONER HUNT FOR THE BUTTON.
            They have just typed a name, been told "No registered patient matches", and pressed a link
            that says Register them -- and arrived on a list of everybody with nothing open. The page
            already documents the URL that opens the drawer, so use it: ?register=1 opens the form and
            &intent=walkin gives it the walk-in wording, which is what this arrival is.

            ⚠ THE NAME IS STILL NOT CARRIED. It is a dynamic template field rather than a prop, so
            seeding it means threading initial values through RegistrationForm -- a real change, not a
            query parameter. The retype remains, and is worth removing separately. */}
        <Link href="/practice/patients?register=1&intent=walkin"
          className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
          Register them →
        </Link>{" "}
        then attach from this row.
      </p>
      {error && <p className="mt-1 text-[11px] font-semibold text-[var(--cmp-text-critical)]">{error}</p>}
    </div>
  );
}
