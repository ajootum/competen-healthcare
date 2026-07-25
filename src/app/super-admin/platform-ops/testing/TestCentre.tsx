"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { useRouter } from "next/navigation";

// Configuration Testing & Simulation Centre (NCP-012) — author no-code test suites whose cases ASSERT expected
// outcomes against live config objects, then run them. Six executable test types run server-side against the
// actual definitions (schema conformance, dependency safety, metric RAG, rule decision, permission policy,
// object status). A run that passes every case flips the suite's promotion gate green.
type ObjRow = { object_key: string; object_type: string; display_name: string };
type Suite = { suite_key: string; name: string; description?: string; cases?: any[]; last_run?: any; status: string };
type LocalCase = { key: string; name: string; test_type: string; object_key: string; inputsStr: string; expectedStr: string };
type Result = { key: string; name: string; test_type: string; object_key: string; pass: boolean; actual: any; expected: any; detail: string };

const TYPES = [
  { v: "schema", l: "Schema conformance", hint: { inputs: "{}", expected: "{}" } },
  { v: "dependency", l: "Dependency safety", hint: { inputs: "{}", expected: "{}" } },
  { v: "object_status", l: "Object status", hint: { inputs: "{}", expected: '{ "status": "active" }' } },
  { v: "metric_rag", l: "Metric RAG", hint: { inputs: '{ "value": 2.5 }', expected: '{ "rag": "green" }' } },
  { v: "rule_decision", l: "Rule decision", hint: { inputs: '{ "cond_key": "value" }', expected: '{ "outputs": { "action_key": "value" } }' } },
  { v: "permission_policy", l: "Permission policy", hint: { inputs: '{ "role": "nurse" }', expected: '{ "applies": true }' } },
];
const TM = Object.fromEntries(TYPES.map(t => [t.v, t]));
const FILTER: Record<string, string> = { metric_rag: "METRIC", rule_decision: "BUSINESS_RULE", permission_policy: "PERMISSION" };
const input = "border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white";
const ST: Record<string, string> = { draft: "bg-gray-100 text-gray-600", passing: "bg-emerald-100 text-emerald-700", failing: "bg-rose-100 text-rose-700" };
const freeKey = (have: Set<string>) => { let n = 1; while (have.has(`case_${n}`)) n++; return `case_${n}`; };
const pretty = (o: any) => { try { return JSON.stringify(o ?? {}, null, 0); } catch { return "{}"; } };
const toLocal = (s?: Suite): LocalCase[] => (s?.cases ?? []).map((c: any) => ({ key: c.key, name: c.name ?? "", test_type: c.test_type, object_key: c.object_key, inputsStr: pretty(c.inputs), expectedStr: pretty(c.expected) }));

