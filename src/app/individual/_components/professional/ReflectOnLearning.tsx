"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, inputCls } from "./forms";
import { focusRing, primaryBtn } from "../chrome";

// A private reflection on one CPD entry or one Competen Learning record (LCPD-01 LCPD-3, migration 491). Quick, guided or
// detailed, from the configured templates. The impact is what the person reports, never verified. Saved through
// /api/individual/professional/learning-reflections, which re-checks the person and the subject.

type Template = { code: string; label: string; prompts: string[] };
const IMPACTS: [string, string][] = [["completed", "I completed it"], ["understood", "I understood it"], ["applied", "I applied it in practice"]];

export default function ReflectOnLearning({ subject, templates, accent }: { subject: { cpdId: string } | { learningRecordId: string }; templates: Template[]; accent: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(templates[0]?.code ?? "");
  const [answers, setAnswers] = useState<string[]>([]);
  const [impact, setImpact] = useState("completed");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const t = templates.find(x => x.code === code);
  const id = "cpdId" in subject ? subject.cpdId : subject.learningRecordId;

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/individual/professional/learning-reflections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...subject, template: code, answers, impact }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be saved." }); return; }
      setMsg({ ok: true, text: "Saved privately." }); setAnswers([]); setOpen(false); router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be saved. Check your connection." }); } finally { setBusy(false); }
  }

  if (!open) return (
    <p className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setOpen(true)} className={`text-[12.5px] font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: accent }}>Reflect on this</button>
      {msg && <span role="status" className="text-[12.5px] text-green-800">{msg.text}</span>}
    </p>
  );
  return (
    <form onSubmit={save} className="mt-2 space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <Field label="Reflection" htmlFor={`rt-${id}`}>
        <select id={`rt-${id}`} className={inputCls} value={code} onChange={e => { setCode(e.target.value); setAnswers([]); }}>
          {templates.map(x => <option key={x.code} value={x.code}>{x.label}</option>)}
        </select>
      </Field>
      {t?.prompts.map((p, i) => (
        <Field key={`${code}-${i}`} label={p} htmlFor={`rp-${id}-${i}`}>
          <textarea id={`rp-${id}-${i}`} rows={2} maxLength={2000} className={inputCls} value={answers[i] ?? ""} onChange={e => setAnswers(a => { const n = [...a]; n[i] = e.target.value; return n; })} />
        </Field>
      ))}
      <fieldset>
        <legend className="text-[13px] font-semibold text-gray-800">What did it amount to?</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {IMPACTS.map(([v, l]) => (
            <label key={v} className="inline-flex items-center gap-2 text-[13px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
              <input type="radio" name={`impact-${id}`} value={v} checked={impact === v} onChange={() => setImpact(v)} /> {l}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-gray-600">This is what you report. It is not independently verified, and it is not a verification of your clinical competence.</p>
      </fieldset>
      <p className="text-[12px] text-gray-600">Private to you. It is never shared on a Passport link or with any organisation.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={primaryBtn} style={{ background: accent }}>{busy ? "Saving…" : "Save reflection"}</button>
        <button type="button" onClick={() => setOpen(false)} className={`text-[13px] font-semibold underline underline-offset-2 ${focusRing}`}>Cancel</button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </form>
  );
}
