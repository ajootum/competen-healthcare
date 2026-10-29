"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { focusRing, primaryBtn, secondaryBtn } from "../chrome";
import { Field, inputCls } from "./forms";

// "Add to my development plan" -- COMPETEN-PROFESSIONAL-COMPETENCY-01, from what an assessor's outcome leaves to develop.
//
// It opens the EXISTING development-need create flow (POST /api/individual/professional/needs, then need-links for the
// competency), pre-filled, and only when the person presses Save. Nothing is created on its own, and the person may change
// the words first. The need is the person's own: it records no competence and changes no verification.

export default function VerificationNeed({ competencyTitle, frameworkCompetencyId, reason, detail, accent }: {
  competencyTitle: string; frameworkCompetencyId: string | null; reason: string; detail: string[]; accent: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState(false);
  const initialTitle = `Develop: ${competencyTitle}`.slice(0, 200);
  const initialDetail = [reason, ...detail.map(d => `- ${d}`)].join("\n").slice(0, 2000);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true); setMsg(null);
    const post = (url: string, body: Record<string, unknown>) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try {
      const res = await post("/api/individual/professional/needs", {
        stage2: true, title: String(fd.get("title") ?? ""), detail: String(fd.get("detail") ?? ""), sourceNote: "From an assessor's outcome",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.id) { setMsg({ ok: false, text: json?.error ?? "That could not be saved. Try again shortly." }); return; }
      let linked = !frameworkCompetencyId;
      if (frameworkCompetencyId) {
        const l = await post("/api/individual/professional/need-links", { needId: json.id, kind: "competency", competencyId: frameworkCompetencyId });
        linked = l.ok;
      }
      setDone(true); setOpen(false);
      setMsg({ ok: true, text: linked ? "Added to your development plan under Needs & plan." : "Added under Needs & plan. It could not be linked to the competency." });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "That could not be saved. Check your connection and try again." });
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-2">
      {!open && !done && (
        <button type="button" onClick={() => { setOpen(true); setMsg(null); }} aria-expanded={false}
          className={`inline-flex min-h-[36px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg border border-gray-300 bg-white px-3 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 ${focusRing}`}>
          Add to my development plan
        </button>
      )}
      {open && (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
          <p className="text-[12.5px] text-gray-600">Check the words, change what you like, then save. Nothing is added until you do.</p>
          <Field label="What would you like to develop?" htmlFor={`vn-t-${frameworkCompetencyId ?? "x"}`}>
            <input id={`vn-t-${frameworkCompetencyId ?? "x"}`} name="title" required minLength={3} maxLength={200} defaultValue={initialTitle} className={inputCls} />
          </Field>
          <Field label="Details" htmlFor={`vn-d-${frameworkCompetencyId ?? "x"}`}>
            <textarea id={`vn-d-${frameworkCompetencyId ?? "x"}`} name="detail" rows={5} maxLength={2000} defaultValue={initialDetail} className={inputCls} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={primaryBtn} style={{ background: accent }}>{busy ? "Saving…" : "Save to my development plan"}</button>
            <button type="button" onClick={() => setOpen(false)} className={secondaryBtn}>Cancel</button>
          </div>
        </form>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-1 text-[12.5px] ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
    </div>
  );
}
