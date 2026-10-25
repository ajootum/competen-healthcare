"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CpdRequirement, LcpdConfig, ShareableClass } from "@/lib/individual/professional/lcpd-config";

// The Professional Learning and CPD configuration (COMPETEN-PROFESSIONAL-LCPD-01 s11), as a draft. Saved to
// /api/hq/individual/config {action: "lcpd"}, which re-checks hq.individual.config.manage and validates the whole draft.
// It takes effect only when the Individual policy is published (the Publish section below), as one audited version.

const input = "w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const label = "block text-[12.5px] font-semibold text-gray-700";
const SHAREABLE: [ShareableClass, string][] = [["platform_recorded", "Recorded by Competen Learning"], ["source_linked", "Self-declared, with a document attached"], ["self_declared", "Self-declared"]];
const BLANK_REQ = { code: "", label: "", profession: "", jurisdiction: "", body: "", source: { title: "", reference: "", url: "" }, reviewStatus: "unreviewed", reviewedOn: "",
  cycleMonths: 12, requiredHours: "", requiredCredits: "", eligibleTypes: "", mandatoryCategories: "", evidence: "", reportingPeriod: "", effectiveFrom: "", effectiveTo: "", version: "" };
type ReqForm = typeof BLANK_REQ;

const toForm = (r: CpdRequirement): ReqForm => ({ ...r, source: { title: r.source.title, reference: r.source.reference ?? "", url: r.source.url ?? "" }, reviewedOn: r.reviewedOn ?? "",
  cycleMonths: r.cycleMonths, requiredHours: r.requiredHours == null ? "" : String(r.requiredHours), requiredCredits: r.requiredCredits == null ? "" : String(r.requiredCredits),
  eligibleTypes: r.eligibleTypes.join(", "), mandatoryCategories: r.mandatoryCategories.map(m => `${m.label}: ${m.types.join(" ")}: ${m.minHours}`).join("\n"),
  evidence: r.evidence ?? "", reportingPeriod: r.reportingPeriod ?? "", effectiveTo: r.effectiveTo ?? "" });
const fromForm = (f: ReqForm) => ({
  ...f, requiredHours: f.requiredHours === "" ? null : Number(f.requiredHours), requiredCredits: f.requiredCredits === "" ? null : Number(f.requiredCredits), cycleMonths: Number(f.cycleMonths),
  eligibleTypes: String(f.eligibleTypes).split(/[\s,]+/).filter(Boolean),
  mandatoryCategories: String(f.mandatoryCategories).split(/\r?\n/).map(l => l.split(":").map(s => s.trim())).filter(p => p.length >= 3 && p[0]).map(([l, t, h]) => ({ label: l, types: t.split(/[\s,]+/).filter(Boolean), minHours: Number(h) })),
  reviewedOn: f.reviewedOn || null, effectiveTo: f.effectiveTo || null,
});

