# Scholar Ask with web sources: design and cost model

**Status: design only. Nothing in this document is built or enabled. Paid search stays off.** No code, configuration, policy or database was changed. No paid search credential is introduced, no billable query is enabled and no learner gets web search from this document. Each of those needs separate owner authorisation (section 10).

Owner instruction: P2, 6 Nov 2026. Read against `main` at `a1eb16a7`. Prices were read on 6 Nov 2026.

**Three points for the owner:**

1. **Activating research for Teach Me can also switch on Ask's research source, and that path can send names to PubMed and OpenAlex today.** See findings F1 and F8. Fix or separate them before the Teach Me activation GO.
2. **The expected search fee is small.** It is between about USD 0.03 and 0.22 per active learner per month, depending on the provider. Assumptions are in section 9. The AI cost of reading the results can be larger than the search fee.
3. **The existing money path can hold the cap.** `ai_reserve` is atomic, and search fits it as one ledger row. The current research budget check is not atomic, so it cannot be the cap.

---

## 1. What exists today, and the gap

### What to reuse

| Exists | Where | What it gives Ask |
|---|---|---|
| Provider registry with lifecycle, one call gate, owner approval, paid-spend approval | `src/lib/holdings/research/registry.ts` (`notInvocable`, `transitionNeeds`) | The only registry. `brave_search`, `exa` and `tavily` are already seeded as Phase 3 records of type `web_search`, with no adapter and no products |
| Studio: drafts, checks, publish, rollback, owner-only steps | `src/lib/holdings/research/admin.ts`, `src/app/api/hq/research-sources/route.ts` | All provider administration, with no new page |
| Published policy and fixed rules | `src/lib/holdings/research/engine-config.ts` (`FIXED_RULES`, `DEFAULT_POLICY`) | Budgets, cache days, evidence rules. `dailySpendUsd` defaults to 0 |
| Search, merge, verify, cache, usage | `src/lib/holdings/research/service.ts` (`runResearch`, `mergeItems`, `isEvidence`) | The scholarly pipeline |
| Provider adapters | `src/lib/holdings/research/providers.ts` | PubMed, OpenAlex, Crossref, PMC. Each fails soft, and only the query leaves |
| Usage record, apart from AI usage | `plat_research_requests` (migration 630), `src/lib/holdings/research/load.ts` | One row per provider call. No query text and no person, by design. Linked to the AI action by `action_id` |
| Evidence model with verified and interpretation halves | `src/lib/holdings/research/evidence.ts` | Keeps provider facts apart from AI text |
| Ask with chosen sources | `src/lib/individual/scholar/ask-sources.ts`, `src/app/api/individual/scholar/explain/across/route.ts` | Per-question source choice and a "what was searched" line. `web` is named and labelled "Web sources" but is never offered |
| Relevance and source quality | `src/lib/individual/scholar/research-relevance.ts`, `source-quality.ts` | Concept scoring, specialty mismatch, publication-type gate |
| Evidence tiers and labels | `src/lib/individual/scholar/evidence-recovery.ts`, `.../study/_components/evidence-recovery.tsx` | Notes, then library, then external. Labels "Your notes", "Competen library", "External reference", "AI explanation" |
| Web call with a domain list and result-only sources | `src/lib/individual/scholar/exam-research.ts`, `src/lib/ai/client.ts` (`webSearch`) | Exam papers only, off by default. `keepSources` takes sources from provider blocks, never from model text |
| Reserve and settle | `src/lib/ai/allowance.ts` (`meter`), migrations 410, 411, 412, 421 (`ai_reserve`, `ai_settle`, `ai_release`, `ai_mark_unreconciled`) | Atomic holds under a row lock, retry refusal, unknown charges held rather than guessed |
| Platform and institution budgets | `src/lib/ai/consumption.ts` (`ATTRIBUTION`, `BudgetPolicy`, `budgetAccount`) | A monthly ceiling that refuses at the limit, with an alert share |
| Identifier and intent screens | `src/lib/privacy/patient-identifiers.ts` (`findPatientIdentifiers`, re-exported by `scholar/extract.ts`), `src/lib/ai/request-intent.ts` | Identifier shapes, real-patient evidence, named person, study framing |
| Clinical gate | `src/lib/ai/clinical-risk.ts`, `operating-mode.ts`, `allowance.ts` (`gateCore`), `scholar/http.ts` (`withinRequestRisk`) | Risk tier, refusal words, educational boundary |

`src/app/api/individual/research/route.ts` and `docs/COMPETEN-KNOWLEDGE-RESEARCH-01-ckri-foundation.md` are CKRI: participation in collective analytics and research studies. They are unrelated to search and are not used here. Nothing in this design contributes a learner's question to CKRI. One CKRI rule carries across as a precedent: research work must not be charged to individual students (`consumption.ts`, comment on `research.analysis_assist`).

SCHOLAR-RESEARCH-TEACH-001 is being built in another session. It is not on `main` or on any remote branch whose name I could match. This design assumes its evidence packs as stated in the owner's ruling, and must be checked against the real code at build.

Two Ask paths exist. The in-place panel (`ask-panel.tsx`) posts to `/api/individual/scholar/learn/assistant`, which has no research step. Ask across your library posts to `/api/individual/scholar/explain/across`, which already calls the research engine when the learner chooses it. The first consumer of this design is the across route. The panel follows later through the same shared function.

### The gap, with evidence

I ran the two pure query functions on synthetic questions (no real person, no network call, no database).

