"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  QUALITY_STATUS_CONFIG, METHODOLOGY_LABELS, IMPROVEMENT_STATUS_CONFIG,
  INDICATOR_UNIT_LABELS, INDICATOR_STATUS_CONFIG,
} from "@/lib/ckcm";

type Domain = { id: string; code: string; name: string };
type Framework = { id: string; code: string; name: string };
type QO = { id: string; code: string | null; title: string; description: string | null; status: string; domain_id: string | null; review_date: string | null };
type Standard = { id: string; quality_object_id: string; framework_id: string; reference_code: string; title: string | null };
type Indicator = {
  id: string; quality_object_id: string | null; code: string | null; name: string; unit: string;
  direction: string; target_value: number | null; escalation_value: number | null;
  latest_value: number | null; latest_period: string | null; status: string;
};
type Improvement = {
  id: string; code: string | null; title: string; quality_object_id: string | null;
  methodology: string; status: string; aim_statement: string | null; target_date: string | null; outcome_summary: string | null;
};

const IMPROVEMENT_NEXT: Record<string, string[]> = {
  proposed:  ["planning", "abandoned"],
  planning:  ["active", "abandoned"],
  active:    ["measuring", "abandoned"],
  measuring: ["sustained", "active", "abandoned"],
  sustained: ["closed"],
};

