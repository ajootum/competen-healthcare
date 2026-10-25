"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { focusRing, primaryBtn, secondaryBtn } from "../chrome";
import { inputCls } from "./forms";
import { AiNoticeText, aiNotice, type AiNotice } from "./ai-refusal";

// The Document Studio draft editor (COMPETEN-PROFESSIONAL-PROGRESS-01 PR7 s10.4-10.5). It edits PRESENTATION only: which
// sections show and in what order, which of the person's own records go in each (by key) and in what order, which facts
// of a record show, and the person's own words. Saving posts the choices; the server checks every key against the
// person's own records and composes the preview from the owners' records. Nothing here can change a source record.

type Rec = { key: string; title: string; subtitle: string | null; status: string; sections: string[]; facts: { code: string; label: string; value: string; defaultHidden?: boolean }[]; source: string };
type DR = { key: string; hide?: string[]; show?: string[] };
type DS = { code: string; visible: boolean; title?: string | null; intro?: string | null; records: DR[] };
type Draft = { headline?: string | null; summary?: string | null; showContact?: boolean; sections: DS[] };

const small = `inline-flex min-h-[32px] pointer-coarse:min-h-[var(--cmp-touch-min)] items-center rounded-lg border border-gray-300 bg-white px-2 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 ${focusRing}`;
const move = <T,>(xs: T[], i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= xs.length) return xs; const c = [...xs]; [c[i], c[j]] = [c[j], c[i]]; return c; };

