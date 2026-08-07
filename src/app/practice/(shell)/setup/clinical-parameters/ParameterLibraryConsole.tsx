"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { tintedCard, tintedChip, tintedFigure } from "@/lib/practice/palette";
import {
  PARAMETER_CATEGORIES, COLLECTION_RULES, PARAMETER_DATA_TYPES, RISK_CLASSES, CONFIG_LEVELS,
  CATEGORY_HUE, CATEGORY_HUE_UNKEYED, CATEGORY_ICON, THRESHOLD_TONE,
  PARAMETER_REFUSALS, NO_PLATFORM_REFERENCE_RANGE, PARAMETER_CAPABILITIES,
} from "@/lib/practice/parameters-constants";
import type { ParameterLibrary, LibraryParameter } from "@/lib/practice/parameters";

// CPR-LCP-001 s10.1's console.
//
// ⚠ EVERYTHING THIS COMPONENT RECEIVES IS PLAIN DATA. `ParameterLibrary` is a type-only import, so
// nothing from parameters.ts (which imports access.ts, which imports `next/headers`) crosses into the
// browser bundle. A server-only import reaching a client component killed the Follow-ups board this
// week: it passed tsc, eslint, every harness and every 307, and only `next build` caught it. The rule:
// A CLIENT COMPONENT IMPORTS TYPES FROM THE ENGINE AND VALUES FROM THE CONSTANTS FILE.

const CARD = "rounded-xl border border-gray-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const input = "w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const BTN = "rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50";
const QUIET = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";

const hueOf = (category: string) => CATEGORY_HUE[category] ?? CATEGORY_HUE_UNKEYED;

