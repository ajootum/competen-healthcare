"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DocType, DocumentsConfig, Template } from "@/lib/individual/documents-config";

// The No-Code Document Template Studio editor (COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.3). It edits a DRAFT of the
// Document Studio configuration: templates (page, margins, typeface, colours, branding, header and footer, page numbers,
// date format, section titles, evidence and status wording) and document types (sections, default order and visibility,
// formats, templates, record-selection rules). Saved to /api/hq/individual/config {action: "documents"}, which re-checks
// hq.individual.config.manage, validates the whole draft against the hard limits and versions every changed template.
// It reaches people only when the Individual policy is published, as one audited WCE version.

const input = "w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const lab = "block text-[12.5px] font-semibold text-gray-700";

export default function TemplateStudio({ initial, sections, labelKeys }: { initial: DocumentsConfig; sections: [string, string][]; labelKeys: string[] }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<DocumentsConfig>(initial);
  const [open, setOpen] = useState<string>(initial.templates[0]?.code ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const setT = (code: string, f: (t: Template) => Template) => setCfg(c => ({ ...c, templates: c.templates.map(t => (t.code === code ? f(t) : t)) }));
  const setD = (code: string, f: (d: DocType) => DocType) => setCfg(c => ({ ...c, types: c.types.map(d => (d.code === code ? f(d) : d)) }));
  const t = cfg.templates.find(x => x.code === open);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/hq/individual/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "documents", settings: cfg }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "The draft could not be saved." }); return; }
      setCfg(j.settings);
      setMsg({ ok: true, text: "Draft saved. Changed templates get their next version. Publish the Individual policy to make it live." });
      router.refresh();
    } catch { setMsg({ ok: false, text: "The draft could not be saved. Check your connection." }); } finally { setBusy(false); }
  }
  const addTemplate = () => {
    const base = cfg.templates[0];
    const code = `template-${cfg.templates.length + 1}`;
    setCfg(c => ({ ...c, templates: [...c.templates, { ...base, code, name: "New template", version: 1, description: "" }] }));
    setOpen(code);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {cfg.templates.map(x => (
            <button key={x.code} type="button" onClick={() => setOpen(x.code)} aria-pressed={open === x.code}
              className={`${btn} border ${open === x.code ? "border-teal-700 bg-teal-50 text-teal-900" : "border-gray-300 bg-white text-gray-800"}`}>{x.name} v{x.version}</button>
          ))}
          <button type="button" onClick={addTemplate} className={`${btn} border border-dashed border-gray-400 text-gray-700`}>+ Template</button>
        </div>
        {t && (
          <div className="mt-3 grid gap-3 rounded-xl border border-gray-200 p-4 md:grid-cols-3">
            <label className={lab}>Name<input className={input} value={t.name} onChange={e => setT(t.code, x => ({ ...x, name: e.target.value }))} /></label>
            <label className={lab}>Code (fixed once used)<input className={input} value={t.code} onChange={e => { const v = e.target.value; setT(t.code, x => ({ ...x, code: v })); setOpen(v); }} /></label>
            <label className={lab}>Description<input className={input} value={t.description} onChange={e => setT(t.code, x => ({ ...x, description: e.target.value }))} /></label>
            <label className={lab}>Page size<select className={input} value={t.page.size} onChange={e => setT(t.code, x => ({ ...x, page: { ...x.page, size: e.target.value as "A4" } }))}><option>A4</option><option>Letter</option></select></label>
            <label className={lab}>Orientation<select className={input} value={t.page.orientation} onChange={e => setT(t.code, x => ({ ...x, page: { ...x.page, orientation: e.target.value as "portrait" } }))}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
            <fieldset className="grid grid-cols-4 gap-1"><legend className={lab}>Margins (mm)</legend>
              {(["top", "right", "bottom", "left"] as const).map(k => <input key={k} aria-label={`${k} margin`} type="number" min={8} max={40} className={input} value={t.page.margins[k]} onChange={e => setT(t.code, x => ({ ...x, page: { ...x.page, margins: { ...x.page.margins, [k]: Number(e.target.value) } } }))} />)}
            </fieldset>
            <label className={lab}>Typeface<select className={input} value={t.type.face} onChange={e => setT(t.code, x => ({ ...x, type: { ...x.type, face: e.target.value as "sans" } }))}><option value="sans">Sans-serif (Arial / Helvetica)</option><option value="serif">Serif (Times)</option></select></label>
            <label className={lab}>Base size (pt)<input type="number" step={0.5} min={8} max={14} className={input} value={t.type.base} onChange={e => setT(t.code, x => ({ ...x, type: { ...x.type, base: Number(e.target.value) } }))} /></label>
            <label className={lab}>Heading scale<input type="number" step={0.05} min={1} max={2} className={input} value={t.type.headingScale} onChange={e => setT(t.code, x => ({ ...x, type: { ...x.type, headingScale: Number(e.target.value) } }))} /></label>
            <label className={lab}>Line spacing<input type="number" step={0.05} min={1} max={2} className={input} value={t.type.lineSpacing} onChange={e => setT(t.code, x => ({ ...x, type: { ...x.type, lineSpacing: Number(e.target.value) } }))} /></label>
            {(["accent", "text", "muted"] as const).map(k => (
              <label key={k} className={lab}>Colour: {k}<input className={input} value={t.colours[k]} onChange={e => setT(t.code, x => ({ ...x, colours: { ...x.colours, [k]: e.target.value } }))} /></label>
            ))}
            <label className={lab}>Date format<select className={input} value={t.dateFormat} onChange={e => setT(t.code, x => ({ ...x, dateFormat: e.target.value as Template["dateFormat"] }))}><option value="d-mmm-yyyy">26 Oct 2026</option><option value="mmm-yyyy">Oct 2026</option><option value="yyyy-mm-dd">2026-10-26</option></select></label>
            <label className={lab}>Footer text<input className={input} value={t.branding.footerText} maxLength={200} onChange={e => setT(t.code, x => ({ ...x, branding: { ...x.branding, footerText: e.target.value } }))} /></label>
            <label className={lab}>Document types<input className={input} value={t.docTypes === "all" ? "all" : t.docTypes.join(", ")} onChange={e => setT(t.code, x => ({ ...x, docTypes: e.target.value.trim() === "all" ? "all" : e.target.value.split(/[\s,]+/).filter(Boolean) }))} /></label>
            <div className="flex flex-wrap gap-x-4 gap-y-1 md:col-span-3 text-[13px] text-gray-800">
              <label className="flex items-center gap-1"><input type="checkbox" checked={t.header.showHeadline} onChange={e => setT(t.code, x => ({ ...x, header: { ...x.header, showHeadline: e.target.checked } }))} /> Headline under the name</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={t.header.showContact} onChange={e => setT(t.code, x => ({ ...x, header: { ...x.header, showContact: e.target.checked } }))} /> Offer the person&apos;s email (they choose)</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={t.footer.pageNumbers} onChange={e => setT(t.code, x => ({ ...x, footer: { ...x.footer, pageNumbers: e.target.checked } }))} /> Page numbers</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={t.footer.generatedDate} onChange={e => setT(t.code, x => ({ ...x, footer: { ...x.footer, generatedDate: e.target.checked } }))} /> Generated date</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={t.branding.showCompetenMark} onChange={e => setT(t.code, x => ({ ...x, branding: { ...x.branding, showCompetenMark: e.target.checked } }))} /> Competen mark</label>
              <span className="text-gray-500">Photographs: not offered (no image is ever fetched into a document).</span>
            </div>
            <fieldset className="md:col-span-3"><legend className={lab}>Evidence and status wording (a label that is not for an independent decision may not claim verification)</legend>
              <div className="grid gap-2 md:grid-cols-3">
                {labelKeys.map(k => <label key={k} className="text-[12px] text-gray-600">{k}<input className={input} value={(t.labels as Record<string, string>)[k]} onChange={e => setT(t.code, x => ({ ...x, labels: { ...x.labels, [k]: e.target.value } }))} /></label>)}
              </div>
            </fieldset>
            <fieldset className="md:col-span-3"><legend className={lab}>Section titles (blank keeps the default)</legend>
              <div className="grid gap-2 md:grid-cols-3">
                {sections.map(([code, title]) => <label key={code} className="text-[12px] text-gray-600">{title}<input className={input} value={t.sectionTitles[code as keyof typeof t.sectionTitles] ?? ""} onChange={e => setT(t.code, x => { const st = { ...x.sectionTitles }; if (e.target.value.trim()) st[code as keyof typeof st] = e.target.value; else delete st[code as keyof typeof st]; return { ...x, sectionTitles: st }; })} /></label>)}
              </div>
            </fieldset>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-[14px] font-bold text-gray-900">Document types</h3>
        <ul className="mt-2 space-y-3">
          {cfg.types.map(d => (
            <li key={d.code} className="grid gap-2 rounded-xl border border-gray-200 p-3 md:grid-cols-2">
              <label className={lab}>Label<input className={input} value={d.label} onChange={e => setD(d.code, x => ({ ...x, label: e.target.value }))} /></label>
              <label className={lab}>Templates (codes)<input className={input} value={d.templates.join(", ")} onChange={e => setD(d.code, x => ({ ...x, templates: e.target.value.split(/[\s,]+/).filter(Boolean) }))} /></label>
              <label className={`${lab} md:col-span-2`}>Sections, in default order (codes)<input className={input} value={d.sections.join(", ")} onChange={e => setD(d.code, x => ({ ...x, sections: e.target.value.split(/[\s,]+/).filter(Boolean) as DocType["sections"] }))} /></label>
              <label className={`${lab} md:col-span-2`}>Sections on by default (codes)<input className={input} value={d.on.join(", ")} onChange={e => setD(d.code, x => ({ ...x, on: e.target.value.split(/[\s,]+/).filter(Boolean) as DocType["on"] }))} /></label>
              <div className="flex flex-wrap gap-x-4 text-[13px] text-gray-800 md:col-span-2">
                {(["docx", "pdf"] as const).map(f => <label key={f} className="flex items-center gap-1"><input type="checkbox" checked={d.formats.includes(f)} onChange={e => setD(d.code, x => ({ ...x, formats: e.target.checked ? [...new Set([...x.formats, f])] : x.formats.filter(y => y !== f) }))} /> {f.toUpperCase()}</label>)}
                <label className="flex items-center gap-1"><input type="checkbox" checked={d.rules.offerLapsed} onChange={e => setD(d.code, x => ({ ...x, rules: { ...x.rules, offerLapsed: e.target.checked } }))} /> Offer expired, superseded or revoked records (always labelled)</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={d.rules.offerSelfDeclared} onChange={e => setD(d.code, x => ({ ...x, rules: { ...x.rules, offerSelfDeclared: e.target.checked } }))} /> Offer self-declared records (always labelled)</label>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12.5px] text-gray-500">Section codes: {sections.map(([c]) => c).join(", ")}.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className={`${btn} bg-teal-700 text-white`}>{busy ? "Saving…" : "Save draft"}</button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