export default function DocumentEditor({ id, title: title0, templateCode, templates, draft: draft0, records, sectionTitles, accent, aiOn, showContactOffered }: {
  id: string; title: string; templateCode: string; templates: { code: string; label: string }[]; draft: Draft; records: Rec[];
  sectionTitles: Record<string, string>; accent: string; aiOn: boolean; showContactOffered: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(title0);
  const [template, setTemplate] = useState(templateCode);
  const [draft, setDraft] = useState<Draft>(draft0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ai, setAi] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [notice, setNotice] = useState<AiNotice | null>(null);
  const [purpose, setPurpose] = useState("");
  const [aiUsed, setAiUsed] = useState(false);
  const byKey = new Map(records.map(r => [r.key, r]));
  const setSection = (i: number, f: (s: DS) => DS) => setDraft(d => ({ ...d, sections: d.sections.map((s, n) => (n === i ? f(s) : s)) }));

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/individual/professional/document-drafts", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title, templateCode: template, content: draft, ...(aiUsed ? { aiAssisted: true } : {}) }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: typeof j?.error === "string" ? j.error : "The draft could not be saved." }); return; }
      setMsg({ ok: true, text: "Saved. The preview below shows the document as it will export." });
      router.refresh();
    } catch { setMsg({ ok: false, text: "The draft could not be saved. Check your connection." }); } finally { setBusy(false); }
  }
  async function askAi() {
    setAiBusy(true); setNotice(null); setAi(null);
    try {
      const res = await fetch("/api/individual/professional/document-drafts/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, purpose }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice(aiNotice(j, "The assistant could not answer just now.")); return; }
      setAi(j.text);
    } catch { setNotice({ text: "The assistant could not be reached.", continuity: false }); } finally { setAiBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-[13.5px] font-semibold text-gray-800">Document title
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} className={`mt-1 ${inputCls}`} />
        </label>
        <label className="block text-[13.5px] font-semibold text-gray-800">Template
          <select value={template} onChange={e => setTemplate(e.target.value)} className={`mt-1 ${inputCls}`}>
            {templates.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
          </select>
        </label>
        <label className="block text-[13.5px] font-semibold text-gray-800 md:col-span-2">Headline under your name (your words, optional)
          <input value={draft.headline ?? ""} onChange={e => setDraft(d => ({ ...d, headline: e.target.value }))} maxLength={160} className={`mt-1 ${inputCls}`} />
        </label>
        {showContactOffered && (
          <label className="flex min-h-[44px] items-center gap-2 text-[13.5px] text-gray-800">
            <input type="checkbox" checked={!!draft.showContact} onChange={e => setDraft(d => ({ ...d, showContact: e.target.checked }))} /> Show my email address
          </label>
        )}
      </div>

      <ol className="space-y-3">
        {draft.sections.map((s, i) => {
          const eligible = records.filter(r => r.sections.includes(s.code));
          const chosen = new Set(s.records.map(r => r.key));
          return (
            <li key={s.code} className="rounded-xl border border-gray-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex min-h-[36px] items-center gap-2 text-[14px] font-semibold text-gray-900">
                  <input type="checkbox" checked={s.visible} onChange={e => setSection(i, x => ({ ...x, visible: e.target.checked }))} />
                  {s.title?.trim() || sectionTitles[s.code] || s.code}
                </label>
                <button type="button" className={small} disabled={i === 0} onClick={() => setDraft(d => ({ ...d, sections: move(d.sections, i, -1) }))} aria-label="Move section up">↑</button>
                <button type="button" className={small} disabled={i === draft.sections.length - 1} onClick={() => setDraft(d => ({ ...d, sections: move(d.sections, i, 1) }))} aria-label="Move section down">↓</button>
                <span className="text-[12px] text-gray-500">{s.records.length} chosen of {eligible.length} available</span>
              </div>
              {s.visible && (
                <div className="mt-2 space-y-2">
                  <input value={s.title ?? ""} onChange={e => setSection(i, x => ({ ...x, title: e.target.value }))} placeholder="Section title (optional)" maxLength={60} className={inputCls} aria-label="Section title" />
                  {s.code === "summary" ? (
                    <div>
                      <textarea value={draft.summary ?? ""} onChange={e => setDraft(d => ({ ...d, summary: e.target.value }))} rows={5} maxLength={4000} className={inputCls} aria-label="Professional summary, in your own words" placeholder="Your professional summary, in your own words." />
                      {aiOn && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <input value={purpose} onChange={e => setPurpose(e.target.value)} maxLength={300} placeholder="Purpose (optional), e.g. a ward manager role" className={`${inputCls} max-w-md`} aria-label="Purpose for the AI draft" />
                          <button type="button" onClick={askAi} disabled={aiBusy} className={secondaryBtn} style={{ color: accent }}>{aiBusy ? "Thinking…" : "✦ Draft a summary from my chosen records (optional)"}</button>
                        </div>
                      )}
                      {notice && <AiNoticeText notice={notice} className="mt-2" />}
                      {ai && (
                        <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-3" aria-live="polite">
                          <p className="text-[11.5px] font-bold uppercase tracking-[0.12em] text-gray-500">AI suggestion · check every word · nothing is used unless you choose it</p>
                          <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-gray-800">{ai}</p>
                          <button type="button" className={`mt-2 ${small}`} onClick={() => { setDraft(d => ({ ...d, summary: ai })); setAiUsed(true); setAi(null); }}>Use this text, then edit it</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <textarea value={s.intro ?? ""} onChange={e => setSection(i, x => ({ ...x, intro: e.target.value }))} rows={2} maxLength={1000} className={inputCls} aria-label="Section introduction (optional)" placeholder="A short introduction (optional, your words)." />
                      {s.records.length > 0 && (
                        <ul className="space-y-2">
                          {s.records.map((dr, n) => {
                            const r = byKey.get(dr.key);
                            return (
                              <li key={dr.key} className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[13.5px] font-semibold text-gray-900">{r ? r.title : "A record no longer available"}</span>
                                  {r && <span className="text-[12px] text-gray-600">{r.status}</span>}
                                  <button type="button" className={small} disabled={n === 0} onClick={() => setSection(i, x => ({ ...x, records: move(x.records, n, -1) }))} aria-label="Move up">↑</button>
                                  <button type="button" className={small} disabled={n === s.records.length - 1} onClick={() => setSection(i, x => ({ ...x, records: move(x.records, n, 1) }))} aria-label="Move down">↓</button>
                                  <button type="button" className={small} onClick={() => setSection(i, x => ({ ...x, records: x.records.filter(k => k.key !== dr.key) }))}>Remove</button>
                                </div>
                                {r && r.facts.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-x-4">
                                    {r.facts.map(f => {
                                      const on = f.defaultHidden ? (dr.show ?? []).includes(f.code) : !(dr.hide ?? []).includes(f.code);
                                      const toggle = () => setSection(i, x => ({ ...x, records: x.records.map(k => k.key !== dr.key ? k : f.defaultHidden
                                        ? { ...k, show: on ? (k.show ?? []).filter(c => c !== f.code) : [...(k.show ?? []), f.code] }
                                        : { ...k, hide: on ? [...(k.hide ?? []), f.code] : (k.hide ?? []).filter(c => c !== f.code) }) }));
                                      return <label key={f.code} className="flex items-center gap-1 text-[12px] text-gray-700"><input type="checkbox" checked={on} onChange={toggle} /> {f.label}</label>;
                                    })}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {eligible.filter(r => !chosen.has(r.key)).length > 0 && (
                        <details>
                          <summary className={`cursor-pointer text-[12.5px] font-semibold ${focusRing}`} style={{ color: accent }}>Add records to this section</summary>
                          <ul className="mt-1 space-y-1">
                            {eligible.filter(r => !chosen.has(r.key)).map(r => (
                              <li key={r.key}>
                                <button type="button" className="text-left text-[13px] text-gray-800 underline-offset-2 hover:underline"
                                  onClick={() => setSection(i, x => ({ ...x, records: [...x.records, { key: r.key }] }))}>
                                  + {r.title}{r.subtitle ? `, ${r.subtitle}` : ""} <span className="text-gray-500">· {r.status} · {r.source}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {eligible.length === 0 && <p className="text-[12.5px] text-gray-500">You have no records of this kind yet. Add them in their own module first.</p>}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className={primaryBtn} style={{ background: accent }}>{busy ? "Saving…" : "Save and preview"}</button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13.5px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