| Question (synthetic) | `researchQuery`, used by Ask across | `topicKeywords`, used by evidence recovery |
|---|---|---|
| Mrs Nambi age 72 at Mulago ward 5 has sepsis, explain qSOFA | `mrs nambi age mulago ward sepsis qsofa` | `ward sepsis qsofa` |
| Sarah Okello presented with chest pain, what does the troponin mean | `sarah okello presented chest pain troponin mean` | `presented chest pain troponin` |
| what does troponin mean in sarah okello from kampala | `troponin mean sarah okello kampala` | `troponin sarah okello kampala` |
| my neighbour peter has hiv, explain cd4 | `neighbour peter hiv cd4` | `neighbour peter hiv cd4` |
| thanks that helped | `thanks helped` | `thanks helped` |

| # | Finding | Evidence | Effect |
|---|---|---|---|
| F1 | Ask across builds its outgoing query with no name removal | `explain/across/route.ts:115` passes `plainKeywords: true`. `learn-research.ts:128` then falls to `service.ts:70` `researchQuery`, which only checks identifier shapes and lowercases | **Names and places would leave Competen** once research is operational for Ask. This is off by default, not absent |
| F2 | `topicKeywords` removes names by capital letter only | `evidence-recovery.ts:187`, and the table above | A lowercase name passes both functions |
| F3 | Nothing stops a search on chit-chat | Table above | `thanks helped` would be searched |
| F4 | With metering on, search runs before the risk decision | `scholar/http.ts:204` returns null when metering is on, and the route then searches at `route.ts:115`. The comment at `route.ts:110` holds only with metering off | A request the model call later refuses has already been sent to a provider |
| F5 | A web search fee is never charged or recorded | `allowance.ts:533` always passes `p_extra_usd: 0`. `gateway.ts:80` costs tokens only. `client.ts` returns `searches`, and nothing charges it | Turning on the exam web path would under-record every search |
| F6 | The research budget check reads and then acts, and holds nothing | `load.ts:53-66`. `rateLimitPerMinute` is read only by the HQ form, never enforced | Parallel requests can pass a limit together. It cannot be a hard cap |
| F7 | The registry treats OpenAlex as a free service with no cost | Seed in `registry.ts`, `checkEvidence` wording, adapter sends `mailto` and no key. OpenAlex now publishes usage pricing and a daily budget (section 9) | Recorded cost is 0 when a price exists. Parallel Crossref checks (`service.ts:200`, up to 5) also exceed its published polite concurrency of 3 |
| F8 | Ask's research source shares its switch with Learn | `ask-sources.ts:47` offers it when `scholar_learn_source_modes` includes `research` and the engine is operational for `scholar` / `learn`. The across route checks the same thing (`route.ts:56-59`) | **If Teach Me activation publishes those settings, Ask's research source appears too, with F1 and F4 still open** |
| F9 | Web results cannot pass the scholarly pipeline | `service.ts:221` keeps only PubMed, DOI and OpenAlex links. `isEvidence` needs a PMID or a Crossref-confirmed DOI. `web_search` is `implemented: false` | Web needs its own side path. Do not widen the scholarly one |
| F10 | The exam web tool type may use dynamic filtering | `client.ts:100-101` selects `web_search_20260209` for current models, and `client.ts:141` sets no `allowed_callers`. Anthropic's page says that version defaults to dynamic filtering, which is not eligible for zero data retention | Any reuse must set direct calling |

---

## 2. The search processor and provider interface

"Search processor" means two things here, and both need a decision.

**The legal processor** is the company that receives the query. `scholar_exam_web_provider` in `policy.ts` already says this is an owner decision covering the privacy notice, cost and funding. `docs/legal/drafts/05-data-roles.md` lists Anthropic as a sub-processor and names no search company. `04-scholar-privacy-notice.md` does not mention search or research sources.

**The software** is one coordinator that every Ask web search passes through. All names below are proposed, not built.

```ts
// Only sanitiseAskQuery can create this. An adapter accepts nothing else, so raw learner text cannot compile.
type SanitisedQuery = { readonly text: string; readonly terms: readonly string[]; readonly vocabularyVersion: string; readonly __brand: "sanitised" };

type SanitiseResult =
  | { ok: true; query: SanitisedQuery }
  | { ok: false; reason: "identifier" | "real_patient" | "named_person" | "personal_safety" | "no_academic_term" };

type WebResult = { url: string; title: string; publisher: string; published: string | null; excerpt: string | null; rank: number; retrievedAt: string };

type WebAdapterOutcome =
  | { status: "ok"; results: WebResult[]; billedUnits: number }
  | { status: "failed"; billing: "none" | "unknown"; code: string };

interface WebSearchAdapter {
  id: AdapterId;                   // registry.ts ADAPTERS: adding an id here is the code side of "Integrated"
  search(q: SanitisedQuery, o: { allowedDomains: readonly string[]; maxResults: number; timeoutMs: number; fetch: FetchLike }): Promise<WebAdapterOutcome>;
}

type AskEvidence = {
  searched: Searched[];            // ask-sources.ts: what was searched and what happened, one line per source
  scholarly: LearnResearch | null; // the existing engine result, unchanged
  web: WebResult[];                // kept apart: never a ResearchItem, never given a PMID or DOI claim
  queryShown: string | null;       // the exact terms sent, for the learner
};
```

The processor runs these steps, in order. Any step can end the search. None can end the answer.

1. Risk and intent decision (section 3).
2. Sanitise (section 4).
3. Cache and reuse lookup.
4. Scholarly sources, through `runResearch` as it stands.
5. Web, only if the scholarly result is insufficient and web is operational: person limit, rate limit, **reserve**, the one gate `notInvocable`, adapter call, **settle, release or mark unreconciled**, then `plat_research_requests` row.
6. Filter, deduplicate and label (section 5).
7. Return `AskEvidence`. The route's existing AI call and checks decide what is written.

The registry needs these additions, and no parallel list:

