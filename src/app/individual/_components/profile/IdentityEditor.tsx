"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// The shared identity fields, edited in place -- COMPETEN-INDIVIDUAL-IDENTITY-HUB-01 (590). Edit, then Save or
// Cancel (Escape cancels), with limits checked as you type and saved through PUT /api/individual/identity. The limits
// mirror parseIdentityPatch; the server checks them again.

type Field = "preferred_name" | "headline" | "location" | "biography";
const SPEC: Record<Field, { label: string; max: number; hint: string; multiline?: boolean; autoComplete?: string }> = {
  preferred_name: { label: "Preferred name", max: 80, hint: "What you like to be called. Your full name stays on your Passport.", autoComplete: "nickname" },
  headline: { label: "Headline", max: 140, hint: "One line: your role or what you specialise in. For example: Registered nurse, emergency care." },
  location: { label: "Location", max: 120, hint: "A town or region, as broad as you like.", autoComplete: "address-level2" },
  biography: { label: "Biography", max: 2000, hint: "A few lines about you, in your own words.", multiline: true },
};

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const inputCls = `w-full rounded-lg border bg-white px-3 py-2 text-[14.5px] text-gray-900 ${focusRing}`;
const small = `inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center justify-center rounded-lg border px-3 text-[13px] font-semibold disabled:opacity-50 ${focusRing}`;

export default function IdentityEditor({ fields, values, accent, editLabel, unavailable }: {
  fields: Field[]; values: Partial<Record<Field, string | null>>; accent: string; editLabel: string; unavailable?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const first = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => { if (open) first.current?.focus(); }, [open]);

  const over = fields.filter(f => (draft[f] ?? "").trim().length > SPEC[f].max);
  function start() { setDraft(Object.fromEntries(fields.map(f => [f, values[f] ?? ""]))); setErr(null); setStatus(""); setOpen(true); }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (over.length) { setErr(`${SPEC[over[0]].label} is too long.`); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/individual/identity", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j?.error ?? "That could not be saved. Nothing was changed."); return; }
      setOpen(false); setStatus("Saved.");
      router.refresh();
    } catch { setErr("Competen could not be reached. Nothing was changed."); } finally { setBusy(false); }
  }

  if (unavailable) return <p className="text-[13px] text-gray-500">{unavailable}</p>;
  if (!open) return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={start} className={`${small} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>{editLabel}</button>
      <span role="status" aria-live="polite" className="text-[13px] font-semibold text-green-800">{status}</span>
    </div>
  );
  return (
    <form onSubmit={save} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); } }} noValidate className="mt-2 grid gap-3 rounded-xl border border-gray-200 p-4">
      {fields.map((f, i) => {
        const s = SPEC[f], v = draft[f] ?? "", bad = v.trim().length > s.max, id = `idf-${f}`;
        const props = {
          id, value: v, maxLength: s.max + 50, autoComplete: s.autoComplete, "aria-invalid": bad, "aria-describedby": `${id}-help`,
          onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(d => ({ ...d, [f]: e.target.value })),
          className: `${inputCls} ${bad ? "border-red-500" : "border-gray-300"}`,
        };
        return (
          <div key={f}>
            <label htmlFor={id} className="text-[13px] font-semibold text-gray-800">{s.label} <span className="font-normal text-gray-500">(optional)</span></label>
            {s.multiline ? <textarea ref={i === 0 ? first : undefined} rows={5} {...props} /> : <input ref={i === 0 ? first : undefined} type="text" {...props} />}
            <p id={`${id}-help`} className={`mt-1 text-[12px] ${bad ? "font-semibold text-red-700" : "text-gray-500"}`}>{bad ? `Too long: ${v.trim().length} of ${s.max} characters.` : `${s.hint} ${v.trim().length}/${s.max}`}</p>
          </div>
        );
      })}
      {err && <p role="alert" className="text-[12.5px] font-semibold text-red-700">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || over.length > 0} className={`${small} border-transparent text-white`} style={{ background: accent }}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className={`${small} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>Cancel</button>
      </div>
    </form>
  );
}
