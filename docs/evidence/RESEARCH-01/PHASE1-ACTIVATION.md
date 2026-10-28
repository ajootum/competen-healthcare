# COMPETEN-RESEARCH-01: Phase 1 activation configuration (ready, NOT activated)

**Where:** HQ > AI & Intelligence > Research Sources (`/super-admin/ai/research-sources`). Everything below is configuration. Nothing needs a deployment.

**Who:**
- **Owner (platform owner):** approval, activation, publication and rollback. The code enforces this.
- **Holder of `hq.platform.research.manage`:** may draft and record checks. No position holds this right; the owner may grant it in HQ Positions.

**Prerequisites:**
- Production: migration 630 applied (separate owner GO). Without it, every source's budget reads fail closed and nothing can be called.
- Production: D1 routing published. Already done (28 Oct).
- Optional: set `RESEARCH_CONTACT_EMAIL` in the deployment. This is the address NCBI, OpenAlex and Crossref see. Default: hello@competenhealthcare.com.
- No key is needed for any Phase 1 source.

## 1. Source lifecycle (part 7, Readiness & activation), one source at a time

Phase 1 sources start at **Configured**: the adapter exists in code and the fields are seeded. Take each through these steps:

| Step | PubMed | OpenAlex | Crossref | Google Scholar link |
|---|---|---|---|---|
| Run connectivity check | yes (a synthetic "oxygen therapy" query) | yes | yes (Crossref's test DOI) | none (it is a link only) |
| Move to Integrated | yes | yes | yes | yes |
| Record Evaluation | `scripts/scholar-research01-acceptance.ts` staging run 28 Oct, 11/11 | same | same | same |
| Move to Evaluated | yes | yes | yes | yes |
| Record Access | NCBI E-utilities, public, no key, 3 requests a second, tool and email sent | OpenAlex API, public, polite pool (mailto) | Crossref REST API, public, polite pool (mailto) | outbound link only, never fetched |
| Record Licensing | Abstracts are publishers' copyright. Private evidence for one answer, a 320-character excerpt with a link, never redistributed | CC0 data | open metadata | not applicable |
| Record Governance | Scholar Academic, Clinical & AI Committee: educational use, clinical eligibility unchanged | same | same | same |
| Record Cost | free, $0 a request, 2,000 requests a day | free, $0, 2,000 a day | free, $0, 2,000 a day | none |
| Move to Approved (owner) | yes | yes | yes | yes |
| Move to Active (owner) | yes | yes | yes | yes |

Seeded record values, already in place (edit in part 1 only to change them):

| Source | Capabilities | Product / activity | Priority | Rate | Depth | Freshness | Cache | Retention |
|---|---|---|---|---|---|---|---|---|
| PubMed | search, metadata, abstracts | scholar / learn | 1 | 180 a minute | 5 | 15 years | 30 days | 30 days |
| OpenAlex | search, metadata, abstracts | scholar / learn | 2 | 300 a minute | 5 | 15 years | 30 days | 30 days |
| Crossref | doi_verification, metadata | scholar / learn | 3 | 300 a minute | 5 | 15 years | 30 days | 30 days |
| Google Scholar link | external_link | scholar / learn | 9 | none | none | none | none | none |

## 2. Policies (parts 3, 5 and 6): the defaults are the recommended pilot values

- **Source policy, scholar:** PubMed then OpenAlex (or leave it empty for priority order). Approved sources only.
- **Evidence and citation rules:**
  - abstracts as evidence ON;
  - Crossref DOI verification ON;
  - at most 5 evidence items;
  - a 320-character excerpt;
  - further reading shown;
  - Google Scholar link ON.
- **Limits:**
  - 5 results a request, a 6,000 ms timeout and 0 retries;
  - cache and retention of 30 days;
  - 5,000 requests a day across all sources;
  - $0 a day of spend (Phase 1 is free; a paid request beyond budget is never sent).

## 3. Workflow (part 4)

- **Basic:** owner Activate. This is refused until a Phase 1 search source is Active.
- Comparison, Clinical evidence and Advanced stay **Designed**. They have steps with no code, so they cannot be activated.

## 4. Publish (owner)

One publish, with a note. It is versioned and can be rolled back from "Published versions".

## 5. Scholar (HQ > Individual > Configuration, the Individual policy)

| Key | Value | Effect |
|---|---|---|
| `scholar_learn_source_modes` | notes, library, research | **This makes Research & Explain visible to every Scholar learner.** Owner authorisation needed. Learners must still choose it for each request. |
| `scholar_research_daily_max` | 5 (default) | fresh searches per learner per day |
| `scholar_research_daily_cost_cents` | 25 (default) | research-answer AI spend per learner per day |

- My Notes Only stays the default.
- My Notes + Competen Library shows clinically approved library entries only.
- Research is never automatic: it runs only when the learner picks Research & Explain.
- To pilot without general exposure: activate the engine (steps 1 to 4) and leave `scholar_learn_source_modes` at notes. Research is then operational but shown to no learner.

## Not activated by this package

- Phase 2 and Phase 3 sources: no adapters exist, so they cannot be integrated or called.
- Production research sources and Research & Explain for general users: owner authorisation needed.
- No grant of `hq.platform.research.manage`.