- A web source becomes callable only with an adapter in `ADAPTERS`, `web_search` set to implemented, products and activities set, and the existing checks recorded.
- **Rule change:** type `web_search` always needs `paidApproval`. Today `transitionNeeds` asks for it only when `costPerRequestUsd > 0`, so a paid source with cost left at 0 could skip it.
- If the owner chooses Anthropic web search, add a registry record for it. It has none today, because the exam path uses a policy setting instead.
- Ask gets its own switches: `scholar_ask_research` and `scholar_ask_web`, default off. This closes F8.
- A new `research.vocabulary` CONFIG-002 document (section 4).

---

## 3. When a search runs, and when it does not

| Situation | Search? | Why, or what reuses |
|---|---|---|
| Learner did not choose an external source for this question | No | The choice is per question and resets (`ask-sources.ts`). Unlike Teach Me, Ask is not automatic in this design |
| Greeting, thanks, "ok", chit-chat | No | No recognised academic term (F3). Needs a term from the vocabulary, and `questionFraming` from `request-intent.ts` |
| Follow-up (simpler, deeper, example) on an earlier answer | No | Reuses the evidence of that question. A follow-up carries the earlier question, not a new topic |
| Question about the learner's own record or plan | No | Nothing external can answer it |
| Identifiers, real patient, named person, personal safety | No | Section 4 and section 7. Always decided before any network call |
| Request refused by the clinical gate | No | The decision comes first in every metering state (closes F4) |
| Notes and approved library already sufficient | No | `assessSufficiency`, with the threshold from `scholar_recovery_sufficiency`. If the learner explicitly asked for research, scholarly sources may still run, and web does not |
| Lesson served from a saved lesson | No | Existing reuse, no AI and no search |
| Same sanitised query in the cache | No new search | `researchKey` plus `individual_scholar_research_cache`. No charge and no count against limits. Answer text is still not stored (owner ruling D10), so a repeat costs AI but no search fee |
| Teach Me evidence pack covers the same terms | No new search | Search once and reuse. Only approved, non-personal packs. Private materials stay separate |
| Identical repeat from the same learner in the panel | No new search | The same cache, and a stable retry id so a double press cannot pay twice (`ai_reserve` refuses a repeated id) |
| Follows all checks, scholarly result not sufficient, web operational | Web, once | At most one paid query per question, and no retry on a paid source |

**Cache limit to check:** Brave's page says storing results needs a plan with storage rights. Tavily's and Exa's terms were not verified. If a provider forbids caching, web results cannot be reused. The high case in section 9 covers this at a 100% miss rate.

---

## 4. From a free-text question to a sanitised query

Ask is harder than Teach Me. A topic title is written for a lesson. A learner's question is free text, and may hold patient details or private notes.

### The rule

**A word leaves Competen only if it is on an approved academic vocabulary.** Removing what looks personal is a blocklist. It fails silently on anything not foreseen, as the lowercase names show. An allowlist fails closed.

### The steps, all deterministic

1. **Identifier screen.** `findPatientIdentifiers`. Any hit means no search. It finds NHS numbers, labelled birth dates and hospital numbers only, and is shape-based by its own header.
2. **Intent screen.** `cautiousIntentFeatures`, which reads the corrected spelling as well. Real-patient evidence, personal safety, first-person administration or a named person means no search. Do not scrub and carry on: such a question is not a general topic.
3. **Vocabulary match, longest phrase first.** Keep only terms in `research.vocabulary`. Phrases win, so "bell palsy" passes and "Bell" alone does not, and "parkinson disease" passes where "Parkinson" alone does not.
4. **Bound.** At most six terms. No digits, ages, dates, places or institutions, because none are in the vocabulary.
5. **At least one distinctive term.** Generic words alone do not search (`GENERIC_TOPIC_WORDS`, `WEAK_WORDS`).
6. **Outbound guard.** The adapter call re-checks the final string for digits, identifiers and length. Only a `SanitisedQuery` reaches it.
7. **Show the learner the exact terms before sending,** with one press to send. Recommended for the pilot (decision D6). It is the only check that can catch what code does not recognise, and it tells the learner plainly what leaves.

Worked examples, if the vocabulary holds these clinical terms:

| Question | Query sent |
|---|---|
| what does troponin mean in sarah okello from kampala | Stopped by no rule at step 2, so step 3 gives `troponin` |
| Mrs Nambi age 72 at Mulago ward 5 has sepsis, explain qSOFA | None: named person at step 2 |
| the patient in bed 4 has low sats, explain oxygen therapy | None: real patient at step 2 |
| thanks that helped | None: no academic term at step 5 |

### Where the vocabulary comes from

A closed, versioned CONFIG-002 document, published by HQ and seeded from:

- Approved Competen library titles and outcomes.
- The curated lists already in `research-relevance.ts` (`KNOWN_PHRASES`, `EQUIVALENTS`, `SPECIALTY_TERMS`) and `term-match.ts`.
- A standard medical vocabulary such as MeSH. Its licence and fit are **not verified**, and it needs review before use.

**Never from learner material.** Material topics are built from private uploads, so a name in a note could become an allowed word. The vocabulary must not read them.

A small vocabulary means some good questions do not search. That is the intended failure: the answer still works and says so. Vocabulary misses are counted, with no text kept, so HQ can see the coverage.

### When it cannot be made safe

- No external request, no hold and no charge. A usage row records outcome `refused`, with a code only.
- The AI answer continues from notes and approved references, under the existing clinical gate. If the gate refuses, its own words apply.
- The learner sees, on the source's "searched" line: *"Web sources were not searched because your question may include patient or personal details. To search, ask about the general topic, for example: management of sepsis in adults."* The example comes from allowed terms when any exist.

### Why model-based sanitising alone is not enough

