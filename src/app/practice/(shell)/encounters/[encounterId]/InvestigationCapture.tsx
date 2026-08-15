"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  INVESTIGATION_STATUS_CHIP, INVESTIGATION_STATUS_LABEL, INVESTIGATION_STATUSES,
  QUICK_ADD_NOT_A_RECOMMENDATION, SETS_NOT_A_RECOMMENDATION, QUICK_ADD_REASON_LABEL,
  QUICK_ADD_REASONS, REPEATS_ARE_NEVER_MERGED, rankInvestigations, investigationReadiness,
} from "@/lib/practice/investigation-constants";
// CPR-INV-HFE-006 s3 and s12: "keep the active working list in the same pale-lavender active-work band
// used in Treatment and Procedures", and s16's acceptance criterion that the band language MATCHES.
// This tab predates encounter-band-constants.ts and drew Quick add, My sets, the working list and the
// picker all in one identical CARD -- four surfaces at one volume, which is the exact defect
// CPR-HFE-TRT-004 s11 was written about for the right rail.
import {
  BAND_RECORD, BAND_SHORTCUTS, BAND_WORK,
} from "@/lib/practice/encounter-band-constants";
// Generic over the shared detail_fields shape and import-free -- see investigations.ts for why the
// procedure vocabulary is borrowed rather than copied.
import { detailFieldIssues } from "@/lib/practice/procedure-constants";
import type { InvestigationCatalogue, CatalogueItem, EncounterInvestigation, Panel } from "@/lib/practice/investigations";
import { PANEL, SectionHeader, Tip } from "@/components/practice/EncounterKit";
import {
  ClinicalRecordTable, type RecordColumn, type RowState,
} from "@/components/practice/ClinicalRecordTable";

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

type Selected = { id: string | null; label: string; reasonOverride: string; again: boolean; details: Record<string, string> };

/** The row's own view model: the record, plus the selection state the review batch needs. */
type InvRow = {
  i: EncounterInvestigation; selected: boolean; editable: boolean; onSelect: () => void;
};

