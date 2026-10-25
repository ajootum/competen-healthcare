# CKRI 444 — staging record (ezhvpgtcqcdsgylrxgdb), 2026-10-25

Applied after 443 by the coordinating session with the guarded runner. The file was applied whole: LF sha256
b83bb5b224cdc34e0020c558198efd00e645fbb868714217361c191ff6a1c1c0.
**Staging only. Production: not applied, needs its own owner GO.**

## Sequence

1. Apply 444.
2. Apply 444 again.
3. VERIFY-444.
4. ROLLBACK-444.
5. Re-apply 444.

## Fingerprint (the same CKRI query as 440–443)

| step | fingerprint | items |
|---|---|---|
| PRE | 0bfe8174644a27435a3167efc8dea2da | 442 |
| apply #1 | 22073062c5be4210ebf9d0b06c521e30 | 490 |
| apply #2 | 22073062c5be4210ebf9d0b06c521e30 (idempotent) | 490 |
| ROLLBACK-444 | 0bfe8174644a27435a3167efc8dea2da = PRE | 442 |
| re-apply | 22073062c5be4210ebf9d0b06c521e30 = apply #1 | 490 |

PRE differs from the 440–443 apply fingerprint (7b8c5759) for one expected reason. Learning 461 has since added
`learning_version_id` and the learning guard branches on staging. 444 does not touch the clinical guards.

## VERIFY-444 (all as expected)

- ckri_partner_agreement: RLS on, 0 policies.
- The 6 triggers.
- The 6 nullable columns.
- The 3 CHECKs.
- ckri_agreement_covers and ckri_expire_agreements: not executable by anon or authenticated.
- 0 agreements, 0 purposes with a basis, 0 exemptions.
- ckri_444_fingerprint: fad9f7160e6c8e7ccdb685773fa40a9c.
