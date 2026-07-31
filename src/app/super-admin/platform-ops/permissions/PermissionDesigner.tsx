"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Role, Permission & Visibility Designer (NCP-008) — the no-code security composer on top of governed PERMISSION
// registry objects authored in the Configuration Studio. A permission set = RBAC grants (allow/deny an action on
// a resource type) + ABAC visibility rules (context conditions that must all hold) + inheritance from other sets.
// The signature interactive piece is the POLICY SIMULATION: enter a context and see whether the set applies and
// what it effectively grants (deny overrides allow). Persists onto object.definition via PATCH /api/config/objects,
// which validates grants/rules and wires inherited sets into dependencies (PERMISSION_REF). The authorization
// runtime, visibility resolver, delegation and approval engines (NCP-008 §3/§4) are honest next-phase.
type Grant = { key: string; resource: string; resourceKey?: string; action: string; effect: "allow" | "deny" };
type Rule = { key: string; attribute: string; operator: string; value: string };
type Def = { grants?: Grant[]; rules?: Rule[]; inherits?: string[]; effective?: { from?: string; to?: string } };
type Obj = { object_key: string; object_type: string; display_name: string; status: string; definition?: Def };

const RES = ["workspace", "module", "dashboard", "widget", "form", "field", "record", "report", "workflow", "ai_assistant", "administration", "configuration"];
const ACT = ["view", "create", "edit", "delete", "execute", "approve", "configure", "admin"];
const ATTR = ["role", "profession", "department", "facility", "enterprise", "unit", "location", "shift", "competency_status", "certification", "patient_context", "feature_flag", "tenant_config", "workflow_state", "device_type", "custom"];
const OPS = [
  { v: "is", l: "is" }, { v: "is_not", l: "is not" }, { v: "in", l: "in (a,b,c)" }, { v: "not_in", l: "not in" }, { v: "exists", l: "exists" },
];
const input = "border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white";
const freeKey = (prefix: string, have: Set<string>) => { let n = 1; while (have.has(`${prefix}_${n}`)) n++; return `${prefix}_${n}`; };
const list = (v: string) => v.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const load = (o?: Obj): Def => ({ grants: o?.definition?.grants ?? [], rules: o?.definition?.rules ?? [], inherits: o?.definition?.inherits ?? [], effective: o?.definition?.effective ?? {} });

// Evaluate one ABAC rule against a context map. Blank context value → unsatisfied (conservative), except is_not.
function ruleHolds(r: Rule, ctx: Record<string, string>): boolean {
  const cv = (ctx[r.attribute] ?? "").trim().toLowerCase();
  const val = (r.value ?? "").trim().toLowerCase();
  switch (r.operator) {
    case "is": return cv !== "" && cv === val;
    case "is_not": return cv !== val;
    case "in": return cv !== "" && list(r.value).includes(cv);
    case "not_in": return !list(r.value).includes(cv);
    case "exists": return cv !== "";
    default: return false;
  }
}

