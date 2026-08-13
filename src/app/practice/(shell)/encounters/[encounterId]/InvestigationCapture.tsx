"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  INVESTIGATION_STATUS_CHIP, INVESTIGATION_STATUS_LABEL, INVESTIGATION_STATUSES,
  QUICK_ADD_NOT_A_RECOMMENDATION, SETS_NOT_A_RECOMMENDATION, QUICK_ADD_REASON_LABEL,
  REPEATS_ARE_NEVER_MERGED, rankInvestigations,
} from "@/lib/practice/investigation-constants";
import type { InvestigationCatalogue, CatalogueItem, EncounterInvestigation, Panel } from "@/lib/practice/investigations";
import { PANEL, SectionHeader, Tip } from "@/components/practice/EncounterKit";

// CPR-INV-001 -- THE INVESTIGATIONS TAB.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS REPLACED, AND THE COUNT THAT JUSTIFIES IT.
//
// The tab was one text box and one Record button. Recording four investigations meant: type, press,
// type, press, type, press, type, press -- eight interactions and four spellings of things like
// "Urea and Electrolytes", per consultation, forever.
//
// s2 replaces it with a multi-select picker, Quick Add and sets, and ONE batch confirmation. Four
// investigations from Quick Add is now FOUR TAPS AND ONE CONFIRM. That is the whole design target of
// s1: three to six investigations in roughly ten to twenty seconds.
//
// ⚠ EVERY CONTROL ON THE SHORTEST PATH CARRIES data-step. The harness counts them out of the rendered
// markup and asserts a ceiling, so a field added later that pushes the routine case past its budget
// fails a test rather than quietly costing a practitioner ten seconds a patient.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ THIS IS NOT AN ORDER SYSTEM AND THE SCREEN SAYS SO WHERE THE WORK HAPPENS. s14. Nothing is sent to
// a laboratory, no result is stored, and there is no status that claims a test was performed. The
// boundary paragraph is rendered from the engine's own constant, not retyped here.
//
// ⚠ QUICK ADD IS NEVER LABELLED "SUGGESTED" OR "RECOMMENDED". s10. Each chip states WHY it is there --
// pinned, often used, recent -- because CINV-CAP-001 s11 requires the reason to be visible, and because
// "often used" is a count while "recommended" would be a clinical claim this product cannot make.
//
// ⚠ TYPE-ONLY IMPORT FROM THE ENGINE. Importing values from investigations.ts would drag the server
// engine into this bundle. The ranking comes from investigation-constants.ts, which imports nothing.

/* eslint-disable @typescript-eslint/no-explicit-any */

const CARD = "rounded-xl border border-gray-200 bg-white p-3.5";
const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const BTN = "rounded-lg bg-[var(--cp-primary)] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-50";
const QUIET = "rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50";
const CHIP = "rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-gray-800 hover:border-[var(--cp-primary)] hover:bg-[var(--cp-primary)]/5 disabled:opacity-50";
const CHIP_ON = "rounded-full border border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 px-2.5 py-1 text-[11.5px] font-semibold text-[var(--cp-primary-deep)]";

type Selected = { id: string | null; label: string; reasonOverride: string; again: boolean };

