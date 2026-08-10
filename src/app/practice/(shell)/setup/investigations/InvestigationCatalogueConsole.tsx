"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  rankInvestigations, DUPLICATE_RULES, INVESTIGATION_REFUSALS,
  SETS_NOT_A_RECOMMENDATION, INVESTIGATION_STATUSES,
} from "@/lib/practice/investigation-constants";
import type { InvestigationCatalogue } from "@/lib/practice/investigations";

// CINV-CAP-001 s5 and s8, and the three workflow settings CPR-INV-001 makes practice-configurable.
//
// ⚠ EVERY CONTROL HERE IS BEHIND investigation.configure AND THE SCREEN SAYS SO WHEN IT IS ABSENT.
// s10: master catalogue edits require governance, and local activation is a permission-controlled act
// because it changes what everybody in the practice may record. A reader without the capability sees
// the catalogue and no switches, rather than switches that 403.
//
// ⚠ ABSENCE OF AN ACTIVATION ROW IS "ENABLED". The toggle below therefore starts ON for every item a
// practice has never touched, which is what makes the seeded catalogue usable on day one. Migration 275
// section 3 records the reasoning.
//
// ⚠ TYPE-ONLY IMPORT FROM THE ENGINE, ranking from the import-free constants module.

const CARD = "rounded-xl border border-gray-200 bg-white p-4";
const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const BTN = "rounded-lg bg-[var(--cp-primary)] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50";
const QUIET = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";