1. **It sends the text to do the cleaning.** The unsafe text goes to an AI provider before it has been made safe.
2. **It cannot be proved.** A model gives no guarantee, its behaviour changes with versions, and passing tests today does not bound tomorrow's output.
3. **The question text can influence it.** The learner's own words, or pasted text, are input to the sanitiser.
4. **Its failure is silent.** A name that survives looks like any other word. No alarm fires, and because questions are not stored, nobody can audit it afterwards.
5. **Provider-run search writes its own queries.** With Anthropic web search, the model decides the search string, and Competen sees it only afterwards. So that request may carry only the sanitised terms, never the question or notes, and cannot share a call with the answer.

A model may later *suggest* better search terms, but its output must still pass the vocabulary. It can improve a query. It can never be what makes one safe.

---

## 5. Source selection, relevance, deduplication, citation and full text

**Order of sources:**

1. The learner's notes and saved learning.
2. Approved Competen library.
3. Reusable cached research or an approved evidence pack.
4. Scholarly: PubMed, OpenAlex, with Crossref verification and PMC links.
5. General web, on approved publisher domains only, and last.

**Selection for web.** Reuse the domain policy `scholar_exam_web_domains` and its default list (`EXAM_WEB_DOMAINS_DEFAULT`: who.int, health.go.ug, nice.org.uk, nhs.uk, cdc.gov, nih.gov, cochranelibrary.com, resus.org.uk, sign.ac.uk). Ask should have its own setting, starting from that list. Pass the list to the provider where it supports filtering, and **always re-filter on Competen's side** (`onDomain`, `keepSources`). Open-web search is out of scope.

**Relevance.**

- Scholarly: `rankRelevant` and `gateResearch`, unchanged. Results below the bar are not shown.
- Web: score title and excerpt with the same `scoreRelevance`, and use the `strict` level, since a web page has no publication type to check.
- `withdrawDeclaredIrrelevant` applies to any summary that says its own sources do not bear on the question.

**Deduplication.**

- Scholarly: `mergeItems` by DOI, PMID and title.
- Web: normalise the URL (https, host, path, no tracking parameters or fragment), then take one result per URL.
- A web result pointing at `pubmed.ncbi.nlm.nih.gov` or `doi.org` is dropped when the same work is already a scholarly item, and otherwise looked up through the scholarly adapter by its id. The verified copy always wins.

**Citation verification.** These hold under `FIXED_RULES` and do not change:

- Every citation is a provider's own record, never model text.
- Scholarly evidence needs a PubMed PMID or a Crossref-confirmed DOI (`isEvidence`). A DOI Crossref contradicts is dropped.
- Web citations get their own `[W n]` tag. A `[W n]` must match a returned result, on an approved domain, over https. An unknown tag is removed (`dropUnknownTags`). A URL the model wrote is never shown.
- A retracted PMC record gets no link (`parsePmcCloudMeta`).
- Every sentence in a research part must cite a given source and pass its check (`checkResearchPart`), or it is withheld alone.

**Abstract only and full text.** Full text is never fetched, by fixed rule, and this design keeps that.

- `RECOVERY_RETRIEVED_LABEL` stays honest: "details only", "abstract only". Add "web excerpt".
- A web excerpt is never called full text. An open-access PMC link is a link, and nothing is read from it.
- Abstracts stay as private evidence, shown only as a short excerpt with a link (`excerptChars`, registry licensing).

**Decision D4: what a web result may do.** A web page has no PMID or DOI, so under the fixed rule it is not evidence. I recommend two stages:

- **W1, links only.** Web results are listed as reading. The model never sees them. This is cheapest and safest, and removes prompt injection as a risk.
- **W2, approved excerpts.** The model may cite an excerpt from an approved publisher. This needs a written change to `FIXED_RULES` by the owner, and an evaluation first.

---

## 6. The four labelled source classes on screen

| Class | Holds | Tag | Label and note on screen | Today |
|---|---|---|---|---|
| **Your notes** | The learner's materials and saved learning | `[S n]`, `[N n]` | "Your notes". Private, never sent to a source | `RECOVERY_ORIGIN_LABEL.notes` |
| **Approved references** | Competen library content approved as it stands, approved cases | `[L n]` | "Competen library", with the approved badge. Listed as they stand | `RECOVERY_ORIGIN_LABEL.library`, `CONTENT_STATUS_LABEL` |
| **External research** | PubMed and OpenAlex records, web results | `[E n]`, `[W n]` | "External reference" with what was retrieved: "abstract only", "details only", "web excerpt". Note: "Published sources Competen found. Not from your notes and not clinically reviewed. Open the source before relying on it." | `RECOVERY_ORIGIN_LABEL.external`, `RECOVERY_RETRIEVED_LABEL`, plus the new label |
| **AI interpretation** | Every sentence the model wrote | None of its own | "AI explanation", set apart from the sources, with the existing not-clinically-reviewed wording | `RECOVERY_ORIGIN_LABEL.ai`, `AI_LABEL`, `RECOVERY_EXPLANATION_LABEL`, dashed box in `EvidenceRecovery` |

Rules:

- **All model text is AI interpretation, even when it cites.** A citation points to classes 1 to 3 and does not turn the sentence into a source. `ASK_RESEARCH_LABEL` says "From published research", which blurs this. Change it to say "AI summary of published research".
- **Classes never blend in one part.** `runAskAcross` already writes notes and research as separate parts, each with its own check. Web keeps the same separation.
- **Every chosen source reports its state,** using `searchedLine`: used, listed, nothing matched, not searched and why. "Not searched" must never read as "nothing exists".
- **Reuse the existing components.** The `Group` layout and `ExternalList` in `evidence-recovery.tsx`, `--cmp-*` tokens and learning tones. Words carry each class, so colour is never the only signal.
- **Show the terms sent:** "Searched for: sepsis, qSOFA."

The in-place panel renders only note sources and one label (`ask-panel.tsx`), so it needs this grouping before it can show external sources.

---

## 7. Clinical safety

Existing controls stay as they are: the risk tier, operating modes and refusal words, model eligibility, the educational boundary, and `withinRequestRisk` on what the research part wrote. **Research never changes which model may answer** (`FIXED_RULES`).

