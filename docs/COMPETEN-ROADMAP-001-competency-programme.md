# COMPETEN-ROADMAP-001 — Hospital Competency Programme

**Operationalisation roadmap — train, assess, oversee**

| | |
|---|---|
| **Date** | 2026-08-07 |
| **Status** | Draft for the programme owner. **Not a build authorisation.** |
| **Scope** | The competency line only. Competen Practice runs alongside as a separate commercial line — see [[cpr-optimisation-backlog]]. |
| **Parameters** | 100+ nurses · 20 competencies · 5 assessors · 4 levels of oversight |
| **Related** | `COMPETEN-STRATEGY-001` (passport thesis) · `CPR-OPT-001` (Practice, parked) |
| **Also issued as** | `COMPETEN-ROADMAP-001.docx` — the shareable version for hospital stakeholders |

> **This roadmap adds almost no features.** The software is already built — 45 assessor screens, ~120
> educator screens, every table the programme needs. The work is getting 100 real nurses, 5 real assessors
> and one real framework running on it. Treat any proposal to build a new module as a deviation requiring
> justification.

---

## 1. Purpose and scope

The programme owner is an instructor at a hospital responsible for training and assessing competency for
100+ nurses. One person cannot assess them, so an assessor cohort is forming. The hospital also needs
competency visibility at four levels: nurse, shift supervisor, unit manager, nurse director.

This is an **operationalisation** roadmap, not a product roadmap. Commercialisation is a later consequence,
addressed in Phase 4 and in `COMPETEN-STRATEGY-001`.

## 2. The situation

- 100+ nurses require competency assessment.
- Five assessors are being recruited and must work consistently with each other.
- **Assessment first**; training follows, targeted at the gaps assessment reveals.
- Oversight at four levels: nurse → shift supervisor → unit manager → nurse director.
- Built to solve a real internal problem; not being commercialised in this phase.

This origin is a strength. **The founder cannot be wrong about the problem**, which is the failure mode that
ends most software ventures. The open question is not whether anyone wants this — it is whether *this
hospital's version generalises*. That is answered in Phase 4 and nowhere earlier.

## 3. What already exists

Measured against the codebase, 2026-08-07. **Nothing in this table needs building.**

| Capability | Where |
|---|---|
| Assessor workspace — 45 screens | `assess` · `queue` · `nurses` · `cycle` · `osce` · `frameworks` · `studio/*` · `reports` |
| Assessment capture surface | `ConductCockpit` (830 lines) · `CaptureTools` · cycle `AssessmentForm` |
| Educator workspace — ~120 screens | `students` · `assessments` · `gaps` · `progress` · `interventions` · `studio` · `analytics` |
| Framework and competency model | `frameworks` · `framework_domains` · `framework_competencies` · `competencies` · `competency_skills` |
| Scoring and evidence | `assessments` · `skill_scores` · `competency_scores` · `assessment_evidence` · `skill_checklists` |
| Assessment cycles | `competency_cycles` · `assessment_plans` · `assessment_blueprints` · `assessment_requests` |
| Practical / OSCE | `osce_exams` · `osce_stations` · `osce_candidates` · `osce_results` |
| Four-level oversight | HWW · SSW · UMW · HEX workspaces |
| Assessor reliability | CAPA-005 reliability engine |
| Learning, for Phase 3 | `learning_courses` · `learning_enrolments` · `learning_pathways` · `learning_assignments` |
| Configuration | WCE-001 engine + WCE-002 registry |

> **One real gap.** There is **no roster capture surface** — no way to assess many nurses against one
> competency in a single observation session. The existing path is one nurse at a time; the real ward
> pattern is an assessor watching a shift and marking eight people on the same skill. Closing this is the
> highest-leverage build in the roadmap and the only significant one.

## 4. The organising constraint

100 nurses × 20 competencies = **2,000 assessment events per cycle**, **400 per assessor**.

