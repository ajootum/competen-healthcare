# COMPETEN-SCHOLAR-HFE-REDESIGN-01: the integrated Scholar experience

| | |
|---|---|
| **Status** | Built on `scholar/hfe-redesign`, PR against `main`. **No migration, no flag, no new route, no new API.** |
| **Visual spec** | The agreed prototype `competen-scholar.html` (2026-10-26). Owner standing rule: an uploaded HFE mock-up is the visual spec. |
| **Functional base** | Scholar stages 1-8 as built and accepted (`docs/COMPETEN-SCHOLAR-PRODUCT-ARCHITECTURE.md`). Nothing was re-audited and no stage's behaviour changed. |

## What changed

| Area | Change | Where |
|---|---|---|
| Shell (both experiences) | Prototype header (76 px, brand, switcher, "Individual account", avatar + name to Profile & history), 236 px sidebar, sidebar foot. Structure stays shared so the two shells cannot drift. | `(app)/[experience]/layout.tsx`, `_components/ShellNav.tsx`, `_components/chrome.tsx` |
| Scholar palette | Prototype ink, line, canvas and teal, scoped to `.cmp-scholar`. Tailwind's gray scale is re-pointed there, so every existing Scholar panel takes the palette without being rewritten. Text greys keep 4.5:1 or better. Scholar accent `#087F98` (4.7:1). | `globals.css`, `experiences.ts` |
| Page heading | Prototype eyebrow / title / intro, and the shell's page action at its right. Scholar's action is the AI help switch, read once by the layout from the person's own consent. | `chrome.tsx` `PageHeader`, `_components/Dialog.tsx` `ShellAction` |
| AI help switch | Opens a dialog holding the **existing** `ConsentPanel` unchanged: notice, version, legal links, one-click withdrawal. Also on Settings ("Privacy & AI controls") and the Library ("Manage consent"). | `study/_components/shell-pieces.tsx` |
| Learning spaces | Tabs Library, Learn, Revise, Apply, Evaluate, Progress, each a real page that already existed. Words and order are configuration (`spaces.ts`), read by the tabs and every space heading. | `lib/individual/scholar/spaces.ts`, `StudyNav.tsx` |
| Eight-stage journey | Join, Upload, Classify, Learn, Revise, Apply, Evaluate, Progress, as a guide in a dialog (sidebar foot, Home). It gates nothing. Replaces the old six-step strip (Upload/Understand/Assess/...), which predated the canonical taxonomy. | `spaces.ts` `SCHOLAR_STAGES` |
| Home | The study space: hero (resume the latest active learning session, or upload first), cards due, Apply, Evaluate, recent material, the guide. Notices and the governed "not yet available" list stay. | `study/_components/home.tsx` |
| Library | Search (browser-side filter of what the server already shows), "Mapping suggestions · n" (proposed links per material, each linking to the material where they are decided), "+ Upload material" (the existing upload form in a dialog; `#upload` opens it), Classify notice, programme and AI cards. Collections, ask-across-library and erase-all unchanged. Learn sessions moved to the Learn tab, where they already were. | `study/page.tsx`, `library-list.tsx`, `library-rows.ts` |
| Formative notices | "Formative learning only · Private to you · Not verified clinical competence" on Revise, Apply, Evaluate and Progress, keeping each page's existing wording beside it. | the four space pages |

## Decisions taken where the prototype and frozen rules meet

1. **Mobile navigation stays the bottom bar.** The prototype turns the sidebar into a top scroll row under 650 px. CPR-MOB-001 (one `md` edge, `pointer-coarse` touch targets, a bottom bar of at most five) is frozen, so the mobile shell keeps its bottom bar and the prototype's look applies from `md` up.
2. **Professional is not redesigned.** It shares the new shell structure and heading; its palette, accent and pages are unchanged.
3. **Prototype copy that would overclaim was adjusted.** Classify is not automatic (analysis runs when the learner asks, with AI help on), so the Library says so. Prototype sample data, scripted AI and the "review notes" bar are prototype-only and not built.
4. **The prototype's genuine gaps stay governed absences:** OCR/transcription, audio, clinically reviewed shared cases and question banks, OSCE and adaptive exams. They remain in the registry's `planned` list.

## Verification

- Unit: `spaces.test.ts` (tab routing, eight-stage order, formative wording) plus `foundation.test.ts` and `access.test.ts`.
- `scripts/individual-foundation-harness.ts`: ALL GREEN (74/0).
- `scripts/scholar-upload-harness.ts` over HTTP against a staging-pointed dev server: ALL GREEN (13/0). W1/W2 prove the upload form is still in the Library's HTML with `id="upload"`. The AI group PENDs on that server for want of published consent documents, which is unrelated to this change.
- Browser, staging fixture student (`scripts/scholar-hfe-fixture.ts`, staging only): Home, Library, upload and AI dialogs, Learn, Revise, Apply, Evaluate, Progress, Settings, Passport at 1440 px and 375 px.
