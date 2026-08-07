# COMPETEN-STRATEGY-001 — The competency passport thesis

**Written:** 2026-08-07
**Status:** Strategy of record. **Not a build authorisation** — see §10.
**Supersedes:** nothing. Sits above every build plan; does not change any of them yet.

> Two voices in this document, kept separate on purpose. **§1–§3 are the owner's vision**, written down as
> stated. **§4–§9 are the assistant's analysis of it** — emphases, hard truths, and what would falsify it.
> Where the analysis contradicts earlier advice, it says so.

---

## 1. The thesis

Competen is not a portfolio of five products. It is **a supply chain for trust in clinical competence**:

> **learn → assess → verify → carry → deploy**

Each stage is the input to the next, and the thing at the end — *a credential an employer actually
believes* — cannot exist unless every stage holds. That is the reason the pieces belong in one company,
and it is the only reason. Five products that did not feed each other would be five weaker versions of
somebody else's specialist tool.

The owner's framing, verbatim in substance:

- A product that **improves competency through quality frameworks**.
- Producing **reproducible evidence — a passport — that travels beyond one hospital**, so the
  practitioner holds proof of their own learning.
- Evidence that exists **before recruitment**, so a **student begins the journey at school** and grows over
  time through a framework that tests them and proves what they know.
- **Skill proven physically**, by attending a human testing centre — not only knowledge proven on screen.

## 2. The asymmetry it attacks

When a hospital hires a nurse it knows where she trained, what her licence says, what her CV claims, and
what one referee will put in writing. It does **not** know whether she can perform this procedure, on this
equipment, to this standard, today.

So every hospital re-assesses from scratch. Every agency re-assesses. Every migration re-assesses. That
dead-weight cost is paid repeatedly for the same person — and the person carries away nothing, because her
competency evidence dies inside each employer's database the day she leaves.

**Closing that asymmetry is what a credential is for.** CFA did it for finance, Cisco and AWS for IT, Gas
Safe for engineers, board certification for physicians. The pattern is proven. The open question is not
whether it works — it is whether it is winnable in this market, by this company.

## 3. Product structure (settled 2026-08-07)

**Two businesses. Five SKUs. One codebase.**

| | |
|---|---|
| **Competen Practice** | Practitioner, self-serve, card payment, bottom-up. Its own buyer, motion, pricing and arguably brand. A business on its own. Same philosophy as the passport — *the evidence belongs to the person, not the institution* — on a much shorter timescale. |
| **Competen for Hospitals / Schools** | One enterprise platform, licensed as modules: **Competency** (lead), **Quality**, **Learning**, **Workforce**. |

A SKU is not a product. Name, price, license, demo and navigate all five separately; do **not** split
codebase, schema or deployment. The substrate already exists — migrations 105/106 give `products`,
`product_suites`, `product_workspaces` (product → workspace keys), `tenants`, `tenant_product_licenses`,
wired through `src/lib/orchestration/licensing.ts`.

Standalone, **Learning** is a commodity (Moodle and Totara are free) and **Workforce** is an also-ran
(UKG, RLDatix Allocate, Deputy). Attached, they are *"the LMS that already knows what each nurse is weak
at"* and *"competency-aware rostering"* — claims nobody else can make. **The connective tissue is the
moat; independence would throw it away.**

---

## 4. The four emphases

### 4.1 Starting at school is the strongest decision in the vision

Strong enough to change the enterprise wedge. **The wedge is nursing schools, not hospitals.**

- Students are the only population with both the time and the need to prove themselves — no track record,
  and every incentive to build one.
- Schools have the matching incentive: *"our graduates arrive with verified competency"* is a recruitment
  pitch and a placement statistic.
- **It solves cold start**, which is otherwise fatal. A credential with no holders is worthless; one school
  yields ~200 holders a year in a single sale.
- It makes the passport the **default** for a cohort, and defaults are how credential markets are won.
- It is a paying customer that is not a hospital, on a far shorter procurement cycle.

### 4.2 Quality frameworks are the best door into hospitals

Most competency systems start from a job description. This one starts from **what a quality standard
requires**. Consequences:

- No standard is being invented that nobody asked for — existing ones are being operationalised
  (COHSASA, SafeCare, JCI, ISO, national standards).
- **Accreditation bodies become a distribution channel.**
- *"Prove your staff meet the standard you are already audited against"* is a sentence with a budget behind
  it.
- The motion becomes regulatory pull rather than nice-to-have push.

### 4.3 Accredit testing centres; do not build them

The physical centre is the most credible element and the most operationally expensive. Credible because
knowledge assessments are cheap and universally discounted, while a **witnessed OSCE is not** — which is
exactly why software-only competitors cannot copy it.

**But own none of them.** Accredit existing ones: nursing schools, teaching hospitals, simulation labs.
They have skills labs standing idle. Competen supplies the framework, assessor training, reliability
monitoring and the credential; the centre supplies the room and takes a revenue share. This is the
Pearson VUE / Prometric model — it scales without capex and compounds with §4.1. Substrate already exists
(`osce_*` tables, CAPA-005 assessor reliability).

### 4.4 "Reproducible" must bind us

