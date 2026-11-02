import { Unreadable } from "@/app/individual/_components/chrome";
import { EmptyLine, RowList } from "../_module/module-parts";
import type { EvidenceSection } from "./competencies-view";

// Read-only rows of the Passport, grouped by competencies-view.evidenceView. Every row carries its evidence label in
// words. Nothing here edits, shares or removes anything: that stays in the Passport and in My Learning.

export function EvidenceSections({ sections }: { sections: EvidenceSection[] }) {
  return (
    <div className="space-y-5">
      {sections.map(s => (
        <div key={s.id}>
          <h3 className="mb-2 text-[14.5px] font-bold text-gray-900">{s.title}</h3>
          {s.state === "unreadable" ? <Unreadable what={s.title.charAt(0).toLowerCase() + s.title.slice(1)} />
            : s.state === "items" ? (
              <RowList>
                {s.rows.map(r => (
                  <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold text-gray-900">{r.title}</p>
                      {r.detail && <p className="text-[12.5px] text-gray-600">{r.detail}</p>}
                    </div>
                    <p className="text-[12.5px] font-semibold text-gray-800">{r.label}</p>
                  </li>
                ))}
              </RowList>
            )
              : <EmptyLine>{s.text}</EmptyLine>}
        </div>
      ))}
    </div>
  );
}
