# UNIFIED-GOVERNANCE-V1 follow-ups walk, 2026-11-03T20:41:40.023Z

Server: http://localhost:3178 (worktree competen-gov2, staging with 940, 941, 942). Person A = owner fixture (CEO). Person B = demo reviewer (Checklist Studio Reviewer + Quality Council Member, appointed by the proof script for policy review).

| Check | Result | Note |
|---|---|---|
| F7 inbox draws nothing about deadlines or overdue work while none is configured | PASS |  |
| F5a Policy Manager shows the governed policies section and the legacy records apart | PASS |  |
| F5b the policy version page carries the three-stage pathway and Submit v1 for review | PASS | Submit v1 for review. |
| F5c A submitted and cannot approve own policy | PASS |  |
| F5d B's inbox lists the policy under My actions with Review & approve (Quality Council Member holds policy review) | PASS |  |
| F5e B approved the policy in one interaction | PASS | Publish v1. |
| F5f A sees Publish v1 and may publish the exact approved version | PASS |  |
| F5g the policy is published by A | PASS | state=published |
| F5h Controlled Content lists the policy | PASS |  |
| F5i Governance History shows the policy decision and publication | PASS |  |
| F6 the framework workspace names the Publisher group and says the author or submitter may publish the exact approved content | PASS |  |
| F5j Document Template Studio shows the pathway to publication | PASS |  |
| F5k the author saves a changed documents draft | PASS | 200 |
| F5l the pathway says Prepare is current and offers Submit this draft for review | PASS |  |
| F5m after submission the submitter cannot approve and is told who must | PASS |  |
| F5n the database refuses publishing the changed documents configuration before approval | PASS | 409 not approved. The documents configuration is published only as a draft that an independent |
| F5o-pre B switches governance context to the Individual Product Administrator appointment | PASS | 200 |
| F5o B's inbox lists the document templates review | PASS |  |
| F5p B approved the documents draft; Publish is the next stage | PASS |  |
| F5q the submitter publishes the exact approved documents draft | PASS | 200 |
| F5r Governance History shows the document templates review records | PASS |  |
| F-mobile the policy page fits 375 px | PASS | panel overflow 0px |

22/22 PASS. Screenshots 01-15 in this folder.

Notes. Person B holds the Checklist Studio Reviewer, Clinical Content Reviewer and Quality Council Member positions (quality product line) and, for the documents flow, an Individual Product Administrator appointment (platform product line) made by the walk setup; effective authority is the union within ONE product line (640), so the walk switches B's governance context to the Individual appointment before the documents review, as a person would with the context switcher. The walk saves a changed documents draft through the studio's own save route, submits it, proves the database refuses an early publish (409, in words), B approves from the inbox, A publishes the exact approved draft with the Individual policy publish, and the history shows the records. Staging artefacts: governed policies "Governed policy walk <hhmm>" (POL-000001 onwards) and "Walk policy <hhmm>", the documents configuration published once with a renamed first template, and B's two extra appointments. Harmless demo data.
