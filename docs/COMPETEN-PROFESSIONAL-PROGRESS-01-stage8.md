# COMPETEN-PROFESSIONAL-PROGRESS-01 — Professional Stage 8: Progress, Career Intelligence & Document Studio (build record)

Owner GO (25 Oct 2026): PR1–PR7 (PR7 Document Studio, DOCX + PDF, is P0), development, integration, staging migrations
and focused staging acceptance. **Production migration, deploy, document-sharing activation and public access need a
separate owner GO.** Individual is OFF in production.

## Migration

| # | File | Depends on | State |
|---|---|---|---|
| 550 | `supabase/migrations/550-individual-professional-progress-and-documents.sql` (APPLY WHOLE, plpgsql) | 007 | staging only (record in `docs/evidence/COMPETEN-PROFESSIONAL-PROGRESS-01/`) |

550 adds the only Stage 8 stores (GO s3):
- **Progress preference.** One row per person.
- **Saved views.** Editable and deletable.
- **Next-step decisions.** Append-only.
- **Requested progress snapshots.** Keys and counts only; immutable.
- **Document drafts.** Presentation choices and record keys, never copies. A CHECK refuses a record entry carrying text.
- **Export metadata.** Append-only. The file is never stored.

It names no other stage's table. RLS is own-row SELECT only. The append-only function keeps the cascade path.

## Dependencies added

- `pdf-lib@1.17.1` (exact). The repository had no PDF generator: `unpdf` only extracts text from PDFs, and the existing print pages rely on the browser. It is pure JavaScript, uses the standard fonts, and has no native or filesystem font loading, so it bundles cleanly on Vercel.
- `docx` moved from devDependencies to dependencies. It was already in the lock file.
- `audit-gate` PASSED.

## Code

| Piece | Where | Reuses |
|---|---|---|
| Progress interpretation: overview, timeline and periods, competency columns, learning, career, next steps (pure) | `professional/progress-intel.ts` | Stage 6 `loadEvaluationInput`, Holdings `progress-model` Measure, Stage 4 `cpd-requirements.summarise` |
| Progress reads | `professional/progress-sources.ts` | profile (450 + context history), Stage 6 snapshots, offered catalogue (Domain, CPU) |
| Progress stores | `professional/progress-store.ts`, `api/individual/professional/progress` | — |
| Progress views | `(professional)/progress/page.tsx` (?view=), `_components/professional/progress-views.tsx` | existing Progress sections kept in Overview, Learning and Competencies |
| Document types and templates (governed, versioned) | `documents-config.ts`, action `documents` on `/api/hq/individual/config` | WCE lifecycle (publish, rollback, audit) of the Individual policy, the LCPD precedent |
| One model → preview, DOCX, PDF | `documents/model.ts`, `documents/docx.ts`, `documents/pdf.ts`, `_components/DocumentPreview.tsx` | `docx`, `pdf-lib` |
| Record catalogue from owners | `professional/document-sources.ts`, `documents/trust.ts` | profile + 451, CPD, Learning, evidence, Stage 5, C5 via Stage 5's adapter, Passport, Scholar study, Stage 6 |
| Drafts and exports | `professional/document-store.ts`, `document-compose.ts`, `api/individual/professional/document-drafts{,/export,/ai}` | Holdings AI gateway (`askProfessionalAssistant`) for an optional summary |
| Studio | `(professional)/progress/documents` (from Progress and from the Passport page) | — |
| No-Code Document Template Studio | `/super-admin/individual/documents` (nav: Individual Policy → Document Templates; `spaces.ts`: `hq.individual.config.manage`) | Individual policy publish bar; invented sample records only |
| Policies (8) | `professional/progress-policy.ts` | Individual policy store |

## Boundaries

- **Preview before export, by construction.** The export carries the preview's sha256 and is refused if the composed content changed.
- **One model.** DOCX and PDF render the same model; a unit test and the staging journey compare their text line by line.
- **Only chosen records.** Record keys are checked against the person's own catalogue on save. Unselected records, private reflections, AI conversations and default-hidden facts (registration numbers) never appear.
- **Meaning from the owner.** Templates word a record's meaning; they cannot decide it. A label that is not for an independent decision may not claim verification, and no photographs are ever fetched.
- **No score, no compliance claim.** Volume is never called demonstrated learning. A CPD requirement is "recorded", never met.
- **Next steps open their owning module.** Nothing is created, purchased or requested from them.

## Known limits

- **PDF text encoding.** The standard PDF fonts encode Windows-1252 only. A character outside it prints "?" in the PDF; the DOCX keeps it, and the preview warns before export. Follow-up: embed a Unicode font.
- **Passport launch.** The Studio accepts `origin=passport` (and only the person's own link). At Stage 7's request, the "Create a document" link on the Passport page and pre-selection through `loadPassportSelection` / `loadPassportItems` are added after #130 merges.

## Merge order

After #127 (Stage 6, merged). Independent of Stage 7 (#130); whichever merges second wires the other's read.