export default function InvestigationCatalogueConsole({ library, canConfigure }: {
  library: InvestigationCatalogue;
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [creating, setCreating] = useState(false);
  const [custom, setCustom] = useState({ canonicalName: "", shortName: "", category: "", aliases: "" });

  const categories = useMemo(
    () => [...new Set(library.all.map(i => i.category))].sort(),
    [library.all]);

  // ⚠ THE EXAMPLES ARE THE PRACTICE'S OWN. See the same note in InvestigationCapture.tsx: a placeholder
  // naming three tests is a hard-coded clinical list, and s6 freezes those out wherever they appear.
  const searchHint = useMemo(() => {
    const examples = library.all.map(i => i.shortName ?? i.displayName).filter(Boolean).slice(0, 3);
    return examples.length > 0
      ? `Search ${examples.join(", ")} and anything else`
      : "Search by name, short name or abbreviation";
  }, [library.all]);

  const rows = useMemo(() => {
    const base = category ? library.all.filter(i => i.category === category) : library.all;
    return rankInvestigations(base, query);
  }, [library.all, category, query]);

  async function post(payload: Record<string, unknown>, okText: string) {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/investigation-capture", {
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

  if (!library.permitted) {
    return (
      <p className={`${CARD} text-[12px] text-gray-600`}>
        You do not have the permission that reads this practice&rsquo;s investigation catalogue.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {library.storeState === "absent" && (
        <p className={`${CARD} text-[12px] text-[var(--cmp-text-warning)]`}>{library.storeNotice}</p>
      )}
      {library.unavailable && (
        <p className={`${CARD} text-[12px] text-[var(--cmp-text-critical)]`}>{library.detail}</p>
      )}
      {notice && (
        <p className={`${CARD} text-[12px] ${notice.kind === "ok" ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      {/* ══ WORKFLOW SETTINGS -- CPR-INV-001 s6 and s11 ═══════════════════════════════════════════ */}
      <section className={CARD}>
        <h2 className="text-[14px] font-bold text-gray-900">How the picker behaves</h2>
        <p className="mt-0.5 text-[11.5px] text-gray-500">
          Two behaviours the specification leaves to each practice. Both apply to everybody here.
        </p>

        <div className="mt-3 flex flex-col gap-3">
          <div>
            <span className="text-[12px] font-bold text-gray-900">
              When an investigation is already on the encounter
            </span>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {DUPLICATE_RULES.map(r => (
                <li key={r.code}>
                  <button type="button" disabled={!canConfigure || busy}
                    className={library.settings.duplicateRule === r.code
                      ? "rounded-lg border border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 px-2.5 py-1.5 text-[11.5px] font-semibold text-[var(--cp-primary-deep)]"
                      : QUIET}
                    onClick={() => post({ action: "setSetting", key: "investigation_duplicate_rule", value: r.code },
                      "Duplicate handling changed.")}>
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[10.5px] text-gray-500">
              {DUPLICATE_RULES.find(r => r.code === library.settings.duplicateRule)?.explain}
            </p>
          </div>

          <div>
            <span className="text-[12px] font-bold text-gray-900">A clinical question on every investigation</span>
            <div className="mt-1.5 flex gap-1.5">
              {[["false", "Optional"], ["true", "Required"]].map(([v, l]) => (
                <button key={v} type="button" disabled={!canConfigure || busy}
                  className={String(library.settings.investigationReasonRequired) === v
                    ? "rounded-lg border border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 px-2.5 py-1.5 text-[11.5px] font-semibold text-[var(--cp-primary-deep)]"
                    : QUIET}
                  onClick={() => post({ action: "setSetting", key: "investigation_reason_required", value: v },
                    "Changed.")}>
                  {l}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10.5px] text-gray-500">
              Required means a shared reason, or a reason on each item, before anything is recorded.
            </p>
          </div>
        </div>

        {library.settings.unreadable && (
          <p className="mt-2 text-[11px] text-[var(--cmp-text-critical)]">
            These settings could not be read, so the defaults shown are what is in force. They are not
            necessarily what this practice chose.
          </p>
        )}
        {!canConfigure && (
          <p className="mt-2 text-[11px] text-gray-500">
            Changing these needs the investigation configuration permission. It is granted in Team &amp;
            Permissions.
          </p>
        )}
      </section>

      {/* ══ THE CATALOGUE -- s5 ═════════════════════════════════════════════════════════════════ */}
      <section className={CARD}>
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-[14px] font-bold text-gray-900">The catalogue</h2>
          <span className="text-[11px] text-gray-500">
            {library.all.length} item{library.all.length === 1 ? "" : "s"} &middot;{" "}
            {library.all.filter(i => i.enabled).length} enabled
          </span>
          {canConfigure && (
            <button type="button" className={`${QUIET} ml-auto`} onClick={() => setCreating(c => !c)}>
              {creating ? "Cancel" : "+ Add a custom investigation"}
            </button>
          )}
        </div>

        {creating && canConfigure && (
          <form className="mt-3 grid gap-2 sm:grid-cols-2"
            onSubmit={async ev => {
              ev.preventDefault();
              const body = await post({
                action: "createCustom",
                canonicalName: custom.canonicalName, shortName: custom.shortName || null,
                category: custom.category,
                aliases: custom.aliases.split(",").map(s => s.trim()).filter(Boolean),
                // s5's last bullet: a practice may put a custom item on Quick Add immediately.
                favourite: true,
              }, "Added to this practice's catalogue and pinned to your Quick Add.");
              if (body) { setCreating(false); setCustom({ canonicalName: "", shortName: "", category: "", aliases: "" }); }
            }}>
            <input required className={input} value={custom.canonicalName} placeholder="Full name"
              onChange={e => setCustom(c => ({ ...c, canonicalName: e.target.value }))} />
            <input className={input} value={custom.shortName} placeholder="Short name (optional)"
              onChange={e => setCustom(c => ({ ...c, shortName: e.target.value }))} />
            <input required className={input} value={custom.category} placeholder="Category" list="cp-setup-inv-cats"
              onChange={e => setCustom(c => ({ ...c, category: e.target.value }))} />
            <datalist id="cp-setup-inv-cats">
              {categories.map(c => <option key={c} value={c} />)}
            </datalist>
            <input className={input} value={custom.aliases} placeholder="Other names, comma separated (optional)"
              onChange={e => setCustom(c => ({ ...c, aliases: e.target.value }))} />
            <button type="submit" className={`${BTN} sm:col-span-2`}
              disabled={busy || !custom.canonicalName.trim() || !custom.category.trim()}>
              Create it
            </button>
            <p className="text-[10.5px] text-gray-500 sm:col-span-2">
              It stays in this practice. It is not shared with any other practice and it is not added to
              the platform catalogue.
            </p>
          </form>
        )}

        <input className={`${input} mt-3`} value={query} onChange={e => setQuery(e.target.value)}
          placeholder={searchHint} aria-label="Search the catalogue" />

        <div className="mt-2 flex flex-wrap gap-1">
          <button type="button" onClick={() => setCategory(null)}
            className={category === null
              ? "rounded-full border border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--cp-primary-deep)]"
              : "rounded-full border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"}>
            All
          </button>
          {categories.map(c => (
            <button key={c} type="button" onClick={() => setCategory(category === c ? null : c)}
              className={category === c
                ? "rounded-full border border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--cp-primary-deep)]"
                : "rounded-full border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"}>
              {c}
            </button>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="mt-3 text-[12px] text-gray-500">
            {library.all.length === 0
              ? "There is nothing in the catalogue. If this deployment has not run migration 275 there is no store behind this page yet."
              : `Nothing matches “${query}”.`}
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-gray-100">
            {rows.map(item => (
              <li key={item.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-[12.5px] font-semibold ${item.enabled ? "text-gray-900" : "text-gray-400 line-through"}`}>
                    {item.displayName}
                  </span>
                  {item.shortName && <span className="text-[11px] text-gray-400">{item.shortName}</span>}
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                    {item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}
                  </span>
                  {item.source === "practice" && (
                    <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                      this practice
                    </span>
                  )}
                  {/* ⚠ THE MASTER NAME IS STILL SHOWN WHEN THE PRACTICE HAS RENAMED IT. s5 keeps the
                      master ID relationship, and hiding the original would make a rename look like a
                      different test. */}
                  {item.renamed && (
                    <span className="text-[10px] text-gray-400">renamed from &ldquo;{item.canonicalName}&rdquo;</span>
                  )}
                  {item.favourite && <span className="text-[10px] font-semibold text-gray-400">pinned</span>}

                  {canConfigure && (
                    <span className="ml-auto flex flex-wrap gap-1">
                      <button type="button" className={QUIET} disabled={busy}
                        onClick={() => post({ action: "setActivation", investigationId: item.id, enabled: !item.enabled },
                          item.enabled ? "Switched off for this practice." : "Switched on.")}>
                        {item.enabled ? "Turn off" : "Turn on"}
                      </button>
                      <button type="button" className={QUIET} disabled={busy}
                        onClick={() => { setRenameTo(item.displayName); setRenaming(renaming === item.id ? null : item.id); }}>
                        Rename here
                      </button>
                      <button type="button" className={QUIET} disabled={busy}
                        onClick={() => post({ action: "setFavourite", investigationId: item.id, favourite: !item.favourite },
                          item.favourite ? "Unpinned." : "Pinned to your Quick Add.")}>
                        {item.favourite ? "Unpin" : "Pin"}
                      </button>
                    </span>
                  )}
                </div>

                {renaming === item.id && canConfigure && (
                  <form className="mt-1.5 flex flex-wrap items-center gap-1.5"
                    onSubmit={async ev => {
                      ev.preventDefault();
                      const body = await post({
                        action: "setActivation", investigationId: item.id,
                        localDisplayName: renameTo.trim() === item.canonicalName ? null : renameTo,
                      }, "Renamed for this practice.");
                      if (body) setRenaming(null);
                    }}>
                    <input autoFocus className={`${input} max-w-[320px]`} value={renameTo}
                      onChange={e => setRenameTo(e.target.value)} />
                    <button type="submit" className={QUIET} disabled={busy}>Save</button>
                    <button type="button" className={QUIET} onClick={() => setRenaming(null)}>Cancel</button>
                    <p className="w-full text-[10px] text-gray-500">
                      The name changes here only. Anything already recorded keeps the name it was recorded
                      under, and the master item behind it is unchanged.
                    </p>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ══ SETS -- s8 ══════════════════════════════════════════════════════════════════════════ */}
      <section className={CARD}>
        <h2 className="text-[14px] font-bold text-gray-900">Sets</h2>
        <p className="mt-0.5 text-[11.5px] text-gray-500">{SETS_NOT_A_RECOMMENDATION}</p>
        {library.sets.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">
            None yet. A set is created from the encounter screen: select several investigations, then save
            the selection.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {library.sets.map(s => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-semibold text-gray-900">{s.name}</span>
                <span className="text-[11px] text-gray-500">
                  {s.itemIds.length} item{s.itemIds.length === 1 ? "" : "s"}
                  {s.ownerType === "practice" ? " · shared with the practice" : " · yours"}
                </span>
                <button type="button" className={`${QUIET} ml-auto`} disabled={busy}
                  onClick={() => post({ action: "retireSet", setId: s.id }, "Set retired.")}>
                  Retire
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10.5px] text-gray-500">
          Retiring a set stops it being offered. Nothing already recorded changes &mdash; a set is never
          referenced by an encounter.
        </p>
      </section>

      {/* ══ WHAT THIS CAPABILITY DECLINES TO DO ═════════════════════════════════════════════════ */}
      <section className={CARD}>
        <h2 className="text-[14px] font-bold text-gray-900">What enabling an investigation does not do</h2>
        <ul className="mt-2 flex flex-col gap-1.5">
          {INVESTIGATION_REFUSALS.map(r => (
            <li key={r.key} className="text-[11.5px] text-gray-600">
              <span className="font-semibold text-gray-800">{r.what}</span> {r.why}
            </li>
          ))}
        </ul>
        <h3 className="mt-3 text-[12px] font-bold text-gray-900">What each status means, and does not</h3>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {INVESTIGATION_STATUSES.map(s => (
            <li key={s.code} className="text-[11.5px] text-gray-600">
              <span className="font-semibold text-gray-800">{s.label}:</span> {s.means}{" "}
              <span className="text-gray-500">It does not mean: {s.mustNotImply}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
