"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  TREATMENT_FIELD_KEYS, TREATMENT_FIELD_LABEL, TREATMENT_REFUSALS,
  TEMPLATES_ARE_REVALIDATED, type TreatmentFieldKey,
} from "@/lib/practice/treatment-capture-constants";
import type { TreatmentOptionSet, TreatmentTemplate } from "@/lib/practice/treatment-capture";
import type { Panel } from "@/lib/practice/investigations";

// CPR-TREAT-001 s6's frozen requirement, as a screen.
//
// ⚠ THE ONE HONEST LIMIT IS SHOWN, NOT HIDDEN. `treatment_type` can be relabelled, reordered and
// deactivated here, but a NEW type code cannot be added without a migration, because practice_treatment
// constrains the column with a database CHECK. The engine refuses it with NOT_EXTENSIBLE and this screen
// says so beside the list rather than offering an Add control that would fail. s3's own answer to that
// gap is 'other', which is seeded active and keeps the practitioner's exact words.

const CARD = "rounded-xl border border-gray-200 bg-white p-4";
const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const QUIET = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const ON = "rounded-lg border border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 px-2.5 py-1.5 text-[11.5px] font-semibold text-[var(--cp-primary-deep)]";

export default function TreatmentConfigurationConsole(props: {
  options: TreatmentOptionSet;
  templates: Panel<TreatmentTemplate>;
  reasonRequired: boolean;
  settingsUnreadable: boolean;
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [adding, setAdding] = useState<TreatmentFieldKey | null>(null);
  const [newLabel, setNewLabel] = useState("");

  async function post(payload: Record<string, unknown>, okText: string) {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/treatment-capture", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: body?.error?.message ?? `That did not work (${res.status}).` });
        return null;
      }
      setNotice({ kind: "ok", text: okText });
      router.refresh();
      return body;
    } finally { setBusy(false); }
  }

  const settingsPost = (payload: Record<string, unknown>, okText: string) => {
    // The reason-required flag lives in practice_capture_setting, whose verb is on the investigation
    // route. One settings store, one write path, rather than a second copy of the same upsert.
    setBusy(true); setNotice(null);
    return fetch("/api/v1/practice/investigation-capture", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    }).then(async res => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setNotice({ kind: "err", text: body?.error?.message ?? `That did not work (${res.status}).` });
      else { setNotice({ kind: "ok", text: okText }); router.refresh(); }
    }).finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-4">
      {props.options.storeState === "absent" && (
        <p className={`${CARD} text-[12px] text-[var(--cmp-text-warning)]`}>{props.options.storeNotice}</p>
      )}
      {props.options.unavailable && (
        <p className={`${CARD} text-[12px] text-[var(--cmp-text-critical)]`}>{props.options.detail}</p>
      )}
      {notice && (
        <p className={`${CARD} text-[12px] ${notice.kind === "ok" ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      <section className={CARD}>
        <h2 className="text-[14px] font-bold text-gray-900">A reason on every treatment</h2>
        <div className="mt-1.5 flex gap-1.5">
          {[["false", "Optional"], ["true", "Required"]].map(([v, l]) => (
            <button key={v} type="button" disabled={!props.canConfigure || busy}
              className={String(props.reasonRequired) === v ? ON : QUIET}
              onClick={() => settingsPost(
                { action: "setSetting", key: "treatment_reason_required", value: v }, "Changed.")}>
              {l}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10.5px] text-gray-500">
          CPR-TREAT-001 s5 leaves this to each practice. Required means nothing records without a reason.
        </p>
        {props.settingsUnreadable && (
          <p className="mt-1.5 text-[11px] text-[var(--cmp-text-critical)]">
            This setting could not be read, so the default is what is in force. It is not necessarily what
            this practice chose.
          </p>
        )}
      </section>

      {TREATMENT_FIELD_KEYS.map(key => {
        const list = props.options.allByField[key] ?? [];
        const extensible = key !== "treatment_type";
        return (
          <section key={key} className={CARD}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-[14px] font-bold text-gray-900">{TREATMENT_FIELD_LABEL[key]}</h2>
              <span className="text-[11px] text-gray-500">
                {list.filter(o => o.enabled).length} of {list.length} enabled
              </span>
              {props.canConfigure && extensible && (
                <button type="button" className={`${QUIET} ml-auto`}
                  onClick={() => { setAdding(adding === key ? null : key); setNewLabel(""); }}>
                  {adding === key ? "Cancel" : "+ Add one"}
                </button>
              )}
            </div>

            {!extensible && (
              <p className="mt-1 text-[10.5px] text-gray-500">
                These can be renamed, reordered and switched off, but a new type cannot be added without a
                database change &mdash; the column is constrained. Use <strong>Other</strong> for anything
                the list does not cover; the practitioner&rsquo;s own words are kept.
              </p>
            )}

            {adding === key && props.canConfigure && (
              <form className="mt-2 flex flex-wrap items-center gap-1.5"
                onSubmit={async ev => {
                  ev.preventDefault();
                  const body = await post({ action: "createOption", fieldKey: key, label: newLabel },
                    `Added to ${TREATMENT_FIELD_LABEL[key].toLowerCase()}.`);
                  if (body) { setAdding(null); setNewLabel(""); }
                }}>
                <input autoFocus className={`${input} max-w-[260px]`} value={newLabel}
                  onChange={e => setNewLabel(e.target.value)} placeholder="What it should say" />
                <button type="submit" className={QUIET} disabled={busy || !newLabel.trim()}>Add</button>
              </form>
            )}

            {list.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">
                Nothing here. If this deployment has not run migration 275 there is no store behind this
                list yet &mdash; that is not the same as a practice having emptied it.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col divide-y divide-gray-100">
                {list.map(o => (
                  <li key={o.id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className={`text-[12.5px] font-semibold ${o.enabled ? "text-gray-900" : "text-gray-400 line-through"}`}>
                      {o.label}
                    </span>
                    {o.numericValue !== null && (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                        {key === "frequency" ? `${o.numericValue} a day` : `${o.numericValue} days`}
                      </span>
                    )}
                    {o.source === "practice" && (
                      <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                        this practice
                      </span>
                    )}
                    {o.relabelled && <span className="text-[10px] text-gray-400">renamed</span>}
                    {props.canConfigure && (
                      <span className="ml-auto flex gap-1">
                        <button type="button" className={QUIET} disabled={busy}
                          onClick={() => post({ action: "setOption", optionId: o.id, enabled: !o.enabled },
                            o.enabled ? "Switched off." : "Switched on.")}>
                          {o.enabled ? "Turn off" : "Turn on"}
                        </button>
                        <button type="button" className={QUIET} disabled={busy}
                          onClick={() => { setRenameTo(o.label); setRenaming(renaming === o.id ? null : o.id); }}>
                          Rename
                        </button>
                      </span>
                    )}
                    {renaming === o.id && props.canConfigure && (
                      <form className="mt-1 flex w-full flex-wrap items-center gap-1.5"
                        onSubmit={async ev => {
                          ev.preventDefault();
                          const body = await post({ action: "setOption", optionId: o.id, labelOverride: renameTo },
                            "Renamed for this practice.");
                          if (body) setRenaming(null);
                        }}>
                        <input autoFocus className={`${input} max-w-[280px]`} value={renameTo}
                          onChange={e => setRenameTo(e.target.value)} />
                        <button type="submit" className={QUIET} disabled={busy}>Save</button>
                        <button type="button" className={QUIET} onClick={() => setRenaming(null)}>Cancel</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <section className={CARD}>
        <h2 className="text-[14px] font-bold text-gray-900">Prescription templates</h2>
        <p className="mt-0.5 text-[11.5px] text-gray-500">{TEMPLATES_ARE_REVALIDATED}</p>
        {props.templates.unavailable ? (
          <p className="mt-2 text-[12px] text-[var(--cmp-text-critical)]">{props.templates.detail}</p>
        ) : props.templates.items.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">
            None yet. A template is created from the encounter screen: build a plan, then save it.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {props.templates.items.map(t => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-semibold text-gray-900">{t.name}</span>
                <span className="text-[11px] text-gray-500">
                  {t.items.length} item{t.items.length === 1 ? "" : "s"} &middot; version {t.version}
                  {t.ownerType === "practice" ? " · shared with the practice" : " · yours"}
                </span>
                <button type="button" className={`${QUIET} ml-auto`} disabled={busy}
                  onClick={() => post({ action: "retireTemplate", templateId: t.id }, "Template retired.")}>
                  Retire
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={CARD}>
        <h2 className="text-[14px] font-bold text-gray-900">What these lists do not do</h2>
        <ul className="mt-2 flex flex-col gap-1.5">
          {TREATMENT_REFUSALS.map(r => (
            <li key={r.key} className="text-[11.5px] text-gray-600">
              <span className="font-semibold text-gray-800">{r.what}</span> {r.why}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
