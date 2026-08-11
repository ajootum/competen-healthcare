"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Refusals } from "./Honesty";
import { SCREEN_REFUSES } from "./refusals";
import UniversalSearch from "./UniversalSearch";
import WorklistTiles from "./WorklistTiles";
import CohortTable from "./CohortTable";
import ContextBanner from "./ContextBanner";
import SummaryPanel from "./SummaryPanel";
import QuickActions from "./QuickActions";
import InsightsPanel from "./InsightsPanel";
import RegistrationDrawer from "./RegistrationDrawer";
import { BUTTON } from "@/lib/practice/palette";
import type {
  CohortSortView, CohortView, FamilyView, ScreenCapabilities, SearchView, SummaryView, WorklistsView,
} from "./types";

// CPR-PAT-002 -- the Patients workspace dashboard, assembled in the specification's own order.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// s3'S LAYOUT, TOP TO BOTTOM: universal search with New Patient and Quick Walk-in beside it; the five
// Today's Care cards; the four Continuing Care cards; the longitudinal register at the bottom. The right
// rail carries the selected patient's summary, the eight quick actions and the insight figures -- the
// comp's own column, and the reason the register keeps the full width of the page when nothing is
// selected.
//
// s9 SAYS REGISTRATION OCCUPIES MINIMAL SPACE, AND THAT MEANS A DRAWER RATHER THAN A DELETION. The form
// is the longest thing in this workspace and the least often needed; most of what happens at a desk is
// finding somebody who already exists, which is also the only reliable defence against a duplicate
// record. So search leads, the cards and the register fill the page, and registration is one deliberate
// click away -- with everything it could do before still in it: guardians, drafts, register-and-queue,
// register-and-book, the duplicate 409 flow and register-and-start-the-consultation.
//
// THE URL IS THE STATE, AND THAT IS THE WHOLE ARCHITECTURE.
//
// ?list= selects a card's filtered list, ?patient= opens the summary panel, ?q= is a search, ?register=1
// opens the drawer and ?intent=walkin tells the drawer which act it was opened for. Three consequences,
// and each of them is the reason:
//
//   1. THE SHIPPED NAVIGATION ALREADY LINKS HERE. /practice/patients?list=waiting is a contract.
//   2. A VIEW CAN BE SENT TO A COLLEAGUE. "Look at this patient" is a link, not a description of which
//      three things to click.
//   3. CLINICAL DATA STAYS SERVER-RENDERED. Selecting a patient re-renders on the server rather than
//      fetching a summary into browser state -- a record pulled into client memory leaks into history,
//      back/forward caches and anything watching the DOM. The cost is a round trip per selection, and it
//      is paid deliberately.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function PatientsScreen(props: {
  capabilities: ScreenCapabilities;
  lists: WorklistsView;
  cohort: CohortView | null;
  /** A valid worklist key, or null for the whole register. */
  selectedList: string | null;
  /** What ?list= actually said, when it was neither a worklist key nor "new". */
  unknownList: string | null;
  query: string;
  initialSearch: SearchView | null;
  patientId: string | null;
  summary: SummaryView | null;
  summaryError: { status: number; code: string; message: string } | null;
  family: FamilyView | null;
  registerOpen: boolean;
  /** "walkin" when the drawer was opened by Quick Walk-in, so it can say which act it is for. */
  registerIntent: string | null;
  page: number;
  scope: "practice" | "mine";
  sort: CohortSortView;
  /** The registration console, rendered on the server and handed in as the drawer's contents. */
  registration: React.ReactNode;
  /**
   * The register's period control, rendered on the server and mounted immediately above the register.
   *
   * ⚠ IT IS NOT AT THE TOP OF THE PAGE, AND THAT IS THE POINT. It narrows the register and nothing else;
   * a period control sitting above the worklist tiles would look like it narrowed them too.
   */
  registerNavigator: React.ReactNode;
  /**
   * ⚠ THE PERIOD RIDES ALONG WITH EVERY OTHER NAVIGATION ON THIS SCREEN, AND THIS PROP IS WHY.
   *
   * `go()` rebuilds the query string from scratch. Without these, choosing a period and then paging,
   * sorting or opening a patient would silently drop it -- the register would widen back out under a
   * control still lit as though it were narrow.
   */
  periodParams: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { selectedList, patientId, query, page, scope, sort, registerOpen, registerIntent } = props;

  const go = useCallback((patch: Partial<{
    list: string | null; patient: string | null; q: string; page: number;
    scope: string; sort: string; register: boolean; intent: string | null;
  }>) => {
    const next = {
      list: patch.list !== undefined ? patch.list : selectedList,
      patient: patch.patient !== undefined ? patch.patient : patientId,
      q: patch.q !== undefined ? patch.q : query,
      // ANY CHANGE OF WHAT IS BEING LISTED RESETS TO PAGE ONE. Keeping page 4 while switching to a list
      // of six people shows an empty table and reads as "nobody is waiting".
      page: patch.page !== undefined ? patch.page
        : (patch.list !== undefined || patch.scope !== undefined || patch.sort !== undefined) ? 0 : page,
      scope: patch.scope !== undefined ? patch.scope : scope,
      sort: patch.sort !== undefined ? patch.sort : sort,
      register: patch.register !== undefined ? patch.register : registerOpen,
      intent: patch.intent !== undefined ? patch.intent : registerIntent,
    };
    const sp = new URLSearchParams();
    if (next.list) sp.set("list", next.list);
    if (next.patient) sp.set("patient", next.patient);
    if (next.q) sp.set("q", next.q);
    if (next.page > 0) sp.set("page", String(next.page));
    if (next.scope !== "practice") sp.set("scope", next.scope);
    if (next.sort !== "registered") sp.set("sort", next.sort);
    if (next.register) sp.set("register", "1");
    if (next.register && next.intent) sp.set("intent", next.intent);
    // ⚠ THE PERIOD SURVIVES EVERY OTHER CONTROL ON THIS SCREEN. See the prop's note.
    for (const [k, v] of Object.entries(props.periodParams)) if (v) sp.set(k, v);
    const qs = sp.toString();
    startTransition(() => router.push(`/practice/patients${qs ? `?${qs}` : ""}`, { scroll: false }));
  }, [router, selectedList, patientId, query, page, scope, sort, registerOpen, registerIntent, props.periodParams]);

  const worklist = selectedList ? props.lists.worklists.find(w => w.key === selectedList) ?? null : null;

  return (
    <div className="flex flex-col gap-5">
      {/* ── s3 TOP: universal search, New Patient, Quick Walk-in ──────────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[180px] shrink-0">
          <h1 className="text-[21px] font-bold leading-tight text-gray-900">Patients</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Your patients. Their journey. Your continuity of care.
          </p>
        </div>

        <div className="min-w-[300px] flex-1">
          <UniversalSearch
            // Remounted when the linked query changes, so the server's answer and the box agree.
            key={`q:${query}`}
            initialQuery={query}
            initial={props.initialSearch}
            canCreate={props.capabilities.mayCreate}
            selectedPatientId={patientId}
            onSelect={id => go({ patient: id })}
            onRegister={() => go({ register: true, intent: null })}
            onSubmitQuery={q => go({ q })}
          />
        </div>

        {props.capabilities.mayCreate && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => go({ register: true, intent: null })}
              className={`rounded-lg px-4 py-2.5 text-[13.5px] font-semibold ${BUTTON.primary}`}
            >
              + New patient
            </button>
            {/* QUICK WALK-IN OPENS THE SAME FORM, and it is honest to do so: the form's own primary
                button is "Register and add to the queue", which IS the walk-in act. What the intent
                changes is what the drawer says it is for -- not a second registration path. */}
            <button
              type="button"
              onClick={() => go({ register: true, intent: "walkin" })}
              className={`rounded-lg px-4 py-2.5 text-[13.5px] font-semibold ${BUTTON.secondaryAction}`}
            >
              Quick walk-in
            </button>
          </div>
        )}
      </div>

      {props.unknownList && (
        <p className="rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">
          <span className="font-semibold">&ldquo;{props.unknownList}&rdquo; is not one of this workspace&rsquo;s lists,</span>{" "}
          so the whole register is shown instead. The lists are:{" "}
          {props.lists.worklists.map(w => w.key).join(", ")}.
        </p>
      )}

      {/* ── s3 MIDDLE: Today's Care, then Continuing Care ─────────────────────────────────────────── */}
      <WorklistTiles
        lists={props.lists}
        selected={selectedList}
        onSelect={key => go({ list: key })}
      />

      {/* ── s3 BOTTOM: the longitudinal register, with the comp's right rail beside it ────────────── */}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_336px]">
        <div className="flex min-w-0 flex-col gap-4">
          {props.summary && (
            <ContextBanner banner={props.summary.banner} onClose={() => go({ patient: null })} />
          )}
          {/* The period control sits WITH the register it narrows, not at the top of the page. */}
          {props.registerNavigator}
          <CohortTable
            cohort={props.cohort}
            worklist={worklist}
            selectedPatientId={patientId}
            onSelect={id => go({ patient: id })}
            onScope={s => go({ scope: s })}
            onSort={s => go({ sort: s })}
            onPage={p => go({ page: p })}
            pending={pending}
          />
          <p className="rounded-xl border border-[var(--cp-primary)]/20 bg-[var(--cp-primary)]/[0.04] px-4 py-2.5 text-[12px] leading-relaxed text-gray-600">
            <span className="font-semibold text-[var(--cp-primary-deep)]">Tip:</span> select a patient to
            open their summary beside the register, or follow &ldquo;Open timeline&rdquo; for the whole
            record &mdash; encounters, documents, treatments and follow-ups on one page.
          </p>
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-4">
          {patientId && (
            <SummaryPanel
              summary={props.summary}
              summaryError={props.summaryError}
              family={props.family}
              capabilities={props.capabilities}
            />
          )}
          <QuickActions
            capabilities={props.capabilities}
            selectedPatientId={patientId}
            onNewPatient={() => go({ register: true, intent: null })}
            onWalkIn={() => go({ register: true, intent: "walkin" })}
          />
          <InsightsPanel lists={props.lists} cohort={props.cohort} />
        </aside>
      </div>

      {/* TWO REFUSAL LISTS, BECAUSE THEY ANSWER TO TWO DOCUMENTS. The first is what the ENGINE cannot
          put in the payload; the second is what this SCREEN will not draw from the CPR-PAT-002 comp.
          Merging them would make an engine limit look like a design choice, or the reverse. */}
      <Refusals
        refuses={SCREEN_REFUSES}
        title="What this screen will not draw"
        blurb="Elements of the CPR-PAT-002 design and specification that this record cannot honestly support, each with the reason. None of them is silently missing."
      />
      <Refusals
        refuses={props.lists.refuses}
        title="What the record itself cannot answer"
        blurb="Limits of the patient workspace engine, carried with its own payload."
      />

      <RegistrationDrawer
        open={registerOpen && props.capabilities.mayCreate}
        intent={registerIntent}
        // ?list=new was already resolved to "not a worklist" on the server, so closing simply drops the
        // register flag and whatever list is genuinely selected stays selected.
        onClose={() => go({ register: false, intent: null })}
      >
        {props.registration}
      </RegistrationDrawer>
    </div>
  );
}