export default function InvestigationCapture(props: {
  encounterId: string;
  catalogue: InvestigationCatalogue;
  recorded: Panel<EncounterInvestigation>;
  canEdit: boolean;
  canConfigure: boolean;
  locked: boolean;
}) {
  const router = useRouter();
  const editable = props.canEdit && !props.locked;

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [refused, setRefused] = useState<{ label: string; code: string | null; message: string | null }[]>([]);

  const [pending, setPending] = useState<Selected[]>([]);
  const [reasonShared, setReasonShared] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const [reviewSelection, setReviewSelection] = useState<string[]>([]);
  const [reviewSummary, setReviewSummary] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const [creating, setCreating] = useState(false);
  const [custom, setCustom] = useState({ canonicalName: "", shortName: "", category: "", aliases: "" });

  const [savingSet, setSavingSet] = useState(false);
  const [setName, setSetName] = useState("");

  const cat = props.catalogue;
  const byId = useMemo(() => new Map(cat.selectable.map(i => [i.id, i])), [cat.selectable]);

  // ⚠ THE EXAMPLES IN THE SEARCH BOX ARE THIS PRACTICE'S OWN, NOT THREE ABBREVIATIONS TYPED HERE. The
  // first version of this file read "Search - FBC, CBC, CT head", which is precisely the hard-coded
  // clinical vocabulary CPR-TREAT-001 s6 freezes out. The harness caught it, and the fix is the same
  // rule the rest of the file already follows: if it is clinical, it comes from configuration.
  const searchHint = useMemo(() => {
    const examples = cat.selectable.map(i => i.shortName ?? i.displayName).filter(Boolean).slice(0, 3);
    return examples.length > 0
      ? `Search ${examples.join(", ")} and anything else`
      : "Search by name, short name or abbreviation";
  }, [cat.selectable]);

  // ⚠ RANKING IS THE ENGINE'S FUNCTION, IMPORTED. A copy here would drift from the one CINV-CAP-001 s6
  // specifies and from the one the harness proves.
  const results = useMemo(() => {
    const base = category ? cat.selectable.filter(i => i.category === category) : cat.selectable;
    return rankInvestigations(base, query).slice(0, 120);
  }, [cat.selectable, category, query]);

  async function post(payload: Record<string, unknown>): Promise<Record<string, any> | null> {
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
      return body;
    } finally { setBusy(false); }
  }

  const isPending = (id: string | null, label: string) =>
    pending.some(p => (id && p.id === id) || (!id && p.label.toLowerCase() === label.toLowerCase()));

  const toggle = (item: CatalogueItem) => {
    setPending(p => isPending(item.id, item.displayName)
      ? p.filter(x => x.id !== item.id)
      : [...p, { id: item.id, label: item.displayName, reasonOverride: "", again: false }]);
  };

  const addSet = (itemIds: string[]) => {
    setPending(p => {
      const next = [...p];
      for (const id of itemIds) {
        const item = byId.get(id);
        if (!item) continue;
        if (next.some(x => x.id === id)) continue;
        next.push({ id, label: item.displayName, reasonOverride: "", again: false });
      }
      return next;
    });
  };

  async function confirmAdd() {
    const body = await post({
      action: "add", encounterId: props.encounterId,
      reasonShared: reasonShared || null,
      items: pending.map(p => ({ investigationId: p.id, label: p.label, reasonOverride: p.reasonOverride || null })),
      allowDuplicate: pending.map((p, i) => (p.again ? i : -1)).filter(i => i >= 0),
    });
    if (!body) return;
    const bad = (body.results ?? []).filter((r: any) => !r.ok);
    setRefused(bad.map((r: any) => ({ label: r.label, code: r.code, message: r.message })));
    // ⚠ ONLY THE ONES THAT WERE WRITTEN LEAVE THE PLAN. A refused duplicate stays on screen with its
    // Add again control, because s15 forbids dropping a treatment silently and the same rule is right
    // here: a selection that vanished with a toast is a selection the practitioner has to rebuild.
    const keep = new Set(bad.map((r: any) => Number(r.index)));
    setPending(p => p.filter((_, i) => keep.has(i)));
    if (bad.length === 0) { setReasonShared(""); setPickerOpen(false); }
    setNotice({
      kind: bad.length === 0 ? "ok" : "err",
      text: bad.length === 0
        ? `Recorded ${body.recorded} investigation${body.recorded === 1 ? "" : "s"}.`
        : `Recorded ${body.recorded}. ${bad.length} still needs your decision.`,
    });
    router.refresh();
  }

  async function markReviewed(ids: string[]) {
    const body = await post({
      action: "review", encounterId: props.encounterId,
      investigationIds: ids, summary: reviewSummary || null,
    });
    if (!body) return;
    setReviewSelection([]); setReviewSummary("");
    setNotice({ kind: "ok", text: `Marked ${body.reviewed.length} as reviewed.` });
    router.refresh();
  }

  const recorded = props.recorded;
  const openOnes = recorded.items.filter(i => i.status === "requested");

  return (
    // ⚠ SECOND TAB ON THE ENCOUNTER KIT. Chrome only -- the panel, the heading and the boundary band.
    // ⚠ AND THE SUBTITLE KEEPS ITS THREE STATES. "could not be read" is NOT "0 recorded", and collapsing
    // them here would tell a clinician this encounter has no investigations when the query failed.
    <section className={PANEL}>
      <SectionHeader
        title="Investigations"
        // ⚠ NOT "ordered or done". That was this subtitle until now, and it sat directly above the
        // boundary paragraph that says IN SO MANY WORDS "it is not an order system" -- the heading
        // claimed the one thing the notice beneath it spent three sentences disclaiming. AC-10 forbids
        // both words for a reason: `requested` means the practitioner asked for it, and mustNotImply
        // that any laboratory received or performed anything. The wording now echoes the boundary's own
        // language, so the two cannot drift apart into a screen that argues with itself.
        subtitle={recorded.unavailable
          ? "These could not be read -- this is not a statement that none were recorded."
          : `Record what you asked for and what you have looked at. ${recorded.items.length} recorded so far.`}
      />
      <div className="p-4">

      {/* ⚠ THE BOUNDARY, FROM THE ENGINE'S OWN CONSTANT. Not retyped, so it cannot drift from the one
          the API and the harness assert on. Now in the kit's Tip band, which is the same band every
          other tab uses for the sentence that qualifies what the screen is claiming. */}
      <Tip>
        {cat.boundary}{" "}
        <Link href="/practice/inbox" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
          Open the document inbox
        </Link>
      </Tip>

      {cat.storeState === "absent" && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[11.5px] text-[var(--cmp-text-warning)]">
          {cat.storeNotice}
        </p>
      )}
      {cat.unavailable && (
        <p className="mt-2 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[11.5px] text-[var(--cmp-text-critical)]">
          {cat.detail} You can still record one by typing its name.
        </p>
      )}
      {notice && (
        <p className={`mt-2 rounded-lg px-3 py-2 text-[11.5px] ${notice.kind === "ok"
          ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
          : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      {/* ══ WHAT IS ALREADY ON THIS ENCOUNTER -- s3's "requested/recorded list" ═══════════════════ */}
      {recorded.unavailable ? (
        <p className="mt-3 rounded-lg bg-[var(--cmp-surface-critical)] px-3 py-2 text-[11.5px] text-[var(--cmp-text-critical)]">
          {recorded.detail ?? "The investigations on this encounter could not be read."} Do <strong>not</strong> take
          this as none having been recorded.
        </p>
      ) : recorded.items.length === 0 ? (
        <p className="mt-3 text-[12px] text-gray-400">None recorded in this encounter.</p>
      ) : (
        <div className="mt-3">
          {/* s9's batch review controls. Individual review stays available on each row. */}
          {editable && openOnes.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-2">
              <button type="button" className={QUIET} disabled={busy}
                onClick={() => setReviewSelection(
                  reviewSelection.length === openOnes.length ? [] : openOnes.map(i => i.id))}>
                {reviewSelection.length === openOnes.length ? "Clear selection" : `Select all ${openOnes.length}`}
              </button>
              <input className={`${input} max-w-[280px]`} value={reviewSummary}
                onChange={e => setReviewSummary(e.target.value)}
                placeholder="What did you make of it? (your words, not a result)" />
              <button type="button" data-step="review-selected" className={QUIET}
                disabled={busy || reviewSelection.length === 0}
                onClick={() => markReviewed(reviewSelection)}>
                Mark {reviewSelection.length || ""} selected as reviewed
              </button>
            </div>
          )}

          <ul className="flex flex-col gap-1.5">
            {recorded.items.map(i => (
              <li key={i.id} className="rounded-lg border border-gray-100 px-2.5 py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {editable && i.status === "requested" && (
                    <input type="checkbox" aria-label={`Select ${i.label}`}
                      checked={reviewSelection.includes(i.id)}
                      onChange={() => setReviewSelection(s =>
                        s.includes(i.id) ? s.filter(x => x !== i.id) : [...s, i.id])} />
                  )}
                  <span className="text-[12px] font-semibold text-gray-800">{i.label}</span>
                  {i.category && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                      {i.category}
                    </span>
                  )}
                  <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold ${INVESTIGATION_STATUS_CHIP[i.status] ?? "bg-gray-100 text-gray-600"}`}>
                    {INVESTIGATION_STATUS_LABEL[i.status] ?? i.status}
                  </span>
                </div>
                <p className="text-[10px] text-gray-400">
                  recorded {String(i.requestedAt).slice(0, 16).replace("T", " ")}
                  {i.reviewedAt ? ` · reviewed ${String(i.reviewedAt).slice(0, 16).replace("T", " ")}` : ""}
                  {i.cancelledAt ? ` · not pursued ${String(i.cancelledAt).slice(0, 10)}` : ""}
                </p>
                {i.reason && <p className="mt-0.5 text-[11px] text-gray-600">Clinical question: {i.reason}</p>}
                {i.summary && <p className="mt-0.5 text-[11px] text-gray-700">{i.summary}</p>}
                {i.cancelledReason && <p className="mt-0.5 text-[11px] text-gray-500">Not pursued: {i.cancelledReason}</p>}

                {editable && i.status === "requested" && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <button type="button" className={QUIET} disabled={busy}
                      onClick={() => markReviewed([i.id])}>Mark as reviewed</button>
                    <button type="button" className={QUIET} disabled={busy}
                      onClick={() => { setCancelReason(""); setCancelling(cancelling === i.id ? null : i.id); }}>
                      Not pursued
                    </button>
                  </div>
                )}
                {cancelling === i.id && (
                  <form className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg bg-gray-50 p-2"
                    onSubmit={async ev => {
                      ev.preventDefault();
                      const body = await post({
                        action: "cancel", encounterId: props.encounterId,
                        investigationId: i.id, reason: cancelReason,
                      });
                      if (body) { setCancelling(null); setNotice({ kind: "ok", text: "Recorded as not pursued." }); router.refresh(); }
                    }}>
                    <input autoFocus className={`${input} max-w-[320px]`} value={cancelReason}
                      onChange={e => setCancelReason(e.target.value)}
                      placeholder="Why was it not pursued?" />
                    <button type="submit" className={QUIET} disabled={busy || !cancelReason.trim()}>Record</button>
                    {/* ⚠ s8's MUST NOT. Nothing was ever sent, so nothing was cancelled anywhere. */}
                    <p className="w-full text-[10px] text-gray-500">
                      {INVESTIGATION_STATUSES.find(s => s.code === "cancelled")?.mustNotImply}
                    </p>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!editable && (
        <p className="mt-3 text-[11px] text-gray-500">
          {props.locked
            ? "This consultation is signed, so nothing can be added to it."
            : "You do not have the permission that records an investigation on this encounter."}
        </p>
      )}

      {editable && (
        <>
          {/* ══ QUICK ADD -- s3 and s10 ══════════════════════════════════════════════════════════ */}
          <div className={`${CARD} mt-4`}>
            <div className="flex items-baseline gap-2 flex-wrap">
              <h4 className="text-[12px] font-bold text-gray-900">Quick add</h4>
              <span className="text-[10px] text-gray-400">one tap, no typing</span>
            </div>
            {cat.quickAdd.length === 0 ? (
              <p className="mt-1.5 text-[11px] text-gray-400">
                Nothing here yet. Items you pin, and the ones you record most, appear here after you have
                used them.
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {cat.quickAdd.map(({ item, reason }) => {
                  const on = isPending(item.id, item.displayName);
                  return (
                    <li key={item.id}>
                      <button type="button" data-step="quick-add" disabled={busy}
                        className={on ? CHIP_ON : CHIP} onClick={() => toggle(item)}>
                        {item.shortName ?? item.displayName}
                        <span className="ml-1 text-[9px] font-medium text-gray-400">
                          {QUICK_ADD_REASON_LABEL[reason] ?? reason}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-1.5 text-[10px] text-gray-500">{QUICK_ADD_NOT_A_RECOMMENDATION}</p>
          </div>

          {/* ══ MY SETS -- s3 and s5 ════════════════════════════════════════════════════════════ */}
          {cat.sets.length > 0 && (
            <div className={`${CARD} mt-3`}>
              <h4 className="text-[12px] font-bold text-gray-900">My sets</h4>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {cat.sets.map(s => (
                  <li key={s.id}>
                    <button type="button" data-step="add-set" className={CHIP} disabled={busy}
                      onClick={() => addSet(s.itemIds)}>
                      {s.name}
                      <span className="ml-1 text-[9px] font-medium text-gray-400">
                        {s.itemIds.length} item{s.itemIds.length === 1 ? "" : "s"}
                        {s.ownerType === "practice" ? " · shared" : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[10px] text-gray-500">{SETS_NOT_A_RECOMMENDATION}</p>
            </div>
          )}

          {/* ══ THE PENDING SELECTION -- s4's footer, always showing the count ════════════════════ */}
          <div className={`${CARD} mt-3`}>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-[12px] font-bold text-gray-900">
                {pending.length === 0 ? "Nothing selected yet" : `${pending.length} selected`}
              </h4>
              <button type="button" data-step="open-picker" className={`${QUIET} ml-auto`}
                onClick={() => setPickerOpen(o => !o)}>
                {pickerOpen ? "Close the picker" : "+ Add investigations"}
              </button>
            </div>

            {pending.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {pending.map((p, i) => (
                  <li key={`${p.id ?? p.label}-${i}`} className="rounded-lg bg-gray-50 px-2.5 py-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-semibold text-gray-800">{p.label}</span>
                      {p.again && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                          repeat
                        </span>
                      )}
                      <button type="button" className="ml-auto text-[11px] font-semibold text-gray-500 hover:underline"
                        onClick={() => setPending(list => list.filter((_, n) => n !== i))}>
                        Remove
                      </button>
                    </div>
                    {/* s6: an individual item may override the shared reason. It is never demanded. */}
                    <input className={`${input} mt-1`} value={p.reasonOverride}
                      onChange={e => setPending(list => list.map((x, n) => n === i ? { ...x, reasonOverride: e.target.value } : x))}
                      placeholder="A different clinical question for this one (optional)" />
                  </li>
                ))}
              </ul>
            )}

            {/* s6: ONE shared reason for the whole selection, never retyped per item. */}
            <input className={`${input} mt-2`} value={reasonShared} onChange={e => setReasonShared(e.target.value)}
              placeholder={cat.settings.investigationReasonRequired
                ? "Clinical question for all of these (required by this practice)"
                : "Clinical question for all of these (optional)"} />

            <button type="button" data-step="confirm-add" className={`${BTN} mt-2`}
              disabled={busy || pending.length === 0} onClick={confirmAdd}>
              {busy ? "Recording…" : `Add ${pending.length || ""} investigation${pending.length === 1 ? "" : "s"}`}
            </button>

            {refused.length > 0 && (
              <div className="mt-2 rounded-lg bg-[var(--cmp-surface-warning)] px-2.5 py-2">
                <p className="text-[11px] font-bold text-[var(--cmp-text-warning)]">
                  These were not recorded, and they are still in your selection.
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {refused.map((r, i) => (
                    <li key={i} className="text-[11px] text-gray-700">
                      <strong>{r.label}</strong> — {r.message}
                      {(r.code === "DUPLICATE_WARNING" || r.code === "DUPLICATE_PREVENTED") && (
                        <button type="button" className={`${QUIET} ml-2`}
                          onClick={() => setPending(list => list.map(x =>
                            x.label === r.label ? { ...x, again: true } : x))}>
                          Add again
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {/* ⚠ s11's LAST LINE, ON THE SCREEN. */}
                <p className="mt-1 text-[10px] text-gray-600">{REPEATS_ARE_NEVER_MERGED}</p>
              </div>
            )}

            {pending.length > 1 && (
              <div className="mt-2">
                {savingSet ? (
                  <form className="flex flex-wrap items-center gap-1.5"
                    onSubmit={async ev => {
                      ev.preventDefault();
                      const body = await post({
                        action: "saveSet", name: setName, ownerType: "practitioner",
                        investigationIds: pending.map(p => p.id).filter(Boolean),
                      });
                      if (body) { setSavingSet(false); setSetName(""); setNotice({ kind: "ok", text: "Set saved." }); router.refresh(); }
                    }}>
                    <input autoFocus className={`${input} max-w-[260px]`} value={setName}
                      onChange={e => setSetName(e.target.value)} placeholder="Name this set" />
                    <button type="submit" className={QUIET} disabled={busy || !setName.trim()}>Save</button>
                    <button type="button" className={QUIET} onClick={() => setSavingSet(false)}>Cancel</button>
                  </form>
                ) : (
                  <button type="button" className={QUIET} onClick={() => setSavingSet(true)}>
                    Save this selection as a set
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ══ THE PICKER -- s4 ═══════════════════════════════════════════════════════════════ */}
          {pickerOpen && (
            <div className={`${CARD} mt-3`}>
              <input autoFocus className={input} value={query} onChange={e => setQuery(e.target.value)}
                placeholder={searchHint} aria-label="Search investigations" />

              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" className={category === null ? CHIP_ON : CHIP}
                  onClick={() => setCategory(null)}>All</button>
                {cat.categories.map(c => (
                  <button key={c} type="button" className={category === c ? CHIP_ON : CHIP}
                    onClick={() => setCategory(category === c ? null : c)}>{c}</button>
                ))}
              </div>

              {/* ⚠ THE SELECTION SURVIVES SEARCHING AND SWITCHING CATEGORY. s4 requires it, and it is
                  why `pending` lives outside this block rather than inside the picker's own state. */}
              {results.length === 0 ? (
                <div className="mt-3">
                  <p className="text-[12px] text-gray-500">
                    {cat.selectable.length === 0
                      ? "This practice has nothing enabled in its investigation catalogue."
                      : `Nothing in the catalogue matches “${query}”.`}
                  </p>
                  {props.canConfigure && (
                    creating ? (
                      <form className="mt-2 grid gap-1.5 sm:grid-cols-2"
                        onSubmit={async ev => {
                          ev.preventDefault();
                          const body = await post({
                            action: "createCustom",
                            canonicalName: custom.canonicalName, shortName: custom.shortName || null,
                            category: custom.category,
                            aliases: custom.aliases.split(",").map(s => s.trim()).filter(Boolean),
                          });
                          if (body) {
                            setCreating(false);
                            setPending(p => [...p, { id: body.id, label: custom.canonicalName, reasonOverride: "", again: false }]);
                            setCustom({ canonicalName: "", shortName: "", category: "", aliases: "" });
                            setNotice({ kind: "ok", text: "Added to this practice's catalogue and to your selection." });
                            router.refresh();
                          }
                        }}>
                        <input required className={input} value={custom.canonicalName}
                          onChange={e => setCustom(c => ({ ...c, canonicalName: e.target.value }))}
                          placeholder="Full name" />
                        <input className={input} value={custom.shortName}
                          onChange={e => setCustom(c => ({ ...c, shortName: e.target.value }))}
                          placeholder="Short name (optional)" />
                        <input required className={input} value={custom.category}
                          onChange={e => setCustom(c => ({ ...c, category: e.target.value }))}
                          placeholder="Category" list="cp-inv-categories" />
                        <datalist id="cp-inv-categories">
                          {cat.categories.map(c => <option key={c} value={c} />)}
                        </datalist>
                        <input className={input} value={custom.aliases}
                          onChange={e => setCustom(c => ({ ...c, aliases: e.target.value }))}
                          placeholder="Other names people use, comma separated (optional)" />
                        <button type="submit" className={`${BTN} sm:col-span-2`}
                          disabled={busy || !custom.canonicalName.trim() || !custom.category.trim()}>
                          Create and select it
                        </button>
                        <p className="text-[10px] text-gray-500 sm:col-span-2">
                          It becomes selectable immediately and stays in this practice&rsquo;s catalogue. It is not
                          shared with any other practice.
                        </p>
                      </form>
                    ) : (
                      <button type="button" className={`${QUIET} mt-2`}
                        onClick={() => { setCreating(true); setCustom(c => ({ ...c, canonicalName: query })); }}>
                        + Create a custom investigation
                      </button>
                    )
                  )}
                  {!props.canConfigure && (
                    <p className="mt-1 text-[10.5px] text-gray-500">
                      Adding a new item to this practice&rsquo;s catalogue needs the investigation configuration
                      permission. You can still record one by name from the encounter.
                    </p>
                  )}
                </div>
              ) : (
                <ul className="mt-2 flex max-h-[320px] flex-col gap-0.5 overflow-y-auto">
                  {results.map(item => {
                    const on = isPending(item.id, item.displayName);
                    return (
                      <li key={item.id}>
                        <button type="button" data-step="pick" onClick={() => toggle(item)}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-gray-50 ${on ? "bg-[var(--cp-primary)]/8" : ""}`}>
                          <span aria-hidden className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-bold ${on ? "border-[var(--cp-primary)] bg-[var(--cp-primary)] text-white" : "border-gray-300 text-transparent"}`}>
                            x
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[12px] font-semibold text-gray-800">
                              {item.displayName}
                              {item.shortName && <span className="ml-1 text-gray-400">({item.shortName})</span>}
                            </span>
                            <span className="block text-[10px] text-gray-400">
                              {item.category}{item.subcategory ? ` · ${item.subcategory}` : ""}
                              {item.source === "practice" ? " · this practice" : ""}
                            </span>
                          </span>
                          {item.favourite && <span className="ml-auto text-[10px] font-semibold text-gray-400">pinned</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      </div>
    </section>
  );
}
