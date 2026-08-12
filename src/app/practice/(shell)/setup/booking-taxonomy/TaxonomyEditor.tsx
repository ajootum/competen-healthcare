"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// s4's editable properties, as one screen. Every action is a POST to /api/v1/practice/booking-taxonomy,
// which re-checks the capability and every rule -- this component decides nothing.
//
// ⚠ THE REFUSALS ARE SHOWN VERBATIM. "This is the only active consultation mode" and "this is the
// practice default" are the two changes most likely to be attempted, and both are refused by the engine
// for reasons a person can act on. Replacing them with a generic "could not save" would leave somebody
// clicking the same switch.

type Item = {
  id: string; code: string; label: string; active: boolean;
  selfBookable: boolean; systemSeeded: boolean; isDefault: boolean;
  durationMinutes?: number | null; requiresLocation?: boolean;
};

export default function TaxonomyEditor({ visitTypes, modes }: { visitTypes: Item[]; modes: Item[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // ⚠ SUCCESS IS SAID, NOT IMPLIED (the owner, 2026-08-11). A switch that flips and says nothing leaves
  // somebody unsure whether it reached the server.
  const send = async (body: Record<string, unknown>, okText: string) => {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/booking-taxonomy", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: json?.error?.message ?? "That change was not saved." });
        return false;
      }
      setNotice({ kind: "ok", text: okText });
      router.refresh();
      return true;
    } catch {
      setNotice({ kind: "err", text: "That change did not reach the server, so nothing was saved." });
      return false;
    } finally { setBusy(false); }
  };

  const section = (dimension: "visit_type" | "consultation_mode", title: string, items: Item[], hint: string) => (
    <section className="mt-5 rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-[14px] font-bold text-gray-900">{title}</h2>
        <p className="mt-0.5 text-[12px] text-gray-500">{hint}</p>
      </div>
      <ul className="divide-y divide-gray-100">
        {items.map(it => (
          <li key={it.id} className={`px-4 py-3 ${it.active ? "" : "bg-gray-50/70"}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <input defaultValue={it.label} disabled={busy}
                onBlur={e => {
                  const label = e.target.value.trim();
                  if (label && label !== it.label)
                    send({ action: "update", dimension, itemId: it.id, label }, `Renamed to "${label}".`);
                }}
                className="min-w-[180px] flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] font-semibold" />

              {/* ⚠ THE CODE IS SHOWN AND CANNOT BE EDITED (s4: immutable after creation). Shown because
                  it is what every historical appointment actually points at, so somebody renaming a
                  label can see what will not change underneath it. */}
              <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10.5px] text-gray-500"
                title="The stable code. Renaming the label above never changes this, so appointments already recorded stay interpretable.">
                {it.code}
              </code>

              {it.isDefault
                ? <span className="rounded-md bg-[var(--cp-primary)]/10 px-2 py-0.5 text-[11px] font-bold text-[var(--cp-primary-deep)]">default</span>
                : it.active && (
                  <button type="button" disabled={busy}
                    onClick={() => send({ action: "set_default", dimension, itemId: it.id }, `"${it.label}" is now the default.`)}
                    className="rounded-lg border border-gray-200 px-2 py-1 text-[11.5px] font-semibold text-gray-600 hover:bg-gray-50">
                    Make default
                  </button>
                )}

              <label className="flex items-center gap-1.5 text-[11.5px] text-gray-600"
                title="Whether a patient may choose this on the public booking page. Staff booking on a patient's behalf is never restricted by it.">
                <input type="checkbox" defaultChecked={it.selfBookable} disabled={busy}
                  onChange={e => send(
                    { action: "update", dimension, itemId: it.id, selfBookable: e.target.checked },
                    e.target.checked ? `Patients may now book "${it.label}".` : `Patients can no longer book "${it.label}".`)} />
                patients may book
              </label>

              {dimension === "visit_type" && (
                <label className="flex items-center gap-1.5 text-[11.5px] text-gray-600" title="Minutes. Blank means the practice default applies.">
                  <input type="number" min={5} max={480} step={5} defaultValue={it.durationMinutes ?? ""}
                    disabled={busy} placeholder="--"
                    onBlur={e => {
                      const raw = e.target.value.trim();
                      const mins = raw === "" ? null : Number(raw);
                      if (mins !== (it.durationMinutes ?? null))
                        send({ action: "update", dimension, itemId: it.id, defaultDurationMinutes: mins },
                          mins === null ? "Duration cleared." : `Duration set to ${mins} minutes.`);
                    }}
                    className="w-[64px] rounded-lg border border-gray-200 px-2 py-1 text-[12px]" />
                  min
                </label>
              )}

              <button type="button" disabled={busy}
                onClick={() => send(
                  { action: "set_active", dimension, itemId: it.id, active: !it.active },
                  it.active ? `"${it.label}" switched off. Appointments already recorded keep it.` : `"${it.label}" switched back on.`)}
                className={`ml-auto rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold ${it.active
                  ? "border-gray-200 text-gray-600 hover:bg-gray-50"
                  : "border-[var(--cp-primary)] text-[var(--cp-primary-deep)] hover:bg-[var(--cp-primary)]/5"}`}>
                {it.active ? "Switch off" : "Switch on"}
              </button>
            </div>
            {!it.active && (
              <p className="mt-1 text-[11px] italic text-gray-500">
                Not offered on any booking form. Still recorded against appointments that already used it.
              </p>
            )}
          </li>
        ))}
      </ul>

      <AddItem dimension={dimension} busy={busy} onAdd={(label, self) =>
        send({ action: "add", dimension, label, selfBookable: self }, `"${label}" added.`)} />
    </section>
  );

  return (
    <div>
      {notice && (
        <p role="status" className={`mt-4 rounded-lg px-3 py-2 text-[12.5px] ${notice.kind === "ok"
          ? "bg-emerald-50 text-emerald-800" : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}
      {section("visit_type", "Visit types", visitTypes, "Why the patient is being seen.")}
      {section("consultation_mode", "Consultation modes", modes, "How the consultation happens.")}
    </div>
  );
}

function AddItem({ dimension, busy, onAdd }: {
  dimension: string; busy: boolean; onAdd: (label: string, selfBookable: boolean) => Promise<boolean>;
}) {
  const [label, setLabel] = useState("");
  const [self, setSelf] = useState(false);
  return (
    <form className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50/60 px-4 py-3"
      onSubmit={async e => {
        e.preventDefault();
        if (!label.trim()) return;
        if (await onAdd(label.trim(), self)) { setLabel(""); setSelf(false); }
      }}>
      <input value={label} onChange={e => setLabel(e.target.value)} disabled={busy}
        placeholder={dimension === "visit_type" ? "Add a visit type..." : "Add a consultation mode..."}
        className="min-w-[200px] flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px]" />
      <label className="flex items-center gap-1.5 text-[11.5px] text-gray-600">
        <input type="checkbox" checked={self} onChange={e => setSelf(e.target.checked)} disabled={busy} />
        patients may book
      </label>
      <button type="submit" disabled={busy || !label.trim()}
        className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50">
        Add
      </button>
    </form>
  );
}
