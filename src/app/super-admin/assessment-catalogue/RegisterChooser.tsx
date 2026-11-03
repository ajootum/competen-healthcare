"use client";

import { useRef, useState } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import type { Family } from "@/lib/assessment/catalogue/families";
import type { TaxonomyDimension } from "@/lib/assessment/catalogue/classify";
import RegisterDialog from "./RegisterDialog";
import ImportWizard from "./ImportWizard";
import TemplateDialog from "./TemplateDialog";
import { btnGhost } from "./ui";

/**
 * Register instrument: the three ways in (ASMT-CATALOGUE-IMPORT-01, flexible registration).
 *   Create new             the lightweight identity form, content written in Checklist Studio afterwards
 *   Import existing        upload a workbook, preview and correct what was found, register Drafts, open in Checklist Studio
 *   Create from template   a Draft copied from a published instrument, with the provenance kept
 * Each ends in the same place: an ordinary Draft in the catalogue and Checklist Studio, governed like every other.
 */
type Mode = "choose" | "new" | "import" | "template";

const OPTIONS: { mode: Mode; title: string; lede: string; needs: string }[] = [
  { mode: "new", title: "Create new", lede: "Register the identity and classification now. Write the sections, items and scoring in Checklist Studio.", needs: "Catalogue management" },
  { mode: "import", title: "Import existing instrument", lede: "Upload an Excel workbook. Preview what was found, correct it, confirm which sheets belong together, and register editable Drafts.", needs: "Catalogue management, Checklist authoring to register" },
  { mode: "template", title: "Create from template", lede: "Start from a published instrument. The new Draft copies its content and keeps a link to where it came from.", needs: "Catalogue management, Checklist authoring" },
];

export default function RegisterChooser({ families, taxonomy, canAuthor, onClose }: { families: Family[]; taxonomy: TaxonomyDimension[]; canAuthor: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("choose");
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(mode === "choose", panel, onClose);
  const back = () => setMode("choose");

  if (mode === "new") return <RegisterDialog families={families} taxonomy={taxonomy} onClose={onClose} onBack={back} />;
  if (mode === "import") return <ImportWizard families={families} taxonomy={taxonomy} canAuthor={canAuthor} onClose={onClose} onBack={back} />;
  if (mode === "template") return <TemplateDialog families={families} taxonomy={taxonomy} canAuthor={canAuthor} onClose={onClose} onBack={back} />;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-teal-950/40 p-4">
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="chooser-title" tabIndex={-1} className="w-full max-w-3xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 id="chooser-title" className="text-lg font-bold text-gray-900">Register instrument</h2>
            <p className="mt-0.5 text-[12.5px] text-gray-700">Three ways in, one result: a Draft with a permanent code, edited in Checklist Studio and published through independent review.</p>
          </div>
          <button type="button" className={btnGhost} onClick={onClose} aria-label="Close">{"×"}</button>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-3">
          {OPTIONS.map(o => (
            <button key={o.mode} type="button" onClick={() => setMode(o.mode)}
              className="flex min-h-[9rem] flex-col rounded-xl border border-gray-200 bg-white p-4 text-left hover:border-teal-400 hover:bg-teal-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
              <span className="text-[15px] font-bold text-gray-900">{o.title}</span>
              <span className="mt-1 flex-1 text-[12.5px] text-gray-700">{o.lede}</span>
              <span className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-600">Needs: {o.needs}</span>
            </button>
          ))}
        </div>
        {!canAuthor && <p className="px-5 pb-4 text-[12px] text-gray-600">You hold catalogue management without Checklist authoring: you can create an identity and prepare an import, and an author registers the imported content.</p>}
      </div>
    </div>
  );
}
