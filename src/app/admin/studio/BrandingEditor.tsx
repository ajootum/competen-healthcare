"use client";
import { useState } from "react";

type Hospital = { id: string; name: string; logo_url?: string | null; accent_color?: string | null };

const PRESET_COLORS = [
  "#0d9488", "#2563eb", "#7c3aed", "#db2777", "#dc2626",
  "#d97706", "#16a34a", "#0891b2", "#1d4ed8", "#374151",
];

export default function BrandingEditor({ hospital }: { hospital: Hospital }) {
  const [logoUrl, setLogoUrl]       = useState(hospital.logo_url ?? "");
  const [color, setColor]           = useState(hospital.accent_color ?? "#0d9488");
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [error, setError]           = useState("");

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    const res = await fetch("/api/admin/studio", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "branding", logo_url: logoUrl, accent_color: color }),
    });
    setSaving(false);
    if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); }
    else { const d = await res.json(); setError(d.error ?? "Failed"); }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Branding</h2>

      <div className="flex flex-col gap-4">
        {/* Logo preview */}
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl border border-gray-200 flex items-center justify-center overflow-hidden bg-gray-50 shrink-0"
            style={{ borderColor: color }}>
            {logoUrl
              ? <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
              : <span className="text-2xl font-bold" style={{ color }}>{hospital.name[0]}</span>
            }
          </div>
          <div className="flex-1">
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Logo URL</label>
            <input
              value={logoUrl}
              onChange={e => setLogoUrl(e.target.value)}
              placeholder="https://your-org.com/logo.png"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
        </div>

        {/* Accent color */}
        <div>
          <label className="text-xs font-semibold text-gray-500 mb-2 block">Accent Color</label>
          <div className="flex items-center gap-2 flex-wrap">
            {PRESET_COLORS.map(c => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full border-2 transition-all ${color === c ? "scale-110 border-gray-800" : "border-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={e => setColor(e.target.value)}
              className="w-7 h-7 rounded-full border border-gray-200 cursor-pointer p-0.5 bg-white" />
            <span className="text-xs font-mono text-gray-500 ml-1">{color}</span>
          </div>
        </div>

        {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex justify-end">
          <button onClick={save} disabled={saving}
            className="px-5 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save Branding"}
          </button>
        </div>
      </div>
    </div>
  );
}
