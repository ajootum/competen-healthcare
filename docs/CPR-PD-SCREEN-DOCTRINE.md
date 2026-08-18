# Product Director screen doctrine

**Status:** derived from building CPR-PD-002 Mission Control, 17–18 August 2026. Every rule below was
paid for — by a defect found, an owner's screenshot, or a measurement that contradicted a guess. Build
the next PD screen against this, not against a memory of the last one.

---

## 1. The data rules

**The registry gates the LOADER, not the component.** `mayRender(metricId)` is called in the loader
before a figure enters the payload, so an absent metric never reaches a component and no component can
bypass the rule by forgetting to ask. Gating in the view means every new view is a new chance to forget.

**A metric with no registry entry does not render.** `mayRender` returns false for an unregistered id
as well as an absent one — two different sentences to a developer, one answer to a reader. Growing the
registry is how a figure earns permission to exist.

**Absence sentences live in the registry, written once.** Thirty screens must not each invent a way of
saying the same thing is missing. `absenceSentence(metricId)` is the only source.

**Name the missing fact, never "coming soon".** *"No incident store exists"* and *"no open incidents"*
render identically as a zero, and only one of them is a reassurance. Say which.

**Null is not zero and a failed read is not an empty result.** A count that could not be read renders
"could not be read — that is not zero". A negative claim ("none suspended") requires a complete scan
behind it; on a partial read, say the scan was partial.

**"Not enough data", never a delta of 0%.** PD-002 §3: do not show a comparison when the period or the
data quality is insufficient.

**Derive from an existing loader before writing a new read.** `pd-operations.ts` makes zero database
calls — it composes `loadPracticeOps()`. Two surfaces then cannot print different totals, and it adds
no new site for `plane-boundary-harness` to judge. Reach for the allowlist only when composition
genuinely cannot answer.

**Count the LIVE estate in a headline; retired is context.** An archived practice takes no bookings and
cannot be opened. Define the RETIRED list and take live as the complement, so a lifecycle state added
tomorrow appears in the headline and gets noticed rather than silently vanishing.

**One page may hold two clocks, each labelled.** Absolute freshness is GMT, because it must mean the
same thing to two readers in different countries. A day pulse is the *market's* local time (PD-002 §5).
Never mix them silently.

## 2. The honesty rules for visuals

**Adopt the comp's SHAPES, never its NUMBERS.** The approved design shows MRR, 99.96% health and a
seven-stage funnel. Render the same component in the honest state: eight service rows all reading
*Unknown*, the commercial grid reading *Not available*, the funnel labelled *Practices, not
practitioners*. When a producer arrives, the shape is already there for the figure to land in.

**Colour is granted only to a real value.** The tint on a KPI tile is conditional on the figure actually
being a measurement, so an unmeasured metric cannot wear a reassuring colour. Enforce it structurally,
not by remembering.

**Never colour alone.** A status dot carries its word beside it. Severity carries a badge with text.

**No implementation detail on a director surface.** No UUIDs, no saga step names, no migration numbers
(PD-001 §3, PD-002 §4). Those belong in Technical Operations and may be capability-restricted.

## 3. The density rules

**Explanations belong behind a real `<details>`, not in the layout.** The sentence explaining a figure
is not decoration and must not be cut — but three lines of prose under every KPI is how a six-card row
becomes a scroll. `title` alone is not acceptable as the carrier: it is unreachable by keyboard and
unread by a screen reader.

**Chrome goes in the header band, not in a page row.** A search launcher with its own right-aligned row
costs ~60px of empty page above the fold.

⚠ **And do not fix spacing by overlapping.** The first attempt made that row sticky with a negative
margin; it closed the gap and put the button on top of the freshness stamp. A control that overlaps
content is not a saving. Only a screenshot caught it.

**A header's right column can carry more than one fact.** *When* the page was read and *who* it was
read as, stacked, instead of a full-width bordered card for one line.

**Compacting must not remove a control.** The Acting-as switcher kept its switch. Hiding an authority
affordance to save 40px is a bad trade at any size.

## 4. The process rules

**Break-test every pin — and check the test actually ran.** Twice in this arc a break-test stayed green
because the substitution never matched, not because the guard was absent. A green break-test is a claim
about the test as much as the code.

**Verify an agent's numbers rather than accepting them.** One reported two green harnesses truthfully
and was then interrupted mid-break-test, leaving `if (true) return null;` in a live guard. The numbers
were measured before the guard was disabled.

**Test the obvious explanation before recording it as the root cause.** "A killed run leaves stale state
that poisons the next one" fitted every fact of the booking-rules failure and was wrong; manufacturing
that state proved it recovered cleanly.

**The dev server can report a defect that no longer exists.** A stale Turbopack cache replayed a fixed
compile error; Next's dev indicator overlapped a real control and read as a rendering bug. When dev
disagrees with `tsc` and a production build, dev is usually the one lying.

**Measure contrast, do not judge it.** The active sidebar fill looked fine and was 2.37:1 — under
WCAG 1.4.11's 3:1 for a state indicator. "Not colour alone" and "the colour is discernible" are two
different rules and only one was being met.

## 5. What no PD screen can verify about itself

Every acceptance criterion that is a statement about a **rendered, signed-in session** — landing,
collapse surviving a refresh, hover and focus labels on a collapsed icon, off-canvas mobile, direct-URL
refusal at each width — is outside what a source harness or a loader test can reach. Say so on the
harness banner rather than letting a green suite imply it. That walk-through is the owner's.
