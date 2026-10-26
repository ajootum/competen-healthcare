import { experienceHref } from "@/lib/individual/experiences";
import { FORMAT_LABEL, FORMAT_OF, UNIT_OF } from "@/lib/individual/scholar/config";
import { qualitySummary } from "@/lib/individual/scholar/extract";
import type { MaterialRow } from "@/lib/individual/scholar/store";
import type { LibraryRow } from "./library-list";

// One material as a Library row: what is true of it, in the words the Library has always used (format, units,
// sections, date added, the context it was uploaded in, and a partial read said plainly). Pure.

const TILE: Record<string, string> = { pdf: "PDF", docx: "DOCX", pptx: "PPTX", text: "TXT" };

export function libraryRow(m: MaterialRow, opts: { quality?: Parameters<typeof qualitySummary>[0] | null; stamp?: string | null } = {}): LibraryRow {
  const unit = UNIT_OF(m.mimeType);
  const format = FORMAT_OF[m.mimeType];
  const q = opts.quality ?? null;
  const partial = q ? qualitySummary(q).partial : false;
  const meta = [
    FORMAT_LABEL[format],
    m.pageCount !== null ? `${m.pageCount} ${unit}${m.pageCount === 1 ? "" : "s"}` : null,
    `${m.chunkCount} section${m.chunkCount === 1 ? "" : "s"}`,
    "Private",
    `added ${new Date(m.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
    opts.stamp ? `while studying ${opts.stamp}` : null,
  ].filter(Boolean).join(" · ");
  return {
    id: m.id, title: m.title, href: experienceHref("scholar", `study/${m.id}`), tile: TILE[format] ?? "DOC", meta,
    warning: partial ? `Partly read: ${q!.emptyUnits.length} ${unit}${q!.emptyUnits.length === 1 ? "" : "s"} without readable text` : null,
  };
}
