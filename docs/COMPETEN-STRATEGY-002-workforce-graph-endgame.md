# COMPETEN-STRATEGY-002 — The workforce graph: from Scholar to the trust rail

**Status:** Strategy record. Advisory analysis written at the owner's request, 2026-10-25. It decides
nothing and authorises nothing — no build, no migration, no activation, no corporate action. Decisions
remain the owner's and are recorded elsewhere when made (ADRs, IND decision records).
**Sits beside:** `COMPETEN-STRATEGY-001-competency-passport-thesis.md` (the passport thesis). 001 argues
what the passport *is*; this document argues what the passport is *worth*, and the staircase from
today's measured state to a business valued in the billions of dollars — including the honest arithmetic
of why the products as currently priced cannot get there on their own.
**Baseline:** every figure in §1 was measured on 2026-10-25 against production
(`rnnqhlrcgvsauigxwszl`) and `origin/main` (`d15e4bf7`), not recalled. Later readers should re-measure
before relying on them; this repository's own rule is that absences and counts quietly stop being true.

---

## 1. The measured starting point (2026-10-25)

| Dimension | State |
|---|---|
| Built | Scholar MVP + S2–S4 + Stage 3 Learn; Professional MVP + Profile Stage 1; CKRI foundation; AI fair-use (CAU allowances, UGX basis, price sources, model eligibility, budget routing); Practice (live, one real workspace) |
| Staging | migrations through ~450, each applied twice with rollback rehearsed |
| Production users | 30 profiles platform-wide, 3 Individual entitlements (HQ-granted), 1 scholar material, 0 professional profiles, ~32 AI requests ever |
| Commercial state | `individual_app` OFF, self-registration OFF, Individual billing path not built, terms unpublished, Scholar operating subsidiary unnamed, IP assignment unsigned |
| Pricing | Scholar UGX 20,000/month (policy only); Professional unpriced |
| Target decided by owner | **Individuals, not institutions** (2026-10-24) |

The one-line summary of the baseline: extraordinary build velocity, zero market contact, and five
commercial blockers that are administrative rather than technical.

## 2. The ceiling of what is currently priced

Subscriptions alone cannot reach the stated ambition, at any realistic scale:

| Model | Heroic assumption | ARR | Plausible valuation |
|---|---|---|---|
| Scholar at UGX 20k/mo | 1,000,000 paying African subscribers | ~USD 65M | USD 300–600M |
| + Professional + Practice | ARPU doubles across the base | ~USD 130M | still below USD 1B on most days |

A million paying consumer subscribers in East Africa would itself be one of the continent's great
consumer stories — and it still does not clear the bar. Multi-billion pure-education companies barely
exist (Duolingo is the exception; AMBOSS, Coursera and Lecturio sit well below). The question is
therefore not "how does Scholar get huge" but **what does Scholar's user base make possible that is
worth roughly a hundred times more per user**.

## 3. The thesis: Competen is the trust rail for African health-workforce flows

What the schema already is — one identity from student to graduate to professional to practitioner,
competency-mapped against real programme frameworks, provenance honestly labelled, under a Holdings and
subsidiary structure built for multiple operating entities — is not a study app's architecture. It is a
**workforce graph**. The money flows *across* that graph, not inside the subscriptions:

- **WHO projects a shortfall of roughly 10 million health workers by 2030**, concentrated in the Global
  North and the Gulf. Africa trains the workers; the UK NHS, Gulf states, Canada and the US actively
  recruit them; Uganda and Kenya hold government labour-export MOUs.
- **International placement of one nurse carries USD 10,000–25,000 in fees today**, paid to recruiters
  who verify credentials by email and PDF. Companies that merely *schedule* nurses domestically reached
  the multi-billion neighbourhood (ShiftKey ~USD 2B, Clipboard ~1.3B, Incredible Health ~1.65B, all
  approximate and as of their last raises). Nobody owns verified, portable, competency-level records for
  the **supply side of the global flow**.
- **Verification-as-infrastructure is a proven category on its own** (Checkr, ~USD 4–5B at peak, for
  ordinary background checks). The equivalent for African health credentials — the API an NHS trust or a
  Gulf hospital queries to confirm a Ugandan nurse's training, competencies and licence — is a business
  whose customer pays in hard currency, and whose moat is exactly the regulatory and honest-provenance
  work already enforced in this codebase's schema.

**The thesis in one sentence:** Scholar and Professional are the cheapest possible acquisition engine
for the supply side of a workforce-mobility and verification platform — acquiring the health worker at
student prices, years before anyone else wants her, and holding the only longitudinal record of what she
can actually do. The subscription pays the rent. The graph is the company.