export default function LcpdEditor({ initial }: { initial: LcpdConfig }) {
  const router = useRouter();
  const [types, setTypes] = useState(initial.activityTypes.map(t => `${t.code}: ${t.label}`).join("\n"));
  const [templates, setTemplates] = useState(initial.reflectionTemplates.map(t => ({ code: t.code, label: t.label, prompts: t.prompts.join("\n") })));
  const [share, setShare] = useState<ShareableClass[]>(initial.passportShareable);
  const [reqs, setReqs] = useState<ReqForm[]>(initial.requirements.map(toForm));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true); setMsg(null);
    const settings = {
      activityTypes: types.split(/\r?\n/).map(l => { const i = l.indexOf(":"); return i < 0 ? null : { code: l.slice(0, i).trim(), label: l.slice(i + 1).trim() }; }).filter(Boolean),
      reflectionTemplates: templates.map(t => ({ code: t.code, label: t.label, prompts: t.prompts.split(/\r?\n/).filter(p => p.trim()) })),
      passportShareable: share,
      requirements: reqs.map(fromForm),
    };
    try {
      const res = await fetch("/api/hq/individual/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "lcpd", settings }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "The draft could not be saved." }); return; }
      setMsg({ ok: true, text: "Draft saved. Publish below to make it effective." }); router.refresh();
    } catch { setMsg({ ok: false, text: "The draft could not be saved. Check your connection." }); } finally { setBusy(false); }
  }
  const setReq = (i: number, patch: Partial<ReqForm>) => setReqs(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      <label className={label}>CPD activity types, one per line as code: label
        <textarea className={`${input} font-mono`} rows={6} value={types} onChange={e => setTypes(e.target.value)} />
      </label>
      <fieldset className="space-y-2"><legend className={label}>Reflection templates</legend>
        {templates.map((t, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-gray-200 p-2 sm:grid-cols-3">
            <label className={label}>Code<input className={input} value={t.code} onChange={e => setTemplates(ts => ts.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} /></label>
            <label className={`${label} sm:col-span-2`}>Label<input className={input} value={t.label} onChange={e => setTemplates(ts => ts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></label>
            <label className={`${label} sm:col-span-3`}>Prompts, one per line<textarea className={input} rows={3} value={t.prompts} onChange={e => setTemplates(ts => ts.map((x, j) => (j === i ? { ...x, prompts: e.target.value } : x)))} /></label>
          </div>
        ))}
        <button type="button" className={`${btn} border border-gray-300 bg-white text-gray-800`} onClick={() => setTemplates(ts => [...ts, { code: "", label: "", prompts: "" }])}>Add a template</button>
      </fieldset>
      <fieldset><legend className={label}>Learning a person may choose to share on a Passport link</legend>
        {SHAREABLE.map(([v, l]) => (
          <label key={v} className="mr-4 inline-flex items-center gap-2 text-[13px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
            <input type="checkbox" checked={share.includes(v)} onChange={e => setShare(s => (e.target.checked ? [...s, v] : s.filter(x => x !== v)))} /> {l}
          </label>
        ))}
        <p className="text-[12px] text-gray-600">Private reflections and development plans are never shareable, whatever is chosen here.</p>
      </fieldset>
      <fieldset className="space-y-3"><legend className={label}>CPD requirements (none is seeded: each names its authoritative source and review status)</legend>
        {reqs.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-3">
            <label className={label}>Code<input className={input} value={r.code} onChange={e => setReq(i, { code: e.target.value })} /></label>
            <label className={`${label} sm:col-span-2`}>Name<input className={input} value={r.label} onChange={e => setReq(i, { label: e.target.value })} /></label>
            <label className={label}>Profession<input className={input} value={r.profession} onChange={e => setReq(i, { profession: e.target.value })} /></label>
            <label className={label}>Jurisdiction<input className={input} value={r.jurisdiction} onChange={e => setReq(i, { jurisdiction: e.target.value })} /></label>
            <label className={label}>Regulatory or professional body<input className={input} value={r.body} onChange={e => setReq(i, { body: e.target.value })} /></label>
            <label className={label}>Source title<input className={input} value={r.source.title} onChange={e => setReq(i, { source: { ...r.source, title: e.target.value } })} /></label>
            <label className={label}>Source reference<input className={input} value={r.source.reference} onChange={e => setReq(i, { source: { ...r.source, reference: e.target.value } })} /></label>
            <label className={label}>Source link (https)<input className={input} value={r.source.url} onChange={e => setReq(i, { source: { ...r.source, url: e.target.value } })} /></label>
            <label className={label}>Review status<select className={input} value={r.reviewStatus} onChange={e => setReq(i, { reviewStatus: e.target.value })}>
              <option value="unreviewed">Not yet reviewed</option><option value="under_review">Under review</option><option value="reviewed">Reviewed against its source</option></select></label>
            <label className={label}>Reviewed on<input type="date" className={input} value={r.reviewedOn} onChange={e => setReq(i, { reviewedOn: e.target.value })} /></label>
            <label className={label}>Version of the source<input className={input} value={r.version} onChange={e => setReq(i, { version: e.target.value })} /></label>
            <label className={label}>Cycle (months)<input type="number" min={1} max={120} className={input} value={r.cycleMonths} onChange={e => setReq(i, { cycleMonths: Number(e.target.value) })} /></label>
            <label className={label}>Required hours<input type="number" min={0} step={0.5} className={input} value={r.requiredHours} onChange={e => setReq(i, { requiredHours: e.target.value })} /></label>
            <label className={label}>Required credits<input type="number" min={0} step={0.5} className={input} value={r.requiredCredits} onChange={e => setReq(i, { requiredCredits: e.target.value })} /></label>
            <label className={`${label} sm:col-span-3`}>Eligible activity type codes (blank: all)<input className={input} value={r.eligibleTypes} onChange={e => setReq(i, { eligibleTypes: e.target.value })} /></label>
            <label className={`${label} sm:col-span-3`}>Mandatory categories, one per line as label: type codes: minimum hours<textarea className={input} rows={2} value={r.mandatoryCategories} onChange={e => setReq(i, { mandatoryCategories: e.target.value })} /></label>
            <label className={`${label} sm:col-span-2`}>Evidence expected<input className={input} value={r.evidence} onChange={e => setReq(i, { evidence: e.target.value })} /></label>
            <label className={label}>Reporting period<input className={input} value={r.reportingPeriod} onChange={e => setReq(i, { reportingPeriod: e.target.value })} /></label>
            <label className={label}>In effect from<input type="date" className={input} value={r.effectiveFrom} onChange={e => setReq(i, { effectiveFrom: e.target.value })} /></label>
            <label className={label}>In effect until (optional)<input type="date" className={input} value={r.effectiveTo} onChange={e => setReq(i, { effectiveTo: e.target.value })} /></label>
            <div className="flex items-end"><button type="button" className={`${btn} border border-gray-300 bg-white text-gray-800`} onClick={() => setReqs(rs => rs.filter((_, j) => j !== i))}>Remove</button></div>
          </div>
        ))}
        <button type="button" className={`${btn} border border-gray-300 bg-white text-gray-800`} onClick={() => setReqs(rs => [...rs, { ...BLANK_REQ }])}>Add a requirement</button>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} className={`${btn} bg-teal-700 text-white hover:bg-teal-800`} onClick={() => void save()}>Save Learning & CPD draft</button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