export default function QualityManager({ domains, frameworks, qos, standards, indicators, improvements }: {
  domains: Domain[]; frameworks: Framework[]; qos: QO[]; standards: Standard[];
  indicators: Indicator[]; improvements: Improvement[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQoForm, setShowQoForm] = useState(false);
  const [showIndForm, setShowIndForm] = useState(false);
  const [showIoForm, setShowIoForm] = useState(false);
  const [measureFor, setMeasureFor] = useState<string | null>(null);

  // Quality Object form
  const [qoTitle, setQoTitle] = useState("");
  const [qoDesc, setQoDesc] = useState("");
  const [qoDomain, setQoDomain] = useState("");
  const [stdRows, setStdRows] = useState<{ framework_id: string; reference_code: string }[]>([{ framework_id: "", reference_code: "" }]);

  // Indicator form
  const [indName, setIndName] = useState("");
  const [indQo, setIndQo] = useState("");
  const [indUnit, setIndUnit] = useState("percent");
  const [indDir, setIndDir] = useState("higher_is_better");
  const [indTarget, setIndTarget] = useState("");
  const [indEsc, setIndEsc] = useState("");

  // Measurement form
  const [mValue, setMValue] = useState("");

  // Improvement form
  const [ioTitle, setIoTitle] = useState("");
  const [ioQo, setIoQo] = useState("");
  const [ioProblem, setIoProblem] = useState("");
  const [ioAim, setIoAim] = useState("");
  const [ioMethod, setIoMethod] = useState("pdsa");

  const fwBy = new Map(frameworks.map(f => [f.id, f]));
  const domainBy = new Map(domains.map(d => [d.id, d]));
  const qoBy = new Map(qos.map(q => [q.id, q]));
  const stdsByQo = new Map<string, Standard[]>();
  for (const s of standards) {
    if (!stdsByQo.has(s.quality_object_id)) stdsByQo.set(s.quality_object_id, []);
    stdsByQo.get(s.quality_object_id)!.push(s);
  }
  const indsByQo = new Map<string, Indicator[]>();
  for (const i of indicators) {
    const k = i.quality_object_id ?? "";
    if (!indsByQo.has(k)) indsByQo.set(k, []);
    indsByQo.get(k)!.push(i);
  }

  async function post(body: Record<string, unknown>, done: () => void) {
    setBusy(true); setError(null);
    const res = await fetch("/api/quality", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); return; }
    done(); router.refresh();
  }

  async function advance(improvement_id: string, status: string) {
    setBusy(true); setError(null);
    const res = await fetch("/api/quality", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ improvement_id, status }) });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); return; }
    router.refresh();
  }

  const input = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30";
  const btn = "text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50";

  return (
    <div className="flex flex-col gap-6">
      {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-2.5">{error}</div>}

      {/* ── QUALITY OBJECTS ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Quality Objects</h2>
          <button onClick={() => setShowQoForm(v => !v)} className={`${btn} bg-teal-600 hover:bg-teal-700 text-white`}>
            {showQoForm ? "Cancel" : "+ Quality Object"}
          </button>
        </div>

        {showQoForm && (
          <div className="bg-white rounded-xl border border-teal-100 p-5 mb-4 flex flex-col gap-3">
            <input className={input} placeholder="Title — e.g. Hand Hygiene" value={qoTitle} onChange={e => setQoTitle(e.target.value)} />
            <textarea className={input} rows={2} placeholder="Description / purpose" value={qoDesc} onChange={e => setQoDesc(e.target.value)} />
            <select className={input} value={qoDomain} onChange={e => setQoDomain(e.target.value)}>
              <option value="">Quality domain…</option>
              {domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">Framework standards mapping (one QO satisfies many frameworks)</p>
              {stdRows.map((row, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <select className={input} value={row.framework_id}
                    onChange={e => setStdRows(rs => rs.map((r, j) => j === i ? { ...r, framework_id: e.target.value } : r))}>
                    <option value="">Framework…</option>
                    {frameworks.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                  <input className={input} placeholder="Reference — e.g. IPSG.1" value={row.reference_code}
                    onChange={e => setStdRows(rs => rs.map((r, j) => j === i ? { ...r, reference_code: e.target.value } : r))} />
                </div>
              ))}
              <button onClick={() => setStdRows(rs => [...rs, { framework_id: "", reference_code: "" }])}
                className="text-xs text-teal-600 hover:underline">+ add mapping</button>
            </div>
            <button disabled={busy || !qoTitle.trim()}
              onClick={() => post({ kind: "quality_object", title: qoTitle.trim(), description: qoDesc.trim() || null, domain_id: qoDomain || null, standards: stdRows },
                () => { setShowQoForm(false); setQoTitle(""); setQoDesc(""); setQoDomain(""); setStdRows([{ framework_id: "", reference_code: "" }]); })}
              className={`${btn} bg-teal-600 hover:bg-teal-700 text-white self-start`}>
              {busy ? "Saving…" : "Create Quality Object"}
            </button>
          </div>
        )}

        {qos.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
            No quality objects yet — create the first one (e.g. Hand Hygiene, Medication Reconciliation, Patient Identification).
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            {qos.map(q => {
              const st = QUALITY_STATUS_CONFIG[q.status];
              const dm = q.domain_id ? domainBy.get(q.domain_id) : null;
              const stds = stdsByQo.get(q.id) ?? [];
              const inds = indsByQo.get(q.id) ?? [];
              return (
                <div key={q.id} className="px-5 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{q.title}
                        {q.code && <span className="ml-2 text-[10px] font-mono text-gray-300">{q.code}</span>}
                      </p>
                      {q.description && <p className="text-[11px] text-gray-400 mt-0.5">{q.description}</p>}
                    </div>
                    {dm && <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-medium">{dm.name}</span>}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${st?.cls}`}>{st?.label ?? q.status}</span>
                  </div>
                  {(stds.length > 0 || inds.length > 0) && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {stds.map(s => (
                        <span key={s.id} className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-mono">
                          {fwBy.get(s.framework_id)?.code ?? "?"} {s.reference_code}
                        </span>
                      ))}
                      {inds.map(i => {
                        const ic = INDICATOR_STATUS_CONFIG[i.status];
                        return <span key={i.id} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ic.cls}`}>📈 {i.name}</span>;
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── INDICATORS ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Quality Indicators</h2>
          <button onClick={() => setShowIndForm(v => !v)} className={`${btn} bg-violet-600 hover:bg-violet-700 text-white`}>
            {showIndForm ? "Cancel" : "+ Indicator"}
          </button>
        </div>

        {showIndForm && (
          <div className="bg-white rounded-xl border border-violet-100 p-5 mb-4 flex flex-col gap-3">
            <input className={input} placeholder="Indicator name — e.g. Hand hygiene compliance" value={indName} onChange={e => setIndName(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <select className={input} value={indQo} onChange={e => setIndQo(e.target.value)}>
                <option value="">Linked Quality Object…</option>
                {qos.map(q => <option key={q.id} value={q.id}>{q.title}</option>)}
              </select>
              <select className={input} value={indUnit} onChange={e => setIndUnit(e.target.value)}>
                {Object.entries(INDICATOR_UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select className={input} value={indDir} onChange={e => setIndDir(e.target.value)}>
                <option value="higher_is_better">Higher is better</option>
                <option value="lower_is_better">Lower is better</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input className={input} placeholder="Target" value={indTarget} onChange={e => setIndTarget(e.target.value)} />
                <input className={input} placeholder="Escalation" value={indEsc} onChange={e => setIndEsc(e.target.value)} />
              </div>
            </div>
            <button disabled={busy || !indName.trim()}
              onClick={() => post({
                kind: "indicator", name: indName.trim(), quality_object_id: indQo || null, unit: indUnit, direction: indDir,
                target_value: indTarget === "" ? null : Number(indTarget), escalation_value: indEsc === "" ? null : Number(indEsc),
              }, () => { setShowIndForm(false); setIndName(""); setIndQo(""); setIndTarget(""); setIndEsc(""); })}
              className={`${btn} bg-violet-600 hover:bg-violet-700 text-white self-start`}>
              {busy ? "Saving…" : "Create Indicator"}
            </button>
          </div>
        )}

        {indicators.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">No indicators yet.</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            {indicators.map(i => {
              const ic = INDICATOR_STATUS_CONFIG[i.status];
              return (
                <div key={i.id} className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800">{i.name}</p>
                      <p className="text-[10px] text-gray-400">
                        {i.quality_object_id ? qoBy.get(i.quality_object_id)?.title : "Unlinked"}
                        {" · target "}{i.target_value ?? "—"} {INDICATOR_UNIT_LABELS[i.unit]}
                        {" · "}{i.direction === "lower_is_better" ? "lower is better" : "higher is better"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-800">{i.latest_value ?? "—"} <span className="text-[10px] font-normal text-gray-400">{i.latest_value != null ? INDICATOR_UNIT_LABELS[i.unit] : ""}</span></p>
                      {i.latest_period && <p className="text-[10px] text-gray-400">{new Date(i.latest_period).toLocaleDateString()}</p>}
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${ic.cls}`}>{ic.label}</span>
                    <button onClick={() => { setMeasureFor(measureFor === i.id ? null : i.id); setMValue(""); }}
                      className="text-xs text-violet-600 hover:underline shrink-0">record</button>
                  </div>
                  {measureFor === i.id && (
                    <div className="flex gap-2 mt-2.5">
                      <input className={input} autoFocus placeholder={`Value (${INDICATOR_UNIT_LABELS[i.unit]})`} value={mValue} onChange={e => setMValue(e.target.value)} />
                      <button disabled={busy || mValue === "" || isNaN(Number(mValue))}
                        onClick={() => post({ kind: "measurement", indicator_id: i.id, value: Number(mValue) }, () => setMeasureFor(null))}
                        className={`${btn} bg-violet-600 hover:bg-violet-700 text-white shrink-0`}>Save</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── IMPROVEMENT PROJECTS ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Improvement Projects</h2>
          <button onClick={() => setShowIoForm(v => !v)} className={`${btn} bg-amber-500 hover:bg-amber-600 text-white`}>
            {showIoForm ? "Cancel" : "+ Improvement"}
          </button>
        </div>

        {showIoForm && (
          <div className="bg-white rounded-xl border border-amber-100 p-5 mb-4 flex flex-col gap-3">
            <input className={input} placeholder="Title — e.g. Reduce medication administration errors" value={ioTitle} onChange={e => setIoTitle(e.target.value)} />
            <textarea className={input} rows={2} placeholder="Problem statement" value={ioProblem} onChange={e => setIoProblem(e.target.value)} />
            <textarea className={input} rows={2} placeholder="Aim — measurable goal, e.g. reduce errors by 30% in 6 months" value={ioAim} onChange={e => setIoAim(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <select className={input} value={ioQo} onChange={e => setIoQo(e.target.value)}>
                <option value="">Linked Quality Object…</option>
                {qos.map(q => <option key={q.id} value={q.id}>{q.title}</option>)}
              </select>
              <select className={input} value={ioMethod} onChange={e => setIoMethod(e.target.value)}>
                {Object.entries(METHODOLOGY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <button disabled={busy || !ioTitle.trim()}
              onClick={() => post({
                kind: "improvement", title: ioTitle.trim(), quality_object_id: ioQo || null,
                problem_statement: ioProblem.trim() || null, aim_statement: ioAim.trim() || null, methodology: ioMethod,
              }, () => { setShowIoForm(false); setIoTitle(""); setIoProblem(""); setIoAim(""); setIoQo(""); })}
              className={`${btn} bg-amber-500 hover:bg-amber-600 text-white self-start`}>
              {busy ? "Saving…" : "Create Improvement"}
            </button>
          </div>
        )}

        {improvements.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-sm text-gray-400">
            No improvement projects yet — quality improves through governed initiatives (PDSA, audits, RCA…).
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
            {improvements.map(io => {
              const st = IMPROVEMENT_STATUS_CONFIG[io.status];
              const next = IMPROVEMENT_NEXT[io.status] ?? [];
              return (
                <div key={io.id} className="px-5 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{io.title}
                        {io.code && <span className="ml-2 text-[10px] font-mono text-gray-300">{io.code}</span>}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {METHODOLOGY_LABELS[io.methodology]}
                        {io.quality_object_id ? ` · ${qoBy.get(io.quality_object_id)?.title}` : ""}
                        {io.aim_statement ? ` · ${io.aim_statement}` : ""}
                      </p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${st?.cls}`}>{st?.label ?? io.status}</span>
                    {next.map(n => (
                      <button key={n} disabled={busy} onClick={() => advance(io.id, n)}
                        className="text-[10px] font-semibold text-teal-600 border border-teal-200 hover:bg-teal-50 px-2 py-0.5 rounded transition-colors">
                        → {IMPROVEMENT_STATUS_CONFIG[n]?.label ?? n}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
