"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { ghost, input, Message, primary, btn } from "./FairUseControls";

// The write half of "AI operating modes" on /super-admin/ai/fair-use (owner GO SUPERVISED PILOT MODE, 29 Oct 2026).
// Every control posts to /api/hq/ai-governance, which re-checks the capability and validates the document: a cohort
// or a person that would be silently ignored is refused, and Supervised Pilot can never be the default. A mode never
// approves a model. Publishing is audited. People are typed as emails (or user ids) and stored as user ids.

const MODES = [["strict_production", "Strict Production"], ["supervised_pilot", "Supervised Pilot"], ["clinical_production", "Clinical Production"]] as const;
const modeLabel = (m: string) => MODES.find(x => x[0] === m)?.[1] ?? m;

type CohortForm = { code: string; label: string; mode: string; userIds: string; sources: string; plans: string; hourly: string };
type Doc = { defaultMode: string; cohorts: { code: string; label: string; mode: string; userIds: string[]; entitlementSources: string[]; planCodes: string[]; hourlyLimit: number | null }[]; pilotRisk: { rules: any[] }; clarifiableRules: string[] };
export type ModeProduct = { product: string; published: Doc; draft: Doc | null; hasPublished: boolean; pending: boolean; publishedAt: string | null; ruleIds: string[]; people: Record<string, string> };
export type VersionRow = { id: string; createdAt: string; label: string | null; note: string | null; publishedBy: string | null; when: string };

const toForm = (d: Doc, people: Record<string, string>): CohortForm[] => d.cohorts.map(c => ({ code: c.code, label: c.label, mode: c.mode, userIds: c.userIds.map(id => people[id.toLowerCase()] ?? id).join("\n"), sources: c.entitlementSources.join(", "), plans: c.planCodes.join(", "), hourly: c.hourlyLimit ? String(c.hourlyLimit) : "" }));
const lines = (v: string) => v.split(/[\n,]/).map(x => x.trim()).filter(Boolean);

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/hq/ai-governance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    return res.ok ? { ok: true } : { ok: false, error: j?.error ?? "That could not be saved. Nothing has changed." };
  } catch { return { ok: false, error: "That could not be saved. Check your connection." }; }
}

/** A confirmation that holds focus (role="dialog" aria-modal) for the two acts that change what runs. */
function Confirm({ title, body, action, onConfirm, onCancel }: { title: string; body: string; action: string; onConfirm: () => void; onCancel: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const dismiss = useCallback(() => onCancel(), [onCancel]);
  useModalFocus(true, panel, dismiss);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="mc-t" className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-xl">
        <h3 id="mc-t" className="text-[16px] font-bold text-gray-900">{title}</h3>
        <p className="text-[13px] text-gray-700">{body}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghost} onClick={onCancel}>Cancel</button>
          <button type="button" className={primary} onClick={onConfirm}>{action}</button>
        </div>
      </div>
    </div>
  );
}

