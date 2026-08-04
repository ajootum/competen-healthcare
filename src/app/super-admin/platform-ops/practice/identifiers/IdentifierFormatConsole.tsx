"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Changing the format.
//
// THE FRICTION IS THE FEATURE. Once a number has been issued the format is locked, and unlocking it
// means typing a sentence that states the consequence -- not ticking a box. A checkbox is clicked
// without reading; a sentence has to be understood to be reproduced.
//
// The preview updates as you type, because a prefix and a digit count do not show what a person will
// actually read off a card. The check digit is computed here with the same algorithm the server uses.

const DAMM = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2], [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9], [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8], [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4], [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5], [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];
const damm = (s: string) => [...s].reduce((i, ch) => DAMM[i][ch.charCodeAt(0) - 48], 0);

type Format = {
  prefix: string; digits: number; checkDigit: boolean; separator: string;
  version: number; locked: boolean;
};

export default function IdentifierFormatConsole({ format, issued, acknowledgement }: {
  format: Format; issued: number; acknowledgement: string;
}) {
  const router = useRouter();
  const [prefix, setPrefix] = useState(format.prefix);
  const [digits, setDigits] = useState(format.digits);
  const [checkDigit, setCheckDigit] = useState(format.checkDigit);
  const [separator, setSeparator] = useState(format.separator);
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const cleanPrefix = prefix.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
  const body = "1".padStart(digits, "0");
  const preview = `${cleanPrefix}${separator}${body}${checkDigit ? `${separator}${damm(body)}` : ""}`;

  const unchanged = cleanPrefix === format.prefix && digits === format.digits &&
    checkDigit === format.checkDigit && separator === format.separator;
  const ackOk = !format.locked || ack.trim() === acknowledgement;
  const ready = !unchanged && reason.trim().length >= 10 && ackOk && cleanPrefix.length > 0;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-bold text-gray-900">Change the format</h2>

      {/* THE ONE THING AN OPERATOR MIGHT OTHERWISE ASSUME. */}
      <p className="mt-1 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-3 text-xs text-gray-600">
        <span className="font-semibold text-gray-800">
          The {issued} number{issued === 1 ? "" : "s"} already issued will not change.
        </span>{" "}
        They are printed on cards, encoded into QR codes and saved in patients&rsquo; phones — rewriting
        one would mean it was never permanent. A new format applies to every number issued from here on,
        and each identity records which version it was issued under.
      </p>

      <div className="mt-3 grid sm:grid-cols-4 gap-3">
        <label className="text-xs font-semibold text-gray-600">
          Prefix
          <input value={prefix} onChange={e => setPrefix(e.target.value)} maxLength={6}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 font-mono text-sm text-gray-900" />
        </label>
        <label className="text-xs font-semibold text-gray-600">
          Digits
          <input type="number" min={4} max={12} value={digits}
            onChange={e => setDigits(Math.max(4, Math.min(12, Number(e.target.value) || 4)))}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900" />
        </label>
        <label className="text-xs font-semibold text-gray-600">
          Separator
          <select value={separator} onChange={e => setSeparator(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900">
            <option value="-">hyphen</option>
            <option value="/">slash</option>
            <option value=".">dot</option>
            <option value="">none</option>
          </select>
        </label>
        <label className="flex items-end gap-2 text-xs font-semibold text-gray-600">
          <input type="checkbox" checked={checkDigit} onChange={e => setCheckDigit(e.target.checked)} className="mb-2" />
          <span className="mb-1.5">Check digit</span>
        </label>
      </div>

      <p className="mt-3 text-xs font-semibold text-gray-500">The next number would read</p>
      <p className="font-mono text-xl font-bold text-gray-900">{preview}</p>
      {!checkDigit && (
        <p className="mt-1 text-xs text-[var(--cmp-text-warning)]">
          Without a check digit, a patient who transposes two digits reaches a different real clinician
          and nothing notices.
        </p>
      )}

      <label className="mt-3 block text-xs font-semibold text-gray-600">
        Why is it changing? This is recorded and read later.
        <input value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Agreed at the 4 August platform review"
          className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400" />
      </label>

      {format.locked && (
        <label className="mt-3 block text-xs font-semibold text-gray-600">
          Numbers have been issued. Type: <span className="font-normal italic">{acknowledgement}</span>
          <input value={ack} onChange={e => setAck(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-sm text-gray-900" />
        </label>
      )}

      {error && <p className="mt-2 text-xs text-[var(--cmp-text-danger)]">{error}</p>}
      {done && <p className="mt-2 text-xs text-[var(--cmp-text-success)]">{done}</p>}

      <button
        type="button"
        disabled={!ready || busy}
        onClick={async () => {
          setBusy(true); setError(null); setDone(null);
          const r = await fetch("/api/v1/practice/identifier-format", {
            method: "PATCH", headers: { "content-type": "application/json" },
            body: JSON.stringify({
              prefix: cleanPrefix, digits, checkDigit, separator,
              reason, acknowledgement: ack.trim() || undefined,
            }),
          });
          const b = await r.json().catch(() => ({}));
          setBusy(false);
          if (!r.ok) { setError(b.error?.message ?? "the format could not be changed"); return; }
          setDone(`Now version ${b.version}. Next number: ${b.example}. ${b.note}`);
          setAck(""); setReason("");
          router.refresh();
        }}
        className="mt-3 rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Changing…" : "Change the format"}
      </button>
      {unchanged && <span className="ml-2 text-xs text-gray-400">nothing has been altered yet</span>}
    </section>
  );
}
