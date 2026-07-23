"use client";

import { useState } from "react";

// Professional Toolkit clinical calculators (SSW-CONF-001 §3). Pure client-side,
// deterministic tools implemented from standard validated formulas — NEWS2 (RCP
// National Early Warning Score 2, Scale 1), infusion rate, paediatric maintenance
// fluids (Holliday-Segar 4-2-1), BMI and unit conversion. They compute from
// clinician-entered values (tools, not advice) and every result carries a
// verify-against-local-protocol disclaimer.

const num = (s: string) => { const n = Number(s); return Number.isFinite(n) ? n : null; };
const Field = ({ label, value, onChange, unit }: { label: string; value: string; onChange: (v: string) => void; unit?: string }) => (
  <label className="block">
    <span className="text-[10px] font-semibold text-gray-500 uppercase">{label}{unit ? ` (${unit})` : ""}</span>
    <input type="number" step="any" value={value} onChange={e => onChange(e.target.value)} className="mt-0.5 w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
  </label>
);

// ── NEWS2 (RCP, Scale 1) ──────────────────────────────────────────────────────
function news2(rr: number, spo2: number, o2: boolean, sbp: number, pulse: number, alert: boolean, temp: number) {
  const items: [string, number][] = [
    ["Respiration rate", rr <= 8 ? 3 : rr <= 11 ? 1 : rr <= 20 ? 0 : rr <= 24 ? 2 : 3],
    ["SpO₂ (Scale 1)", spo2 >= 96 ? 0 : spo2 >= 94 ? 1 : spo2 >= 92 ? 2 : 3],
    ["Air or oxygen", o2 ? 2 : 0],
    ["Systolic BP", sbp <= 90 ? 3 : sbp <= 100 ? 2 : sbp <= 110 ? 1 : sbp <= 219 ? 0 : 3],
    ["Pulse", pulse <= 40 ? 3 : pulse <= 50 ? 1 : pulse <= 90 ? 0 : pulse <= 110 ? 1 : pulse <= 130 ? 2 : 3],
    ["Consciousness", alert ? 0 : 3],
    ["Temperature", temp <= 35 ? 3 : temp <= 36 ? 1 : temp <= 38 ? 0 : temp <= 39 ? 1 : 2],
  ];
  const score = items.reduce((a, [, s]) => a + s, 0);
  const anyThree = items.some(([, s]) => s === 3);
  const risk = score >= 7 ? "High" : (score >= 5 || anyThree) ? "Medium" : score >= 1 ? "Low-Medium" : "Low";
  return { score, risk, anyThree, items };
}

const RISK_TONE: Record<string, string> = { High: "text-rose-600", Medium: "text-orange-600", "Low-Medium": "text-amber-600", Low: "text-green-600" };
const TABS = ["NEWS2", "Infusion", "Fluids", "BMI", "Converter"] as const;