function ProductEditor({ p, onBusy }: { p: ModeProduct; onBusy: (b: boolean) => void }) {
  const router = useRouter();
  const start = p.draft ?? p.published;
  const [defaultMode, setDefaultMode] = useState(start.defaultMode === "clinical_production" ? "clinical_production" : "strict_production");
  const [cohorts, setCohorts] = useState<CohortForm[]>(toForm(start, p.people));
  const [clar, setClar] = useState<string[]>(start.clarifiableRules);
  const [rulesText, setRulesText] = useState(JSON.stringify(start.pilotRisk?.rules ?? [], null, 2));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (i: number, k: keyof CohortForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setCohorts(c => c.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
  const options = [...p.ruleIds, "unknown"];

  async function save() {
    let rules: any[];
    try { rules = JSON.parse(rulesText || "[]"); if (!Array.isArray(rules)) throw new Error("not a list"); } catch { setMsg({ ok: false, text: "Pilot rules must be valid JSON: a list of rules. Nothing was saved." }); return; }
    setBusy(true); onBusy(true); setMsg(null);
    const doc = {
      defaultMode,
      cohorts: cohorts.map(c => ({ code: c.code.trim(), label: c.label.trim(), mode: c.mode, userIds: lines(c.userIds), entitlementSources: lines(c.sources), planCodes: lines(c.plans), hourlyLimit: c.hourly.trim() ? Number(c.hourly) : null })),
      pilotRisk: { rules }, clarifiableRules: clar,
    };
    const r = await post({ action: "save_mode", product: p.product, doc });
    setBusy(false); onBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "Not saved." }); return; }
    setMsg({ ok: true, text: "Draft saved. It takes effect only when published." }); router.refresh();
  }

  return (
    <div className="space-y-3">
      <label className="block text-[12.5px] text-gray-700">Default mode (everyone not named below)
        <select value={defaultMode} onChange={e => setDefaultMode(e.target.value)} className={`${input} ml-1`}>
          <option value="strict_production">Strict Production</option><option value="clinical_production">Clinical Production</option>
        </select>
      </label>
      <p className="text-[12px] text-gray-600">Supervised Pilot is not offered as a default: it applies only to named cohorts.</p>

      <fieldset className="space-y-3 rounded-lg border border-gray-200 p-3">
        <legend className="px-1 text-[13px] font-semibold text-gray-800">Cohorts</legend>
        {cohorts.length === 0 && <p className="text-[12.5px] text-gray-600">No cohort: everyone is in the default mode.</p>}
        {cohorts.map((c, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-gray-100 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-[12.5px] text-gray-700">Code<input value={c.code} onChange={set(i, "code")} maxLength={41} className={`${input} ml-1 w-36`} /></label>
              <label className="text-[12.5px] text-gray-700">Label<input value={c.label} onChange={set(i, "label")} maxLength={120} className={`${input} ml-1 w-48`} /></label>
              <label className="text-[12.5px] text-gray-700">Mode
                <select value={c.mode} onChange={set(i, "mode")} className={`${input} ml-1`}>{MODES.map(m => <option key={m[0]} value={m[0]}>{m[1]}</option>)}</select>
              </label>
              <label className="text-[12.5px] text-gray-700">Hourly limit (1 to 500, blank = plan)<input inputMode="numeric" value={c.hourly} onChange={set(i, "hourly")} className={`${input} ml-1 w-20`} /></label>
              <button type="button" className={ghost} onClick={() => setCohorts(cs => cs.filter((_, j) => j !== i))}>Remove cohort</button>
            </div>
            <label className="block text-[12.5px] text-gray-700">People (email or user id, one per line)
              <textarea rows={3} value={c.userIds} onChange={set(i, "userIds")} spellCheck={false} className={`${input} mt-1 block w-full font-mono text-[12px]`} />
            </label>
            <div className="flex flex-wrap gap-2">
              <label className="text-[12.5px] text-gray-700">Entitlement sources (comma separated)<input value={c.sources} onChange={set(i, "sources")} className={`${input} ml-1 w-56`} /></label>
              <label className="text-[12.5px] text-gray-700">Plan codes (comma separated)<input value={c.plans} onChange={set(i, "plans")} className={`${input} ml-1 w-56`} /></label>
            </div>
          </div>
        ))}
        <button type="button" className={ghost} disabled={cohorts.length >= 20}
          onClick={() => setCohorts(cs => [...cs, { code: "", label: "", mode: "supervised_pilot", userIds: "", sources: "", plans: "", hourly: "" }])}>Add cohort</button>
      </fieldset>

      <fieldset className="rounded-lg border border-gray-200 p-3">
        <legend className="px-1 text-[13px] font-semibold text-gray-800">Clarifiable rules</legend>
        <p className="text-[12.5px] text-gray-600">A high-risk decision reached only by these rules (or by &quot;unknown&quot;, a subject no rule recognises) asks the learner whether the question is for study. Any other high-risk rule still refuses.</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {options.map(id => (
            <label key={id} className="inline-flex items-center gap-1.5 text-[12.5px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
              <input type="checkbox" checked={clar.includes(id)} onChange={e => setClar(s => (e.target.checked ? [...s, id] : s.filter(x => x !== id)))} />
              <span className="font-mono">{id}</span>
            </label>
          ))}
          {clar.filter(id => !options.includes(id)).map(id => (
            <label key={id} className="inline-flex items-center gap-1.5 text-[12.5px] text-amber-900 pointer-coarse:min-h-[var(--cmp-touch-min)]">
              <input type="checkbox" checked onChange={() => setClar(s => s.filter(x => x !== id))} /><span className="font-mono">{id}</span> (not a published rule)
            </label>
          ))}
        </div>
        {p.ruleIds.length === 0 && <p className="mt-1 text-[12.5px] text-gray-600">This product has no published risk rules yet.</p>}
      </fieldset>

      <div>
        <label htmlFor={`pr-${p.product}`} className="block text-[12.5px] font-semibold text-gray-700">Pilot rules (JSON list, added only in Supervised Pilot; validated when you save)</label>
        <textarea id={`pr-${p.product}`} rows={6} value={rulesText} onChange={e => setRulesText(e.target.value)} spellCheck={false} className="mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-1.5 font-mono text-[12px] text-gray-900" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={primary} disabled={busy} onClick={save}>Save draft</button>
        <Message msg={msg} />
      </div>
    </div>
  );
}

