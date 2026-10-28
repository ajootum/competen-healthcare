# Migration 640: staging record (coordinator, 28 Oct 2026)
- **File:** `640-hq-cross-cutting-roles-item-level-sod.sql`, sha256 `7ec13907a9f26d7cf152870f196a13654cbe868dcc5624ad65b754f4955d72ad`. SHA256SUMS: all 4 files OK. House rules: ALL CLEAR (6 non-blocking warnings).
- **Target:** staging ezhvpgtcqcdsgylrxgdb (has 610 and 620).

| Step | FINGERPRINT | Other |
|---|---|---|
| PRE | 0 0 0 0 0 | |
| Apply #1 and #2 (both committed) | 2 6 17 11 7 | VERIFY 13/13 true |
| ROLLBACK | 0 0 0 0 0 | hq_capability_exclusions() = 15 |
| Re-apply (current staging state) | 2 6 17 11 7 | VERIFY 13/13 true (no false rows) |
