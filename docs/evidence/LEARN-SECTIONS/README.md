# LEARN SECTIONS HFE: evidence (4 Nov 2026)

## What this covers

The owner asked to "give it the same treatment [to] any other section… we are looking to improve HFE and reading ease". This follows #281 and redesigns the inside of every Learn section.

## How it was run

- **Server:** this branch's dev server against **staging**.
- **Learner:** the fixture learner. Credentials were read from the fixture file and never printed.
- **Lesson:** lesson 2 "Eye care" of *Essential Nursing Care of the Critically Ill* (session `2b9fccd2…`).
- **Walk script:** `LEARN-SECTIONS-walk.ts` in the coordinator's shared notes folder.
- **Method:** each section was opened and photographed at 1440 and 390, `before/` on main d26f22dc and `after/` on this branch. The walk then opened every section at once and ran the checks at 1440, 820 (touch), 390 (touch) and 200% zoom.

## Results (`after/walk-results.txt`): 10 PASS, 0 FAIL

- **Axe:** wcag2a/2aa/21aa on `<main>` with every section open, **0 violations** at 1440, 820 and 390 (`after/axe-*.json`).
- **Horizontal overflow:** none at 1440, 820, 390 or 200% zoom (720 CSS px).
- **Touch targets:** every control inside the lesson's sections is at least 44 px on a coarse-pointer (touch) browser at 820 and 390.
- **Baseline:** the same gates also passed on main (`before/walk-results.txt`). This change keeps them at zero while improving reading and hierarchy. It does not fix a failing gate.
- **Console:** 0 errors.
- **Reading type for the notes:** 15.5 px with 26.35 px line height (1.7), at about 59 characters per line at 1440 and about 38 at 390. The measure is capped at 68ch.

## Dev-server notes

These came up in earlier runs and are not part of the result above:

- One run, while I was editing, hit "Manifest file is empty" / "Cannot read properties of undefined (reading 'call')" during on-demand compilation.
- One run hit a staging Supabase connect timeout.
- One run hit the known Windows errno −4094 `.next` lock.

Each cleared on a quiet machine or a clean `.next`. The final run above is clean.

## Screenshots (`before/` and `after/`, each at `1440-` and `390-`)

| # | Section |
|---|---|
| 01 | Your notes · N sections (the main change) |
| 02 | View sources |
| 03 | Practise this lesson (Quiz chosen) |
| 04 | Quick check |
| 05 | Your previous checks |
| 06 | Your notes on this lesson |
| 07 | Lesson settings (unchanged) |
| 08 | Activities row |
| 09 | Earlier and later lessons |
| 10 | Lesson navigator and This lesson's sources |
