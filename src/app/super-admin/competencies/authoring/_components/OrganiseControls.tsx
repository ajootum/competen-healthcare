"use client";

import { useId, useState } from "react";

// FRAMEWORK-DESIGN-STUDIO-02 S4: the presentational controls for Areas and organisational moves in the explorer.
// Nothing here posts: StudioWorkspace owns the one place that talks to /api/hq/competency/authoring and passes callbacks.
// Every drag has a keyboard / touch alternative here: a select plus a Move button (a select that moved on change would move
// on every arrow key press), and Move up / Move down on every Area (the buttons come from StudioWorkspace).

const field = "min-w-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const small = "inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-[12.5px] font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";

/** "Move to…" for one thing: pick a destination, then press Move. */
export function MoveSelect({ label, options, busy, onMove, className = "" }: { label: string; options: { value: string; label: string }[]; busy: boolean; onMove: (value: string) => void; className?: string }) {
  const [v, setV] = useState("");
  const id = useId();
  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <select id={id} value={v} onChange={e => setV(e.target.value)} disabled={busy || !options.length} className={`${field} flex-1 py-1 text-[12.5px]`}>
        <option value="">{label}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button type="button" className={small} disabled={busy || !v} aria-label={`${label}: confirm the move`} onClick={() => { const x = v; setV(""); onMove(x); }}>Move</button>
    </div>
  );
}

/** Create an Area. The server refuses a duplicate name (case-insensitive) and answers in words. */
export function AddAreaForm({ busy, onCreate }: { busy: boolean; onCreate: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState("");
  return (
    <form className="flex items-center gap-1.5" onSubmit={async e => { e.preventDefault(); if (name.trim().length < 2) return; if (await onCreate(name.trim())) setName(""); }}>
      <label htmlFor="area-new" className="sr-only">New Area name</label>
      <input id="area-new" value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="New Area, e.g. Clinical Practice" className={`${field} flex-1`} />
      <button type="submit" className={small} disabled={busy || name.trim().length < 2}>Add Area</button>
    </form>
  );
}

/**
 * One Area's heading: its name and domain count, Rename and Delete (empty Areas only), and the Move up / Move down pair.
 * `rowProps` are the reorder row props of the Areas list and `grip` its pointer-drag handle (drag to reorder); `organise` false = a plain heading.
 */
export function AreaHeading({ name, count, organise, busy, rowProps, grip, buttons, onRename, onDelete, headingId }: {
  name: string; count: number; organise: boolean; busy: boolean; headingId: string;
  rowProps?: React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
  grip?: React.ReactNode; buttons?: React.ReactNode;
  onRename: (name: string) => Promise<boolean>; onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  return (
    <div {...(organise && !renaming ? rowProps : {})} className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-y border-gray-200 bg-gray-50 px-3 py-2 ${organise && !renaming ? rowProps?.className ?? "" : ""}`}>
      {organise && !renaming && grip}
      {renaming ? (
        <form className="flex min-w-0 flex-1 items-center gap-1.5" onSubmit={async e => { e.preventDefault(); if (draft.trim().length < 2) return; if (await onRename(draft.trim())) setRenaming(false); }}>
          <label htmlFor={`${headingId}-rn`} className="sr-only">Area name</label>
          <input id={`${headingId}-rn`} autoFocus value={draft} onChange={e => setDraft(e.target.value)} maxLength={120} className={`${field} flex-1`} />
          <button type="submit" className={small} disabled={busy || draft.trim().length < 2}>Save</button>
          <button type="button" className={small} onClick={() => { setRenaming(false); setDraft(name); }}>Cancel</button>
        </form>
      ) : (
        <>
          <h3 id={headingId} className="min-w-0 flex-1 break-words text-[12.5px] font-bold uppercase tracking-[0.1em] text-gray-800">{name} <span className="font-normal normal-case tracking-normal text-gray-500">· {count} {count === 1 ? "domain" : "domains"}</span></h3>
          {organise && (
            <span className="flex flex-wrap items-center gap-1">
              <button type="button" className={small} disabled={busy} aria-label={`Rename the Area ${name}`} onClick={() => { setDraft(name); setRenaming(true); }}>Rename</button>
              <button type="button" className={small} disabled={busy || count > 0} aria-label={`Delete the Area ${name}`} title={count > 0 ? "Move its domains out first. Only an empty Area can be deleted." : "Delete this empty Area"} onClick={onDelete}>Delete</button>
              {buttons}
            </span>
          )}
        </>
      )}
    </div>
  );
}