Reproducible means **a third party can verify a claim without trusting us**. Minimum obligations:

1. Tamper-evident, signed evidence records. `practice_encounter`'s DB-enforced signed immutability is the
   right instinct — extend it to the passport.
2. A traceable, challengeable assessor identity on every skill claim.
3. A public verification endpoint an employer can call.
4. A revocation path.
5. **A custodian or escrow arrangement so the credential survives the company failing.** Nobody stakes a
   career on a credential that dies with a startup.

Align to **W3C Verifiable Credentials / Open Badges 3.0** — portability needs rails that already exist.
**Do not reach for blockchain.** The hard problem is governance, not consensus, and it costs credibility
with the regulators whose buy-in decides this.

---

## 5. The three hard truths

**5.1 A credential is worth what the market believes it is worth, and belief is not a software feature.**
Its value is determined entirely by whether an employer, on seeing it, does *less work* than they otherwise
would. That is a demand-side achievement. Every failed credential in history had adequate software and no
demand. **The first ten hospitals will accept the passport *in addition to* their own assessment, not
instead of it.** The whole strategy is the march from "in addition to" to "instead of" — measure that, not
features.

**5.2 This makes us an accreditation body, and those have a governance problem before a technology one.**
Who sets the standard? Who audits the assessors? Who is liable when a passport-holder harms a patient? A
credential that is not independently governed is not a credential — it is a vendor's claim. Expect to need
a **separate legal entity**: a standards council with clinical and regulatory representation owning the
framework, with Competen as technology provider. That is the CFA Institute / AWS split, and it is also the
defensibility — a governed standard is very hard to copy; a database is not.

**5.3 The biggest threat is a regulator doing it.** If a national nursing council runs its own competency
register, it wins by fiat. Two acceptable outcomes: we build it for them, or adoption is far enough ahead
that they adopt ours. Both are fine; being surprised is not. **Action: talk to a council early — not to
sell, to learn whether it is on their roadmap.**

---

## 6. Sequencing and funding logic

The vision is more defensible than a platform, but it **lengthens time to revenue and raises capital
requirement**, because a credential is a network good — worthless with one participant, very valuable with
many, and the crossing between is long and unfunded.

> **Practice funds the passport.**

Practice is sellable within months, self-serve, cash-generative and shares the passport's philosophy.
The passport is an institution built over years. Do not let the vision's scale delay the revenue; do not
let the revenue product become the whole company.

Indicative order — **not a commitment, and nothing starts until the build in flight is finished**:

| | Move | Purpose |
|---|---|---|
| 1 | Competen Practice to first paying practitioners | Cash, and proof anyone will pay |
| 2 | One nursing school pilot | Cold start, supply of holders |
| 3 | Framework derived from an accreditation standard already in force | Regulatory pull, hospital door |
| 4 | Two accredited testing centres (partner-owned) | Credibility of skill claims |
| 5 | Verification endpoint + revocation + custodian arrangement | Makes "reproducible" true |
| 6 | Governance entity conversation | Turns a vendor claim into a credential |

---

## 7. What would make this believable

Three falsifiable milestones, in order. Nothing else counts as evidence.

1. **One school signs and 200 students hold a passport.** Supply exists; cold start solved.
2. **One employer states in writing that they will accept it in place of their own assessment — for a
   single skill.** The first crack in "in addition to." One skill is enough.
3. **One person obtains a job, or clears a migration step, partly because of it.**

**On milestone 3 this stops being a software company.** Until then every architectural decision is
provisional and the asset to protect is optionality.

---

## 8. Where the money is, ranked

1. **Migration corridors.** Africa and South Asia export nurses; the Gulf, UK, Ireland, Canada import
   them. Verification today costs the individual 6–14 months and real money in PDFs and sealed envelopes.
   A governed, OSCE-backed passport is worth hundreds of dollars to that person and to the recruiter —
   a different order of magnitude from $3/month, and the African footprint becomes the supply-side moat
   rather than a limitation.
2. **Schools**, per student, per cohort, annually recurring.
3. **Hospitals**, pulled by accreditation rather than pushed as a nice-to-have.
4. **Regulators**, largest and slowest; a durable annuity if won.

---

## 9. Open questions, unanswered on purpose

- Does the standards council sit inside or outside the company, and when?
- Whose framework is version one — an accreditation body's, a council's, or ours?
- What is the liability position when a passport-holder harms a patient?
- Does the practitioner pay, the school, the employer, or the destination recruiter? (Probably all four,
  at different stages — but the *first* one must be chosen.)
- Is Practice the same brand as the passport, or deliberately separate?

---

## 10. What this document is not

- **Not a build authorisation.** Nothing here starts. See [[roi-review-before-building]] — the backlog gets
  presented for a decision, never launched from.
- **Not a replacement for [[cpr-optimisation-backlog]]** (`docs/CPR-OPT-001`), which is parked until the
  build in flight is done. That one is about whether Practice gets used; this one is about what the
  company is.
- **Not a valuation.** The gate is unchanged: zero paying users prices the same across one product or five.
  The number that moves it is the first ten practitioners paying for Practice.
