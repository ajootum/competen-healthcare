# Competen Scholar: upload attestation

> **DRAFT FOR COUNSEL REVIEW. NOT LEGALLY APPROVED.** The text below is the product's, word for word, from `src/lib/individual/scholar/config.ts` (`UPLOAD_ATTESTATION`, `UPLOAD_ATTESTATION_REQUIRED`).

| | |
|---|---|
| Issued by | the Scholar operating entity [OWNER SLOT: registered name] |
| Counsel sign-off | **[COUNSEL SLOT]** |

## The attestation, given for every upload

> "I confirm this file contains no identifiable patient information, and I have permission to upload and use it."

**If it is not ticked, the upload is refused with:** "Confirm the file contains no identifiable patient information and that you have permission to upload and use it."

**What it covers:**
- **One attestation covers both points:** no identifiable patient information, and the right to upload and use the file.
- **It is recorded** with the material, with its time (`pii_attested_at`).

## The safeguards around it

- **Upload screening.** Uploads and the text extracted from them are screened for patient identifiers. They include health-service numbers, hospital numbers, dates of birth, contact details, dates, postcodes and national ID numbers. A file that trips the screen is refused.
- **Screening has limits.** It is pattern-based. A patient's name with no title, or an unusual identifier, can pass. The attestation and the Terms (Scholar Terms §4) stand behind it.
- **Privacy of uploads.** Uploads are private to the student, kept in private storage, never shown to other learners or educators, and never used for AI training or any library.

## For counsel

1. **Rights in third-party material.** Is "permission to upload and use it" enough for lecture slides and handouts the student received from their institution? Or should the Terms give a fuller statement of the licence the student must hold? (Scholar Terms §9.4 asks students to respect copyright.)
2. **Clinical examples.** Do the Terms need a de-identification standard for examples drawn from practice ("de-identified and lawful to use")?
3. **Contribution would need more.** None of this covers contributing material to a shared library, which is OFF in the pilot. That would need its own attestation, licence and de-identification standard (PRODUCTION-READINESS §5, items 9 and 9a).