export default function ClinicalToolkit() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("NEWS2");
  // NEWS2
  const [n, setN] = useState({ rr: "18", spo2: "97", o2: false, sbp: "120", pulse: "80", alert: true, temp: "37.0" });
  const nv = { rr: num(n.rr), spo2: num(n.spo2), sbp: num(n.sbp), pulse: num(n.pulse), temp: num(n.temp) };
  const nReady = Object.values(nv).every(x => x != null);
  const nRes = nReady ? news2(nv.rr!, nv.spo2!, n.o2, nv.sbp!, nv.pulse!, n.alert, nv.temp!) : null;
  // Infusion
  const [inf, setInf] = useState({ volume: "500", time: "8", drop: "20" });
  const iv = { volume: num(inf.volume), time: num(inf.time), drop: num(inf.drop) };
  const rate = iv.volume != null && iv.time ? iv.volume / iv.time : null;
  const drops = rate != null && iv.drop != null ? (rate * iv.drop) / 60 : null;
  // Fluids (Holliday-Segar 4-2-1)
  const [fw, setFw] = useState("20");
  const fwv = num(fw);
  const maint = fwv != null && fwv > 0 ? (Math.min(fwv, 10) * 4 + Math.min(Math.max(fwv - 10, 0), 10) * 2 + Math.max(fwv - 20, 0) * 1) : null;
  // BMI
  const [b, setB] = useState({ h: "170", w: "70" });
  const bh = num(b.h), bw = num(b.w);
  const bmi = bh && bw ? bw / ((bh / 100) ** 2) : null;
  const bmiCat = bmi == null ? "" : bmi < 18.5 ? "Underweight" : bmi < 25 ? "Normal" : bmi < 30 ? "Overweight" : "Obese";
  // Converter
  const [conv, setConv] = useState({ kg: "70", c: "37" });
  const ck = num(conv.kg), cc = num(conv.c);

  const disclaimer = <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Computed from clinician-entered values using standard formulas. Always verify against your local protocol — not a substitute for clinical judgement.</p>;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {TABS.map(t => (<button key={t} onClick={() => setTab(t)} className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${tab === t ? "bg-teal-600 text-white" : "bg-gray-50 text-gray-600 border border-gray-200"}`}>{t}</button>))}
      </div>

      {tab === "NEWS2" && (
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Respiration rate" unit="/min" value={n.rr} onChange={(v: string) => setN({ ...n, rr: v })} />
            <Field label="SpO₂" unit="%" value={n.spo2} onChange={(v: string) => setN({ ...n, spo2: v })} />
            <Field label="Systolic BP" unit="mmHg" value={n.sbp} onChange={(v: string) => setN({ ...n, sbp: v })} />
            <Field label="Pulse" unit="/min" value={n.pulse} onChange={(v: string) => setN({ ...n, pulse: v })} />
            <Field label="Temperature" unit="°C" value={n.temp} onChange={(v: string) => setN({ ...n, temp: v })} />
            <div className="flex flex-col gap-1 justify-end">
              <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={n.o2} onChange={e => setN({ ...n, o2: e.target.checked })} /> On supplemental O₂</label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={!n.alert} onChange={e => setN({ ...n, alert: !e.target.checked })} /> New confusion / not alert</label>
            </div>
          </div>
          {nRes && (
            <div className="mt-4 flex items-center gap-4">
              <div className="text-center"><p className={`text-3xl font-bold ${RISK_TONE[nRes.risk]}`}>{nRes.score}</p><p className="text-[10px] text-gray-400">NEWS2</p></div>
              <div><p className={`text-sm font-bold ${RISK_TONE[nRes.risk]}`}>{nRes.risk} clinical risk</p><p className="text-[11px] text-gray-500">{nRes.risk === "High" ? "Urgent/emergency response; continuous monitoring." : nRes.risk === "Medium" ? "Urgent review by a clinician competent in acute illness." : nRes.anyThree ? "A single parameter scored 3 — review advised." : "Routine monitoring per local frequency."}</p></div>
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1">{nRes?.items.map(([l, s]) => (<span key={l} className={`text-[9px] px-1.5 py-0.5 rounded ${s === 3 ? "bg-rose-50 text-rose-700" : s >= 1 ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-500"}`}>{l} +{s}</span>))}</div>
          <p className="text-[10px] text-gray-400 mt-2">Scale 1 SpO₂. Use Scale 2 for patients with target 88–92% (hypercapnic respiratory failure) — not modelled here.</p>
          {disclaimer}
        </div>
      )}

      {tab === "Infusion" && (
        <div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Volume" unit="mL" value={inf.volume} onChange={(v: string) => setInf({ ...inf, volume: v })} />
            <Field label="Time" unit="hours" value={inf.time} onChange={(v: string) => setInf({ ...inf, time: v })} />
            <Field label="Drop factor" unit="gtt/mL" value={inf.drop} onChange={(v: string) => setInf({ ...inf, drop: v })} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-gray-100 p-3 text-center"><p className="text-2xl font-bold text-gray-900">{rate == null ? "—" : rate.toFixed(1)}</p><p className="text-[10px] text-gray-500">mL / hour</p></div>
            <div className="rounded-lg border border-gray-100 p-3 text-center"><p className="text-2xl font-bold text-gray-900">{drops == null ? "—" : Math.round(drops)}</p><p className="text-[10px] text-gray-500">drops / min</p></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Rate = volume ÷ time · drops/min = (rate × drop factor) ÷ 60.</p>
          {disclaimer}
        </div>
      )}

      {tab === "Fluids" && (
        <div>
          <div className="max-w-xs"><Field label="Body weight" unit="kg" value={fw} onChange={setFw} /></div>
          <div className="mt-4 flex items-center gap-4">
            <div className="rounded-lg border border-gray-100 p-3 text-center"><p className="text-2xl font-bold text-gray-900">{maint == null ? "—" : maint.toFixed(0)}</p><p className="text-[10px] text-gray-500">mL / hour</p></div>
            <div className="rounded-lg border border-gray-100 p-3 text-center"><p className="text-2xl font-bold text-gray-900">{maint == null ? "—" : (maint * 24).toFixed(0)}</p><p className="text-[10px] text-gray-500">mL / 24 h</p></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">Holliday-Segar 4-2-1: 4 mL/kg/h for first 10 kg, 2 for next 10 kg, 1 for each kg above 20 kg. Maintenance only — does not account for deficit, losses or restriction.</p>
          {disclaimer}
        </div>
      )}

      {tab === "BMI" && (
        <div>
          <div className="grid grid-cols-2 gap-3 max-w-sm"><Field label="Height" unit="cm" value={b.h} onChange={(v: string) => setB({ ...b, h: v })} /><Field label="Weight" unit="kg" value={b.w} onChange={(v: string) => setB({ ...b, w: v })} /></div>
          <div className="mt-4 flex items-center gap-4"><div className="text-center"><p className="text-3xl font-bold text-gray-900">{bmi == null ? "—" : bmi.toFixed(1)}</p><p className="text-[10px] text-gray-400">BMI kg/m²</p></div><p className={`text-sm font-bold ${bmiCat === "Normal" ? "text-green-600" : bmiCat === "Obese" ? "text-rose-600" : "text-amber-600"}`}>{bmiCat}</p></div>
          {disclaimer}
        </div>
      )}

      {tab === "Converter" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><Field label="Weight" unit="kg" value={conv.kg} onChange={(v: string) => setConv({ ...conv, kg: v })} /><p className="text-sm text-gray-700 mt-2">{ck == null ? "—" : `${(ck * 2.20462).toFixed(1)} lb`}</p></div>
          <div><Field label="Temperature" unit="°C" value={conv.c} onChange={(v: string) => setConv({ ...conv, c: v })} /><p className="text-sm text-gray-700 mt-2">{cc == null ? "—" : `${(cc * 9 / 5 + 32).toFixed(1)} °F`}</p></div>
          {disclaimer}
        </div>
      )}
    </div>
  );
}