**No patient-specific advice.**

- Real-patient evidence, administration decisions about a person, emergencies and identifiable details are decided before any source is searched. They are refused or redirected by the existing words.
- An external source can never turn a refused request into an answered one, and can never lower a risk tier.
- Asking "hypothetically" does not lower real-patient evidence (`request-intent.ts`).

**High-risk topics.**

| Tier or topic | Scholarly sources | Web | Model may read results |
|---|---|---|---|
| Standard educational | Yes | Yes, if on | Under existing rules |
| Clinical educational | Yes | Yes, if on | Eligible model only |
| High-risk clinical, for example medicine doses and titration, insulin, anticoagulants, chemotherapy, paediatric dosing, emergencies, overdose | Reading list only, if the gate allows the request | **No** (decision D7) | Only on a model eligible at that tier |
| Personal safety, for example self-harm | **No** | **No** | No. The existing support words only |

`ai_reserve` adds a backstop: at high risk it refuses unless an eligibility row covers the priced provider, so a paid search fee could not be held at that tier without someone recording an explicit decision.

**What the AI may not do with an external source:**

- Turn a finding into an instruction for a person, or give a dose or rate as something to do.
- Say a source says what its excerpt does not contain. The model has only an abstract or excerpt, and must not claim the study's full contents.
- Call an abstract, a web page or a single study a guideline, a recommendation or clinically approved.
- Cite anything it was not given, or write a URL.
- Blend a source with the learner's notes in one claim, or use a source to correct the notes silently. Disagreement is stated and left for the learner to take to their course.
- Follow instructions found in a source. Abstracts and web excerpts are untrusted data. They are stripped of markup, the prompt states they are data, and the answer call has no tools.
- Hide how old a source is or where it comes from. Each source shows its date and publisher, and the answer tells the learner to check their local guideline and supervisor.

If the check fails, that part is withheld (`RESEARCH_WITHHELD`), and the rest stands. No retry at a weaker model and no silent downgrade.

**No identifiable patient information in any external request.** Section 4 is the control. In addition:

- Calls are server side only, with Competen's own contact details (`researchContact`).
- No learner location is sent, so `user_location` stays unset on Anthropic's tool.
- Query text is never stored in usage, audit or cache rows. The cache key is a hash, and `plat_research_requests` has no query column (`VERIFY-630.sql` checks this).
- The Google Scholar link is built from the sanitised query only.

---

## 8. Metering, rate limits and funding

### Per-query cost record

Reuse `plat_research_requests` as it stands: `action_id`, `product`, `operation`, `workflow`, `provider`, `capability`, `requests`, `results`, `outcome`, `latency_ms`, `cost_usd`. No person and no query text. HQ analytics and `researchCostByOutcome` read it unchanged. Paid rows survive retention, because `retention.ts` deletes only zero-cost rows.

The money itself is one row in `ai_usage_ledger`, with `record_type` `research_search` and `record_ref` holding the action id. The two meet on the action id. The ledger is what is enforced, and the usage table is what is analysed. Set `costPerRequestUsd` from the published price, and record the actual charge.

### Reserve and settle: a search as one ledger row

No new money function is needed. `ai_reserve` prices through `ai_price`, and a row can carry `extra_per_request_usd` with zero token prices.

- **Price.** One `ai_price` row per provider: provider label `research`, `model_prefix` set to the registry id, tokens 0, `extra_per_request_usd` the published unit price. Migration 431 permits the provider name.
- **Reserve.** `ai_reserve` with `p_max_input_tokens` 0 and `p_max_output_tokens` 1, because the ledger check requires output above 0. The request id is `${userId}:${clientKey}:search`, the same `:part` form `actionOfRequest` already understands.
- **Code.** A small exported `meterSearch` in `allowance.ts`, the same steps as `meter` without `generate()`. Pass the actual extra through `ai_settle` where a provider bills by use. This also fixes F5 for any caller that adopts it.
- **AI answer.** Stays its own row on its own activity, exactly as now.

With Anthropic web search the two costs arrive in one provider call, but are still two rows: the fee row above, settled by `searches`, and the normal AI row. That AI row needs an input pad, because search results count as input tokens and `maxInputTokens` does not foresee them.

| What happened | Money | Learner sees |
|---|---|---|
| Cache or evidence pack hit | No hold | Results, as usual |
| Refused before the call (unsafe, risk, off, limit) | No hold | The "searched" line says why |
| Hold refused: cap reached | No call | Section "Funding cap" below |
| Search succeeded, including an empty result | Settled at unit price | Results, or "nothing matched" |
| Provider says it did not bill (error status, documented as not billed) | `ai_release`, full refund | "could not be reached", answer continues |
| Timeout or broken connection, or billing on failure not documented | `ai_mark_unreconciled`: the hold stays until reconciled, never guessed | "could not be reached", answer continues |
| Worker dies before settling | `ai_release_stale` sweep handles it, as today | Nothing |
| Same request id again | `ai_reserve` returns `retry`, no second call | Same result from the cache |
| Search succeeded, AI answer then failed or was withheld | Search stays settled, because it happened. AI row settles or releases as today. Results are cached, so a retry pays no second fee | The existing failure or withheld words |
| Unreconciled holds above `unreconciledCapCau` | No new paid searches | As cap reached |

Only Anthropic's page states failure billing ("A web search that fails with an error is not billed"). For Brave, Tavily and Exa it is **not verified**, so failures are treated as unknown until the `cost` check records the provider's written terms.

### Rate limits

