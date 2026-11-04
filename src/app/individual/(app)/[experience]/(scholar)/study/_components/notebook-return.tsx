"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { experienceHref } from "@/lib/individual/experiences";
import { notebookBackPath, parseNotebookReturn } from "@/lib/individual/scholar/notebook-practice";
import { focusRing } from "../../../../../_components/chrome";

// SALE-2026-11 R3 / SALE-12: moving between the Notebook, lessons and questions without losing the place. A link out of the Notebook
// carries `nb` (the note the learner left from, or "1"); any study page showing StudyNav then offers the way back to that note. Reads the
// address only: nothing is stored and nothing is sent anywhere.

const subscribe = (on: () => void) => { window.addEventListener("popstate", on); return () => window.removeEventListener("popstate", on); };
/** The address's query, read on every render (a client navigation re-renders the page), "" on the server. */
const useSearch = () => useSyncExternalStore(subscribe, () => window.location.search, () => "");

export function NotebookReturn() {
  const sp = new URLSearchParams(useSearch());
  const r = parseNotebookReturn(sp.get("nb"));
  if (!r || sp.get("view") === "notebook") return null;
  return (
    <p className="mb-3" data-testid="notebook-return">
      <Link href={experienceHref("scholar", notebookBackPath(r))}
        className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3.5 text-[13.5px] font-semibold text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
        <span aria-hidden>←</span> Back to your Notebook{r.note ? " (the note you came from)" : ""}
      </Link>
    </p>
  );
}

