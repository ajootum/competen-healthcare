"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPES = [
  { v: "competency", label: "Competency" }, { v: "framework", label: "Framework" }, { v: "skill", label: "Skill" }, { v: "blueprint", label: "Blueprint" },
  { v: "question_bank", label: "Question bank" }, { v: "osce", label: "OSCE" }, { v: "simulation", label: "Simulation" },
  { v: "learning_resource", label: "Learning resource" }, { v: "policy", label: "Policy" }, { v: "guideline", label: "Guideline" }, { v: "other", label: "Other" },
];
const LOCALES = [
  { v: "fr", label: "French" }, { v: "es", label: "Spanish" }, { v: "ar", label: "Arabic" }, { v: "sw", label: "Swahili" },
  { v: "pt", label: "Portuguese" }, { v: "zh", label: "Chinese" }, { v: "hi", label: "Hindi" }, { v: "de", label: "German" }, { v: "other", label: "Other" },
];
const STATUS_COLOR: Record<string, string> = { not_started: "#94a3b8", in_progress: "#f59e0b", review: "#8b5cf6", published: "#10b981" };
const NEXT: Record<string, string> = { not_started: "in_progress", in_progress: "review", review: "published" };

export default function TranslationManager({ translations }: { translations: any[] }) {
  const router = useRouter();
  const [assetType, setAssetType] = useState("competency");
  const [label, setLabel] = useState("");
  const [locale, setLocale] = useState("fr");
  const [translator, setTranslator] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const call = async (url: string, opts: RequestInit) => { setBusy(true); const r = await fetch(url, opts); setBusy(false); if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "Request failed."); return false; } setErr(null); router.refresh(); return true; };

  async function add() {
    if (!label.trim()) { setErr("Enter the asset name."); return; }
    if (await call("/api/studio/translations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asset_type: assetType, asset_label: label, locale, translator_name: translator, status: "in_progress" }) })) { setLabel(""); setTranslator(""); }
  }
  const setStatus = (id: string, status: string) => call(`/api/studio/translations?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
  const del = (id: string) => call(`/api/studio/translations?id=${id}`, { method: "DELETE" });

  const inp = "text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-teal-400";

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h2 className="font-semibold text-gray-900 text-sm mb-3">Register a translation</h2>
        <div className="flex flex-col lg:flex-row gap-2">
          <select value={assetType} onChange={e => setAssetType(e.target.value)} className={`${inp} lg:w-40`}>{TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}</select>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Asset name" className={`${inp} flex-1`} />
          <select value={locale} onChange={e => setLocale(e.target.value)} className={`${inp} lg:w-32`}>{LOCALES.map(l => <option key={l.v} value={l.v}>{l.label}</option>)}</select>
          <input value={translator} onChange={e => setTranslator(e.target.value)} placeholder="Translator (optional)" className={`${inp} lg:w-40`} />
          <button onClick={add} disabled={busy} className="text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg px-4 py-2 whitespace-nowrap">{busy ? "…" : "Add"}</button>
        </div>
        {err && <p className="text-[11px] text-[var(--cmp-text-critical)] mt-1">{err}</p>}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <h3 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-2">Translations ({translations.length})</h3>
        {translations.length === 0 ? (
          <p className="text-xs text-gray-500">No translations registered yet — English is the source; add a target-locale translation above.</p>
        ) : (
          <div className="flex flex-col divide-y divide-gray-50">
            {translations.map((t: any) => (
              <div key={t.id} className="flex items-center gap-2 py-2 text-xs flex-wrap">
                <span className="text-[9px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 shrink-0 w-24 text-center">{t.typeLabel}</span>
                <span className="font-semibold text-gray-800 truncate max-w-[30%]">{t.assetLabel}</span>
                <span className="text-gray-500">→</span>
                <span className="font-semibold text-gray-700 w-20">{t.localeLabel}</span>
                <span className="inline-flex items-center gap-1 text-[10px]"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLOR[t.status] }} />{t.status.replace(/_/g, " ")}</span>
                {t.translator && <span className="text-[10px] text-gray-500 truncate hidden md:inline">· {t.translator}</span>}
                <div className="ml-auto flex items-center gap-1.5">
                  {NEXT[t.status] && <button onClick={() => setStatus(t.id, NEXT[t.status])} disabled={busy} className="text-[10px] font-semibold text-teal-700 hover:underline">→ {NEXT[t.status].replace(/_/g, " ")}</button>}
                  <button onClick={() => del(t.id)} disabled={busy} className="text-gray-500 hover:text-red-500" title="Remove">✕</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