| Limit | Value proposed | Enforced by |
|---|---|---|
| Per person, fresh web searches | 3 per day, 30 per month. Off by default | New policy key beside `scholar_research_daily_max`, counted from audit rows as `learnResearchToday` does. Unreadable refuses |
| Per person, fresh scholarly searches | Existing `scholar_research_daily_max`, default 5 | Existing |
| Per person, burst | 1 fresh search at a time, 5 per 10 minutes | New count in the same audit rows |
| Per provider, per minute | The registry's `rateLimitPerMinute` | **New enforcement** (F6), counted from `idx_plat_research_requests_provider`. Set under the published limits in section 9 |
| Per provider and whole engine, per day | `dailyRequestBudget`, `dailySpendBudgetUsd`, `limits.dailyRequests`, `limits.dailySpendUsd` | Existing `allow()`, kept as a second, softer limit. Fix its row cap (`limit(20000)`), which could under-count |
| Scholarly call pattern | Crossref checks at most 3 at a time | Change in `runResearch` (F7) |

Person limits can overrun by a few under concurrency, since they count rows. That is acceptable, because the cap below is what protects the money.

### Funding cap: what stops over-spend

- **The hard stop is a platform budget** (`ai_budget`, `ai.budget.<code>`, `BudgetPolicy`). `ai_reserve` takes the account's row lock and refuses when `used + reserved + hold` passes the ceiling. So parallel requests cannot pass it together, and no search call is made without a hold.
- **Default ceiling 0.** `resolveBudgetPolicy` funds nothing until a policy is published. Carry-forward stays `none`. Nothing tops up by itself.
- **Fail closed.** Unreadable budget, missing price, missing rate row: no search.
- **Alert** at `alertAtPct` (80% proposed) on the HQ page.
- **Kill switches, any one of which stops new searches at once:** registry record Paused, budget suspended, `scholar_ask_web` off, workflow Paused.
- **The ceiling is in CAU, and the owner thinks in USD.** HQ should show both, using the rates `ai_reserve` already reads. Whether `ai_fx_rate` and `ai_cau_basis` hold live rows in production is **not verified** and is a gate.

**At the cap, the learner sees** an unchanged answer from their notes and approved references, and this on the source's line: *"Web sources are paused for now, so they were not searched. This answer uses your notes and Competen sources."* It must not read as an error or as "no evidence exists", and it must not offer an upgrade. Cached results and scholarly sources keep working.

### Who pays

Recommended (decision D3): **the platform budget pays the search fee. The person's allowance pays the AI answer, as now.**

- Reuse makes per-person charging unfair. The first learner to ask would pay, and the next would not.
- `ATTRIBUTION` gets one new workflow, `scholar.ask_web_search`, owner `platform`.
- With metering off (the `ai_fair_use` flag; `activity-cost.ts` says production until after 20 Nov), this fee cap still works, since `ai_reserve` does not read the flag. The person's allowance is then no control, and only the person limits above apply.

Alternative: charge the person's allowance too. It needs two holds, budget first and then person, with the first released if the second is refused. The learner would need to be told that web sources use their allowance. `scholar_research_daily_cost_cents` reads AI spend only, and would need the fee added.

---

## 9. Cost model

**These are assumptions, not measurements.** With metering off, the ledger holds no data (`sqie-cost.ts`: "no data, not zero"), and I did not read production. **Before any paid GO, replace the Q row with real Ask counts from `plat_ai_requests` and `audit_log`.**

### Published prices and limits, read 6 Nov 2026

