# CPR-MOB-001 — the responsive design system, frozen

**Status:** frozen 2026-08-17, at the close of phase 10.
**Enforced by:** `scripts/practice-responsive-harness.ts`. This document is not decoration — the
harness reads the surface list below out of this file and checks it against the tree, so a rename
that is not recorded here turns the suite red.

Phase 10 of the specification reads: *"Freeze responsive design system and prohibit page-specific
exceptions without design-system review."* What follows is what is frozen, what an exception costs,
and — stated plainly, because a freeze that overclaims is worse than none — what remains unverified.

---

## 1. The one breakpoint

Practice has **one** responsive edge: Tailwind's `md`, at **768px**. The JS side asks
`(max-width: 767px)` or `(min-width: 768px)` — the two sides of that same edge — and nothing else.

| Mode | Width | Face |
|---|---|---|
| Mobile | < 768px | the `max-md:` / `md:hidden` face |
| Tablet | 768–1199px | the desktop face — see the correction below |
| Desktop | ≥ 1200px | unchanged, and pixel-identical to before this arc |

**⚠ The tablet row is more precise than "fewer columns", and the difference was measured rather than
assumed.** Tailwind's defaults are in force (no config, no `--breakpoint-*` overrides), so `lg` is
1024 and `xl` is 1280 — and the spec's 1200px desktop edge **does not exist in the CSS**. The band
therefore splits:

- **768–1023** — the `lg:` and `xl:` grids collapse to one or two columns. This genuinely is the
  reduced-column face s15 asks for, and it arrived by where the earlier freezes put their
  breakpoints, not by work done in phase 8.
- **1024–1199** — column counts are **identical to desktop** (6-up KPI rows, 5-up pathway cards,
  the 2-column Session split). s15 is satisfied in spirit — the hierarchy is desktop's — but nothing
  is reduced here, and claiming otherwise would be a freeze that describes a product that does not
  exist.

Closing that gap would require a 1200px edge, which is a **design-system change** under §4, not a
page-level edit. It has not been made. The one lever that reaches 1024–1199 alone was examined for
the waiting queue and rejected on measurement: it would have put card rows where the name column is
*widest* and kept the dense row where it is *tightest*.

A page that decides its own content "really needs" 820px has made the CSS face and the JS face
disagree about the same screen. That is not a style preference — it is how a focus trap ends up
running against a `display:none` element. Pins 4b and 4d enforce it on the JS and CSS sides
respectively, because an invented breakpoint written as `min-[820px]:` is the same exception in a
place a `matchMedia` scan cannot see.

## 2. The idiom

- **One payload, two faces.** Mobile faces are consts derived from the *same* server payload as the
  desktop markup, rendered as `md:hidden` siblings beside `max-md:hidden` desktop elements. There is
  no mobile route, no mobile fetch, and no second copy of a rule.
- **DOM order is visual order is focus order.** A screen reader and a keyboard walk the DOM;
  reordering with CSS makes them walk a different screen from the one that is visible. Four
  `order-*` utilities exist against this rule, all inside a single control cluster and all
  `max-md:`-scoped, each with a recorded reason. That bound is the rule: an `order-*` that applies at
  desktop or unconditionally reorders a whole page differently for a mouse and a screen reader,
  permanently, with no width to blame. Pin 4e enforces the bound rather than the absence.
- **Touch targets are sized by what is pointing, not by how wide the window is.** Below `md` that is
  `max-md:`; from 768 up it is `pointer-coarse:`. Sizing the tablet band by width would grow targets
  in a 1000px-wide *desktop window*, where a mouse is pointing and compact is correct, and would
  still miss an iPad held at 1200+. This matters most in the shell: the bottom nav is `md:hidden`, so
  between 768 and 1199 **the sidebar is the only navigation**, and it was mouse-sized.
- **`matchMedia` only where something that is *state* must change by width.** A focus trap, a scroll
  lock or an open sheet does not read a media query, so anything `md:hidden` that also holds state
  has to ask. Everything that is merely display is left to CSS. Every call site asks one or other
  side of the md edge — pin 4b — and no page may invent a different one in CSS either, which is
  pin 4d.
- **Shared primitives, not per-page reinventions** — `_responsive/CardList`, `FilterSheet`,
  `FullScreenSheet`, `SectionTabs`, `StickyPrimaryAction`, `use-body-scroll-lock`, and the single
  `use-below-md` hook.
- **Touch targets come from tokens** — `--cp-touch` (44px), `--cp-touch-primary` (48px),
  `--cp-safe-bottom`, `--cp-bottomnav-h`. Never a hard-coded height. CSS does not throw on an
  undefined custom property, so a deleted token would silently turn a 44px target into a 0px one;
  pin 1c is what catches that.
- **16px minimum on inputs below md** (`max-md:text-[16px]`), because iOS zooms the whole viewport
  on focus below it.
- **The 24-hour clock is product law.** No `type="time"`, no `type="datetime-local"`. The native
  control draws the operating system's locale, so a 24-hour product renders "11:00 AM" on half the
  machines that open it; and a `datetime-local` value written to a `timestamptz` is read in the
  connection's zone, which stored a Kampala 14:30 as 14:30 UTC. Text entry with a compiled pattern,
  and the **server** composes the instant.