export default function TestCentre({ suites, objects }: { suites: Suite[]; objects: ObjRow[] }) {
  const router = useRouter();
  const [selKey, setSelKey] = useState<string | null>(suites[0]?.suite_key ?? null);
  const selS = suites.find(s => s.suite_key === selKey) ?? null;
  const [cases, setCases] = useState<LocalCase[]>(toLocal(suites[0]));
  const [results, setResults] = useState<Result[] | null>(null);
  const [gate, setGate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [nk, setNk] = useState(""); const [nn, setNn] = useState("");

  function pick(s: Suite) { setSelKey(s.suite_key); setCases(toLocal(s)); setResults(null); setGate(null); setMsg(null); }
  const addCase = () => setCases(cs => [...cs, { key: freeKey(new Set(cs.map(c => c.key))), name: "", test_type: "schema", object_key: "", inputsStr: "{}", expectedStr: "{}" }]);
  const patch = (i: number, p: Partial<LocalCase>) => setCases(cs => cs.map((c, j) => j === i ? { ...c, ...p } : c));
  const objsFor = (t: string) => FILTER[t] ? objects.filter(o => o.object_type === FILTER[t]) : objects;

  function buildCases(): any[] | null {
    const out = [];
    for (const c of cases) {
      if (!c.name.trim()) { setMsg(`Case "${c.key}" needs a name.`); return null; }
      if (!c.object_key) { setMsg(`Case "${c.key}" needs a target object.`); return null; }
      let inputs, expected;
      try { inputs = JSON.parse(c.inputsStr || "{}"); } catch { setMsg(`Case "${c.name}": inputs is not valid JSON.`); return null; }
      try { expected = JSON.parse(c.expectedStr || "{}"); } catch { setMsg(`Case "${c.name}": expected is not valid JSON.`); return null; }
      out.push({ key: c.key, name: c.name.trim(), test_type: c.test_type, object_key: c.object_key, inputs, expected });
    }
    return out;
  }
  async function save(): Promise<boolean> {
    if (!selS) return false;
    const built = buildCases(); if (!built) return false;
    const r = await fetch("/api/config/tests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ suite_key: selS.suite_key, cases: built }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j?.error || "Save failed."); return false; }
    return true;
  }
  async function run() {
    if (!selS) return;
    setBusy(true); setMsg(null); setResults(null); setGate(null);
    if (!(await save())) { setBusy(false); return; }
    const r = await fetch("/api/config/tests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run", suite_key: selS.suite_key }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { setResults(j.results ?? []); setGate(j.gate); setMsg(`${j.passed}/${j.total} passed.`); router.refresh(); } else setMsg(j?.error || "Run failed.");
  }
  async function create() {
    const key = nk.trim().toLowerCase(), name = nn.trim();
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(key)) { setMsg("Key must be lowercase, dot-separated (e.g. suite.ward_smoke)"); return; }
    if (!name) { setMsg("Suite name required"); return; }
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/tests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ suite_key: key, name }) });
    const j = await r.json().catch(() => ({})); setBusy(false);
    if (r.ok) { setNk(""); setNn(""); setSelKey(key); setCases([]); router.refresh(); } else setMsg(j?.error || "Create failed.");
  }

  const card = "bg-white rounded-xl border border-gray-200";
  const resFor = (k: string) => results?.find(r => r.key === k);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className={`${card} p-4`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-2">Suites ({suites.length})</p>
        <div className="space-y-1 max-h-[300px] overflow-y-auto mb-3">
          {suites.map(s => <button key={s.suite_key} onClick={() => pick(s)} className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors ${selKey === s.suite_key ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}><p className="text-xs font-medium text-gray-800 truncate flex items-center gap-1.5">{s.name}<span className={`text-[8px] px-1 py-px rounded ${ST[s.status] ?? ST.draft}`}>{s.status}</span></p><p className="text-[10px] text-gray-400 truncate">{(s.cases?.length ?? 0)} case(s){s.last_run ? ` · ${s.last_run.passed}/${s.last_run.total}` : ""}</p></button>)}
          {suites.length === 0 && <p className="text-[11px] text-gray-400 py-2">No suites yet.</p>}
        </div>
        <div className="border-t border-gray-100 pt-3 space-y-1.5">
          <p className="text-[11px] font-semibold text-gray-500">New suite</p>
          <input className={`${input} w-full`} value={nn} onChange={e => setNn(e.target.value)} placeholder="Suite name" />
          <input className={`${input} w-full font-mono`} value={nk} onChange={e => setNk(e.target.value)} placeholder="suite.key" />
          <button onClick={create} disabled={busy} className="w-full text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1.5 disabled:opacity-50">+ Create</button>
        </div>
      </div>

      <div className={`${card} p-5 lg:col-span-3`}>
        {!selS ? <p className="text-sm text-gray-400 py-16 text-center">Select or create a test suite.</p> : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">{selS.name}{gate && <span className={`text-[10px] px-1.5 py-0.5 rounded ${gate === "pass" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>gate: {gate === "pass" ? "promotable" : "blocked"}</span>}</h3>
              <div className="flex items-center gap-2">
                <button onClick={addCase} className="text-xs font-medium text-indigo-700 border border-indigo-200 rounded-lg px-2.5 py-1 hover:bg-indigo-50">+ Case</button>
                <button onClick={run} disabled={busy || cases.length === 0} className="text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg px-3 py-1.5 disabled:opacity-40">{busy ? "Running…" : "▶ Run"}</button>
              </div>
            </div>

            {cases.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">Add test cases that assert outcomes against your config objects.</p> : (
              <div className="space-y-2 mb-3">
                {cases.map((c, i) => { const res = resFor(c.key); return (
                  <div key={c.key} className={`border rounded-lg p-2.5 ${res ? (res.pass ? "border-emerald-200 bg-emerald-50/40" : "border-rose-200 bg-rose-50/40") : "border-gray-100"}`}>
                    <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                      {res && <span className={`text-xs font-bold ${res.pass ? "text-emerald-600" : "text-rose-600"}`}>{res.pass ? "✓" : "✕"}</span>}
                      <input className={`${input} flex-1 min-w-[8rem]`} value={c.name} onChange={e => patch(i, { name: e.target.value })} placeholder="Case name" />
                      <select className={`${input} w-40`} value={c.test_type} onChange={e => patch(i, { test_type: e.target.value, object_key: "" })}>{TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}</select>
                      <select className={`${input} w-40`} value={c.object_key} onChange={e => patch(i, { object_key: e.target.value })}><option value="">target…</option>{objsFor(c.test_type).map(o => <option key={o.object_key} value={o.object_key}>{o.display_name}</option>)}</select>
                      <button onClick={() => setCases(cs => cs.filter((_, j) => j !== i))} className="text-gray-300 hover:text-rose-600 text-xs">✕</button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input className={`${input} flex-1 font-mono`} value={c.inputsStr} onChange={e => patch(i, { inputsStr: e.target.value })} placeholder={TM[c.test_type]?.hint.inputs} title="inputs (JSON)" />
                      <span className="text-gray-300 text-xs">⇒</span>
                      <input className={`${input} flex-1 font-mono`} value={c.expectedStr} onChange={e => patch(i, { expectedStr: e.target.value })} placeholder={TM[c.test_type]?.hint.expected} title="expected (JSON)" />
                    </div>
                    {res && <p className={`text-[10px] mt-1 ${res.pass ? "text-emerald-600" : "text-rose-600"}`}>{res.detail}</p>}
                  </div>
                ); })}
              </div>
            )}

            <div className="flex items-center justify-between mt-3">
              <span className="text-[11px] text-gray-400">Six executable test types run against the live object definitions.</span>
              <button onClick={save} disabled={busy} className="text-sm font-medium text-indigo-700 border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-50 disabled:opacity-50">Save</button>
            </div>
            {msg && <p className={`text-xs mt-2 ${msg.includes("passed") && gate === "pass" ? "text-emerald-600" : msg.includes("passed") ? "text-amber-600" : "text-rose-600"}`}>{msg}</p>}
          </>
        )}
      </div>
    </div>
  );
}
