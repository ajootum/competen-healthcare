"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Refusals } from "./Honesty";
import UniversalSearch from "./UniversalSearch";
import WorklistTiles from "./WorklistTiles";
import CohortTable from "./CohortTable";
import ContextBanner from "./ContextBanner";
import SummaryPanel from "./SummaryPanel";
import RegistrationDrawer from "./RegistrationDrawer";
import type {
  CohortView, FamilyView, ScreenCapabilities, SearchView, SummaryView, WorklistsView,
} from "./types";

// CPR-V5-006 -- the Patients workspace, assembled.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE URL IS THE STATE, AND THAT IS THE WHOLE ARCHITECTURE.
//
// ?list= selects a worklist, ?patient= opens the summary panel, ?q= is a search, ?register=1 opens the
// registration drawer. Three consequences, and each of them is the reason:
//
//   1. THE SHIPPED NAVIGATION ALREADY LINKS HERE. /practice/patients?list=waiting and ?list=new are in
//      the sidebar as "Waiting List" and "New Registration". They are a contract, not a suggestion.
//   2. A VIEW CAN BE SENT TO A COLLEAGUE. "Look at this patient" is a link, not a description of which
//      three things to click.
//   3. CLINICAL DATA STAYS SERVER-RENDERED. Selecting a patient re-renders on the server rather than
//      fetching a summary into browser state -- the position /practice/search already took, for the same
//      reason: a record pulled into client memory leaks into history, back/forward caches and anything
//      watching the DOM. The cost is a round trip per selection, and it is paid deliberately.
//
// AN UNKNOWN ?list= FALLS BACK AND SAYS SO. A typo in a link should not be an error page, and it should
// not silently show something else either -- somebody following that link believes they are looking at a
// filtered list.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function PatientsScreen(props: {
  capabilities: ScreenCapabilities;
  lists: WorklistsView;
  cohort: CohortView | null;
  /** A valid worklist key, or null for the unfiltered cohort. */
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
  page: number;
  scope: "practice" | "mine";
  sort: "registered" | "name";
  /** The registration console, rendered on the server and handed in as the drawer's contents. */
  registration: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { selectedList, patientId, query, page, scope, sort, registerOpen } = props;

  const go = useCallback((patch: Partial<{
    list: string | null; patient: string | null; q: string; page: number;
    scope: string; sort: string; register: boolean;
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
    };
    const sp = new URLSearchParams();
    if (next.list) sp.set("list", next.list);
    if (next.patient) sp.set("patient", next.patient);
    if (next.q) sp.set("q", next.q);
    if (next.page > 0) sp.set("page", String(next.page));
    if (next.scope !== "practice") sp.set("scope", next.scope);
    if (next.sort !== "registered") sp.set("sort", next.sort);
    if (next.register) sp.set("register", "1");
    const qs = sp.toString();
    startTransition(() => router.push(`/practice/patients${qs ? `?${qs}` : ""}`, { scroll: false }));
  }, [router, selectedList, patientId, query, page, scope, sort, registerOpen]);

  const worklist = selectedList ? props.lists.worklists.find(w => w.key === selectedList) ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Patients</h1>
          <p className="mt-0.5 text-[14px] text-gray-500">Search &bull; Register &bull; Continue Care</p>
        </div>
        {props.capabilities.mayCreate && (
          <button
            type="button"
            onClick={() => go({ register: true })}
            className="rounded-lg bg-[var(--cp-primary)] px-4 py-2 text-[14px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]"
          >
            + New patient
          </button>
        )}
      </div>

      {props.unknownList && (
        <p className="rounded-lg bg-[var(--cmp-surface-warning)] px-3 py-2 text-[12px] text-[var(--cmp-text-warning)]">
          <span className="font-semibold">&ldquo;{props.unknownList}&rdquo; is not one of this workspace&rsquo;s lists,</span>{" "}
          so the whole register is shown instead. The lists are:{" "}
          {props.lists.worklists.map(w => w.key).join(", ")}.
        </p>
      )}

      {props.summary && (
        <ContextBanner banner={props.summary.banner} onClose={() => go({ patient: null })} />
      )}

      <UniversalSearch
        // Remounted when the linked query changes, so the server's answer and the box agree.
        key={`q:${query}`}
        initialQuery={query}
        initial={props.initialSearch}
        canCreate={props.capabilities.mayCreate}
        selectedPatientId={patientId}
        onSelect={id => go({ patient: id })}
        onRegister={() => go({ register: true })}
        onSubmitQuery={q => go({ q })}
      />

      <WorklistTiles
        lists={props.lists}
        selected={selectedList}
        onSelect={key => go({ list: key })}
      />

      <div className={patientId ? "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]" : ""}>
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
        {patientId && (
          <div className="xl:sticky xl:top-4">
            <SummaryPanel
              summary={props.summary}
              summaryError={props.summaryError}
              family={props.family}
              capabilities={props.capabilities}
            />
          </div>
        )}
      </div>

      <Refusals
        refuses={props.lists.refuses}
        title="Not on this screen"
        blurb="What CPR-V5-006, its review or the comp asks for that this record cannot honestly support."
      />

      <RegistrationDrawer
        open={registerOpen && props.capabilities.mayCreate}
        // ?list=new was already resolved to "not a worklist" on the server, so closing simply drops the
        // register flag and whatever list is genuinely selected stays selected.
        onClose={() => go({ register: false })}
      >
        {props.registration}
      </RegistrationDrawer>
    </div>
  );
}
