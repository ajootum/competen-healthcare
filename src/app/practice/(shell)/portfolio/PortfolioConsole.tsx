"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Adding a declared entry.
//
// THE COMP'S "ADD EVIDENCE" BUTTON OPENS A FILE PICKER; THIS ONE DOES NOT. There is no file storage in
// this product (CPR-320 declined it and named why), so a certificate is recorded by its number and its
// expiry date rather than uploaded. That is stated on the form instead of discovered at the upload step.

export default function PortfolioConsole({ kinds }: { kinds: { key: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState(kinds[0]?.key ?? "qualification");
  const [title, setTitle] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [reference, setReference] = useState("");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-3 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
        Declare something
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div className="grid sm:grid-cols-2 gap-2">
        <label className="text-[11px] font-semibold text-gray-600">
          What kind
          <select value={kind} onChange={e => setKind(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-800">
            {kinds.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-gray-600">
          Title
          <input value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Advanced spine fellowship"
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400" />
        </label>
        <label className="text-[11px] font-semibold text-gray-600">
          Organisation
          <input value={organisation} onChange={e => setOrganisation(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-800" />
        </label>
        <label className="text-[11px] font-semibold text-gray-600">
          Reference
          <input value={reference} onChange={e => setReference(e.target.value)}
            placeholder="DOI, citation or certificate number"
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400" />
        </label>
        <label className="text-[11px] font-semibold text-gray-600">
          Date
          <input type="date" value={occurredOn} onChange={e => setOccurredOn(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-800" />
        </label>
        <label className="text-[11px] font-semibold text-gray-600">
          Expires (certificates)
          <input type="date" value={expiresOn} onChange={e => setExpiresOn(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-800" />
        </label>
      </div>

      {error && <p className="mt-2 text-[11px] text-[var(--cmp-text-danger)]">{error}</p>}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || title.trim().length < 3}
          onClick={async () => {
            setBusy(true); setError(null);
            const r = await fetch("/api/v1/practice/portfolio", {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({
                kind, title, organisation: organisation || undefined, reference: reference || undefined,
                occurredOn: occurredOn || null, expiresOn: expiresOn || null,
              }),
            });
            const body = await r.json().catch(() => ({}));
            setBusy(false);
            if (!r.ok) { setError(body.error?.message ?? "it could not be added"); return; }
            setTitle(""); setOrganisation(""); setReference(""); setOccurredOn(""); setExpiresOn("");
            setOpen(false); router.refresh();
          }}
          className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add"}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700">
          Cancel
        </button>
      </div>

      <p className="mt-2 text-[10px] text-gray-500">
        This will be recorded as declared by you. There is no file storage here, so a certificate is
        recorded by its number and expiry rather than uploaded &mdash; the document itself stays where it
        already is.
      </p>
    </div>
  );
}