// CP-UI-TABLE-001 s5: Investigation | Type | Status | Result/Date | Actions.
const INVESTIGATION_COLUMNS: RecordColumn<InvRow>[] = [
  { key: "label", label: "Investigation", priority: "primary",
    render: ({ i, selected, editable, onSelect }) => (
      <span className="inline-flex items-center gap-2">
        {editable && i.status === "requested" && (
          <input type="checkbox" aria-label={`Select ${i.label} for review`}
            checked={selected} onChange={onSelect} />
        )}
        <span className="font-semibold text-gray-800">{i.label}</span>
      </span>
    ) },
  { key: "category", label: "Type", priority: "secondary",
    render: ({ i }) => i.category
      ? <span className="text-[11.5px] text-gray-600">{i.category}</span>
      : <span className="text-gray-400">&mdash;</span> },
  { key: "status", label: "Status", priority: "status",
    render: ({ i }) => (
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${INVESTIGATION_STATUS_CHIP[i.status] ?? "bg-gray-100 text-gray-600"}`}>
        {INVESTIGATION_STATUS_LABEL[i.status] ?? i.status}
      </span>
    ) },
  // ⚠ s8 AGAIN: THIS IS WHAT A PRACTITIONER WROTE DOWN, NOT A RESULT FROM A LABORATORY. The column is
  // headed "Summary" rather than the spec's "Result/Date" for that reason -- nothing here came back
  // from anywhere, and a column called Result would say it did.
  { key: "summary", label: "Summary", priority: "secondary",
    render: ({ i }) => i.summary
      ? <span className="text-[11.5px] text-gray-700">{i.summary}</span>
      : <span className="text-gray-400">&mdash;</span> },
];

export default function InvestigationCapture(props: {
  encounterId: string;
  patientId: string;
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

  // ── s7's report link (275's column, writable at last) ──────────────────────────────────────────────
  // ⚠ AVAILABLE ON A SIGNED ENCOUNTER ON PURPOSE: a report arrives after the consultation is signed,
  // so this one action gates on the CAPABILITY alone, not on `editable` -- linking changes no clinical
  // content, it points at a document the inbox already holds.
  const [linking, setLinking] = useState<string | null>(null);
  const [linkChoice, setLinkChoice] = useState("");
  /** Three states, never two: null = not fetched yet; {error} = the read failed and says so. */
  const [inbox, setInbox] = useState<{ items: any[] } | { error: string } | null>(null);

  async function openLink(rowId: string) {
    setLinkChoice("");
    if (linking === rowId) { setLinking(null); return; }
    setLinking(rowId);
    if (inbox !== null) return;
    try {
      const res = await fetch(`/api/v1/practice/inbox?patientId=${encodeURIComponent(props.patientId)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInbox({ error: body?.error?.message ?? "the inbox could not be read, so nothing can be offered to link" });
        return;
      }
      setInbox({ items: (body.incoming ?? []) as any[] });
    } catch {
      setInbox({ error: "the inbox could not be reached, so nothing can be offered to link" });
    }
  }

  const [creating, setCreating] = useState(false);
  /** migration 301: which existing investigation the missed search word should be taught to. */
  const [teachTarget, setTeachTarget] = useState("");
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
      : [...p, { id: item.id, label: item.displayName, reasonOverride: "", again: false, details: {} }]);
  };

  const addSet = (itemIds: string[]) => {
    setPending(p => {
      const next = [...p];
      for (const id of itemIds) {
        const item = byId.get(id);
        if (!item) continue;
        if (next.some(x => x.id === id)) continue;
        next.push({ id, label: item.displayName, reasonOverride: "", again: false, details: {} });
      }
      return next;
    });
  };

  async function confirmAdd() {
    const body = await post({
      action: "add", encounterId: props.encounterId,
      reasonShared: reasonShared || null,
      items: pending.map(p => ({
        investigationId: p.id, label: p.label, reasonOverride: p.reasonOverride || null,
        // migration 301: only a governed item can have declared fields, and the engine drops
        // undeclared keys anyway -- sent only when there is something to send.
        details: Object.keys(p.details).length > 0 ? p.details : null,
      })),
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

  // ── s8's READINESS, MIRRORING investigations.ts AND NOTHING ELSE ────────────────────────────────
  //
  // ⚠ THE ENGINE ASKS A SET-LEVEL QUESTION AND THIS ANSWERS A PER-ITEM ONE, EQUIVALENTLY. It refuses
  // unless there is a shared reason OR every item has its own; marking an item unready exactly when it
  // has neither makes "blocked === 0" mean the same thing. So the button is disabled for precisely the
  // batches the engine would refuse, and the amber sits on the items that are actually short.
  const readinessOf = (p: Selected) => {
    const base = investigationReadiness({
      reasonOverride: p.reasonOverride, reasonShared,
      reasonRequired: cat.settings.investigationReasonRequired,
    });
    // ⚠ THE GROWTH investigationReadiness PROMISED IN ITS OWN COMMENT ("this function grows when
    // CPR-INV-CAT-007 lands"). detailFieldIssues is the same function the ENGINE refuses with, so the
    // words on the item and the words in a refusal cannot describe one fault two ways.
    const fields = p.id ? (byId.get(p.id)?.detailFields ?? []) : [];
    const missing = [...base.missing, ...detailFieldIssues(fields, p.details)];
    return { ready: missing.length === 0, missing };
  };
  const blocked = pending.filter(p => !readinessOf(p).ready).length;

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
        <div className={`${BAND_RECORD} mt-3 overflow-hidden p-3`}>
          {/* ══ BAND 1 (s4, s12): THE RECORD ═════════════════════════════════════════════════════
              s9's batch review controls. Individual review stays available on each row. */}
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

          {/* CP-UI-TABLE-001 s13 step 5, s5's columns: Investigation | Type | Status | Result/Date.
              ⚠ THE SELECT-FOR-REVIEW CHECKBOX STAYS IN THE FIRST COLUMN, not in an actions column. It
              selects the record rather than acting on it, and s2 keeps the primary clinical information
              left-most -- an action column that mixed "choose this" with "do this to it" would be two
              different verbs sharing a heading.
              ⚠ AND THE TIMESTAMPS BECOME s2's SECONDARY LINE. They are context, never the fact, and
              they were the longest thing on every row. */}
          <ClinicalRecordTable
            label="Investigations recorded in this encounter"
            columns={INVESTIGATION_COLUMNS}
            empty={<></>}
            records={recorded.items.map(i => ({
              id: i.id,
              data: { i, selected: reviewSelection.includes(i.id), editable,
                onSelect: () => setReviewSelection(s =>
                  s.includes(i.id) ? s.filter(x => x !== i.id) : [...s, i.id]) },
              // ⚠ `stopped`, NOT `warning`. An investigation nobody pursued is a decision that was
              // recorded, not an alarm -- s4 keeps the alert treatment for what needs acting on.
              state: (i.status === "cancelled" ? "stopped" : "normal") as RowState,
              stateLabel: i.status === "cancelled" ? "Not pursued" : undefined,
              secondaryText: (
                <>
                  recorded {String(i.requestedAt).slice(0, 16).replace("T", " ")}
                  {i.reviewedAt ? ` · reviewed ${String(i.reviewedAt).slice(0, 16).replace("T", " ")}` : ""}
                  {i.cancelledAt ? ` · not pursued ${String(i.cancelledAt).slice(0, 10)}` : ""}
                  {i.reason ? ` · clinical question: ${i.reason}` : ""}
                  {i.cancelledReason ? ` · not pursued: ${i.cancelledReason}` : ""}
                  {i.linkedDocumentId && (
                    // s7: the row says WHICH report answers it. The link goes to the register -- there
                    // is deliberately no per-document viewer, the same decision documents-workspace made.
                    <>
                      {" · report: "}
                      <a href="/practice/inbox" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                        {i.linkedDocumentTitle ?? "in the inbox"}
                      </a>
                    </>
                  )}
                </>
              ),
              actions: (editable && i.status === "requested") || (props.canEdit && i.status !== "cancelled") ? (
                <span className="inline-flex items-center gap-1.5">
                  {editable && i.status === "requested" && (
                    <>
                      <button type="button" className={QUIET} disabled={busy}
                        aria-label={`Mark ${i.label} as reviewed`}
                        onClick={() => markReviewed([i.id])}>Mark as reviewed</button>
                      <button type="button" className={QUIET} disabled={busy}
                        aria-label={`Record ${i.label} as not pursued`}
                        onClick={() => { setCancelReason(""); setCancelling(cancelling === i.id ? null : i.id); }}>
                        Not pursued
                      </button>
                    </>
                  )}
                  {props.canEdit && i.status !== "cancelled" && (
                    // Capability-gated, NOT `editable`-gated -- see the state block above. A signed
                    // encounter still takes a report link, because that is when reports exist.
                    <button type="button" className={QUIET} disabled={busy}
                      aria-label={i.linkedDocumentId ? `Change the report linked to ${i.label}` : `Link a report to ${i.label}`}
                      onClick={() => openLink(i.id)}>
                      {linking === i.id ? "Cancel" : i.linkedDocumentId ? "Change report" : "Link report"}
                    </button>
                  )}
                </span>
              ) : undefined,
              expandedContent: linking === i.id ? (
                <div className="rounded-lg bg-gray-50 p-2">
                  {inbox === null ? (
                    <p className="text-[11px] text-gray-500">Reading the inbox&hellip;</p>
                  ) : "error" in inbox ? (
                    // The failed read says it failed -- it never renders as "this patient has no
                    // documents", which is a different fact.
                    <p className="text-[11px] text-[var(--cmp-text-warning)]">{inbox.error}</p>
                  ) : inbox.items.length === 0 ? (
                    <p className="text-[11px] text-gray-600">
                      No inbox document is recorded for this patient. When the report arrives,{" "}
                      <a href="/practice/inbox" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                        record it in the inbox
                      </a>{" "}
                      first, then link it here.
                    </p>
                  ) : (
                    <form className="flex flex-wrap items-center gap-1.5"
                      onSubmit={async ev => {
                        ev.preventDefault();
                        if (!linkChoice) return;
                        const body = await post({
                          action: "linkDocument", encounterId: props.encounterId,
                          investigationId: i.id, incomingDocumentId: linkChoice,
                        });
                        if (body) { setLinking(null); setNotice({ kind: "ok", text: "Report linked. The result stays in the inbox document; this row now points at it." }); router.refresh(); }
                      }}>
                      <select className={`${input} max-w-[360px]`} value={linkChoice}
                        aria-label={`Which report answers ${i.label}`}
                        onChange={e => setLinkChoice(e.target.value)}>
                        <option value="">Choose the report that answers this</option>
                        {inbox.items.map(d => (
                          <option key={d.id} value={d.id}>
                            {(d.title ?? "Untitled")} · {String(d.doc_type ?? "").replace(/_/g, " ")} · {String(d.received_on ?? "").slice(0, 10)}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className={QUIET} disabled={busy || !linkChoice}>Link</button>
                      {i.linkedDocumentId && (
                        <button type="button" className={QUIET} disabled={busy}
                          onClick={async () => {
                            const body = await post({
                              action: "linkDocument", encounterId: props.encounterId,
                              investigationId: i.id, incomingDocumentId: null,
                            });
                            if (body) { setLinking(null); setNotice({ kind: "ok", text: "Unlinked. The inbox document itself is untouched." }); router.refresh(); }
                          }}>
                          Unlink current report
                        </button>
                      )}
                      <p className="w-full text-[10px] text-gray-500">
                        A link points; it never copies. The result stays on the inbox document with its
                        own review trail, and unlinking removes the pointer only.
                      </p>
                    </form>
                  )}
                </div>
              ) : cancelling === i.id ? (
                <form className="flex flex-wrap items-center gap-1.5 rounded-lg bg-gray-50 p-2"
                  onSubmit={async ev => {
                    ev.preventDefault();
                    const body = await post({
                      action: "cancel", encounterId: props.encounterId,
                      investigationId: i.id, reason: cancelReason,
                    });
                    if (body) { setCancelling(null); setNotice({ kind: "ok", text: "Recorded as not pursued." }); router.refresh(); }
                  }}>
                  <input autoFocus className={`${input} max-w-[320px]`} value={cancelReason}
                    aria-label={`Why ${i.label} was not pursued`}
                    onChange={e => setCancelReason(e.target.value)}
                    placeholder="Why was it not pursued?" />
                  <button type="submit" className={QUIET} disabled={busy || !cancelReason.trim()}>Record</button>
                  {/* ⚠ s8's MUST NOT. Nothing was ever sent, so nothing was cancelled anywhere. */}
                  <p className="w-full text-[10px] text-gray-500">
                    {INVESTIGATION_STATUSES.find(s => s.code === "cancelled")?.mustNotImply}
                  </p>
                </form>
              ) : undefined,
            }))}
          />
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
          {/* ══ BAND 2 (s4, s12): SHORTCUTS ═══════════════════════════════════════════════════════
              s4 calls this band "low-contrast blue-grey" and subordinate. Quick add and My sets used to
              be two separate white cards at the same weight as the working list below them -- three
              equal surfaces, so nothing said which one was the task. */}
          <div className={`${BAND_SHORTCUTS} mt-4 p-3.5`}>
            <div className="flex items-baseline gap-2 flex-wrap">
              <h4 className="text-[12px] font-bold text-gray-900">Quick add</h4>
              <span className="text-[10.5px] text-gray-500">one tap, no typing</span>
            </div>
            {cat.quickAdd.length === 0 ? (
              <p className="mt-1.5 text-[11px] text-gray-600">
                Nothing here yet. Items you pin, and the ones you record most, appear here after you have
                used them.
              </p>
            ) : (
              // ⚠ s6's THREE GROUPS, MADE REAL. The reason was a 9px suffix on each chip in one flat
              // list -- true, but a practitioner scanning for something they PINNED had to read every
              // label to find it. Grouping is what makes the reason usable rather than merely present.
              //
              // ⚠ AND THE GROUP ORDER IS THE ENGINE'S RANKING, NOT A NEW ONE. QUICK_ADD_REASONS is
              // ordered favourite, frequent, recent, and rankQuickAdd sorts by the same order; reading
              // the array here means the screen cannot disagree with the server about which shortcut
              // outranks which, and a fourth reason added later appears without touching this file.
              <div className="mt-2 flex flex-col gap-2">
                {QUICK_ADD_REASONS.map(({ code, label, explain }) => {
                  const group = cat.quickAdd.filter(q => q.reason === code);
                  if (group.length === 0) return null;
                  return (
                    <div key={code}>
                      {/* ⚠ THE GROUP HEADING CARRIES THE ENGINE'S OWN EXPLANATION as its title, so the
                          honesty that used to live in a chip suffix is not lost by grouping -- s10 and
                          s6 both require the reason to stay visible and non-advisory. */}
                      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-500"
                        title={explain}>
                        {label}
                      </p>
                      <ul className="mt-1 flex flex-wrap gap-1.5">
                        {group.map(({ item }) => {
                          const on = isPending(item.id, item.displayName);
                          return (
                            <li key={item.id}>
                              <button type="button" data-step="quick-add" disabled={busy}
                                className={on ? CHIP_ON : CHIP} onClick={() => toggle(item)}>
                                {item.shortName ?? item.displayName}
                                {/* The per-chip reason stays for a screen reader, which meets the group
                                    heading only if it happens to be read in order. */}
                                <span className="sr-only"> ({QUICK_ADD_REASON_LABEL[code] ?? code})</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-2 text-[11px] text-gray-600">{QUICK_ADD_NOT_A_RECOMMENDATION}</p>

            {/* ══ MY SETS -- s3 and s5, now INSIDE the shortcut band rather than beside it ════════ */}
            {cat.sets.length > 0 && (
              <div className="mt-3 border-t border-slate-200 pt-2.5">
                <h4 className="text-[12px] font-bold text-gray-900">My sets</h4>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {cat.sets.map(s => (
                    <li key={s.id}>
                      <button type="button" data-step="add-set" className={CHIP} disabled={busy}
                        onClick={() => addSet(s.itemIds)}>
                        {s.name}
                        <span className="ml-1 text-[10px] font-medium text-gray-500">
                          {s.itemIds.length} item{s.itemIds.length === 1 ? "" : "s"}
                          {s.ownerType === "practice" ? " · shared" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-gray-600">{SETS_NOT_A_RECOMMENDATION}</p>
              </div>
            )}
          </div>

          {/* ══ BAND 4 (s3, s4, s12): THE ACTIVE WORK ═════════════════════════════════════════════
              s3: "keep the active working list in the same pale-lavender active-work band used in
              Treatment and Procedures", and s16 makes matching that language an acceptance criterion.
              The band constant is the SAME import both sibling tabs use, so the three cannot drift. */}
          <div className={`${BAND_WORK} mt-3 p-4`}>
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
                {pending.map((p, i) => {
                  const ready = readinessOf(p);
                  return (
                  <li key={`${p.id ?? p.label}-${i}`} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[12px] font-semibold text-gray-800">{p.label}</span>
                      {p.again && (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                          repeat
                        </span>
                      )}
                      {/* ⚠ s8's READINESS INDICATOR, AND s12 GIVES IT A WORD AS WELL AS A COLOUR. Green
                          for ready, amber for outstanding -- s12 reserves red for a true blocking or
                          critical state, and a missing clinical question is neither. */}
                      <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${ready.ready
                        ? "border-emerald-200 bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
                        : "border-amber-300 bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"}`}>
                        {ready.ready ? "✓ Ready" : `⚠ Needs ${ready.missing.join(", ")}`}
                      </span>
                      {/* s15: Add / Remove / Review stay spatially distinct. Remove is the only
                          destructive control on the item and it sits alone at the end of the row. */}
                      <button type="button"
                        aria-label={`Remove ${p.label} from the selection`}
                        className="rounded-lg px-1.5 py-0.5 text-[11px] font-semibold text-gray-500 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                        onClick={() => setPending(list => list.filter((_, n) => n !== i))}>
                        Remove
                      </button>
                    </div>
                    {/* s6: an individual item may override the shared reason. It is never demanded --
                        unless this practice requires one and no shared reason has been given. */}
                    <input className={`${input} mt-1 ${ready.missing.includes("a clinical question") ? "border-amber-300 bg-[var(--cmp-surface-warning)]" : ""}`}
                      value={p.reasonOverride}
                      aria-label={`Clinical question for ${p.label}`}
                      onChange={e => setPending(list => list.map((x, n) => n === i ? { ...x, reasonOverride: e.target.value } : x))}
                      placeholder="A different clinical question for this one (optional)" />

                    {/* ── CPR-INV-CAT-007 s6/s9 (migration 301): THE DEFINITION'S OWN FIELDS ─────────
                        Drawn only for the investigation that declares them -- an FBC shows nothing
                        here, a CT configured with a body-region field asks for one. parseDetailFields
                        already dropped anything unvalidatable on the server, and every blocker is worn
                        by its own field, amber, the same grammar as everywhere else on this page. */}
                    {(p.id ? (byId.get(p.id)?.detailFields ?? []) : []).length > 0 && (
                      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                        {(byId.get(p.id!)?.detailFields ?? []).map(f => {
                          const value = p.details[f.key] ?? "";
                          const short = f.required && !value.trim();
                          const setDetail = (v: string) => setPending(list =>
                            list.map((x, n) => n === i ? { ...x, details: { ...x.details, [f.key]: v } } : x));
                          return (
                            <label key={f.key} className="flex flex-col gap-0.5">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                                {f.label}{f.required ? " *" : ""}
                              </span>
                              {f.kind === "choice" ? (
                                <select value={value} disabled={busy}
                                  onChange={e => setDetail(e.target.value)}
                                  className={`${input} ${short ? "border-amber-300 bg-[var(--cmp-surface-warning)]" : ""}`}>
                                  {/* An empty first option, never a preselected answer nobody gave. */}
                                  <option value="">{f.required ? "Choose..." : "Not recorded"}</option>
                                  {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                              ) : (
                                <input value={value} disabled={busy}
                                  inputMode={f.kind === "number" ? "decimal" : undefined}
                                  placeholder={f.required ? "" : "Optional"}
                                  onChange={e => setDetail(e.target.value)}
                                  className={`${input} ${short ? "border-amber-300 bg-[var(--cmp-surface-warning)]" : ""}`} />
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </li>
                  );
                })}
              </ul>
            )}

            {/* s6: ONE shared reason for the whole selection, never retyped per item. */}
            <input className={`${input} mt-2 ${cat.settings.investigationReasonRequired && blocked > 0
              ? "border-amber-300 bg-[var(--cmp-surface-warning)]" : ""}`}
              value={reasonShared} onChange={e => setReasonShared(e.target.value)}
              aria-label="Clinical question for all of these"
              placeholder={cat.settings.investigationReasonRequired
                ? "Clinical question for all of these (required by this practice)"
                : "Clinical question for all of these (optional)"} />

            {/* ⚠ s15: "make the wrong action difficult or impossible". This button used to be enabled
                whenever anything was selected, so a practice that requires a clinical question sent the
                whole batch, got one 422, and was told nothing had been recorded -- after filling the
                screen. The refusal is now pre-empted, and the sentence beside the button says WHY it is
                disabled, because a disabled control that cannot explain itself reads as a broken
                product. That defect was reported on the Treatment tab and is not repeated here. */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" data-step="confirm-add" className={BTN}
                disabled={busy || pending.length === 0 || blocked > 0} onClick={confirmAdd}>
                {busy ? "Recording…" : `Add ${pending.length || ""} investigation${pending.length === 1 ? "" : "s"}`}
              </button>
              {blocked > 0 && (
                <span className="text-[11.5px] text-[var(--cmp-text-warning)]">
                  {blocked === 1 ? "One investigation still needs" : `${blocked} investigations still need`}{" "}
                  a clinical question &mdash; give one above for all of them, or one on each.
                </span>
              )}
            </div>

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
                            setPending(p => [...p, { id: body.id, label: custom.canonicalName, reasonOverride: "", again: false, details: {} }]);
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
                      <div className="mt-2 flex flex-col gap-2">
                        {/* ── CPR-INV-CAT-007 s12 (migration 301): TEACH THE SEARCH THIS WORD ────────
                            The miss case IS the moment: somebody typed the word their practice uses
                            and the catalogue did not answer. Teaching it beats creating a duplicate
                            definition -- s5 and s14 are explicit that an alias resolves to the
                            canonical item and never creates one -- so the teach control is offered
                            FIRST and create-custom second. Local to this practice, invisible to every
                            other tenant. */}
                        {query.trim() && cat.selectable.length > 0 && (
                          <form className="flex flex-wrap items-center gap-1.5"
                            onSubmit={async ev => {
                              ev.preventDefault();
                              const body = await post({
                                action: "addAlias", investigationId: teachTarget, alias: query.trim(),
                              });
                              if (body) {
                                setTeachTarget("");
                                setNotice({ kind: "ok", text: `"${query.trim()}" now finds it, for this practice only.` });
                                router.refresh();
                              }
                            }}>
                            <span className="text-[12px] text-gray-700">
                              Teach the search: make <strong>&ldquo;{query.trim()}&rdquo;</strong> find
                            </span>
                            <select value={teachTarget} disabled={busy} aria-label="Which investigation this word means"
                              onChange={e => setTeachTarget(e.target.value)}
                              className={`${input} max-w-[260px]`}>
                              <option value="">Choose an investigation...</option>
                              {cat.selectable.map(it => (
                                <option key={it.id} value={it.id}>{it.displayName}</option>
                              ))}
                            </select>
                            <button type="submit" className={QUIET} disabled={busy || !teachTarget}>
                              Teach it
                            </button>
                          </form>
                        )}
                        <button type="button" className={`${QUIET} self-start`}
                          onClick={() => { setCreating(true); setCustom(c => ({ ...c, canonicalName: query })); }}>
                          + Create a custom investigation
                        </button>
                      </div>
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
