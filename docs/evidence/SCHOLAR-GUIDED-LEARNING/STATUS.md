# SCHOLAR-GUIDED-LEARNING-01: STATUS

- **Branch:** `scholar/guided-learning-01`
- **Worktree:** `C:\Users\elish\Documents\Competen\competen-guided`
- **Base:** main 7df93583 (includes #194-#199)
- **Owner instruction:** "Guided Learning, Navigation & Performance Improvement" (31 Oct). Smallest safe implementation. Reuse Learn, Classify, Knowledge, Research, Personal AI, saved sessions and allowance. No new subsystem, no unnecessary migration, no new governance layer. Deploy needs owner GO.

## Diagnosis (production, read-only, 31 Oct)

**Just Culture refusal**
- The audit row is `withheld:ungrounded`, detail "the number two", prompt `scholar-learn-v3:teach+scholar-learn-teach-v1`.
- `checkTeachAnswer` runs overview + key points through `checkLearnMain`. The number check (`textGroundingViolations`) found the word "two" in the answer but not in the passages, and withheld the WHOLE lesson.

**Latency**
- `plat_ai_requests` latency for teach is about 9-11 s (claude-sonnet-4-6, roughly 1.5k input and 450 output tokens).
- The learner perceives about 30 s, so about 20 s is outside the model call: route work, client refresh, extra round trips. This has not been measured yet, so instrument it first.
- Topic analysis (`map`) calls run sequentially, about 6-8 s each.

## Owner requirements (binding)

- **Guided Learning is the default.**
  - Selecting a lesson shows its saved explanation, or starts teaching.
  - Next lesson loads and teaches the next one.
  - No separate Teach me click.
  - Previously generated lessons open without an AI request.
  - Preserve source mode and depth.
  - Manual Learning is an optional preference.
  - Never auto-advance without learner action.
- **Performance**
  - Saved explanations first.
  - No duplicate generation.
  - Optimise retrieval and grounding.
  - Prompt and model efficiency.
  - Meaningful progress display.
  - No arbitrary delays.
- **Prepare-next**
  - At most one lesson ahead.
  - Configurable, default OFF.
  - Existing allowance.
  - Dedupe.
  - Respect mode, depth and content version.
  - Never generate the whole sequence.
- **Grounding**
  - Keep the supported parts; remove or identify unsupported claims instead of rejecting a useful lesson.
  - Learner can continue.
  - Offer wider sources where permitted.
  - Never present unsupported clinical claims as verified.
  - Keep risk safeguards and provenance.
- **Interface**
  - Explanation is the focus.
  - Simplify, Go deeper, Examples and Summarise go under "More learning options".
  - Ask Scholar stays accessible.
  - Inline citations; long excerpts behind View sources.
  - Check at the end of the lesson, answerable inline.
  - "Next lesson" is the primary action.
  - Responsive per CPR-MOB-001.
- **Continuity**
  - Save explanations and progress.
  - Resume at the last lesson.
  - Reopening costs no AI.
  - Checks are informal, not assessment.
- **Metrics:** use the existing audit, `plat_ai_requests` and `plat_ai_outcomes`. Record time to first content, generation latency, reuse, refusal/recovery, duplicates, cost per delivered lesson, prepared-and-viewed, progression and abandonment. No new analytics subsystem.

## Slices

| Slice | Scope | State |
|---|---|---|
| G-A | Server: stage timings, salvage partial grounding, prepare-next endpoint (policy default off), dedupe, cache-first; owner additions 5 (numerical grounding) and 6 (semantic support) | done 31 Oct, local commits, not pushed (see Log) |
| G-B | UI: auto-teach on select and Next, More learning options, inline check, Manual preference (existing 414 preference if it fits), resume | done 31 Oct, local commits, not pushed (see Log) |
| G-C | Staging acceptance: QI deck, lessons 1-4 (sonnet); browser at 375/768/1440 (coordinator) | pending |

## Token rules

- Targeted vitest only.
- scholar-learning harness once.
- tsc once.
- No full suites and no re-runs.

## Log
- 31 Oct (owner screenshot, for G-B): in "My notes only", the recovery panel asks "Would you like to explore additional learning resources?" but only offers "Continue with my notes", because `widerMode()` never widens notes-only (by design: the learner's choice). Fix in G-B:
  - when the learner's policy allows wider learn modes (`scholarResearch.modes` includes library and/or research), the panel offers explicit learner-chosen actions such as "Use My notes + Competen library" and "Research & Explain". These switch the lesson's Learn-from mode, which is persisted like the existing selector, and re-run Teach. Recovery itself still never widens silently;
  - when no wider option exists, the prompt wording must not ask a question it can't answer. Say plainly what the learner can do.
  - Touch `suggestedActions` (`evidence-recovery.ts`) only as needed. G-A is editing other server files in parallel.

### 31 Oct -- G-A server slice (branch scholar/guided-learning-01, not pushed)

**Owner additions recorded (binding, via coordinator):**
- (5) Numerical grounding: ordinary structuring counts pass; safety-critical numbers stay strict.
- (6) Semantic source support: deterministic variants, no AI and no embeddings.

**Delivered** (no migration; no clinical safeguard weakened):
1. **Grounding layer** (`src/lib/ai/grounding.ts`, study text only; the Practice verifier is unchanged).
   - A spelled-out small cardinal followed by a closed STRUCTURE_NOUN list passes: "two types of error", "three key steps". Ordinals and "one of" were already fine.
   - It does NOT pass when its sentence matches SAFETY_CONTEXT: any digit, unit, dose, tablet, rate, frequency, duration, threshold, %, lab value, age, score or medication word.
   - Digits are never excused.
   - Stricter: "twice" and "thrice" are now checked against the notes.
   - Finding words on a closed ROOT_MARKERS list are supported by the same root in the notes ("reduced" by "reduction"). "normal", "positive", "raised" and multi-word markers stay literal.
2. **Key-term coverage** (`term-match.ts`, wired into `matchedTerms`, so groundingOutcome, assessSufficiency and evidence `matched` use it).
   - The old 5-letter prefix rule runs first, so nothing covered before is lost.
   - Then: suffix-stripped root, a curated group list (error/erroneous, PDSA/Plan-Do-Study-Act, SBAR, UK/US spellings) and hyphenated-compound initials.
   - Numbers stay literal.
3. **Salvage** (`generation.ts` checkTeachAnswer/salvageTeach).
   - Applies when overview and key points fail only as `ungrounded`. Each part is then checked alone, the failing ones are dropped, and the lesson is shown if the overview or at least one key point survives.
   - The kept text re-passes checkLearnMain.
   - Never salvaged (the whole lesson is withheld as before): bad or missing citation, NOT_IN_NOTES, an identifier anywhere, or a dropped part with dosing words or an invented number in a safety context (any digit).
   - `check.salvaged = { removed, parts, violations }`.
   - The outcome is recorded as `partial` with reason `grounding_salvaged`. It is never "accepted" and never verified.
4. **Prompt and versions.**
   - Teach prompt is now `scholar-learn-teach-v2`, with no unsupported counts. The full version is `scholar-learn-v3:teach+scholar-learn-teach-v2`.
   - v1 lessons are still served (`LEARN_TEACH_LEGACY`), so reopening never costs AI.
   - The QI regression harness R3b accepts v1 or v2.
5. **Policy key** `scholar_learn_prepare_next` (choice on/off, default **off**) on the HQ Individual configuration surface.
6. **Route** (`learn/act/route.ts` + `learn-flight.ts`).
   - Stage timings: `timing_ms` on every generation audit row and served row.
   - Parallel reads: body+policy, preference+catalogue (started early), governed refs+topics, tutor context (started before the gates), and the outcome, recovery and audit writes.
   - Cache-first, including legacy keys.
   - Open and prepare paths.
   - In-flight dedupe on audit_log (insert-then-read, earliest unfinished start wins). Dedupe uses action `scholar_learn_inflight`, which the hourly quota does not count.
   - Served-from-saved row: action `scholar_learn_served`.
   - The artefact is saved before the trail is written.
7. `metrics.sql` (read only): latency by stage, time to first content, reuse, duplicates, refusal/salvage, cost per delivered lesson, prepared-viewed, progression/abandonment.

**API contract for G-B** (POST `/api/individual/scholar/learn/act`)

- **Open a lesson:** `{ action:"teach", sessionId, step, depth?, mode?, open:true }`
  - Saved: the normal saved reply plus `cached:true` (and `salvage` if it was salvaged).
  - Not saved: `{ action, step, depth, lesson, grounding, cached:false, open:"generate"|"in_flight" }`. No AI call, no allowance read.
  - On "generate" (or "in_flight"), send the same body without `open`. That waits for an in-flight twin rather than generating again.
- **Teach (generate):** the existing reply plus `cached:false`.
  - Salvaged: `salvage:{ removed:n, note:"Some statements were left out because your notes don't support them." }`, and `grounding.outcome:"partial"` with `grounding.removed:n`.
  - A saved salvaged lesson keeps `provenance.promptVersion` ending `+partial:n` and returns the same `salvage` fields when reopened.
- **Duplicate twin:**
  - Served: `cached:true, duplicateSuppressed:true`.
  - The first was withheld: `withheld:true, reason:"duplicate", message`.
  - Otherwise: `retry:true, inFlight:bool, message`.
- **Prepare next:** `{ action:"teach", sessionId, step:<current step>, depth, mode, prepare:true }` returns `{ prepared:boolean, step?, reason? }`.
  - `reason` values: off | not_teach | no_session | recovery | not_current | no_next | saved | not_storable | in_flight | unavailable | not_saved | withheld:… | error:…
  - It prepares only the next step after the session's current one.
  - It records no learning event and changes no currentStep.
  - Send a distinct `x-request-id` from the lesson request.
- **Timing keys:** auth_policy, passages_outline, related, references, cache, standing_preflight, dedupe_claim | dedupe_wait, context, risk, research, ai, generate (includes ai), save, total.
  - Fake run: total 33 ms, generate 22 ms (the checks; the model is a fake). Real numbers come in G-C.

**Verification**
- Targeted vitest: grounding, term-match, teach-salvage, teach-format, policy, the new route test learn-guided.test.ts (cache-first with zero AI including v1, open, dedupe with 1 AI call for 2 requests, prepare gating, salvage through the route), the 4 wiring tests, and the 13 grounding/coverage-dependent suites. All pass.
- The dedupe test was red (2 AI calls) before the end-of-flight fix.
- scholar-learning-harness: 163/0. individual-config-harness: 47/0. tsc --noEmit: clean (needs NODE_OPTIONS=--max-old-space-size=8192; the default heap ran out of memory).

**Open for owner/G-C**
- Prepare-next stays OFF.
- G-C staging should read `timing_ms` to locate the ~20 s outside the model call.
- A sub-millisecond race remains, where DB timestamps can disagree with commit order (stated in learn-flight.ts).

### 31 Oct -- G-B UI slice (branch scholar/guided-learning-01, not pushed)

Commits 760bc887, 2cdf3e24, e26aeb8d. No migration and no server change; the page passes one boolean. No safeguard touched.

**Delivered**
1. **Guided by default** (`learn-client.tsx` teachLesson + effect). Initial load, resume, a step click and Next lesson send `open:true`. A saved lesson is shown with zero AI. `open:"generate"|"in_flight"` sends the same body without `open` (the route dedupes). No Teach me click.
   - One request per lesson key (scope|step|action|mode|depth, `guided-learn.ts` LessonRequests). A key is asked once per visit, so a withheld or failed lesson never loops.
   - A learner who moves on before the open returns: nothing is generated for the skipped lesson. It is released, so coming back opens it. A reply that arrives late goes to its own step's thread, never as the current lesson.
   - Progress line: "Preparing this lesson from your notes…" (or notes + library / published research), plus the lesson title. No percentages.
   - Never auto-advances. When AI is not available, open still runs (saved lessons are shown) but nothing is generated.
2. **Manual preference.** The 414 `default_action` is CHECK-constrained to a learn action, so "manual" cannot be stored there without a migration. It is kept in **localStorage `scholar.learn.guided`** ("manual" = Manual; anything else = guided).
   - Toggle "Teach each lesson automatically" (on by default) in Lesson settings.
   - Manual = the previous behaviour: Teach me button, a new scope's first lesson opened once (now saved-first), resume waits.
3. **Prepare-next.** The page passes `prepareNext={policy.scholarLearnPrepareNext}`.
   - Off (default): no prepare request is ever made.
   - On: after a teach lesson is shown on a recorded session, and it is not the last, one `prepare:true` call per lesson key, with its own `x-request-id`.
4. **Layout**
   - The explanation leads: inline [S n] links, View sources (n) kept.
   - Check questions are answered inline, under the lesson's own question. Clarify records the verdict, informal. A written check (check action) is answered below the lesson.
   - "Next lesson" is the single primary button. Below md it is sticky above the phone tab bar (same offset as learn-search-client); from md it is static. Previous is ghost; "Finish session" on the last lesson.
   - "More learning options" disclosure holds every non-primary action: Explain, Simplify, Go deeper, Give examples, Summarise, and Teach me when another action is the learner's start. Ask Scholar stays visible beside it and in the Ask panel.
   - "Lesson settings" disclosure holds the guided toggle, Depth and Learn from. "Teach this lesson again with these settings" appears when they differ from the lesson shown.
5. **Salvage.** `salvage.note` is shown calmly under the lesson, with the expansion buttons where wider modes are offered.
6. **Source expansion.** Under a withheld, salvaged or partial lesson: "Use my notes + Competen library" / "Research & Explain".
   - Only from the page's `modes` (shownLearnModes, so research only when operational), and only wider than the current mode.
   - Clicking one switches Learn from (localStorage, like the selector) and teaches the lesson again.
   - The recovery panel shows them too. It asks its question only when it offers something to answer it with; otherwise it shows `RECOVERY_PROMPT_PLAIN` (no "?").
   - `suggestedActions`/`widerMode` are unchanged: recovery itself never widens.
7. **Continuity.** Server unchanged: current_step resume, open-from-saved records the event, check verdicts recorded as before.

**Verification**
- vitest `guided-learn.test.ts` 18/18: dedupe, release, stale, prepare-once, auto-teach rules, open-to-generate phases, grouping, expansion choice, prompt wording, preference.
- Also learn-research-quality and evidence-recovery: 91 tests in all, all pass.
- scholar-learning-harness 163/0. tsc clean (8 GB heap). eslint clean on the changed files.
- **Browser not run** (G-C).

**G-C should assert** (staging, QI deck)
- Lesson 1 shows "Preparing this lesson…" and then the lesson, with no click. Network: `open:true`, then one teach POST.
- Reopen or reload: exactly one `open:true` with `cached:true`, no teach POST. There is a `scholar_learn_served` audit row and no new `plat_ai_requests` row.
- Next lesson: lesson 2 opens and teaches, never without the click. Lesson 3 is not generated while on lesson 2 (prepare OFF: no `prepare:true` request at all).
- Rapid double-click of a step, or switching step 2 to 3 to 2: at most one teach POST per lesson. Zero `scholar_learn_inflight` duplicates.
- Manual (untick the toggle, reload): no request until Teach me. The toggle persists across a reload.
- Salvaged lesson (Just Culture): the lesson, the note "Some statements were left out…", and expansion buttons where library/research are offered.
- Notes-only withheld: the panel shows expansion buttons, or the plain wording with no "?" when none are offered. A click switches Learn from and re-teaches.
- Check: "Answer this" opens the box under that question. Submitting records the verdict, and the step shows understood / partly / not yet.
- 375 / 768 / 1440: no horizontal scroll. On a phone the sticky Next lesson sits above the bottom tab bar. Touch targets OK with pointer-coarse.
- Read `timing_ms` for time to first content.
