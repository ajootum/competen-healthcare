
## Staging rehearsal (coordinator, 29 Oct 2026, ezhvpgtcqcdsgylrxgdb)
- 680 sha256 `d74064038217e62c7ca6cfac25038469b0265024cefad2f504e8057cd07659a4`; ROLLBACK-680 sha256 `3ee74e78c3f5b5ceb794d2ed5f3ab9a51d88839a8bfd41c68f47f3f6152717bd`.
- Pre-state: the four 510 functions md5 content_problem e5cd302e, decision_guard f74e7e7a, evidence_guard f38df186, method_version_guard 3e26dee9; 1 method, 2 versions, 1 decision, 1 evidence row.
- Apply 1: committed. 3 new functions, 4 replaced, 8 new columns, kind CHECK now includes knowledge_exam and clinical_reasoning. Existing rows unchanged.
- Rollback rehearsal: committed. The four 510 function fingerprints returned EXACTLY to the pre-state; the 680 columns and kinds gone; rows unchanged.
- Apply x2: both committed, identical fingerprints (content_problem 7893b149, decision_guard fcadb90a, evidence_guard f30856f9, method_version_guard 22eb8d16, plus the 3 new functions). Idempotent.
- staging-c5-verification-acceptance.ts updated for 680's publish SoD: a second synthetic Studio Administrator (publisher) publishes; a new check 17-680 proves the author cannot publish their own draft. Running it needs the owner to appoint the publisher identity on staging (manual, HTTP harness, not in CI).
- Deploy order: deploy this code BEFORE applying 680 in production (680 refuses the old saveDraft call).