| Time per event | Total | Per assessor | Over an 8-week baseline cycle |
|---|---|---|---|
| 5 minutes | 167 h | 33.3 h | 4.2 h/week — **will not happen** |
| 3 minutes | 100 h | 20.0 h | 2.5 h/week — sustainable only under pressure |
| **2 minutes** | 67 h | 13.3 h | **1.7 h/week — the target** |
| **45 s (roster)** | 25 h | 5.0 h | **38 min/week — comfortable and repeatable** |

Roster capture reaches 45 s not by rushing judgement but by removing repetition: ~2 min set-up + 30 s per
nurse, so eight nurses on one competency take ~6 minutes total.

> **Assessor throughput decides whether this programme succeeds.** No dashboard, report or analysis
> compensates for a five-minute assessment path. Measure it first, protect it after, and treat anything
> that slows it as a defect.

---

## 5. Phase 0 — Foundations (weeks 1–3, mostly not code)

1. **Settle the IP, in writing.** Built for an employer, on their time, with their data, for their nurses.
   An unresolved claim is fatal at investment or sale, and the negotiation is far harder once it visibly
   works. Any of these resolves it — ambiguity does not: owner holds IP + hospital gets a perpetual free
   licence; or engagement as an external vendor; or an explicit equity/revenue share. **Do it while it is
   still a side project.** Separately: *the software is the owner's, the data is the hospital's.*
2. **Establish the lawful basis** for assessing named staff — HR data about identifiable employees. Who
   sees what, retained how long. Before the first assessment.
3. **Narrow the scope** — one unit, 20 competencies signed off by the nurse director, five named assessors.
4. **Cut assessor navigation from 45 screens to six** — Queue, Assess, My nurses, Cycle, Framework,
   Reports. The rest behind a flag. Assessors are volunteers with clinical jobs.
5. **Load the real framework** as the hospital defines it. The baseline runs once.

**GATE:** IP signed · lawful basis documented · 20 competencies loaded and signed off · six nav items.

## 6. Phase 1 — Assessor throughput (weeks 3–7, the only real building)

6. **Measure before optimising.** Time `ConductCockpit` end to end. Record median and spread, not an
   impression — you may be closer to target than assumed.
7. **Build the roster capture surface.** One competency, many nurses, one session. The §3 gap.
8. **Mobile and offline.** Wards, phones/tablets, unreliable signal. An assessment lost mid-round is never
   re-done — the observation cannot be repeated. PWA shell + local write queue + sync on reconnect.
9. **Assessor onboarding.** The test: **can an assessor who is not the owner complete ten assessments
   unaided after fifteen minutes?** Not with a manual — the screen should teach it. If not, the cohort
   reverts to paper and the programme has no data.

**GATE:** median event under 2 min · one non-owner assessor completes 10 unaided · an assessment survives
loss of connectivity.

## 7. Phase 2 — The cohort (weeks 6–12, overlapping)

10. **Bulk-enrol the roster.** Verify the import path well before the evening it is needed.
11. **Run the baseline cycle.** Every nurse, every competency, once. **One opportunity only** — a baseline
    against a half-agreed framework compares to nothing later.
12. **Light up the four levels with real numbers.** Nurse sees their own; supervisor sees who is cleared
    for the shift being run; unit manager sees unit coverage and overdue; director sees hospital position,
    trend and risk concentration. All four workspaces exist — configuration and seeding, not construction.
13. **Instrument**: median/spread per event; assessor agreement and drift (from cycle one, not after a
    dispute); completion against plan; and **who opens what, unprompted** — the retention signal, and the
    one that matters most.

**GATE:** 100+ nurses baselined across 20 competencies · assessor agreement measured and acceptable · the
nurse director opens their view unprompted ≥2× in a month.

## 8. Phase 3 — Close the loop (months 4–6)

Assessment reveals what people cannot do; training addresses it; re-assessment shows whether it worked.
**Order matters** — assessment first creates demand for the training. Reversed, this is an LMS, which is a
commodity.