export default function ParameterLibraryConsole({ library }: { library: ParameterLibrary }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ collectionRule: "", low: "", high: "", visibility: "team", localLabel: "" });
  const [newParam, setNewParam] = useState({
    code: "", displayName: "", category: "custom", dataType: "decimal",
    canonicalUnit: "", minPlausible: "", maxPlausible: "", riskClass: "low", cloneOf: "",
  });
  const [showNew, setShowNew] = useState(false);

  async function post(body: Record<string, unknown>, okText: string) {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/parameters", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: "err", text: json?.error?.message ?? json?.error ?? `Request failed (${res.status})` });
        return false;
      }
      setNotice({ kind: "ok", text: okText });
      router.refresh();
      return true;
    } catch (e) {
      setNotice({ kind: "err", text: e instanceof Error ? e.message : "Request failed" });
      return false;
    } finally { setBusy(false); }
  }

  // ⚠ THREE STATES, NOT TWO. A library that could not be read is not a library with nothing in it, and
  // this is the first thing the component decides.
  if (!library.permitted) {
    return (
      <section className={CARD}>
        <h2 className="text-[13px] font-bold text-gray-900">You may not see this</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
          Viewing what this practice measures needs the <code className="rounded bg-gray-100 px-1">parameter.view</code>{" "}
          capability. That is a permissions answer, not an empty library.
        </p>
      </section>
    );
  }

  if (library.parameters.unavailable) {
    return (
      <section className="rounded-xl border border-rose-300 bg-rose-50 p-4">
        <h2 className="text-[13px] font-bold text-rose-900">The parameter library could not be read</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-rose-800">
          This is <strong>not</strong> the same as no parameters being configured. Nothing on this page is
          a count of your practice.
        </p>
        {library.parameters.detail && (
          <p className="mt-1.5 font-mono text-[11px] text-rose-700">{library.parameters.detail}</p>
        )}
      </section>
    );
  }

  const all = library.parameters.items;
  const shown = all.filter(p =>
    (category === "all" || p.category === category)
    && (query.trim() === ""
      || p.displayName.toLowerCase().includes(query.toLowerCase())
      || p.code.includes(query.toLowerCase())
      || p.synonyms.some(s => s.toLowerCase().includes(query.toLowerCase()))));

  const byCategory = PARAMETER_CATEGORIES
    .map(([key, label]) => ({ key, label, items: shown.filter(p => p.category === key) }))
    .filter(g => g.items.length > 0);

  // Doctrine 7: every figure below is the length of a list on this page.
  const stats: { key: string; figure: number | null; label: string; caption: string; hue: string }[] = [
    { key: "active", figure: library.counts.active, label: "Collected", caption: "activated for this practice", hue: "var(--cp-primary)" },
    { key: "notActivated", figure: library.counts.notActivated, label: "Available", caption: "in the library, not switched on", hue: "var(--cp-accent)" },
    { key: "withThreshold", figure: library.counts.withThreshold, label: "With a range", caption: "something is checking the values", hue: "var(--cp-success)" },
    { key: "custom", figure: library.counts.custom, label: "This practice's own", caption: "created or cloned here", hue: "var(--cp-warning)" },
  ];

  return (
    <div className="flex flex-col gap-4">

      {notice && (
        <p className={`rounded-lg px-3 py-2 text-[12px] font-semibold ${notice.kind === "ok"
          ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
          {notice.text}
        </p>
      )}

      {library.librarySeedError && (
        <p className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
          The core parameter library could not be written, so this list may be incomplete:{" "}
          <span className="font-mono">{library.librarySeedError}</span>
        </p>
      )}

      {/* ── The four figures, each one the length of a list ─────────────────────────────────────── */}
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(s => (
          <div key={s.key} className="relative overflow-hidden rounded-xl border p-3.5" style={tintedCard(s.hue)}>
            <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: s.hue }} />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{s.label}</p>
            {/* ⚠ A FIGURE THAT COULD NOT BE COMPUTED IS AN EM DASH, NEVER A NOUGHT. */}
            <p className="mt-1 text-[26px] font-bold leading-none" style={s.figure === null ? { color: "var(--cp-slate-300)" } : tintedFigure(s.hue)}>
              {s.figure === null ? "—" : s.figure}
            </p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-gray-500">
              {s.figure === null ? "could not be read" : s.caption}
            </p>
          </div>
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="flex flex-col gap-4">

          {/* ── Filters ────────────────────────────────────────────────────────────────────────── */}
          <section className={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setCategory("all")}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${category === "all"
                  ? "bg-[var(--cp-primary)] text-white" : "border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                All {all.length}
              </button>
              {PARAMETER_CATEGORIES.map(([key, label]) => {
                const n = all.filter(p => p.category === key).length;
                if (n === 0) return null;
                const hue = hueOf(key);
                return (
                  <button key={key} type="button" onClick={() => setCategory(key)}
                    className="rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                    style={category === key ? { background: hue, color: "white" } : tintedChip(hue)}>
                    <span aria-hidden className="mr-1">{CATEGORY_ICON[key] ?? "•"}</span>
                    {label} {n}
                  </button>
                );
              })}
              <input value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search name, code or synonym" className={`${input} ml-auto max-w-[240px]`} />
            </div>
          </section>

          {/* ── The library, grouped by category and tinted by it ──────────────────────────────── */}
          {byCategory.length === 0 ? (
            <section className={CARD}>
              <p className="text-[12px] text-gray-500">
                {all.length === 0
                  ? "The parameter library is empty. That is a real answer, not a failed read — the core parameters are written on first use by somebody with permission to configure them."
                  : "No parameter matches that filter."}
              </p>
            </section>
          ) : byCategory.map(group => {
            const hue = hueOf(group.key);
            return (
              <section key={group.key} className={CARD}>
                <div className="mb-3 flex items-center gap-2">
                  <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px]"
                    style={tintedChip(hue)}>{CATEGORY_ICON[group.key] ?? "•"}</span>
                  <h2 className="text-[13px] font-bold text-gray-900">{group.label}</h2>
                  <span className="text-[11px] font-semibold" style={tintedFigure(hue)}>
                    {group.items.filter(p => p.activation?.state === "active").length} of {group.items.length} collected
                  </span>
                </div>

                <ul className="flex flex-col gap-2">
                  {group.items.map(p => (
                    <ParameterRow
                      key={p.id} p={p} hue={hue}
                      canConfigure={library.canConfigure} busy={busy}
                      editing={editing === p.id}
                      draft={draft}
                      onEdit={() => {
                        setEditing(p.id);
                        setDraft({
                          collectionRule: p.activation?.collectionRule ?? p.defaultCollectionRule,
                          low: p.activation?.threshold?.low != null ? String(p.activation.threshold.low) : "",
                          high: p.activation?.threshold?.high != null ? String(p.activation.threshold.high) : "",
                          visibility: p.activation?.visibility ?? "team",
                          localLabel: p.activation?.localLabel ?? "",
                        });
                      }}
                      onCancel={() => setEditing(null)}
                      onDraft={d => setDraft(prev => ({ ...prev, ...d }))}
                      onToggle={async (on: boolean) => {
                        await post({
                          action: on ? "activate" : "deactivate", definitionId: p.id,
                          collectionRule: p.activation?.collectionRule ?? p.defaultCollectionRule,
                        }, on ? `${p.displayName} is now collected here.` : `${p.displayName} is no longer collected. Its history is untouched.`);
                      }}
                      onSave={async () => {
                        const ok = await post({
                          action: "activate", definitionId: p.id,
                          collectionRule: draft.collectionRule || null,
                          localLabel: draft.localLabel || null,
                          visibility: draft.visibility,
                          threshold: (draft.low === "" && draft.high === "")
                            ? null
                            : { low: draft.low === "" ? null : Number(draft.low), high: draft.high === "" ? null : Number(draft.high) },
                        }, `${p.displayName} saved.`);
                        if (ok) setEditing(null);
                      }}
                    />
                  ))}
                </ul>
              </section>
            );
          })}

          {/* ── Specialty packs ────────────────────────────────────────────────────────────────── */}
          <section className={CARD}>
            <div className="mb-2 flex items-center gap-2">
              <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px]"
                style={tintedChip("var(--cp-success)")}>◈</span>
              <h2 className="text-[13px] font-bold text-gray-900">Specialty packs</h2>
              {library.packs.items.length > 0 && (
                <span className="text-[11px] text-gray-500">{library.packs.items.length} available</span>
              )}
            </div>

            {library.packs.unavailable ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                The pack catalogue could not be read. This is <strong>not</strong> the same as there being
                no packs.
              </p>
            ) : library.packs.items.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-gray-600">
                No packs yet, and that is the truth about this build rather than a failed load. The pack{" "}
                <em>machinery</em> is here &mdash; a pack can be created, filled, cloned and installed, and
                every parameter it activates records which pack and which version put it there. The curated
                catalogue (CPR-CPL-001: roughly 450 candidate parameters across 34 specialty groupings) is a
                separate pass and has not been authored.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {library.packs.items.map(pack => (
                  <li key={pack.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-bold text-gray-900">
                        {pack.name}
                        {pack.platform && <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold text-slate-500">PLATFORM</span>}
                      </p>
                      <p className="text-[10.5px] text-gray-500">
                        {pack.specialty ? `${pack.specialty} · ` : ""}
                        {pack.itemCount === null ? "parameter count could not be read" : `${pack.itemCount} parameters`}
                        {pack.installedCount !== null && ` · ${pack.installedCount} already collected here`}
                      </p>
                    </div>
                    {library.canInstallPacks && pack.status !== "retired" && (
                      <button type="button" disabled={busy} className={BTN}
                        onClick={() => post({ action: "installPack", packId: pack.id },
                          `${pack.name} installed. Parameters you had switched off stay off.`)}>
                        Install
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── Right rail ───────────────────────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* Create or clone. s10.1's third bullet. */}
          {library.canConfigure && (
            <section className={CARD}>
              <div className="flex items-center gap-2">
                <h2 className="text-[13px] font-bold text-gray-900">Custom parameters</h2>
                <button type="button" className={`${QUIET} ml-auto`} onClick={() => setShowNew(v => !v)}>
                  {showNew ? "Close" : "New or clone"}
                </button>
              </div>
              {!showNew ? (
                <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
                  Define something this practice measures that the library does not have, or clone a
                  governed parameter and change it here. A clone keeps a record of where it came from.
                </p>
              ) : (
                <div className="mt-2.5 flex flex-col gap-2">
                  <label className="text-[10.5px] font-semibold text-gray-600">
                    Clone of (optional)
                    <select className={input} value={newParam.cloneOf}
                      onChange={e => setNewParam(p => ({ ...p, cloneOf: e.target.value }))}>
                      <option value="">Nothing — start from scratch</option>
                      {all.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                    </select>
                  </label>
                  <label className="text-[10.5px] font-semibold text-gray-600">
                    Code
                    <input className={input} value={newParam.code} placeholder="seizure_frequency"
                      onChange={e => setNewParam(p => ({ ...p, code: e.target.value }))} />
                  </label>
                  <label className="text-[10.5px] font-semibold text-gray-600">
                    Display name
                    <input className={input} value={newParam.displayName} placeholder="Seizure frequency"
                      onChange={e => setNewParam(p => ({ ...p, displayName: e.target.value }))} />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[10.5px] font-semibold text-gray-600">
                      Category
                      <select className={input} value={newParam.category}
                        onChange={e => setNewParam(p => ({ ...p, category: e.target.value }))}>
                        {PARAMETER_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </label>
                    <label className="text-[10.5px] font-semibold text-gray-600">
                      Data type
                      <select className={input} value={newParam.dataType}
                        onChange={e => setNewParam(p => ({ ...p, dataType: e.target.value }))}>
                        {PARAMETER_DATA_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="text-[10.5px] font-semibold text-gray-600">
                      Unit
                      <input className={input} value={newParam.canonicalUnit}
                        onChange={e => setNewParam(p => ({ ...p, canonicalUnit: e.target.value }))} />
                    </label>
                    <label className="text-[10.5px] font-semibold text-gray-600">
                      Min plausible
                      <input className={input} value={newParam.minPlausible}
                        onChange={e => setNewParam(p => ({ ...p, minPlausible: e.target.value }))} />
                    </label>
                    <label className="text-[10.5px] font-semibold text-gray-600">
                      Max plausible
                      <input className={input} value={newParam.maxPlausible}
                        onChange={e => setNewParam(p => ({ ...p, maxPlausible: e.target.value }))} />
                    </label>
                  </div>
                  <label className="text-[10.5px] font-semibold text-gray-600">
                    Risk class
                    <select className={input} value={newParam.riskClass}
                      onChange={e => setNewParam(p => ({ ...p, riskClass: e.target.value }))}>
                      {RISK_CLASSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <p className="text-[10px] leading-relaxed text-gray-500">
                    A new parameter starts as a <strong>draft</strong>. A licensed one cannot go active
                    until its licence reference is recorded &mdash; the database refuses it, not this form.
                  </p>
                  <button type="button" disabled={busy} className={BTN}
                    onClick={async () => {
                      const ok = await post({
                        action: "defineParameter",
                        code: newParam.code, displayName: newParam.displayName,
                        category: newParam.category, dataType: newParam.dataType,
                        canonicalUnit: newParam.canonicalUnit || null,
                        permittedUnits: newParam.canonicalUnit ? [newParam.canonicalUnit] : [],
                        unitConversions: newParam.canonicalUnit ? { [newParam.canonicalUnit]: 1 } : {},
                        minPlausible: newParam.minPlausible || null,
                        maxPlausible: newParam.maxPlausible || null,
                        riskClass: newParam.riskClass,
                        cloneOf: newParam.cloneOf || null,
                      }, `${newParam.displayName || newParam.code} created as a draft.`);
                      if (ok) { setShowNew(false); setNewParam({ code: "", displayName: "", category: "custom", dataType: "decimal", canonicalUnit: "", minPlausible: "", maxPlausible: "", riskClass: "low", cloneOf: "" }); }
                    }}>
                    Create
                  </button>
                </div>
              )}
            </section>
          )}

          {/* s10.1's sixth bullet, rendered as a statement. See the page header. */}
          <section className={CARD}>
            <h2 className="text-[13px] font-bold text-gray-900">Who may change what</h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {[
                ["parameter.view", "See what is collected and read values", "Practitioner · Assistant"],
                ["parameter.record", "Record and correct measurements", "Practitioner · Assistant"],
                ["parameter.configure", "Activate parameters, set frequencies and thresholds", "Practitioner"],
                ["pack.install", "Create, clone and install packs", "Practitioner"],
              ].map(([code, what, who]) => (
                <li key={code} className="rounded-lg border border-gray-200 px-2.5 py-1.5">
                  <p className="font-mono text-[10.5px] font-semibold text-[var(--cp-primary-deep)]">{code}</p>
                  <p className="text-[11px] text-gray-700">{what}</p>
                  <p className="text-[10px] text-gray-500">{who}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
              These are role capabilities, granted per member. They are edited in{" "}
              <Link href="/practice/people" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">Team &amp; Permissions</Link>{" "}
              and not here &mdash; two editors over one grant is how a permission gets silently overwritten.
              {" "}The list above is the {PARAMETER_CAPABILITIES.length} this module gates on.
            </p>
          </section>

          {/* s4's hierarchy, so the page says where a setting made here sits. */}
          <section className={CARD}>
            <h2 className="text-[13px] font-bold text-gray-900">Where a setting applies</h2>
            <p className="mt-1 text-[10.5px] leading-relaxed text-gray-500">
              Most specific wins. Anything set on this page is a practice default, and a patient&rsquo;s
              own plan or a single review can override it without changing it.
            </p>
            <ol className="mt-2 flex flex-col gap-1">
              {CONFIG_LEVELS.map((l, i) => (
                <li key={l.key} className="flex items-start gap-2 text-[11px]">
                  <span aria-hidden className="mt-px font-mono text-[10px] text-gray-400">{i + 1}</span>
                  <span>
                    <span className={`font-semibold ${l.key === "practitioner" ? "text-[var(--cp-primary-deep)]" : "text-gray-700"}`}>
                      {l.title}
                    </span>
                    <span className="block text-[10px] text-gray-500">{l.purpose}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {/* ⚠ THE REFUSALS, ON THE PAGE. An omitted feature reads as one that has not loaded. */}
          <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <h2 className="text-[13px] font-bold text-amber-900">What this will not claim</h2>
            <ul className="mt-1.5 flex flex-col gap-2">
              {PARAMETER_REFUSALS.map(r => (
                <li key={r.key}>
                  <p className="text-[11.5px] font-semibold text-amber-900">{r.label}</p>
                  <p className="text-[10.5px] leading-relaxed text-amber-800">{r.detail}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

/** One parameter, with its activation, its threshold verdict and its editor. */
function ParameterRow({ p, hue, canConfigure, busy, editing, draft, onEdit, onCancel, onDraft, onToggle, onSave }: {
  p: LibraryParameter; hue: string; canConfigure: boolean; busy: boolean; editing: boolean;
  draft: { collectionRule: string; low: string; high: string; visibility: string; localLabel: string };
  onEdit: () => void; onCancel: () => void;
  onDraft: (d: Partial<{ collectionRule: string; low: string; high: string; visibility: string; localLabel: string }>) => void;
  onToggle: (on: boolean) => void; onSave: () => void;
}) {
  const on = p.activation?.state === "active";
  const tone = THRESHOLD_TONE[p.threshold.state] ?? THRESHOLD_TONE.unreadable;

  return (
    <li className="rounded-lg border p-3" style={on ? tintedCard(hue) : { borderColor: "var(--cp-slate-300)", background: "white" }}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-bold text-gray-900">
            {p.activation?.localLabel ?? p.displayName}
            {p.canonicalUnit && <span className="font-normal text-gray-500">({p.canonicalUnit})</span>}
            {!p.platform && (
              <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] font-semibold text-slate-600">THIS PRACTICE</span>
            )}
            {p.status === "draft" && (
              <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-800">DRAFT</span>
            )}
            {p.riskClass !== "low" && (
              <span className="rounded bg-violet-100 px-1 py-0.5 text-[9px] font-semibold text-violet-700">
                {(RISK_CLASSES.find(([k]) => k === p.riskClass)?.[1] ?? p.riskClass).toUpperCase()}
              </span>
            )}
          </p>
          <p className="text-[10.5px] text-gray-500">
            <span className="font-mono">{p.code}</span>
            {" · "}{PARAMETER_DATA_TYPES.find(([k]) => k === p.dataType)?.[1] ?? p.dataType}
            {" · "}{COLLECTION_RULES.find(([k]) => k === (p.activation?.collectionRule ?? p.defaultCollectionRule))?.[1] ?? "on request"}
            {p.formula && <> {" · "}<span className="font-mono">{p.formula}</span></>}
          </p>
          {/* Doctrine 7: the figure opens a list — here it is the count behind the parameter. */}
          <p className="mt-1 flex flex-wrap items-center gap-1.5">
            {/* ⚠ NOT CHECKED IS A DASHED GREY CHIP, NEVER A BLANK AND NEVER A TICK. */}
            <span className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${tone.chip}`} title={p.threshold.text}>
              <span aria-hidden className="mr-0.5">{tone.mark}</span>{tone.label}
            </span>
            <span className="text-[10px] text-gray-500">
              {p.measurementCount === null ? "measurement count could not be read"
                : `${p.measurementCount} recorded value${p.measurementCount === 1 ? "" : "s"}`}
            </span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {canConfigure ? (
            <>
              <button type="button" disabled={busy} onClick={() => onToggle(!on)}
                className={on ? QUIET : BTN}>
                {on ? "Stop collecting" : "Collect this"}
              </button>
              {on && (
                <button type="button" disabled={busy} className={QUIET} onClick={editing ? onCancel : onEdit}>
                  {editing ? "Cancel" : "Settings"}
                </button>
              )}
            </>
          ) : (
            <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-[10.5px] font-semibold text-slate-500">
              {on ? "Collected" : "Not collected"}
            </span>
          )}
        </div>
      </div>

      {editing && (
        <div className="mt-2.5 grid gap-2 border-t border-white/60 pt-2.5 sm:grid-cols-2 xl:grid-cols-5">
          <label className="text-[10px] font-semibold text-gray-600">
            How often
            <select className={input} value={draft.collectionRule}
              onChange={e => onDraft({ collectionRule: e.target.value })}>
              {COLLECTION_RULES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="text-[10px] font-semibold text-gray-600">
            Local name
            <input className={input} value={draft.localLabel} placeholder={p.displayName}
              onChange={e => onDraft({ localLabel: e.target.value })} />
          </label>
          <label className="text-[10px] font-semibold text-gray-600">
            Range low
            <input className={input} value={draft.low} onChange={e => onDraft({ low: e.target.value })} />
          </label>
          <label className="text-[10px] font-semibold text-gray-600">
            Range high
            <input className={input} value={draft.high} onChange={e => onDraft({ high: e.target.value })} />
          </label>
          <label className="text-[10px] font-semibold text-gray-600">
            Who can see it
            <select className={input} value={draft.visibility} onChange={e => onDraft({ visibility: e.target.value })}>
              <option value="team">The whole team</option>
              <option value="practitioner_only">Practitioners only</option>
            </select>
          </label>
          <p className="text-[10px] leading-relaxed text-gray-600 sm:col-span-2 xl:col-span-4">
            {/* ⚠ THE SENTENCE THAT MAKES `not_checked` UNDERSTANDABLE RATHER THAN ALARMING. */}
            {NO_PLATFORM_REFERENCE_RANGE.detail}
          </p>
          <button type="button" disabled={busy} className={`${BTN} self-end`} onClick={onSave}>Save</button>
        </div>
      )}
    </li>
  );
}