export function ModesPanel({ products, versions, pendingCount }: { products: ModeProduct[]; versions: VersionRow[] | null; pendingCount: number }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "strict"; product: string } | { kind: "rollback"; id: string; label: string }>(null);
  const cancel = useCallback(() => setConfirm(null), []);

  async function run(steps: Record<string, unknown>[], done: string) {
    setBusy(true); setMsg(null);
    for (const s of steps) {
      const r = await post(s);
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? "Not saved." }); setBusy(false); router.refresh(); return; }
    }
    setBusy(false); setMsg({ ok: true, text: done }); router.refresh();
  }
  const others = (product: string) => products.filter(x => x.product !== product && x.pending).map(x => x.product);

  return (
    <div className="space-y-5">
      {products.map(p => (
        <div key={p.product} className="rounded-lg border border-gray-200 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[15px] font-bold capitalize text-gray-900">{p.product}</h3>
            <button type="button" disabled={busy} onClick={() => setConfirm({ kind: "strict", product: p.product })}
              className={`${btn} bg-[var(--cmp-color-critical)] text-white hover:opacity-90`}>Return to Strict Production now</button>
          </div>
          <p className="mt-1 text-[13px] text-gray-800">
            In force: <strong>{p.hasPublished ? modeLabel(p.published.defaultMode) : "Strict Production (nothing published)"}</strong> by default
            {p.publishedAt ? ` · published ${new Date(p.publishedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC` : ""}
            {p.pending ? " · an unpublished draft is waiting" : ""}.
          </p>
          {p.published.cohorts.length === 0 ? <p className="text-[13px] text-gray-600">No cohort is named.</p> : (
            <div className="overflow-x-auto">
              <table className="mt-2 w-full min-w-[560px] text-left text-[13px]">
                <caption className="sr-only">Published cohorts for {p.product}</caption>
                <thead><tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-[0.08em] text-gray-500"><th scope="col" className="py-1.5">Cohort</th><th scope="col">Mode</th><th scope="col">Members named</th><th scope="col">By source / plan</th><th scope="col">Hourly limit</th></tr></thead>
                <tbody>{p.published.cohorts.map(c => (
                  <tr key={c.code} className="border-b border-gray-100">
                    <th scope="row" className="py-1.5 font-normal">{c.label} <span className="font-mono text-[12px] text-gray-500">{c.code}</span></th>
                    <td>{modeLabel(c.mode)}</td><td>{c.userIds.length}</td>
                    <td>{[...c.entitlementSources, ...c.planCodes].join(", ") || "none"}</td><td>{c.hourlyLimit ?? "plan"}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
          <details className="mt-3" open={p.pending}>
            <summary className="cursor-pointer text-[13px] font-semibold text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">Edit the draft</summary>
            <div className="mt-2"><ProductEditor key={`${p.product}-${p.draft ? "d" : "p"}-${p.publishedAt}`} p={p} onBusy={setBusy} /></div>
          </details>
        </div>
      ))}

      <div className="space-y-2 rounded-lg border border-gray-200 p-4">
        <h3 className="text-[15px] font-bold text-gray-900">Publish</h3>
        <label htmlFor="md-note" className="block text-[12.5px] font-semibold text-gray-700">Why this change (recorded with the version)</label>
        <textarea id="md-note" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[14px]" />
        <button type="button" className={primary} disabled={busy || pendingCount === 0} onClick={() => run([{ action: "publish_modes", note }], "Published. New requests use it.")}>
          {pendingCount === 0 ? "Nothing to publish" : `Publish ${pendingCount} mode change${pendingCount === 1 ? "" : "s"}`}
        </button>
        <p className="text-[12px] text-gray-600">You cannot publish a change you drafted yourself where the platform separates the two roles.</p>
        <Message msg={msg} />
      </div>

      <div className="rounded-lg border border-gray-200 p-4">
        <h3 className="text-[15px] font-bold text-gray-900">Version history</h3>
        {versions === null ? <p className="text-[13px] text-amber-900">Versions could not be read just now.</p>
          : versions.length === 0 ? <p className="text-[13px] text-gray-700">Nothing has been published yet: every request runs in Strict Production.</p> : (
          <ul className="mt-2 divide-y divide-gray-100">
            {versions.map(v => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                <span>{v.when} UTC · {v.label ?? "Version"} · {v.publishedBy ?? "unknown"}{v.note ? ` · ${v.note}` : ""}</span>
                <button type="button" className={ghost} disabled={busy} onClick={() => setConfirm({ kind: "rollback", id: v.id, label: v.when })}>Roll back to this</button>
              </li>))}
          </ul>
        )}
      </div>

      {confirm?.kind === "strict" && (
        <Confirm title={`Return ${confirm.product} to Strict Production now?`} action="Return to Strict now" onCancel={cancel}
          body={`This saves a Strict Production document (default Strict Production, no cohorts) and publishes it at once, so every ${confirm.product} request is back to the published fair-use rules. Publishing also publishes any other saved draft in the modes scope${others(confirm.product).length ? ` (there is one waiting for ${others(confirm.product).join(", ")})` : ""}.`}
          onConfirm={() => { const product = confirm.product; setConfirm(null); void run([{ action: "strict_now", product }, { action: "publish_modes", note: `Return ${product} to Strict Production` }], `${product} is back in Strict Production.`); }} />
      )}
      {confirm?.kind === "rollback" && (
        <Confirm title="Roll back the AI operating modes?" action="Roll back" onCancel={cancel}
          body={`This restores the modes published at ${confirm.label} UTC and recorded as a new version. A product with no document in that version returns to Strict Production.`}
          onConfirm={() => { const id = confirm.id; setConfirm(null); void run([{ action: "rollback_modes", versionId: id }], "Rolled back. New requests use the restored modes."); }} />
      )}
    </div>
  );
}
