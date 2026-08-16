"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// The 297 configuration console. Two different relationships, drawn differently:
//   SUPPLIED rows -- activation only (hide / local name / sort). The rules are read-only facts.
//   YOUR rows     -- the full s20 rule set, edited through configureProcedureType.
// Every action posts and refreshes; nothing is optimistically invented on a safety-rule screen.

/* eslint-disable @typescript-eslint/no-explicit-any */

const TRI = [
  ["required", "Required"], ["optional", "Optional"], ["not_applicable", "Not applicable"],
] as const;
const SIDES = ["left", "right", "bilateral"] as const;

const input = "rounded-lg border border-gray-200 px-2 py-1 text-[12px] outline-none focus:border-[var(--cp-primary)]";

export default function ProcedureConfigurationConsole({ types, canManage }: {
  types: any[]; canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  async function patch(body: Record<string, unknown>, okText: string) {
    setBusy(String(body.id)); setNotice(null);
    const res = await fetch("/api/v1/practice/procedure-types", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setNotice({ kind: "err", text: data?.error?.message ?? "That did not work." }); return; }
    setNotice({ kind: "ok", text: okText });
    router.refresh();
  }

  const supplied = types.filter(t => t.scope === "platform");
  const own = types.filter(t => t.scope === "workspace");

  const ruleWord = (v: string) => (TRI.find(([k]) => k === v)?.[1] ?? v).toLowerCase();

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <p className={`rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
          {notice.text}
        </p>
      )}
      {!canManage && (
        <p className="rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-600">
          You can read this catalogue; changing it needs procedure.manage.
        </p>
      )}

      {/* ── SUPPLIED: activation departures only ─────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">Supplied procedures</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
          Their safety rules are read-only. What this practice controls is whether each is offered,
          what it is called here, and where it sorts &mdash; a departure is recorded only when you
          change something (no row means enabled, migration 297&apos;s own rule).
        </p>
        <ul className="mt-2 flex flex-col">
          {supplied.map(t => (
            <li key={t.id} className={`border-b border-gray-100 py-2 last:border-0 ${t.enabled ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-gray-900">{t.name}</span>
                {t.catalogueName !== t.name && (
                  <span className="text-[10px] text-gray-400">supplied as &ldquo;{t.catalogueName}&rdquo;</span>
                )}
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{t.category}</span>
                {!t.enabled && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">hidden here</span>}
                <span className="ml-auto text-[10px] text-gray-500">
                  site {ruleWord(t.site_rule)} &middot; side {ruleWord(t.laterality_rule)} &middot; consent {ruleWord(t.consent_rule)}
                </span>
              </div>
              {canManage && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <button type="button" disabled={busy === t.id}
                    onClick={() => patch({ id: t.id, action: "activation", enabled: !t.enabled, localDisplayName: names[t.id] ?? (t.catalogueName !== t.name ? t.name : null) },
                      t.enabled ? "Hidden from this practice's pickers." : "Offered again.")}
                    className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    {t.enabled ? "Hide here" : "Offer again"}
                  </button>
                  <input placeholder={t.catalogueName} value={names[t.id] ?? (t.catalogueName !== t.name ? t.name : "")}
                    onChange={e => setNames(p => ({ ...p, [t.id]: e.target.value }))}
                    className={`${input} w-56`} title="What this practice calls it. The supplied name stays on history." />
                  <button type="button" disabled={busy === t.id}
                    onClick={() => patch({ id: t.id, action: "activation", enabled: t.enabled, localDisplayName: (names[t.id] ?? "").trim() || null },
                      "Local name saved.")}
                    className="rounded border border-gray-200 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    Save name
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* ── YOUR OWN: the full s20 rule set ─────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-[13px] font-bold text-gray-900">This practice&apos;s procedures</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
          Rules here decide what the capture form demands before a procedure can be recorded as
          Ready. Add new procedures from the encounter workspace; their rules live here.
        </p>
        {own.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-500">This practice has not added its own procedures yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {own.map(t => (
              <li key={t.id} className="border-b border-gray-100 py-2 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-gray-900">{t.name}</span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{t.status}</span>
                  <span className="text-[10px] text-gray-500">
                    site {ruleWord(t.site_rule)} &middot; side {ruleWord(t.laterality_rule)} &middot; consent {ruleWord(t.consent_rule)}
                    {t.outcome_required ? " · outcome required" : ""}
                  </span>
                  {canManage && (
                    <button type="button" onClick={() => setOpen(open === t.id ? null : t.id)}
                      className="ml-auto rounded border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
                      {open === t.id ? "Close" : "Edit rules"}
                    </button>
                  )}
                </div>
                {open === t.id && canManage && (
                  <RuleEditor t={t} busy={busy === t.id}
                    onSave={(body) => patch({ id: t.id, action: "configure", ...body }, "Rules saved. They apply to the next recording, never to history.")} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RuleEditor({ t, busy, onSave }: { t: any; busy: boolean; onSave: (body: Record<string, unknown>) => void }) {
  const [site, setSite] = useState<string>(t.site_rule);
  const [side, setSide] = useState<string>(t.laterality_rule);
  const [consent, setConsent] = useState<string>(t.consent_rule);
  const [sides, setSides] = useState<string[]>(t.allowed_lateralities ?? []);
  const [outcome, setOutcome] = useState<boolean>(t.outcome_required === true);

  const triSelect = (label: string, value: string, set: (v: string) => void) => (
    <label className="flex items-center gap-1.5 text-[11px] text-gray-700">
      {label}
      <select value={value} onChange={e => set(e.target.value)} className={input}>
        {TRI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <div className="mt-2 rounded-lg bg-gray-50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        {triSelect("Site", site, setSite)}
        {triSelect("Side", side, setSide)}
        {triSelect("Consent", consent, setConsent)}
        <label className="flex items-center gap-1.5 text-[11px] text-gray-700">
          <input type="checkbox" checked={outcome} onChange={e => setOutcome(e.target.checked)} />
          Outcome required
        </label>
      </div>
      {side !== "not_applicable" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-700">
          Allowed sides (none ticked = all three):
          {SIDES.map(s => (
            <label key={s} className="flex items-center gap-1">
              <input type="checkbox" checked={sides.includes(s)}
                onChange={e => setSides(p => e.target.checked ? [...p, s] : p.filter(x => x !== s))} />
              {s}
            </label>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={busy}
          onClick={() => onSave({
            siteRule: site, lateralityRule: side, consentRule: consent,
            allowedLateralities: side === "not_applicable" ? [] : sides, outcomeRequired: outcome,
          })}
          className="rounded-lg bg-[var(--cp-primary)] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
          Save rules
        </button>
        <span className="text-[10px] text-gray-500">
          Rules bind the NEXT recording. Nothing recorded is rewritten, and the legacy safety flags
          can only ever add a refusal, never remove one.
        </span>
      </div>
    </div>
  );
}