| Provider | Published price | Published rate limit | Source |
|---|---|---|---|
| PubMed E-utilities | No charge stated on the pages read | 3 per second per IP without a key, 10 with a key | [NLM support](https://support.nlm.nih.gov/kbArticle/?pn=KA-05317), [NCBI Insights](https://ncbiinsights.ncbi.nlm.nih.gov/2017/11/02/new-api-keys-for-the-e-utilities/) |
| Crossref REST API | No sign-up required. No charge stated | Public 5 and concurrency 1. Polite 10 and concurrency 3. The time period comes in a response header, not the table | [Overview](https://www.crossref.org/documentation/retrieve-metadata/rest-api/), [Access](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/) |
| OpenAlex | Search USD 1 per 1,000, list and filter USD 0.10 per 1,000, get-by-id free. Free account USD 1 per day. Prepaid from USD 1 | 10 per second without a key, 30 with a free key | [Costs](https://help.openalex.org/access/example-costs/), [Pricing](https://help.openalex.org/access/pricing/), [Authentication](https://help.openalex.org/api-reference/authentication) |
| PubMed Central ID converter and Cloud Service | **Not verified** | **Not verified** | Registry docs link, not re-read |
| Europe PMC | None stated on the page read | None stated | [REST service](https://dev.europepmc.org/RestfulWebService) |
| Semantic Scholar | None stated | Introductory key 1 per second | [API](https://www.semanticscholar.org/product/api) |
| Brave Search API | USD 5 per 1,000. USD 5 monthly credit, which is about 1,000 searches | 50 per second | [Brave](https://brave.com/search/api/) |
| Tavily | Basic 1 credit, advanced 2. USD 0.008 per credit pay-as-you-go. 1,000 free credits per month | 100 per minute development, 1,000 per minute production | [Credits](https://docs.tavily.com/documentation/api-credits), [Limits](https://docs.tavily.com/documentation/rate-limits) |
| Exa | Auto and fast USD 7 per 1,000 for up to 10 results. Contents USD 1 per 1,000 pages per content type. USD 10 free monthly | 10 per second on search | [Pricing](https://exa.ai/pricing), [Limits](https://docs.exa.ai/reference/rate-limits) |
| Anthropic web search | USD 10 per 1,000, plus tokens. Failed searches not billed. Sonnet 4.6 USD 3 and 15 per million tokens | Console, per organisation, **not verified** | [Web search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing) |

### Assumptions per active learner per month

| | Low | Expected | High |
|---|---|---|---|
| Q: Ask questions | 10 | 40 | 120 |
| Share reaching search (learner chose it, safe, not sufficient) | 10% | 25% | 50% |
| Questions that use search results | 1 | 10 | 60 |
| Cache miss rate (High: no caching permitted) | 50% | 70% | 100% |
| **Fresh searches** | **0.5** | **7** | **60** |

### Search fee

Unit costs use one query per question and 5 results. The Anthropic unit assumes 6,000 input and 200 output tokens per search on Sonnet 4.6: USD 0.010 fee + 0.018 + 0.003 = USD 0.031. **That token count is an assumption**, close to the single-search example on Anthropic's page, and not a measurement. Exa assumes contents on 5 pages. No free credit is deducted.

| Provider | Per fresh search | Per question asked: Low | Expected | High | Per learner per month: Low | Expected | High |
|---|---|---|---|---|---|---|---|
| PubMed, Crossref | USD 0 stated | 0 | 0 | 0 | 0 | 0 | 0 |
| OpenAlex search | 0.001 | 0.00005 | 0.0002 | 0.0005 | 0.0005 | 0.007 | 0.06 |
| Brave | 0.005 | 0.00025 | 0.0009 | 0.0025 | 0.0025 | **0.035** | 0.30 |
| Tavily basic | 0.008 | 0.0004 | 0.0014 | 0.004 | 0.004 | 0.056 | 0.48 |
| Exa auto with contents | 0.012 | 0.0006 | 0.0021 | 0.006 | 0.006 | 0.084 | 0.72 |
| Anthropic web search | 0.031 | 0.0016 | 0.0054 | 0.0155 | 0.016 | **0.217** | 1.86 |

All figures are USD. "Per question asked" spreads the cost over every Ask question, including those that never search.

### AI cost of reading results: free search is not free

This falls on every question that uses results, **including cache hits**, because caching saves the search fee and not the reading. Estimated at about 4 characters per token (an approximation), on Sonnet 4.6.

| What the model reads | Per question that uses it | Per learner per month: Low | Expected | High |
|---|---|---|---|---|
| W1 links only | 0 | 0 | 0 | 0 |
| Up to 5 abstracts (2,400 characters each, `ABSTRACT_MAX`), plus 400 extra output tokens (`generation.ts:748`) | up to 0.015 | 0.015 | 0.15 | 0.90 |
| Up to 5 web excerpts (600 characters each, as `keepSources`), plus 400 output tokens | about 0.008 | 0.008 | 0.08 | 0.50 |

So on abstracts, reading costs about three times Brave's fee per question, and it applies to scholarly sources that have no fee. This is an upper estimate: real abstracts are often shorter.

### Platform view at expected use (7 fresh searches per learner per month)

| Active learners | Fresh searches per month | Brave | Anthropic | Fits free scholarly limits? |
|---|---|---|---|---|
| 100 | 700 | USD 3.50 | USD 21.70 | Yes |
| 1,000 | 7,000 | USD 35 | USD 217 | About 233 per day: near the seeded limits below, above PMC's at worst |
| 5,000 | 35,000 | USD 175 | USD 1,085 | No, needs higher budgets and keys |

**Free providers are limited by rate, not price:**

- One fresh scholarly search makes 3 PubMed calls, 1 ID-converter call, 1 OpenAlex call, up to 5 Crossref calls and up to 10 PMC Cloud calls. That is up to 20 requests.
- At 3 per second without a key, NCBI allows about 0.75 fresh searches per second, shared per IP. Whether a serverless deployment shares its IP is **not verified**.
- Seeded budgets of 2,000 requests per provider per day allow about 666 PubMed, 400 Crossref or, at worst, 181 PMC fresh searches (11 requests each). PMC running out only drops the open-access links. The engine's 5,000 per day allows about 250 at the worst case. A free OpenAlex key allows about 1,000 searches per day.
- The adapter sends no OpenAlex key. The keyless daily budget is **not published** on the pages read: "10x" under the free key suggests about 100 searches a day, which is an inference. What happens when it runs out is also **not stated**. Fail-soft covers this, and the record should say so.

**The High case is shown before the per-person limit.** At the proposed limit of 30 fresh web searches per month, the most one person can cost in web fees is USD 0.15 on Brave or USD 0.93 on Anthropic. Scholarly searches have their own limit.

**The ceiling decides the total, whatever the model above says.** An example ceiling of USD 25 per month buys about 5,000 Brave or about 800 Anthropic searches, about 115 learners at expected use on Anthropic, and then web stops by itself. The figure is for the owner to set.

### Not verified

- Which Brave plan includes storage rights. The same page's banner says "up to USD 20 in free calls", against USD 5 in the plan details.
- Query retention and processor terms for Brave, Tavily and Exa. Brave's page lists zero data retention under Enterprise.
- Domain filtering on Tavily and Exa. Brave's page offers Goggles. Anthropic's `allowed_domains` is verified.
- Billing on failed calls, other than Anthropic.
- Real Ask volume, search-result token counts and cache hit rates.
- Production flag states, and FX and CAU rows.
- The NCBI general page could not be fetched (browser check). Limits are from the NLM and NCBI Insights pages above.

---

## 10. Rollout gates, and what the owner must decide

### Gates

Each gate is a separate GO. Passing one authorises nothing beyond it. All work starts on staging with an injected mock `fetch` (`ResearchDeps.fetch`), and no real key.

| Gate | Contents | Billable? | Exit evidence |
|---|---|---|---|
| **G0** | This document accepted | No | Owner decisions recorded |
| **G1** Safety fixes | Separate Ask switch (F8), the vocabulary sanitiser replaces `researchQuery` on Ask (F1, F2, F3), risk decided before search in every metering state (F4), Crossref concurrency, OpenAlex record corrected (F7). **G1 should land before the Teach Me activation GO, or that GO must keep `research` out of Ask** | No | Section 11 corpus and harness green, each planted failure proven red |
| **G2** Free scholarly on Ask, staging | Across route, per-question opt-in, labels | No | Walkthrough with labels, refusal and "not searched" words |
| **G3** Free scholarly on Ask, pilot cohort | Owner activation, using existing operating-mode cohorts. Coordinate one budget with Teach Me | No, apart from AI reading | Real volumes replace section 9 assumptions. Zero identifier leaks in sampled outgoing queries on staging |
| **G4** Legal and money ready | Processor named in the privacy notice and data-roles memo with counsel, provider terms checked, price rows, budget at ceiling, FX and CAU rows confirmed, `meterSearch` proven under concurrency with a mock | No | Owner sign-off, counsel note |
| **G5** Paid web, links only (W1), small pilot | **The owner personally authorises the credential and billable queries,** then registry records through Approved and Active with `paidApproval`, and `scholar_ask_web` for the cohort | **Yes, capped** | Spend against ceiling, cap-stop observed on purpose, no unsafe query |
| **G6** Web excerpts (W2) | `FIXED_RULES` change, evaluation of grounding and injection | Yes, capped | Evaluation results, owner GO |
| **G7** Wider release | Cohort widened, ceiling reviewed against real use | Yes, capped | Owner GO |

Rollback at any gate: a kill switch from section 8, and CONFIG-002 `rollback` for published documents.

### Decisions the owner must make

| # | Decision | Recommendation |
|---|---|---|
| D1 | May Ask use free scholarly sources, when? | Yes, by learner choice per question, after G1 |
| D2 | Should paid web exist at all, and who is the search processor? | Yes, later. For the pilot, **Anthropic web search**: no new company in the data-roles memo, verified domain filter, zero-retention eligible with direct calling (whether Competen's own Anthropic terms include it, and who runs the search behind Anthropic's tool, are not verified). It costs about 6 times Brave per search, about USD 0.18 more per learner per month, and the model writes the query. **Brave** is the alternative at volume: exact query control and a lower price, but a new processor and unresolved storage rights |
| D3 | Who pays, and what ceiling? | Platform budget pays the fee, person's allowance pays AI. Owner sets USD per month. The USD 25 above is only an example |
| D4 | What may web results do? | Links only first (W1). Excerpts only after a written rule change and an evaluation |
| D5 | Which domains are approved? | Start from the nine exam defaults. Confirm for Ask, and consider adding national guideline publishers learners use |
| D6 | Show the exact search terms and require one press? | Yes for the pilot. Review after evidence |
| D7 | High-risk clinical topics | No web at all. Scholarly as reading only, if the gate allows. Personal safety: no search |
| D8 | May Ask search automatically later, as Teach Me does? | Not now. Ask's free text is the reason. Revisit with pilot evidence |
| D9 | Free API keys for NCBI and OpenAlex | Yes when G3 volume needs them. They cost nothing on the pages read, but are still credentials to hold. Decide jointly with Teach Me |
| D10 | Must `ai_fair_use` be on before paid web? | Not required for the fee cap. Decide whether the allowance must also be live |
| D11 | Separately: the exam web path has F5 and F10 | Keep it off until it adopts `meterSearch` and direct calling |

**Separate authorisations, which this document does not give:** a paid search credential, billable queries, web search for any learner, production policy or migration changes.

---

## 11. Test plan for later

Follow `TESTING.md`: unit tests under Vitest, invariants under a new `scripts/ask-web-sources-harness.ts`. Every control must be shown to fail: plant the violation, watch it go red, restore. No test uses a real key, and CI asserts that no call reaches a paid host.

**Sanitiser.**
- A synthetic corpus, kept with the tests, covering capitalised and lowercase names, names that are also clinical words (Bell, Parkinson), local names and places, ages, dates, phone numbers, hospital and national ids, addresses, emails, pasted note text, misspellings, other languages, and text trying to instruct the system.
- Property test: every word of every output is in the vocabulary.
- Regression: the section 1 table no longer yields a name.
- Chit-chat yields no query.
- AST check, as in `plane-boundary-harness.ts`: only `sanitiseAskQuery` creates a `SanitisedQuery`, and no adapter takes a plain string.

**When it searches.**
- One test per row of section 3, asserting the number of outbound calls.
- Refused requests make zero calls with metering on and off (F4).
- Teach Me activation alone does not offer Ask's research source (F8).

**Money, on staging with a mock provider.**
- Concurrency: run 50 parallel holds against a ceiling that admits N. Exactly N are granted, and exactly N calls are made.
- One test per row of the failure table: settle, release, unreconciled, stale sweep, retry id.
- AI failure after a search leaves one fee, and the retry pays none.
- Cap reached: no provider call, answer still served, correct words.
- Ledger and `plat_research_requests` agree per action.
- Missing price, budget, FX or CAU row: no call.
- Rate limit per minute and person limits are enforced.

**Sources and citations.**
- A result off the approved domains is dropped, even if the provider returned it.
- A URL or `[W n]` the model invented is removed.
- Duplicate URLs and DOIs merge, and the verified copy wins.
- An abstract is never labelled full text.
- A retracted record gets no link.
- With W1, the model prompt holds no web text.

**Clinical safety.**
- Each row of the high-risk table.
- A planted prompt injection in an abstract or excerpt changes nothing.
- A dose in a source does not appear as an instruction.
- A source cannot raise a refused request to answered.

**Privacy of records.**
- `VERIFY-630.sql` columns unchanged.
- No query text in audit, usage or cache rows, by scanning rows after a run with a marker word.
- Cache rows hold no user id.

**Screen.**
- All four classes render with words, at phone and desktop width, by keyboard and screen reader.
- Each "searched" state, including paused and not safe.
- A walkthrough at G2 and G5, with the cap reached on purpose.

**Cost truth.**
- HQ shows "no data", never zero, when metering is off.
- Monthly comparison of ledger totals against the provider's invoice at G5, before any wider release.
