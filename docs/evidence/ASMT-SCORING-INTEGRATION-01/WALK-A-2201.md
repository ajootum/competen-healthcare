# ASMT-SCORING-INTEGRATION-01 staging walk part A 2026-11-03T22:07:44.072Z (localhost:3175 -> staging; author = owner fixture, approver/publisher = publisher fixture)

| Result | Check |
|---|---|
| PASS | Correct step shows the graded profile for sheet 1 with the Not configured interpretation |
| PASS | Register step shows the two weighted profiles with the (2 x Yes) + Partial formula |
| PASS | registered CA-000034, CPA-000015, DA-000015 |
| PASS | CA-000034: Scoring & Evaluation shows profile "Graded assessment (rating scale)", N/A never zero, threshold Not configured, result preview |
| PASS | CA-000034: the 0 to 6 scale with numeric values shown |
| PASS | CA-000034: accepted and saved; 1 problem(s) (the unpublished scale only), 6 saved profile tests pass |
| PASS | CPA-000015: Scoring & Evaluation shows profile "Weighted agreement audit (documented versus observed)", N/A never zero, threshold Not configured, result preview |
| PASS | CPA-000015: Yes = 2 (met), Partial = 1, No = 0 shown |
| PASS | CPA-000015: accepted and saved; 0 problem(s), 8 saved profile tests pass |
| PASS | DA-000015: Scoring & Evaluation shows profile "Weighted documentation compliance audit", N/A never zero, threshold Not configured, result preview |
| PASS | DA-000015: Yes = 2 (met), Partial = 1, No = 0 shown |
| PASS | DA-000015: accepted and saved; 0 problem(s), 8 saved profile tests pass |
| PASS | CA-000016 (earlier draft): Apply this profile is offered on the Scoring & Rules tab |
| PASS | CA-000016: the graded profile is applied to the earlier draft and the separate proposed competency decision template is reported (draft, not active) |
| FAIL | CA-000034-SCALE carries the imported 0 to 6 levels |
| FAIL | stopped: locator.waitFor: Timeout 180000ms exceeded.
Call log:
[2m  - waiting for getByRole('button', { name: 'Review & approve' }) to be visible[22m
 |