14. Route identified gaps into targeted learning assignments.
15. Re-assess the affected competencies.
16. Produce the before-and-after for one competency in one unit.

**GATE:** measurable improvement on one competency in one unit, evidenced by baseline and re-assessment.

> **This gate is the moment the programme becomes a product.** A demonstrated before-and-after is what
> persuades a second hospital. No quantity of features substitutes for it, and until it exists there is
> nothing to sell.

## 9. Phase 4 — Generalise (month 6+)

17. **Remove this hospital from the code.** Grading schemes, role names, shift patterns, framework
    structure and vocabulary will be absorbed in dozens of places because they feel like *the* way rather
    than *a* way. Move all of it into WCE configuration **while it is still remembered which choices were
    local.**
18. **Hospital #2 — paid, arms-length.** $5–15k/year is ample; the sum is not the point. **It must not be
    a friend doing a favour.** The highest-value milestone in the plan — the only thing that answers
    whether this generalises, and a stranger paying is the only answer that counts.
19. **Then, and not before:** the passport becomes possible *and necessary* once a nurse assessed at one
    hospital appears at another. That moment cannot be manufactured. See `COMPETEN-STRATEGY-001`.

**GATE:** a second hospital, unconnected to the first, pays.

---

## 10. Deliberately out of scope

| Excluded | Why, and when it returns |
|---|---|
| The competency passport | Needs a nurse moving between two customers. After Phase 4. |
| The ~120 educator screens | Hidden, not deleted. Return when a customer asks by name. |
| Additional AI modules | Eleven exist in the assessor workspace alone. None on the critical path. |
| Quality and Workforce | Sold later, pulled by a customer, never pushed. |
| An LMS as a product | Learning enters in Phase 3 as the answer to measured gaps. |
| Competen Practice | Separate line, own timeline — `CPR-OPT-001`. |

## 11. Risks

| Risk | Consequence | Response |
|---|---|---|
| Unresolved IP | A claim at investment or sale; potentially fatal | Phase 0.1, in writing, before deployment |
| **Nurses experience it as surveillance** | Quiet non-cooperation; data becomes unreliable | Frame it as *their* record and *their* evidence from the first briefing. True — and the same principle the passport rests on |
| Assessor drift across five assessors | Equal ability scored differently; results indefensible | Reliability engine from cycle one; calibrate jointly before baseline |
| Assessment takes too long | Baseline never completes; no before-picture | Phase 1 in full; throughput is a gate, not an aspiration |
| This hospital hard-coded | Cannot sell to a second hospital without a rewrite | Phase 4.1, while local choices are still remembered |
| Free forever | No evidence anyone would pay; a tool, not a business | Phase 4.2 — a paying stranger |

## 12. What is measured

| Measure | Target |
|---|---|
| Median time per assessment event | < 2 min; < 60 s with roster capture |
| Assessors working unaided | 5 of 5 by end of Phase 1 |
| Baseline cycle completion | 100% of enrolled nurses × 20 competencies |
| Inter-assessor agreement | From cycle one; drift investigated, not averaged away |
| Unprompted opens by the nurse director | ≥ 2 per month |
| Improvement on re-assessment | Demonstrable on ≥1 competency in one unit |

## 13. Assumptions and open questions

**Assumptions:** 100+ nurses, 20 competencies, 5 assessors, one starting unit · 8-week baseline cycle ·
assessors are practising clinicians contributing part-time · the hospital's four levels match the
workspaces already built.

**Open questions for the programme owner:**

- How many hours per week can each assessor realistically give? *This sets cycle length more than any
  other input.*
- Who signs off the 20 competencies, and by when?
- Which unit starts, and how many of the 100 nurses does it contain?
- Is the IP conversation with the hospital open, or still to be started?
- Does the hospital hold existing competency records that should form the baseline instead of a fresh
  assessment?
