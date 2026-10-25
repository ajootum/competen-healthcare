# Competen Individual: minimum pilot legal documents (DRAFTS FOR COUNSEL REVIEW)

**Authority:** owner, "COMPETEN — APPLICATION DEPLOYMENT AND PILOT PREPARATION", §7:

> "Complete the minimum legally required pilot documents. Keep student-derived shared case publication disabled until its separate legal and privacy requirements are satisfied."

## Status

**None of these documents is legally approved or published, and nothing here claims legal sign-off.**
- Each document carries a counsel sign-off slot and owner slots.
- `DATA_ROLES.confirmed` stays `false`.
- The documents published at `/legal` for the internal staff pilot (`draft-2026-10-23`) are unchanged by this set.

**The pilot these documents describe, as built and configured on 25 October 2026:**
- invitation-only;
- Scholar 18+, confirmed by the inviter;
- no charges;
- AI metering OFF, with an hourly AI limit;
- the case library and student contribution OFF.

## The set: PRODUCTION-READINESS §5, items 1–8 and 10

| # | §5 item | Draft | Issued by |
|---|---|---|---|
| 1 | Holdings: Individual Terms of Use | `01-holdings-individual-terms.md` | Competen Holdings |
| 2 | Holdings: Privacy Notice | `02-holdings-privacy-notice.md` | Competen Holdings |
| 3 | Scholar operator: Terms | `03-scholar-terms.md` | Scholar operating entity |
| 4 | Scholar operator: Privacy Notice | `04-scholar-privacy-notice.md` | Scholar operating entity |
| 5 | Data roles | `05-data-roles.md` (a proposal; `confirmed = false`) | for counsel |
| 6 | Scholar AI-processing consent v3 | `06-scholar-ai-processing-consent-v3.md` (product text, word for word) | Scholar operating entity |
| 7 | Adult eligibility statement | `07-scholar-adult-eligibility.md` (product text, word for word) | Scholar operating entity |
| 8 | Upload attestation | `08-scholar-upload-attestation.md` (product text, word for word) | Scholar operating entity |
| 10 | AI allowance and fair-use statement | `09-ai-allowance-fair-use-statement.md` | Holdings and Scholar operator |

**Not in this set, by decision:**
- items 9 and 9a, case contribution, its licence and the de-identification standard: contribution stays OFF;
- item 11, commercial terms: charging stays OFF;
- item 12, the LEGAL-002 register decision: an owner decision, recorded in `docs/COMPETEN-LEGAL-002-legal-document-register-design.md`.

## Owner slots, across the set

- The registered legal names, numbers and addresses of Competen Holdings and of the Scholar operating entity (or the interim arrangement while it is not yet incorporated).
- The verified support and privacy contacts, and the responsible officers.
- Counsel's sign-off on each document.
- The owner's approval and the effective dates.
- The production email and SMTP providers.
- The backup retention period.

## Counsel decisions, gathered from the documents

1. **The data-role allocation** (05), and the intra-group agreement it needs.
2. **Lawful bases**, purpose by purpose. Is Scholar AI processing on consent, or on contract with consent as a safeguard?
3. **Provider terms and international transfers:** Supabase (production in AWS eu-west-1), Vercel, Anthropic, and the email provider.
4. **The retention schedule.**
5. **PDPO registration** for each controller.
6. **The limitation of liability, and governing law and mandatory consumer rights**, for each entity.
7. **The acceptance structure.** Today the product records one terms version and one privacy version per acceptance, and both entities point at one set. Should Scholar users accept one consolidated set, or separate entity documents?
8. **Whether Professional AI needs its own notice or consent**, as Scholar has.
9. **Accepting the age-evidence model:** confirmed by the inviter, not verified.

## After sign-off (LEGAL-001 §7 and §9)

1. Create `docs/legal/REGISTER.md` (LEGAL-001 §9) at the first sign-off, with one row per signed version.
2. Publish each signed version at its permanent URL (`/legal/holdings/…`, `/legal/scholar/…`, LEGAL-001 §4), as a new entry. The interim version stays at its own URL.
3. Set the published versions and URLs in configuration (`INDIVIDUAL_LEGAL_*`), or in the LEGAL-002 register once it is built. Only then do the legal gates open.

## One product setting these documents depend on

The Scholar documents (03, 04) describe AI feedback on clinical-reasoning answers as **off** for the pilot (owner, 25 October 2026). Today that holds only where the Individual policy `scholar_case_reasoning_feedback` is set to "the student's own review only".
- **Staging has no published value**, so the default applies and the feedback is ON.
- With metering OFF, model eligibility does not gate it.

The owner sets this before publication: it is configuration, not code.
