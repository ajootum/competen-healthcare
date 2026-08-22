"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Adding a declared entry.
//
// THE COMP'S "ADD EVIDENCE" BUTTON OPENS A FILE PICKER; THIS ONE DOES NOT. There is no file storage in
// this product (CPR-320 declined it and named why), so a certificate is recorded by its number and its
// expiry date rather than uploaded. That is stated on the form instead of discovered at the upload step.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ D3: THREE FIELDS CARRY A WARNING, AT THE FIELD, AS A SENTENCE.
//
// Since migration 270 an entry outlives the practice it was typed in. `title`, `organisation` and
// `detail` are all free text and all travel, so all three say so where they are typed rather than in a
// settings page nobody opens. THE SENTENCES COME FROM THE ENGINE (`PORTABLE_FIELDS`), not from this
// file: a warning that lives only in JSX is one a redesign drops with nothing failing, and the harness
// asserts the same strings this renders.
//
// `detail` is on this form for the first time. The API and the table have always accepted it; only the
// form omitted it, which meant the one field the survey named as the sharpest risk was reachable through
// the API and invisible on the screen -- and therefore un-warnable.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type PortableField = { field: string; label: string; notice: string };

export default function PortfolioConsole({ kinds, portableNotice, portableFields }: {
  kinds: { key: string; label: string }[];
  portableNotice: string;
  portableFields: readonly PortableField[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState(kinds[0]?.key ?? "qualification");
  const [title, setTitle] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [detail, setDetail] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [reference, setReference] = useState("");

  // ⚠ THE SENTENCE IS FOUND, NOT INDEXED. A missing one renders nothing rather than `undefined`, and
  // the harness proves each of the three is actually present.
  const notice = (field: string) => portableFields.find(f => f.field === field)?.notice ?? null;
  const fieldNotice = (field: string) => {
    const text = notice(field);
    return text ? <span className="mt-1 block text-[10px] font-normal leading-snug text-gray-500">{text}</span> : null;
  };

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
      {/* WHAT KEEPING AN ENTRY COSTS, BEFORE THE FIRST BOX RATHER THAN AFTER THE LAST. */}
      <p className="rounded-lg border border-gray-200 bg-white p-2.5 text-[11px] leading-relaxed text-gray-700">
        {portableNotice}
      </p>

      <div className="mt-2 grid sm:grid-cols-2 gap-2">
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
          {fieldNotice("title")}
        </label>
        <label className="text-[11px] font-semibold text-gray-600">
          Organisation
          <input value={organisation} onChange={e => setOrganisation(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-800" />
          {fieldNotice("organisation")}
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
        <label className="text-[11px] font-semibold text-gray-600 sm:col-span-2">
          Detail
          <textarea value={detail} onChange={e => setDetail(e.target.value)} rows={3}
            className="mt-1 block w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] text-gray-800" />
          {fieldNotice("detail")}
        </label>
      </div>

      {error && <p className="mt-2 text-[11px] text-[var(--cmp-text-critical)]">{error}</p>}

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
                detail: detail || undefined,
                occurredOn: occurredOn || null, expiresOn: expiresOn || null,
              }),
            });
            const body = await r.json().catch(() => ({}));
            setBusy(false);
            if (!r.ok) { setError(body.error?.message ?? "it could not be added"); return; }
            setTitle(""); setOrganisation(""); setDetail(""); setReference(""); setOccurredOn(""); setExpiresOn("");
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
