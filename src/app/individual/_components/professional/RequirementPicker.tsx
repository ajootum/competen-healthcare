"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, inputCls } from "./forms";
import { primaryBtn } from "../chrome";

// The CPD requirement a person chooses to follow, and when their current cycle started (LCPD-01 LCPD-5, migration 490).
// Each option says its body, jurisdiction and review status, so nobody follows a requirement without seeing where it is
// from and whether anyone has checked it against that source.

export default function RequirementPicker({ options, current, cycleStart, today, accent }: {
  options: { code: string; label: string; detail: string }[]; current: string | null; cycleStart: string | null; today: string; accent: string;
}) {
  const router = useRouter();
  const [code, setCode] = useState(current ?? "");
  const [start, setStart] = useState(cycleStart ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/individual/professional/cpd/requirement", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requirementCode: code || null, cycleStart: code ? start : null }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be saved." }); return; }
      setMsg({ ok: true, text: code ? "Saved." : "You no longer follow a requirement here." }); router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be saved. Check your connection." }); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
      <Field label="Requirement you follow" htmlFor="cpd-req">
        <select id="cpd-req" className={inputCls} value={code} onChange={e => setCode(e.target.value)}>
          <option value="">None</option>
          {options.map(o => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </Field>
      {code && <Field label="Your current cycle started on" htmlFor="cpd-cycle"><input id="cpd-cycle" type="date" required max={today} className={inputCls} value={start} onChange={e => setStart(e.target.value)} /></Field>}
      {code && <p className="text-[12.5px] text-gray-600 sm:col-span-2">{options.find(o => o.code === code)?.detail}</p>}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={busy} className={primaryBtn} style={{ background: accent }}>{busy ? "Saving…" : "Save"}</button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13.5px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </form>
  );
}
