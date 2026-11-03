# SCHOLAR-AI-COST-CONFIG-01 — topic and competency mapping: Haiku against the approved Sonnet (staging, 3 Nov 2026)

**Question (owner decision 2):** may routine competency mapping (`map`, production's largest AI line at 34 %) run on Haiku with Sonnet as fallback, judged for competency accuracy, clinically important distinctions, uncertainty handling, stable identifiers and cost?

**Verdict: not acceptable as it stands — map stays on Sonnet. Blocked by quality, not by configuration.** Details below; the raw proposals per section are in `p3-eval-2026-11-03.json` (`map[]`), recorded with the evaluation run named in `SCHOLAR-AI-COST-CONFIG-01.md` §6.

## Method

The production mapping generator itself (`runAnalysis` → `proposeMappings`: the same prompt, shortlist, JSON checks, identifier screen and confidence floor a learner's material goes through), run over every section of three real staging materials of the pilot fixture learner, with the model pinned through the gateway, once on **claude-sonnet-4-6** (eligible today, D5-v3) and once on **claude-haiku-4-5-20251001**. Nothing was saved to the learner's mappings. Catalogue: the nursing programme's catalogue as published on staging — **13 competencies** (production's NUR-CCF is far larger; stated as a limitation below).

| Material | Sections |
|---|---|
| Essential Nursing Care of the Critically Ill (PPTX) | 75 |
| Quality Improvement Science and Methods (PPTX) | 49 |
| recognising-deterioration-notes (text) | 1 |

## Results (125 sections, 23 batches × 2 models, 46 calls)

| Measure | Sonnet (approved) | Haiku | Reading |
|---|---|---|---|
| Proposals kept after the checks | 137 | 97 | Haiku maps less of the material |
| Sections where both abstain | 28 | 28 | — |
| **Sections Haiku abstains but Sonnet maps** | — | **22 (18 %)** | coverage loss; includes the one deterioration note (Sonnet 4 proposals, Haiku none) |
| Sections Sonnet abstains but Haiku maps | 2 | — | |
| Exact agreement on the competency set | — | 75 (60 %) | |
| Partial agreement | — | 20 (16 %) | |
| **Complete disagreement (one or both propose, nothing shared)** | — | **30 (24 %)** | |
| Mean Jaccard agreement | — | 0.68 (ENC 0.65, QI 0.75, deterioration 0.0) | |
| Learning outcomes named on proposals | **80** | **13** | the clinically important distinction (competency → outcome) is mostly lost on Haiku |
| Mean stated confidence | 0.48 | 0.64 | Haiku is more confident while proposing less and disagreeing more |
| Concepts found per section | 6.3 | 5.0 | |
| Drops: concept not in text | 186 | 242 | both over-generate concepts; Haiku more |
| **Drops: unknown competency identifier** | 5 | **20** | identifiers outside the shortlist: the check caught every one, but Haiku invents four times as many |
| Drops: over the proposal limit | 0 | 4 | |
| Drops: rationale ungrounded / low confidence | 2 / 2 | 0 / 0 | |
| Cost (46 calls, 125 sections) | USD 0.422 | USD 0.127 | −70 % |
| Tokens | 60,744 | 57,912 | |

Both models drew on the same 10 of the 13 competencies; the top four were the same in a different order (Haiku leans to the second-ranked competency where Sonnet leans to the first).

## Judgement against the governance standard

The D5 standard is that an activity passes when every item passes the production checks and a clinician then reads the outputs. Here nothing unsafe reached the record (the identifier and concept checks dropped what they should), but the mapping Haiku produces is materially different from the approved one: a quarter of the sections map to different competencies, a fifth of the mapped sections are left unmapped, the outcome level is mostly missing, and the only clinical-deterioration note gets no mapping at all. A learner's My Plan, Competency Explorer, Revise-by-competency and self-assessment all read these links. **Haiku for `map` is not proposed at any risk tier.** The production saving would have been about USD 0.3 a month at pilot volume.

What would change the verdict: a Haiku run on the production-size catalogue with agreement ≥ 0.85, no loss of outcome naming, and no abstention where Sonnet maps a clinical section — then a clinician's read of a sample. Not expected from this model class on this task; a cheaper lever for `map` is to classify each material once (already the case: unchanged materials are never re-analysed) and keep Sonnet.

## Limitations

- Staging catalogue is 13 competencies; production's NUR-CCF is larger, which makes the task harder, not easier, for the cheaper model.
- Three materials of one learner; two are slide decks with short sections.
- No clinician read the proposals; the measures are agreement with the approved model and the production checks' own drops.