export default function PermissionDesigner({ permissions }: { permissions: Obj[] }) {
  const router = useRouter();
  const [selKey, setSelKey] = useState<string | null>(permissions[0]?.object_key ?? null);
  const selO = permissions.find(o => o.object_key === selKey) ?? null;
  const [d, setD] = useState<Def>(load(permissions[0]));
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [ctx, setCtx] = useState<Record<string, string>>({});

  const grants = d.grants ?? []; const rules = d.rules ?? []; const inherits = d.inherits ?? [];
  const setGrants = (fn: (g: Grant[]) => Grant[]) => setD(p => ({ ...p, grants: fn(p.grants ?? []) }));
  const setRules = (fn: (r: Rule[]) => Rule[]) => setD(p => ({ ...p, rules: fn(p.rules ?? []) }));

  function pick(k: string) { setSelKey(k); setD(load(permissions.find(o => o.object_key === k))); setMsg(null); setCtx({}); }
  const addGrant = () => setGrants(g => [...g, { key: freeKey("grant", new Set(g.map(x => x.key))), resource: "module", resourceKey: "", action: "view", effect: "allow" }]);
  const addRule = () => setRules(r => [...r, { key: freeKey("rule", new Set(r.map(x => x.key))), attribute: "role", operator: "is", value: "" }]);
  const toggleInherit = (k: string) => setD(p => { const cur = p.inherits ?? []; return { ...p, inherits: cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k] }; });

  // Policy simulation — rules gate applicability; then dedupe grants by resource|resourceKey|action with deny-override.
  const attrsUsed = [...new Set(rules.map(r => r.attribute))];
  const failing = rules.filter(r => !ruleHolds(r, ctx));
  const applies = rules.length === 0 || failing.length === 0;
  const effective = (() => {
    const m = new Map<string, Grant>();
    for (const g of grants) { const id = `${g.resource}|${g.resourceKey || "*"}|${g.action}`; const ex = m.get(id); if (!ex || (ex.effect === "allow" && g.effect === "deny")) m.set(id, g); }
    return [...m.values()];
  })();

  async function save() {
    if (!selO) return;
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/objects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object_key: selO.object_key, definition: d }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? `✓ Saved ${grants.length} grant(s) + ${rules.length} rule(s).` : (j?.error || "Could not save."));
    if (r.ok) router.refresh();
  }

  const card = "bg-white rounded-xl border border-gray-200";
  if (!permissions.length) return <div className={`${card} p-8 text-center`}><p className="text-sm text-gray-500">No permission sets yet.</p><p className="text-xs text-gray-400 mt-1">Author a <b>Permission</b> object in the <a href="/super-admin/platform-ops/studio" className="text-indigo-700 underline">Configuration Studio</a> first, then design it here.</p></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className={`${card} p-4`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-2">Permission sets ({permissions.length})</p>
        <div className="space-y-1 max-h-[560px] overflow-y-auto">
          {permissions.map(o => <button key={o.object_key} onClick={() => pick(o.object_key)} className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors ${selKey === o.object_key ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}><p className="text-xs font-medium text-gray-800 truncate">{o.display_name}</p><p className="text-[10px] text-gray-400 truncate">{(o.definition?.grants?.length ?? 0)} grant(s)</p></button>)}
        </div>
      </div>

      <div className={`${card} p-5 lg:col-span-3`}>
        {!selO ? <p className="text-sm text-gray-400 py-16 text-center">Select a permission set.</p> : (
          <>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-gray-900">{selO.display_name}</h3><span className="text-[10px] text-gray-400 font-mono">{selO.object_key}</span></div>

            {/* Grants */}
            <div className="flex items-center justify-between mb-2"><p className="text-[11px] font-semibold text-gray-500">Grants <span className="font-normal text-gray-400">· deny overrides allow</span></p><button onClick={addGrant} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1">+ Grant</button></div>
            {grants.length === 0 ? <p className="text-xs text-gray-400 py-3 text-center">Add grants to define what this set permits.</p> : (
              <div className="space-y-1.5 mb-4">
                {grants.map((g, i) => (
                  <div key={g.key} className="flex items-center gap-1.5 border border-gray-100 rounded-lg px-2.5 py-1.5 flex-wrap">
                    <button onClick={() => setGrants(gs => gs.map((x, j) => j === i ? { ...x, effect: x.effect === "allow" ? "deny" : "allow" } : x))} className={`text-[10px] font-semibold rounded px-2 py-0.5 w-14 shrink-0 ${g.effect === "allow" ? "bg-[var(--cmp-surface-success)] text-emerald-700" : "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]"}`}>{g.effect}</button>
                    <select className={`${input} w-32`} value={g.resource} onChange={e => setGrants(gs => gs.map((x, j) => j === i ? { ...x, resource: e.target.value } : x))}>{RES.map(r => <option key={r} value={r}>{r}</option>)}</select>
                    <input className={`${input} w-32`} value={g.resourceKey ?? ""} onChange={e => setGrants(gs => gs.map((x, j) => j === i ? { ...x, resourceKey: e.target.value } : x))} placeholder="key (opt · * = any)" />
                    <select className={`${input} w-24`} value={g.action} onChange={e => setGrants(gs => gs.map((x, j) => j === i ? { ...x, action: e.target.value } : x))}>{ACT.map(a => <option key={a} value={a}>{a}</option>)}</select>
                    <span className="text-[9px] text-gray-300 font-mono">{g.key}</span>
                    <button onClick={() => setGrants(gs => gs.filter((_, j) => j !== i))} className="text-gray-300 hover:text-[var(--cmp-text-error)] text-xs ml-auto">✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Visibility rules */}
            <div className="flex items-center justify-between mb-2"><p className="text-[11px] font-semibold text-gray-500">Visibility rules <span className="font-normal text-gray-400">· ABAC · all must hold</span></p><button onClick={addRule} className="text-xs font-medium text-indigo-700 border border-indigo-200 rounded-lg px-2.5 py-1 hover:bg-indigo-50">+ Rule</button></div>
            {rules.length === 0 ? <p className="text-xs text-gray-400 py-3 text-center">No rules — this set applies in every context.</p> : (
              <div className="space-y-1.5 mb-4">
                {rules.map((r, i) => (
                  <div key={r.key} className="flex items-center gap-1.5 border border-gray-100 rounded-lg px-2.5 py-1.5 flex-wrap">
                    <select className={`${input} w-36`} value={r.attribute} onChange={e => setRules(rs => rs.map((x, j) => j === i ? { ...x, attribute: e.target.value } : x))}>{ATTR.map(a => <option key={a} value={a}>{a}</option>)}</select>
                    <select className={`${input} w-28`} value={r.operator} onChange={e => setRules(rs => rs.map((x, j) => j === i ? { ...x, operator: e.target.value } : x))}>{OPS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
                    {r.operator !== "exists" && <input className={`${input} flex-1 min-w-[6rem]`} value={r.value} onChange={e => setRules(rs => rs.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="value" />}
                    <span className="text-[9px] text-gray-300 font-mono">{r.key}</span>
                    <button onClick={() => setRules(rs => rs.filter((_, j) => j !== i))} className="text-gray-300 hover:text-[var(--cmp-text-error)] text-xs">✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Inheritance + effective dates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Inherits from</p>
                {permissions.filter(p => p.object_key !== selO.object_key).length === 0 ? <p className="text-[11px] text-gray-400">No other sets to inherit.</p> : (
                  <div className="space-y-1 max-h-28 overflow-y-auto">
                    {permissions.filter(p => p.object_key !== selO.object_key).map(p => <label key={p.object_key} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={inherits.includes(p.object_key)} onChange={() => toggleInherit(p.object_key)} />{p.display_name}</label>)}
                  </div>
                )}
              </div>
              <div>
                <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Effective window <span className="font-normal text-gray-400">· temporary access (opt)</span></p>
                <div className="flex items-center gap-1.5">
                  <input type="date" className={`${input} w-32`} value={d.effective?.from ?? ""} onChange={e => setD(p => ({ ...p, effective: { ...p.effective, from: e.target.value } }))} />
                  <span className="text-gray-300 text-xs">→</span>
                  <input type="date" className={`${input} w-32`} value={d.effective?.to ?? ""} onChange={e => setD(p => ({ ...p, effective: { ...p.effective, to: e.target.value } }))} />
                </div>
              </div>
            </div>

            {/* Policy simulation */}
            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
              <p className="text-[11px] font-semibold text-gray-500 mb-2">Policy simulation <span className="font-normal text-gray-400">· preview effective access for a context</span></p>
              {attrsUsed.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2.5">
                  {attrsUsed.map(a => <label key={a} className="flex items-center gap-1 text-[11px]"><span className="text-gray-500">{a}</span><input className={`${input} w-24`} value={ctx[a] ?? ""} onChange={e => setCtx(c => ({ ...c, [a]: e.target.value }))} placeholder="value" /></label>)}
                </div>
              )}
              <div className={`text-xs font-medium mb-2 ${applies ? "text-emerald-700" : "text-[var(--cmp-text-error)]"}`}>{applies ? "✓ This set applies in this context" : `✕ Not applicable — ${failing.length} rule(s) not met (${failing.map(f => f.attribute).join(", ")})`}</div>
              {applies && (effective.length === 0 ? <p className="text-[11px] text-gray-400">No grants defined.</p> : (
                <div className="space-y-0.5">
                  {effective.map(g => <div key={`${g.resource}|${g.resourceKey}|${g.action}`} className="flex items-center gap-2 text-[11px]"><span className={`font-semibold w-12 ${g.effect === "allow" ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{g.effect}</span><span className="text-gray-700">{g.action}</span><span className="text-gray-400">on</span><span className="text-gray-700">{g.resource}{g.resourceKey ? `:${g.resourceKey}` : ""}</span></div>)}
                </div>
              ))}
              {inherits.length > 0 && <p className="text-[10px] text-gray-400 mt-2">+ {inherits.length} inherited set(s) layered at runtime (not shown here).</p>}
            </div>

            {msg && <p className={`text-xs mt-3 ${msg.startsWith("✓") ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{msg}</p>}
            <div className="flex items-center justify-end mt-4"><button onClick={save} disabled={busy} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "Saving…" : "Save permission set"}</button></div>
          </>
        )}
      </div>
    </div>
  );
}