This does not amend the owner's individual-first targeting decision; it depends on it. The demand side
(councils, employers, recruiters) only shows up once individuals have accumulated records worth
verifying. Demand-side-first is how two-sided networks die in procurement.

## 4. The staircase

Each stage is designed to be a real, self-justifying business even if the next stage never arrives.

### Stage 0 — exist (now to ~6 months)
Launch Scholar to individuals exactly as decided. **Gate:** 1,000 registered, 100 paying, week-4
retention above 40%. In parallel, the corporate work in §5, which gates everything after it.

### Stage 1 — own Uganda's student record (years 1–2)
25–50k Scholar users; Professional activating behind them. Revenue USD 0.5–1.5M ARR from subscriptions.
The KPI that matters is not revenue: it is **records per user** and **council engagement**, because they
feed Stage 2.

### Stage 2 — become registry-adjacent (years 2–3)
Partner with the Nurses and Midwives Council and the examination boards (UNMC, UNMEB, then NCK Kenya).
This is the decision the schema has been waiting for — *who verifies* — and the answer that creates the
moat is: **the regulator does, through Competen.** A council-recognised digital record converts a
self-declared diary into a credential. Slow, political, founder-led work; also the single
highest-leverage item in this document, and nearly impossible for a foreign competitor to replicate.

### Stage 3 — monetise the flow, not the user (years 3–5)
With verified passports and council recognition: international placement (take USD 2–5k of the USD 15k+
per placed nurse as the verification-and-matching layer, not as the recruiter), employer-side search and
verification subscriptions paid in hard currency, and the existing Enterprise/Workforce products selling
into African hospitals on the back of the graph. 10,000 facilitated placements a year at a USD 3–5k take
is USD 30–50M of high-margin revenue — and placement volume compounds with every cohort Scholar
graduates.

### Stage 4 — infrastructure and finance (years 5+)
The credential-verification API as a product in its own right; then the financial layer a verified
income-and-employment graph unlocks (salary-backed lending to health workers: large, underserved,
structurally low-default). This is where USD 100M+ ARR at platform margins — the multi-billion
arithmetic — actually lives.

## 5. What the staircase demands (the uncomfortable section)

1. **More than one builder.** AI-agent leverage produced this codebase at the cost of the owner's
   evenings; it does not do council politics in Kampala, enterprise sales in Riyadh, or 2 a.m. support.
   First commercial co-founder or early executive who sells while the owner builds. And **sign the IP
   assignment** — open on the risk register since August 2026, fatal in any diligence.
2. **Capital strategy is a now decision.** The staircase is fundable (health workforce + Africa + AI is
   squarely what global funds want), and a multi-billion outcome essentially requires venture capital
   and its governance. The Holdings/subsidiary structure (IND-001 D6) is the right scaffold — complete
   it: a clean top company in a fundable jurisdiction, local operating subsidiaries, a tidy cap table
   before the first cheque. The alternative — revenue-funded to Series-A strength — is legitimate and
   slower; what is not legitimate is not deciding.
3. **Sequencing discipline.** The platform can demonstrably ship five workstreams in 48 hours. The
   business needs exactly one clock running: strangers using Scholar. Anything that neither starts that
   clock nor advances a council relationship is inventory.
4. **Protect the honesty.** In a credentials business, trust is the product. The no-overclaiming schema
   (no column can store "verified" until a verifier exists), the DPPA posture and the provenance labels
   are the asset Stages 2–4 are built on. The day a Competen-verified record is found inflated, those
   stages die. The engineering culture is already right; the risk is commercial pressure later.

## 6. The next 90 days

1. Sign the IP assignment; name and incorporate the Scholar subsidiary; publish terms.
2. Flip the flag. Fifty strangers. Measure the three numbers that settle every appraisal written to
   date: **week-4 retention, free-to-paid conversion in one exam season, one class group adopting
   unprompted.**
3. One conversation with UNMC/UNMEB — not to sell: to ask what a council-recognised digital record
   would require. The answer shapes Stage 2 more than any code.
4. Decide bootstrap-versus-raise. If raising, the deck argues the graph thesis of §3 — the trust rail
   for a ten-million-worker shortage — never the study app.
5. Hire or partner for commercial: the first human who is not the owner.

## 7. Summary

The multi-billion company is a **verification-and-mobility platform wearing an edtech as its
customer-acquisition costume**. The costume, the identity substrate and the governance a regulator could
trust are already built — in the wrong order for a demo day, and the right order for the endgame. What
stands between today and the first rung is not code: it is a flag, a signature, and fifty strangers.