## 3. The frozen surfaces

Each of these carries a mobile face and is covered by the harness:

- `calendar` — Planner: Day, Week, Month, Agenda
- `today` — Current Session
- `encounters` — the encounter console and its workspaces
- `patients` — patient list and patient record
- `follow-ups` — follow-up capture and queue
- `documents` — library, templates, shared, viewer
- `intelligence` — Practice Intelligence
- `reports` — report landing and viewer
- `home` — the practice command centre

## 4. What an exception costs

There is no route to a page-specific breakpoint, a page-local card fallback, or a second
`useBelowMd`. A surface that genuinely cannot be expressed in the idiom changes **the design
system** — the shared primitive or the token — so that every surface gains the capability at once,
and this document and the harness change in the same commit. That is the **design-system review**
phase 10 asks for, and it is deliberately the path of least resistance only for real needs.

Adding a native picker anywhere in the app is not an exception available at any price; see §5.

## 5. The clock — paid off inside Practice, ratcheted outside it

The scan at freeze found **17 native pickers inside Practice**. **All 17 are now gone** (2026-08-17),
so pin 2a is a **flat ban**: no surface under `src/app/practice` may hold a `type="time"` or
`type="datetime-local"` at all.

What the swap turned out to involve, because it was not the mechanical job it looked like:

- **`activity/ActivityConsole.tsx`** was a data bug, not a display one. It prefilled from
  `new Date().toISOString().slice(0,16)` — UTC's wall clock poured into a control the browser draws
  as local time, so in Kampala its "now" default sat three hours behind — and then composed the
  instant in the *browser's* zone. It now sends a date and a 24-hour time, and **the route composes**
  in the practice's timezone, refusing by name rather than guessing.
- **`offline/OfflineReader.tsx`** composed real instants, but in the *device's* zone. The day pack
  already carries the practice timezone, so the device now composes correctly with no network. Three
  copies of a device-clock prefill helper collapsed into one practice-zone helper.
- **The eleven `type="time"` fields** under `setup/availability*` stored wall-clock strings and
  composed no instant — but the swap was still not free. `type="time"` *guaranteed* a valid `HH:MM`;
  a text field does not, and those forms' `toMinutes()` helper is not a parser: `toMinutes("0900")`
  returns **54000** and `toMinutes("9am")` returns **0**. The engines only check ordering
  (`end > start`), so `09:00`→`1300` would have passed and written a session ending at minute 78000.
  The browser's guarantee was load-bearing. Every converted field now carries an `HHMM_RE` guard with
  a sentence naming the format.

**One control, one definition.** `TimeInput` (`src/components/ui/wall-clock.tsx`) carries the pattern,
the keypad, the validation-bubble text and the touch sizing; `HHMM_PATTERN` lives once in
`practice-time.ts` and `HHMM_RE` is compiled *from that same string*, so the attribute and the
validator cannot drift. Six screens had hand-copied that pattern, which is how its backslashes were
once eaten — leaving four inputs that rejected the very example their tooltip gave.

### Still outstanding

- **Six screens still hand-write the pattern** (calendar, encounters, patients). They are safe — pin
  3b compiles and executes every `pattern=` in the app — but they should move to the shared control.
  Not done here because they sit behind 64- and 132-pin freeze harnesses.
- **No server-side minute-range validation.** `Number(body.startsMinute)` is taken bare and no engine
  bounds it, so a non-browser caller can still write minute 78000. `addSession`, `editSession`,
  `duplicateSession` and `commitScheduleChange` each need `0 <= m <= 1439`.
- **13 native pickers remain outside Practice** (admin, assessor, educator, healthcare-worker,
  office-governance, super-admin, supervisor), held as a ratchet in the harness. The `datetime-local`
  ones carry the same instant-composition hazard ActivityConsole's did and **nobody has traced what
  their values reach** — unexamined, not safe. **Owner's decision (2026-08-17): scheduled for roughly
  two weeks out, around 2026-08-31.**

## 6. Performance — satisfied by construction

§18 asks pages to lazy-load secondary analytics and heavy charts, and to avoid large chart payloads
on mobile networks. **Practice has no chart library to lazy-load.** Its visualisations are hand-rolled
SVG, and across all of its files the only bare modules imported are `next` and `react` — zero
third-party runtime weight. There was nothing to fix, which is exactly why it is now pinned: the day
someone reaches for a charting package, pin 5-perf goes red. Not to forbid it, but so that
lazy-loading is a decision taken when it becomes necessary rather than discovered later on a clinic's
mobile connection.

## 7. What is NOT verified

A green suite is not a device pass, and this section exists so nobody reads it as one.

The specification's §20 matrix — **360×640, 390×844, 430×932, 768×1024, 1024×768, ≥1200px, 200% text
scaling, and keyboard-only operation** — is a set of statements about rendered pixels behind a
sign-in. The harness has no browser and no session; it proves the layer underneath (tokens resolve,
no page invented a breakpoint, the idiom is implemented once, the clock and flush rules hold). Every
mobile phase of this arc ended at the same wall: **the signed-in human pass at each width is
outstanding, and is the owner's to make.** It has not been done, and nothing in this repo should be
read as claiming otherwise.
